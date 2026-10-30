# M1 — Persistent Field Authority / 常駐虛擬計算場

**Date:** 2026-10-30 (Asia/Taipei)  
**Status:** REFERENCE_IMPLEMENTED / Linux loopback-tested; Windows and real physical LAN **NOT_RUN**.  
**Contract:** Adds a local control service to existing `field/v0.1` without changing the field-spec envelope.

## Scope and purpose

M1 closes the gap between (a) a one-shot CLI that can save a state file and
(b) a field that a human, application, or later AI controller can call repeatedly
while its *owning process* remains alive.

The field authority is a single process that can own multiple independent fields.
Each field has a stable ID, a validated immutable `FieldSpec`, logical units,
logical memory domains, a persisted successful-run epoch, and last committed
results. A field survives a **graceful process restart as its serialized identity
and state**, not as background compute while the machine is powered off.

The `serve` CLI exposes an authenticated loopback-only control API. Its workers
remain explicitly selected, stateless, allowlisted `sum`/`mul` execution backends
and continue to use the independent TLS 1.3 mTLS worker endpoint. Cloud leases,
peer discovery, cross-host failover, dynamic topology, and arbitrary application
execution are outside M1.

## Non-negotiable invariants

1. **Single authority / single writer** to any persistent root; `serve` takes a
   `.authority.lock` file, and refuses a concurrent or unverified stale lock.
   After an unclean crash, the operator must verify no other process owns the
   directory *before* removing the stale lock. Do not attach two daemons to the
   same root; this is not a distributed consensus protocol.
2. **Authoritative commit boundary**: an execution's epoch/results become visible
   only after its new snapshot file is safely replaced. If execution or snapshot
   write fails, neither the in-memory state nor the previously committed state
   is advanced. This is filesystem-level atomic replacement, **not** a guarantee
   of durability across sudden power loss or a malicious filesystem.
3. **Per-field serialization**: concurrent operations on the same field are
   serialized by a per-field mutex. Different fields may run concurrently.
4. **Domain semantics**: `volatile` domain data is lost on restore; `snapshot`
   domain KV data survives. Put operations do not increment the computation epoch.
   Snapshot JSON is plaintext, not suitable for secrets.
5. **No untrusted code execution**: `sum`/`mul` pure functions only; no shell,
   arbitrary binary loading, arbitrary file-path access, or open endpoint for
   program uploads.
6. **Isolation is logical**: a field's declared unit count is not its CPU-core
   count, thread count, physical RAM allocation or dedicated OS address space.

## How to run

From the repository root (Go 1.23+; use a currently patched Go version):

```bash
go run ./cmd/evefield token -out ./control.token
go run ./cmd/evefield serve -data ./field-data -token-file ./control.token -listen 127.0.0.1:8765
```

In a second terminal:

```bash
go run ./cmd/evefield ctl create -spec examples/local.json -token-file ./control.token
go run ./cmd/evefield ctl list -token-file ./control.token
go run ./cmd/evefield ctl run -id reference-local -token-file ./control.token
go run ./cmd/evefield ctl inspect -id reference-local -token-file ./control.token
go run ./cmd/evefield ctl put -id reference-local -domain continuity -key demonstration -value persists -token-file ./control.token
go run ./cmd/evefield ctl get -id reference-local -domain continuity -key demonstration -token-file ./control.token
```

Stop `serve` normally (Ctrl-C), then restart with identical `-data` and
`-token-file`. `inspect` returns the same field identity, committed epoch and
results; the `continuity` KV still contains `demonstration=persists`. Re-creating
an existing ID returns a conflict. CLI `ctl` always requires an explicit local
loopback URL; it refuses a remote/non-loopback control URL.

### Remote worker delegation while the local authority remains alive

A stateless LAN worker can be registered at authority startup:

