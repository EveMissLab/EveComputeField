# EveComputeField M5-P1 — ODTS Depth × Virtual Memory Domain × Causal Influence Cone

**Date:** 2026-11-02 (Asia/Taipei)  
**Source:** canonical UTF-8 Markdown, plain `$...$` and `$$...$$` math delimiters only  
**State:** EXPERIMENTAL / STACKED DRAFT / WINDOWS NATIVE NOT_RUN  
**Base:** M5-P0 Draft `feat/m5-odts-depth-activation`; no merge of this proposal to `main`.  
**Owner:** EveMissLab / Neo.K  
**License boundary:** independently authored EveComputeField implementation; ODTS pending-license Python source and Wavefront R0–R10 packages were **not** copied into this public repository.

## 1. Problem and implemented scope

The flat plan of virtual units → contiguous R3 tiles → Workers is insufficient to express depth-aware selective computation. The ODTS reference separates:

1. **Causal dependency depth** — prerequisite graphs and transitive invalidation.
2. **Ordinal candidate depth** — possible future states, never automatically committed.
3. **Spatial influence depth** — the conservative region affected across ordinal transitions.

P1 implements a **bounded local reference of their interaction with virtual memory domains**. Under an *explicit, proven-in-the-model* Moore-neighborhood binary-cellular-automaton dependency contract, candidate states are represented as shared immutable full baseline frames plus versioned tile overlays. Only cells in the complete influence cone are evaluated. Unaffected tiles are read from the baseline rather than copied and recalculated. A separate reactive full-step oracle is provided for tests and opt-in commit checking.

This is a genuine *algorithmic* skip in one synthetic bounded model, but **not** a performance guarantee, a general physical solver, an ODTS drop-in runtime, or a generic EML-ADDR provider.

## 2. Layering

```text
Authorized actual event / user-issued candidate sequence
                  |
      ordinal / explicit branch lineage
                  |
   baseline[ordinal] shared, immutable by convention
                  |
   causal closure: prior actual diff + local event footprint
                  |
  affected cells ────────────── nonlocal event / large coverage
                  |                            |
       local r=1 evaluate             full-step fallback
                  |                            |
           changed tiles  <─────────  full output
                  |                            |
          VirtualMemoryDomain v0 owned regions
             generation-scoped typed handles
                  |
          physical SharedArrayBuffer backing
                  |
    actual-event-only commit / independent oracle option
```

The default VMD backend is **SharedArrayBuffer within one Node.js process**. It is neither a kernel virtual address mapper nor an authority to view arbitrary external RAM. `fieldId`, domain ID, version, generation, region ownership, branch lineage and model revision are not interchangeable.

## 3. Typed reference contract

`ConeMemoryField` receives a binary `width × height` root, `horizon ≤ 16`, `tileCells`, `threshold`, `quotaBytes`, `worldRevision`, and the exact baseline event sequence. All baseline frames are computed with the **same finite reference rule** and materialized through VMD-owned byte regions. Candidate branches name a fixed sequence of bounded events; a child may inherit the exact prefix of an existing parent branch. Candidate authority never follows from a memory handle.

Supported reference events:

- `inertial`: full deterministic Life B3/S23 step, with periodic Moore radius-one neighbors.
- `pulse`: toggles declared output-cell indices after the local step; its complete changed output footprint is explicit.
- `global-invert`: toggles every output-cell, forcing a full candidate step.

Any unknown or underdeclared operator **fails closed**, rather than declaring a fraudulent local cone. The existing R3 Saint-Venant waterfall/rivers/ocean backend remains on the full-step path: it has globally shared `dt`, storage-node controls, flux audits and boundary coupling. No R3 cell skipping or fluid-speedup claim is made by P1.

### 3.1 Influence closure

Let $B_t$ be the verified full baseline state at ordinal $t$, $C_t$ the candidate, and let $\Delta_t$ be their *actual* differences. $N_1$ is a toroidal Chebyshev-radius-one neighborhood, $P_t$ and $Q_t$ are the exact baseline and candidate pulse footprints. For the fixed local rule only:

$$
A_{t+1}=N_1(\Delta_t)\cup P_{t+1}\cup Q_{t+1}.
$$

Cells outside $A_{t+1}$ have the same local input and the same local output rule, hence safely inherit $B_{t+1}$. This **does not** apply when an unknown dependency, global rule change, or nonlocal effect is present. A configured fraction threshold can conservatively choose full recomputation when cone traversal is too expensive; this is an **engineering heuristic**, not an optimality theorem.

The runtime recomputes the actual changed cells in $A_{t+1}$, not merely an ever-growing geometric upper bound. Changed cells are grouped into tile regions. The VMD allocates **only those tile buffers**, copying the corresponding baseline tile once before applying differences; the remainder of the frame reuses the original baseline region. Subsequent steps read through these overlays. A full fallback stores a dense VMD region and records its complete difference from the baseline.

### 3.2 Content and branch identity

Every frame has a **content Merkle-style SHA-256 commitment** formed from ordered SHA-256 tile bytes and a schema-tagged root. This is **not** `SHA256(full raw grid)` and must not be labeled as such. Sparse and dense representations of the *same* bytes yield the same commitment for the same grid shape and tile width. The independent test oracle also compares complete bytes.

