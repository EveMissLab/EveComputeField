# M4 — Local Placement & Virtual Memory Domain Bridge

**Track:** EveComputeField M4-P0, 2026-10-31 (Asia/Taipei)
**Scope:** One local machine; bounded experimental runtime, no cloud dependency.
**Status:** Implemented reference mapping, evidence-gated placement, and shared-memory-domain prototype. **Not** a new OS MMU, automatic cross-process memory space, production workload scheduler, or a claim of hardware pulse control.

## Why this phase exists

The M3 R3 study measured a host-specific transition from worker overhead to useful parallel computation. Its `NetworkSolver` already supports a quiescent `reorganize(workers, mode, exchange)` without changing its physical water state, but its workers execute fixed contiguous tile ranges. Meanwhile the M1/M2 FieldSpec logical-unit count can change without physically changing worker placement. Those are **different** concepts.

M4 begins to connect the control plane to an executable backend **without falsely equating** 360/720 virtual units with 360/720 cores. M3 scientific numerical kernels and historical timing files remain unchanged.

## Layer model

```text
Field identity / stable logical-unit count (M2)
        |      experimental mapping association
        v
  M4 placement: unit_id -> stable tile_id -> real worker index
        |      exactly mirrors R3's contiguous TilePool partition
        v
  R3 Worker Pool (0 / 2 / 4 / 8) + unchanged finite-volume kernel
        |
        +--> SharedArrayBuffer double banks (h0,q0,h1,q1)
                   |
                   +--> M4 VirtualMemoryDomain v0:
                        named, checked, generation-stamped, zero-copy views
```

`logical_units` changes mapping associations, **not** actual Worker Pool count. The MVP does not introduce arbitrary non-contiguous tile migration or native FieldSpec ownership of the fluid arrays; those are future integration steps.

### Placement contract

`createPlacement(...)` emits deterministic `ecf-local-placement/v1` records: field identity, logical-unit count, tile ownership, worker ranges, worker seams, execution mode, exchange mode and SHA-256 of canonical mapping inputs. The worker boundaries are **exactly** `floor(worker_index * tiles / workers)`, matching the original R3 pool. All tiles are covered once. Work cannot be scheduled for a non-existent tile, out-of-range unit or worker.

`applyPlacement(...)` works only when the caller has established a *quiescent* solver (the existing resident manager already serializes reorganizations). It validates the plan hash against the actual layout, invokes the existing R3 reorganization API and checks unchanged physical-state hash and unchanged SharedArrayBuffer identities. It emits a receipt, not a transaction or rollback guarantee on an arbitrary external adapter.

### Decision contract

`selectPlacement(...)` consumes **current-run matched-state** measurements (`ecf-m4-matched-probes/v1`). It checks graph/kernel identity, physical grid shape, two alternating measurement blocks, state-hash agreement for *every* pair, and sufficient samples. For this exploratory operational policy a candidate must:

1. Deliver a median paired serial/parallel ratio of at least **1.10**;
2. Show a ratio greater than 1 in both measured blocks;
3. Have positive estimated savings after startup overhead amortized across the declared expected call count.

Otherwise the default is serial. This is **not** a calibrated confidence interval, independent statistical confirmation, or a universal device threshold. Latency measurements include the bounded solver hot-call interval but not rendering, checkpoints, end-to-end service startup or network RPC. The local benchmark records those exclusions and raw samples.

## Virtual Memory Domain v0 — what is real now

`VirtualMemoryDomain` is a **software-level logical virtual memory domain**, separate from M2's `volatile/snapshot` KV domains.

- A domain has `fieldId`, `domainId`, a byte quota, a bounded set of named typed regions, and declared `quiescent-barrier` consistency.
- `allocate()` creates owned SharedArrayBuffer memory; `borrow()` registers an already existing SharedArrayBuffer without copying.
- `handle()` returns stable logical location metadata, element type, logical length, access flag and **generation**. `view()` validates the handle, offset, length and write request before yielding a typed view.
- `rebind()` accepts a fresh, same-size SharedArrayBuffer at a quiescent point, bumps the generation and invalidates subsequent lookups by old handles.
- `observeR3Banks()` borrows the unchanged R3 `h0/q0/h1/q1` storage, making the currently active bank discoverable without copying the state.

**Critical limitations:** JavaScript TypedArrays cannot be physically revoked or made secure read-only after handing out an underlying raw view. The access flag is a *cooperative API contract*, not memory protection. Previous views remain usable after remap. SharedArrayBuffer permits true data races unless external barriers/Atomics enforce ownership. No sparse paging, virtual address translation, process-independent shared memory, kernel page faults, NUMA placement, compressed pages, mmap, GPU residency, transactional persistence, memory eviction or OS-backed protection is implemented. These are staged research targets, not pre-existing features.

## Incremental memory backend migration (not yet implemented)

1. **M4-P0 (this phase)** — explicit virtual domain schema, typed handles, generations, quotas, and borrowed/owned shared buffers; distinguish field memory domains from R3's raw storage.
2. **M4-P1** — allocate R3 hot arrays *through* the domain, rather than borrowing them. Preserve exact double-bank, numerical hash and worker ownership; measure memory-bandwidth/GC overhead before accepting.
3. **M4-P2** — introduce pluggable region backends (`shared-ram`, `file-backed`, later OS-specific mapped pages); require explicit migration, dirty-region accounting, zero-copy eligibility checks and failure atomicity at quiescent boundaries.
4. **M4-P3** — locality-aware placement with CPU/cache/NUMA measurement and optional per-tile or per-region residency changes; fall back to unchanged reference execution whenever memory traffic outweighs computational benefit.
5. **Longer-term** — evaluate NOVA, EML-SF, MACR and other EveMissLab native infrastructure *only after* individually verifiable contracts; none are required to run M4-P0.

The goal is to let a field control **where and how logical data lives** over time. Adding an abstraction layer alone does not guarantee better performance; measurements must include lookup, copy/migration, synchronization, checkpoint and cache-miss costs.

## Run on Windows (PowerShell) or Linux

Requires Node.js 24 for the measured R3 research path, Go for the original local authority, and a local repository checkout. The M4 benchmark itself does not need cloud access, a running M2 authority, or a second computer.

```powershell
# At the repository root:
node research/run-tests.mjs
node research/m4/benchmark.mjs --units 720 --cells 2048 --workers 2,4 --pairs 4 --steps 16 --calls 32
```

Output is JSON on stdout. To save intentionally without overwriting existing evidence, add e.g. `--out .evefield-local/m4-probe.json` (the ignored runtime directory must already exist). Do not commit identifiable raw machine information before review.

### Reproducibility / Release gates

- All M3 tests must stay green, including numerical parity and R3 state hashes.
- M4 deterministic mapping, bounds, invalid handle, stale generation, quota, refused unbound evidence and measurement fallback tests must pass.
- M4/R3 integration must prove exact physical-state hashes through serial -> worker -> serial transitions and unchanged backing buffers.
- Do not interpret a CI smoke or single-host benchmark as proof of universal crossover or of CPU physical-pulse optimization.
- Historical M3 R1–R3 evidence is frozen; M4 produces separately versioned JSON artifacts only when explicitly requested.
