# Public Contract / 可替換執行介面 v0.1

**Canonical source:** UTF-8 Markdown + JSON source files. Do not infer a new mathematical notation from the chat rendering.

## FieldSpec

Use `examples/local.json` or `examples/lan.json` as canonical examples. The `field/v0.1` envelope carries:

| Property | Type | Semantics |
|---|---|---|
| `version` | string | Exact `field/v0.1` |
| `field_id` | string | Stable logical identity; ASCII 1–96 chars |
| `unit_count` | integer | Reference accepted 1..65,536; **not** OS threads |
| `memory_domains[]` | list | Domain ID, `volatile`/`snapshot`, reference quota |
| `tasks[]` | list | ID, allowlisted operation, literal inputs, explicit dependency IDs, optional node alias |

Unknown JSON properties are denied; DAG cycles, unknown dependencies, unsupported operations, and non-finite inputs are rejected. Spec digest is a SHA-256 digest of the current Go JSON serialization: **not yet a cross-language canonical serialization standard**.

## Backend and authority split

`field.Executor` is the **bootstrap reference backend**:

```go
type Executor interface {
    Execute(ctx context.Context, op string, inputs []float64) (float64, error)
}
```

This *deliberately narrow* API demonstrates replaceability but is not the ultimate algebra of compute-field operations. Do not force future NOVA graphs, tensor types, or effect systems through `[]float64`.

Future-version target (conceptual; **not implemented**):

```text
FieldController:
  Create(FieldSpec) -> FieldHandle
  Inspect(FieldID) -> StateProof
  Quiesce(FieldID) -> BarrierProof
  Reconfigure(FieldID, GraphPatch | UnitPatch | DomainPatch) -> Outcome
  Dispatch(FieldID, WorkGraph, CapabilityEnvelope) -> RunReceipt
  Snapshot(FieldID) -> SnapshotRef
  Resume(SnapshotRef) -> FieldHandle

ExecutionBackend:
  Prepare(WorkBundle, ResourceConstraints) -> CapabilityResult
  Execute(PreparedWork, CancellationToken) -> EvidenceBundle
  Release(ResourceLease) -> ReleaseReceipt

MemoryBackend:
  Allocate(DomainSpec) -> DomainHandle
  Resolve(DomainHandle, LocationOrObjectKey) -> ValueRef
  Checkpoint(DomainHandle, Epoch) -> SnapshotRef

SchedulerBackend:
  Plan(CausalGraph, ResourceState, Policy) -> PlanEvidence
  Commit(PlanEvidence, ObservedEffects) -> CommitReceipt
```

The abstractions **must not** assume every computation is serializable as a single RPC, every graph is a DAG, or a single time model is universally adequate. More expressive models will require negotiated protocol evolution, not a silent retrofit.

## Memory semantics

- `volatile`: in-process, cleared when the coordinator restarts.
- `snapshot`: in-process KV saved to JSON if caller explicitly passes a `-state` file or calls `State.Save`.
- `quota_bytes`: reference limit by UTF-8 byte count of keys + values. No memory-page accounting in v0.1.
- Snapshot files are **not encrypted**. They must not contain credentials or third-party private data.
- Cross-node memory reads are **not implemented**.

## Worker wire transport

- TLS: TLS 1.3, `RequireAndVerifyClientCert`, explicit CA trust.
- `GET /v1/capabilities` → capabilities manifest; only authenticated mTLS clients on the actual worker server.
- `POST /v1/execute`:

```json
{"version":"field/v0.1","op":"sum","inputs":[2,3]}
```

Response:

```json
{"version":"field/v0.1","value":5}
```

Maximum request: 64 KiB; disallow unknown properties, unknown operations, too many numbers, and non-finite results. Worker has no arbitrary process execution, filesystem read, plugin loader, or remote code execution endpoint.

### Network is not the Field authority

Worker calls are limited to pure computation. A remote task can finish while the coordinator fails; the contract currently does not make that remote completion an authoritative field commit. There is no multi-node consensus, leased authority, deduplication ledger, or distributed checkpoint. Future additions need explicit identity, capability grants, idempotency keys, causal ordering, failure recovery, and revocation.

## Reconfigure / lifecycle

`Spec.Resize` / `State.Reconfigure` demonstrate that a logical unit count can change while preserving surviving indexed `UnitID`s; caller **must** quiesce the field, serialize the update, and save a new snapshot. There is no live distributed resize or online migration yet.

## API migration discipline

The version string belongs to the **semantic protocol**, not the implementation language. Changing Go → Rust / NOVA does not require a protocol bump *if* identity, validation, state transitions, errors, ordering, and failure semantics remain compatible. Any breaking semantic change **does** require a new protocol version and a migration plan.

## M1 additive control service (implemented)

The original `field/v0.1` spec and stateless mTLS worker wire format remain
unchanged. New local admin interface is documented in
[M1_FIELD_AUTHORITY.md](M1_FIELD_AUTHORITY.md). It provides a per-process
multi-field registry with stable IDs, `GET/POST /v1/fields`, inspect, repeated
`POST /v1/fields/{id}/run`, and controlled domain KV GET/PUT. Every request
requires a secret-bearing Authorization header; **only loopback IPs** are
accepted as listeners. There is no remote admin credential exchange.

Successful field runs become authoritative only after filesystem checkpoint;
failed runs do not mutate the committed epoch. KV updates do not count as
compute epochs. Underlying memory domains are typed logical KV stores, not
real virtual address spaces or a transparent distributed-RAM service. M1 does
not support live reconfiguration through control endpoints, worker consensus,
or physical pulse optimization. No future native adapter is implied.