Separate branch-lineage receipts bind branch ID, inherited parent, fork depth, absolute ordinal, parent content commitment, event, model revision and world revision. A matching output commitment is **not permission** to merge unrelated branch histories. Receipts are ordinary integrity records, not authenticated signatures, formal proofs or physical-world truth certificates.

### 3.3 Commit and invalidation

`computeBudget(maxFrames)` performs bounded, deepest-READY candidate materialization. It never changes the authoritative `head`. `commit(actualEvent)` accepts only a prepared candidate whose actual event, committed event prefix and parent content commitment match. Otherwise it computes a **full reactive transition**. `commit(event,{verifyFull:true})` optionally recomputes the whole step before promoting a candidate and charges those cell evaluations explicitly; verified promotion remains local to this independent research class, not the canonical Python ODTS authority.

A changed world revision clears branches/candidates and **blocks** the object until a fresh baseline field is constructed; model revision is immutable in this version. Parent-branch cancellation recursively invalidates its descendants. Failed VMD region allocation rolls back the partial tile list and leaves the authoritative head unchanged. Global events and high-coverage cones use full fallback. No speculative external effects are permitted.

## 4. VMD lifecycle and limits

P1 extends the M4 software `VirtualMemoryDomain` with `release(name,{expectedGeneration,quiescent:true})`:

- Releases a region from the domain registry and returns its accounted byte quota.
- The same region name, if allocated later, receives a newer generation; stale handles cannot become valid again through name reuse.
- `rebind` also updates the tracked generation.
- The previous `SharedArrayBuffer` and any raw `TypedArray` view cannot be forcibly revoked, cleared or securely hidden. `release` is **metadata lifecycle management**, not guaranteed OS decommit or immediate RSS reduction. Previously exported raw views and references may keep memory alive.

This prototype stages branch state in `u8` tile buffers (binary CA). No true page fault, NUMA, GPU mapping, mmap, sparse OS page table, cross-process lease, transactional external I/O, persistence, crash durability or access-control sandbox is introduced. It does not claim that address possession grants access authority.

## 5. Evidence and cost accounting

Unit tests include: independent every-depth full oracle, periodic spatial wrap, differing baseline/candidate event footprints, exact multi-branch prefix, deeper candidate preparation, actual event mismatch, commit verification, global fallback, coverage fallback, stale generation, quota rollback, version invalidation, multi-seed state parity, descendant cancellation, and no speculative authority advancement.

The benchmark compares a fresh full branch recomputation against P1 baseline construction + candidate staging + complete readback + an authorized commit. It records each stage and **explicitly acknowledges that these are not perfectly matched API workloads**. It alternates arm order, uses deterministic input, and requires final byte equality. The baseline requires $O(HN)$ upfront full work: this cost is not free. All cached arrays, hashes, allocations and readback should remain charged; no speedup is accepted from cell-count reduction alone.

The sample Linux/container runs have observed **lower evaluated candidate cell counts**, but not a reproducible positive whole-lifecycle runtime advantage. Use the owner's Windows machine to decide whether and when the strategy pays off. Fieldlogical-unit counts and worker counts are independent of causal depth and actual cell evaluations; do not multiply M3 R3 worker speedups by Wavefront R10 ratios.

## 6. Commands and local Windows acceptance

From a clone of the P1 branch with Node 24 available:

```powershell
node --test research/m5/cone-memory.test.mjs research/m4/memory.test.mjs
node research/run-tests.mjs
powershell -ExecutionPolicy Bypass -File .\scripts\verify-m5p1.ps1
```

Optional benchmark (creates an ignored local evidence file; refuses to overwrite):

```powershell
New-Item -ItemType Directory -Force .evefield-local | Out-Null
node research/m5/cone-memory-benchmark.mjs --width 64 --height 64 --horizon 5 --branches 4 --repeats 5 --out .evefield-local/m5p1-local-bench.json
```

Required Windows report: exact branch/commit, Windows build, `node -v`, full test counts and exit status, SHA-256 of local report, full oracle byte equality, region allocation/release counts, cold/warm time, RSS (as **process memory**, not VMD bytes), negative cases and whether selected policies improve end-to-end workload cost. Optional independent CPU cache counters must be separately identified; no guessed cache or energy benefits.

## 7. Pending gates and inter-project boundaries

- P1 must pass the full EveComputeField M1–M5 suite on GitHub Linux/Windows. Local Node 22 validation alone is not Windows-native acceptance.
- The P0 Draft must stay unchanged; P1 is stacked on a *separate draft branch* and must not be merged automatically.
- M3 R3 fluid numerical kernels and historical measurement evidence are untouched.
- Canonical ODTS Python R3 remains a separate pending-license research project. Its real R3 draft is not vendored. P1's local event gate is an independently authored experimental behavioral subset, not a claim of wire compatibility.
- Wavefront R10's owned Store and read-domain semantics remain separate. No R10 ZIP code has been imported or privately disclosed here.
- Future R3 fluid region cones require full read/write dependency, shared-face flux, adaptive timestep and reservoir coupling certification, followed by parity against the unchanged full oracle. Until then, **global full fallback** remains mandatory.
- Production integration of arbitrary kernels needs explicit dependency declarations, authorization, side-effect model, observation contracts, cross-domain versions, branch residency GC, and a verified performance gate including failed candidates.

**Promotion recommendation:** preserve M5-P0/M4 and the existing full R3 solver as reference, treat P1 as independent local experimental sidecar. Accept it for wider use only after exact native replay and demonstrable lifecycle benefits on the intended workload.
