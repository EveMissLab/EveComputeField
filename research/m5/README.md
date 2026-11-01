# M5 — ODTS-aligned depth graph field prototype

Local-first reference runtime for **causal dependency depth, ordinal future-candidate depth and scoped invalidation**. It is not a drop-in replacement for the canonical ODTS Python scheduler and does not import the pending-license ODTS source.

From the EveComputeField repository root:

```sh
node --test research/m5/*.test.mjs
node research/run-tests.mjs
```

- `depth-graph.mjs`: typed dependency/ordinal DAG, deepest READY compute, transitive invalidation, explicit complete-footprint vs conservative global policy.
- `ordinal-field.mjs`: multi-ordinal, multi-branch future staging with parent/event/world/model/revision checks; only `commit(actualEvent)` changes authoritative ordinal state.
- `r3-bridge.mjs`: real existing R3 `NetworkSolver` as a **full** physics transition oracle. No local finite-volume skipping yet.
- `*.test.mjs`: depth-order, mismatch/revision/budget and full-R3 equivalence tests.

See [M5 canonical technical handoff](../../docs/M5_ODTS_DEPTH_ACTIVATION.md).

Status: M5-P0 research branch until clean cross-platform CI and independent hardware acceptance. No new performance result is claimed.

## M5-P1 — Virtual Memory Domain × causal influence cone (stacked Draft)

This optional **independently authored** reference keeps baseline future frames in
VMD-owned `u8` regions and stages multi-ordinal branch differences as sparse tile
overlays. It recomputes the complete Moore-radius-one influence closure and
reuses unaffected baseline tiles. Nonlocal events, excessive coverage and
unknown physical dependencies require full fallback. Actual-event commit remains
separate from candidate staging. See
[docs/M5_P1_VMD_CAUSAL_CONE.md](../../docs/M5_P1_VMD_CAUSAL_CONE.md).

```sh
node --test research/m5/cone-memory.test.mjs research/m4/memory.test.mjs
node research/m5/cone-memory-benchmark.mjs --width 64 --height 64 --branches 4 --repeats 3
```

**This does not optimize the actual R3 fluid PDE**: the original globally
coupled R3 solver continues full numerical evaluation. The P1 VMD is a
software-level region namespace with generation checks, not physical MMU
paging or true OS memory protection. No speedup is certified by the synthetic
cell-count reduction.
