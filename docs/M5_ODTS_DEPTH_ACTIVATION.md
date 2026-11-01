# M5 — ODTS-Informed Deep Graph Field Activation / 深度圖論激發計算場

**Date:** 2026-11-02 (Asia/Taipei)  
**Status:** M5-P0 research implementation; local unit verification; R3 bridge must pass Linux/Windows GitHub CI and local Windows acceptance before promotion.  
**Owner:** EveMissLab / Neo.K  
**Source:** UTF-8 Markdown, with canonical `$...$` and `$$...$$` mathematics only.  
**Deployment:** local-only; no cloud, live process migration, or new kernel privileges.

## 1. Architectural correction

EveComputeField should not be described as a flat set of logical worker slots. A **compute field has explicit depth**: (i) dependency/causal graph depth, (ii) ODTS ordinal candidate depth, (iii) spatial or influence-domain depth, represented with separate coordinates and contracts. These are NOT interchangeable. The primary reference is the owner's ODTS R0–R2C main and R3 multi-ordinal research branch (2026-11-02), particularly the R0 readiness/commit gate and R2/R3 conservative influence cones.

This initial implementation is **independently authored in the MIT-licensed EveComputeField repository** from the owner's ODTS design requirements. It does not copy the pending-license ODTS implementation into the public repository, does not merge or change ODTS, and does not claim an ODTS Rust/Go/Python ABI.

| Layer | M5-P0 realized contract | Not claimed |
|---|---|---|
| Dependency depth | Typed DAG with cross-ordinal edges, deepest READY first, explicit descendant invalidation | Inference of undeclared dependencies |
| Ordinal depth | Bounded candidate branches, verified parent/event/revision, actual-event-only sequential commit, fallback | Predicting real future events or replacing ODTS R0 authority |
| Spatial influence | Caller explicitly declares complete local dependencies; otherwise global invalidation | Automatic locality inference for arbitrary PDEs |
| Compute backend | Optional unchanged R3 `NetworkSolver` full-step adapter with independent full-step verifier | Incremental Saint-Venant PDE solver / physics acceleration |
| Memory | Buffer-bound bounded candidate payloads; R3 snapshots remain owned by R3 | EML-ADDR authorization, VMD paging, persistent zero-copy physical state across branches |

## 2. Depth semantics

Write `ordinal` for absolute event position, `d = ordinal - committed_ordinal` for relative candidate depth, and `graph_dependents(v)` for all transitive descendants. The official state is at relative depth zero. Tasks at deeper ordinals may run earlier **only if all declared causal inputs are present**. Observer work at a shallow ordinal need not block an unrelated deeper physics computation. The priority is by descending absolute ordinal, then descending branch priority, then deterministic identifier.

There are two independent M5 reference objects:

- `DepthExcitationGraph`: a deterministic dependency graph of `source`, `compute`, and `observer` nodes. `setSource(..., influence='declared')` removes only the strict descendant cone; use it **only** when all dependencies are complete. The **default** `influence='global'` conservatively invalidates all non-source work. Version changes also invalidate computed work. Re-evaluation is deep-priority among READY nodes.
- `OrdinalDepthField`: manages explicit future branch event sequences, optional inherited prefix/fork, bounded candidate bytes, separate shallow observers, parent/event/world/model digest lineage, and authority-preserving `commit(actualEvent)`. Candidate outputs are not authoritative. A mismatch triggers the reactive transition and drops invalid futures.

An R3 event contains only a bounded number of full solver steps (`{kind:'advance',data:{steps}}`) with no untrusted executable code. Different event histories may produce different physical states. `stateFromBytes` compares the unchanged R3 full physical-state digest. The optional `verifyR3Candidate` recomputes the full serial R3 transition at commit as a correctness diagnostic; its cost is real and must be included in benchmarks.

## 3. Exact safety envelope

For a real field kernel, local reuse is allowed only when the producer's complete **read footprint, write footprint, external effects, model revision, world revision and coupling boundaries** justify the supplied dependency graph. A source version change alone cannot silently leave stale descendants. The hash chain is a consistency aid, **not** signature or physical correctness proof.

**Fluid-specific rule:** R3 currently has global timestep selection, storage coupling, total water audit and shared boundary fluxes. Hence the M5 R3 adapter performs **full R3 numerical steps for every candidate**, not a synthetic 3x3 CA-neighborhood shortcut. A future local PDE cone requires its own conservative dependency/flux halo theorem, boundary audit and exact full-reference oracle; uncertain coupling means full fallback. We do not claim a fluid speedup yet.

**Execution effects:** All callbacks must be pure, deterministic and side-effect-free. Node/Go runtime cannot enforce such purity; external process I/O is not transactional and cannot be rolled back by an ordinal frame gate. Do not connect arbitrary registered workloads without an explicit effect contract.

**Memory:** This version bounds pending candidate bytes and copies Buffer payloads at API boundaries. It does not provide OS memory protection, automatic eviction, durable checkpoints, or M4 VMD ownership of R3 physical arrays. Future VMD must map typed `(field, domain, region, generation, ordinal, branch, authority)` identities without equating address possession with rights.

## 4. Verification gates (must be separate)

1. `node --test research/m5/*.test.mjs` verifies graph topology, deep-ready ordering, local/global invalidation, branch/fork/revision consistency, negative cases and R3 oracle parity.
2. `node research/run-tests.mjs` includes historical M3/M4 tests unchanged and M5 regression tests.
3. Linux/Windows CI must pass and Git source manifest must be exact bytes. The original ODTS private branch and sealed manifests are unchanged.
4. Independent local Windows system testing (the owner's real hardware) is a separate gate; CI is not a benchmark of physical pulse control.
5. Promotion requires workload-paired full lifecycle time (including precompute, failed branches, oracle/audit, memory, reuse and pruning), full R3 state/water-budget parity, and honest negative cases. A count of skipped cells or task nodes is not a CPU speedup certificate.

## 5. What comes after P0

**M5-P1**: define a typed adapter for R3 `domain/reach/tile/face/storage-node` influence rules; distinguish local-stencil dependencies, globally coupled step constraints and observer-only outputs. Only attempt local recomputation where exact finite influence closure can be proved against the full R3 oracle.

**M5-P2**: connect ODTS depth candidates and dependency regions to VMD generation-scoped handles and future EML-ADDR read-domain projection. Make dirty sets, halo versions, branch residency and invalidation explicit, keeping ODTS and EML-ADDR independent authority sources.

**M5-P3**: jointly test depth horizon, sparse/dense fallback, worker placement, materialization and bandwidth. Retain R5 Adaptive and R3 serial as independently compared baselines; avoid multiplying unrelated previous benchmark speedups.

All future work must preserve historical evidence, public/private repository boundaries, and distinguish speculative optimization from authorized state transitions.
