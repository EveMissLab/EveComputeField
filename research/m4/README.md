# M4 local mapping + virtual memory domains (P0)

A bounded experiment that connects the existing R3 worker partition to EveComputeField-style logical unit identities. **Local only** and backwards compatible with M3; does not yet replace R3's physical buffer allocator or change the legacy solver kernel.

Read [the canonical phase contract](../../docs/M4_LOCAL_PLACEMENT_VMD.md).

```sh
node research/run-tests.mjs
node research/m4/benchmark.mjs --units 720 --cells 2048 --workers 2,4 --pairs 4 --steps 16 --calls 32
```

Main modules:

- `planner.mjs`: deterministic tile-to-unit-to-worker mapping; evidence-based serial/parallel choice; quiescent solver reorganization with hash and backing-identity guards.
- `memory.mjs`: owned and borrowed zero-copy SharedArrayBuffer regions, bounded byte quota, generational logical handles, read/write request policy, quiescent remap and active-bank observation.
- `benchmark.mjs`: matched-state, alternating, two-block local performance samples with selected mapping and memory descriptors. Saves a JSON file **only** when explicitly requested.
- `*.test.mjs`: unit and R3 integration regression tests.

No npm packages or cloud services required. Existing platform smoke tests remain authoritative for M1/M2/M3. This is an experimental placement/control plane, not a general OS scheduler, sandbox, distributed RAM or proven performance enhancement.
