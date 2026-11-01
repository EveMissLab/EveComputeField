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
