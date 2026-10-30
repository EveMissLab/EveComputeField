# M3 R3 — larger branched networks and resident crossover

R3 research implementation, 2026-10-31. Historical numerical kernels retain their measured identities. See the [portable setup](../README.md), [results](../RESULTS.md) and [curated measured evidence](../evidence/r3/).

Research target: increase river cells, tributaries and independently stored confluence regions, and measure where retained workers begin to repay synchronization and integration costs. A failure to find a crossover within the measured bounds is a valid result.

Nodes are finite constant-area level-pool reservoirs. Each 1D river reach has one accepted hydrostatic/Rusanov mass flux at each endpoint, used by both that reach and its connected node. Headwater nodes receive independent fixed-delay waterfalls. The terminal ocean node has a signed external rating. Confluences conserve volume and share a horizontal storage head; tributary angles, momentum mixing/losses, 3D impact and actual natural-site calibration remain unmeasured. This is an explicit reduced storage-junction model, not the HEC-RAS junction solver.

Retained SharedArrayBuffers use two physical-state banks. A rejected proposal never swaps the active bank. Fixed 256-cell tiles, independent of worker count, define deterministic reduction order. In `fused` mode workers prepare faces and updates with two barriers per step; `cells-only` leaves face work serial as a comparison. A tile recomputes one non-writing halo face to obtain its donor bound without racing a neighbor. A face still has one authoritative value. Shared timestep, storage coupling, ordered regional audits and the final bank swap remain coordinated.

Predeclared crossover evidence: matched physical state and fixed work per paired call; retained pools, warm-up excluded, paired serial/parallel order alternated, median speedup >=1.10 and bootstrap 95% lower ratio bound >1 in confirmation. Report size brackets and neighboring probes, not a universal hardware-independent threshold. Measure compute, setup and end-to-end checkpoint costs separately. Do not pad computation or weaken conservation audits to manufacture speedup. Message-copy comparisons measure local packaging only.

Large checkpoints retain binary arrays in local content-addressed blobs and save a hash-bound manifest in the existing Go M2 field continuity domain. This is explicit sidecar custody, not native FieldSpec solver ownership. No claim of authenticated authorship, power-failure durability, or automatic restart. Blob hashes and configuration/ledger constraints must be validated before restore. Runtime fields have a finite step horizon and no idle eviction.

The SVG viewer reads the same live solver. Display samples aggregate large grids; rendering resolution never changes solver resolution. No Canvas or WebGL.

## Runtime and evidence

Keep the existing Go authority8765, R1 8766 and R2 8767 running. R3 uses `node research/m3-r3/resident-server.mjs` at `http://127.0.0.1:8768/`. Select the 6144-cell branched demo or65536-cell research field in the SVG viewer. Viewer refresh/freeze changes reading only. Control requires the existing loopback token in memory and rejects browser Origin; no token enters a viewer URL.

```
node research/m3-r3/resident-ctl.mjs status
node research/m3-r3/resident-ctl.mjs advance 64
node research/m3-r3/resident-ctl.mjs checkpoint
node research/m3-r3/resident-ctl.mjs reorganize 4 fused direct
node research/m3-r3/resident-ctl.mjs status --large
```

`advance` retains both banks and the pool. It is bounded to10M total accepted steps. A failed individual numerical step leaves the active bank intact; a multi-step call may have earlier accepted steps. After numerical/audit failure the field stays in RAM but blocks further calls for explicit recovery. Saves retain all referenced content-addressed blobs; there is no automatic garbage collection or idle eviction. R3 explicitly tests a service restart; there is no automatic restart policy.

Run `node research/run-tests.mjs`, `node research/m3-r3/benchmark.mjs crossover`, `node research/m3-r3/benchmark.mjs complexity`, `node research/m3-r3/benchmark.mjs boundary`, `node research/m3-r3/stability-study.mjs`, then `python -X utf8 research/m3-r3/plot-study.py`. Benchmark creates ephemeral measurement solvers, retaining pools throughout each measured block and closing them between configurations. The live demo/research fields remain resident.

The operational crossover rule combines a >=10% point estimate with evidence of any benefit (CI lower>1). It does not prove a >=10% improvement at95% confidence. Report this distinction, pointwise/exploratory selection, raw samples and the stronger lower-CI>1.10 tier. Timing excludes reset/hash/checkpoint work; end-to-end resident calls and explicit save costs are measured separately. Largest grids use fixed step budgets, while separate smaller networks cover60s. Do not equate the two horizons.

See the published [RESULTS.md](../RESULTS.md), evidence manifests and standalone SVG figures. This is reference research, without a production-maturity claim.

Method sources: [HEC reservoir continuity](https://www.hec.usace.army.mil/confluence/hmsdocs/hmstrm/reservoir-modeling/reservoir-modeling-concepts-and-equations), [HEC junction assumptions and limitations](https://www.hec.usace.army.mil/confluence/rasdocs/rasum/6.0/entering-and-editing-geometric-data/stream-junctions), [Audusse hydrostatic reconstruction](https://publications.imp.fu-berlin.de/478/1/file_2004_siam.pdf), [Node worker pools and shared memory](https://nodejs.org/api/worker_threads.html).
