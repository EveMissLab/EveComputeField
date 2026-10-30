# M1 — Persistent Field Authority (integration contract)

Date: 2026-10-30 (Asia/Taipei)  
Repository: `EveMissLab/EveComputeField`  
Branch: `feat/m1-persistent-field-authority`  
Status: **implementation prepared and Linux loopback-tested locally; GitHub code integration pending**.

## Purpose

Turn the one-shot `field/v0.1` runner into a locally managed, long-lived,
callable **field authority**, without declaring that virtual logical units are
physical CPU cores or that a paused field continues computing when powered off.

## Required invariants

1. A field has stable `field_id`, `unit_count`, validated DAG, memory domain
   declarations, successful-run `epoch`, and last committed results.
2. One local authority may manage multiple independent fields. One writer owns
   each persistence root. Calls on one field are serialized; independent fields
   may be scheduled concurrently.
3. A successful run persists its updated state **before** the new epoch becomes
   visible. A failed task or checkpoint must not partially advance authority.
4. `snapshot` memory survives a graceful process restart. `volatile`
   memory does not. State is plaintext; do not store secrets.
5. Local control uses only explicitly bound loopback IP addresses, a generated
   high-entropy bearer token, strict JSON and request-size limits.
6. Remote workers remain allowlisted, stateless, pure-compute, TLS 1.3 mTLS
   endpoints. No public remote administration or arbitrary shell execution.

## Proposed additive local API

- `GET /v1/fields` — list fields.
- `POST /v1/fields` — create field from validated `field/v0.1` spec.
- `GET /v1/fields/{id}` — inspect field.
- `POST /v1/fields/{id}/run` — execute DAG and checkpoint.
- `GET /v1/fields/{id}/memory/{domain}/{key}` — read string value.
- `PUT /v1/fields/{id}/memory/{domain}/{key}` — write string value, respecting quota.

## Verification to require before merge

- Unit tests for duplicate IDs, bad specs, cycles, snapshot corruption,
  memory quota, failed checkpoint rollback, and concurrent run serialization.
- Linux loopback CLI smoke: create → run → checkpoint → restart → inspect.
- `go test ./...`, `go test -race ./...`, `go vet ./...`, `go build ./...`.
- Windows native and two physical LAN machines: **NOT_RUN**.
- Crash-consistent multi-file reconfiguration, cloud continuity, failover and
  pulse-level physical optimization: **NOT_IMPLEMENTED**.

The existing field schema remains `field/v0.1`. M1 is an additive management
boundary, not a claim that NOVA, TCGCT, EML-SF, MACR or other future backends
are already integrated.