```bash
# Use safely provisioned role-specific certificates and a trusted LAN.
go run ./cmd/evefield serve -data ./field-data -token-file ./control.token \
  -remote worker=https://127.0.0.1:8443 -ca ./dev-certs/ca.crt \
  -cert ./dev-certs/client.crt -key ./dev-certs/client.key
# In another terminal, after starting an mTLS worker:
go run ./cmd/evefield ctl create -spec examples/lan.json -token-file ./control.token
go run ./cmd/evefield ctl run -id reference-lan -token-file ./control.token
```

The worker itself is still started with `evefield worker`. A remote operation
may finish while the coordinator fails or loses contact. Only the coordinator's
persisted field epoch is authoritative.

## Control endpoints — local only

Every request must include `Authorization: Bearer <control-token>`; any browser
`Origin` header is rejected. Responses set `Cache-Control: no-store` and do
not enable CORS. The daemon **refuses** wildcard IPs and non-loopback listeners;
TLS is intentionally **not** offered on the control endpoint because it is
restricted to the local machine. This API must not be reverse-proxied to a
network. If a remote operator is needed, implement separately audited secure
control with identity, capability grants and revocation.

| Verb | Path | Behavior |
|---|---|---|
| `GET` | `/v1/fields` | List fields, sorted by identity |
| `POST` | `/v1/fields` | Validate and register a new JSON `field/v0.1` spec |
| `GET` | `/v1/fields/{id}` | Inspect committed epoch/results/unit count |
| `POST` | `/v1/fields/{id}/run` | Execute its immutable DAG, atomically checkpoint and return run report |
| `GET` | `/v1/fields/{id}/memory/{domain}/{key}` | Fetch a logical string KV value |
| `PUT` | `/v1/fields/{id}/memory/{domain}/{key}` | Store `{"value":"..."}`, respecting domain quota |

Identifiers in API paths are 1..96 safe ASCII characters (`A-Z`, `a-z`,
`0-9`, `_`, `-`, `.`), excluding the special `.` and `..` segments. Control
requests are capped at 1 MiB (field creation) and 64 KiB (memory updates).
Worker API/auth remains as documented in `INTERFACE_CONTRACTS.md`.

## Persistence and recovery

- Root: `-data ./field-data` (owner-only on supported POSIX filesystems).
- For each field: `<root>/<field_id>/spec.json` and `state.json`.
- New fields are staged under a private `.new-field-*` directory then renamed
  into place. Incomplete stages are not authoritative field objects.
- State update uses a temporary file, flush, and same-filesystem rename before
  publishing the new in-memory state. An invalid existing snapshot fails startup
  loudly; M1 does **not** silently reset data or accept corrupt snapshots.
- No version migration, distributed replica, WAL, quorum, persistent worker
  ownership, or crash-consistent multi-file reconfiguration exists in M1.
- A future M2 can add quiescent reconfiguration with a transactional envelope,
  control lease, backend capability negotiation, plus robust crash-recovery tests.

## Measured gates

- New unit tests: per-field serialization under 20 concurrent invocations,
  independent multi-field identities, restart recovery, volatile expiry,
  duplicate/traversal rejection, corrupted-state fail-closed, and persistence
  failure without partial commit.
- HTTP tests: bearer denial, Origin denial, create/list/inspect/run/put/get,
  malformed JSON and oversized-body rejection, non-loopback refusal.
- CLI smoke: two independent `serve` processes across a graceful restart,
  matching epoch/results and persisted memory; tested on Linux loopback.
- Linux Go unit tests / Race Detector / Vet / Build are verified in M1.
- Windows and two physical LAN hosts remain **NOT_RUN** until separate evidence.

## Explicit next candidates (not implemented)

1. Transactional quiescent field reconfiguration: unit count, domains and
   backend binding, with reversible migrations.
2. Worker capability handshake, lease, health, rejection/retry evidence and
   idempotency keys; preserve local authority and security.
3. Nontrivial, measurable workload backend: WASM or restricted native worker,
   subject to separate isolation/security gates.
4. Distributed field replication and failover only once authority semantics
   and the security model have passed independent testing.
5. Future theory adapters (NOVA / EML-SF / MACR / ODTS / TCGCT / GMA) remain
   optional and must not alter current public contracts without versioning.
