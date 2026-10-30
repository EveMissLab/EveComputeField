# M3 R1: continuity, partitioning and integration-cost pilot

R1 extends baseline `471ae0b58b8c7a439fdd4ceceb6ca8fd538b265c` without replacing the original M3 Go or browser solver. Generated local results/runtime data remain ignored; curated historical measurements are published under [evidence/r1](../evidence/r1/). See the [portable setup](../README.md) and [three-round results](../RESULTS.md).

The domain remains a 96 m, unit-width, 1D Saint-Venant/Rusanov river. The waterfall supplies an **upstream ghost state**, not a simulated impact jet. The ocean is a tailwater boundary, not a 2D/3D ocean domain. In particular, the configured ghost discharge need not equal the numerical mass flux at the boundary; this pilot records both and their difference. Conserving the discretized river budget alone does not validate real waterfall or coastal physics.

The reported `max_cfl` deliberately reproduces the original **interior-cell** wave-speed estimate. It is not a separate boundary-ghost CFL audit. Boundary-face wave-speed control is a next experiment, not a proven property of this pilot.

## Predeclared evidence rules

- Default float64 research arithmetic must reproduce the unchanged JS reference arrays exactly. Original Go/JS comparisons use absolute sample/flux tolerance `1e-9`; this is a finite-case regression threshold, not a physical-accuracy estimate.
- Correct float64 partitions must have identical complete checkpoint digests for a matched grid, forcing and time-step sequence. One face has one owner/value shared by both neighboring cells. Global time-step choice and face assembly remain serial; only cell updates run in worker partitions.
- For the original default reference envelope, require finite state, depth at least `0.02 m`, CFL at most `0.39 + 1e-12`, and absolute river mass residual below `1e-8 m²`. Larger CFL, larger time caps and fixed time steps are explicitly research stress cases, with failures retained.
- `f32-state` quantizes stored h/q to Float32. Fluxes, source arithmetic and reductions remain JavaScript double precision. It is **not** a full Float32 arithmetic solver. Report its actual conservation drift and error instead of reusing the float64 tolerance as a claim.
- A deliberately inconsistent inter-partition mass flux must violate the conservation threshold. A corrupt/source-mismatched checkpoint must be rejected. SVG styling alone is not a physical-coupling receipt.
- Physical state continuation uses `ecf-fluid-state/v1`: kernel+bed/config identity, all h/q and last-face arrays, time/steps, initial mass and accumulated fluxes. Its digest detects content changes, not adversarial authorship. A quiescent organization change may alter partitions but not silently alter physics or precision.

## Pilot matrix and observables

The runner measures original Go/JS boundary sensitivity on 32/96/192/512 cells; time-step caps, CFL controls, boundary extremes, time-varying inlet/tailwater and Float32 state storage; and 1/2/4/8 cell partitions on 96/512 cells. Performance is three bounded repetitions, with construction/worker startup separated from advance time. It is a single-host pilot, not a scalability or energy certification.

Every row retains configuration, kernel identity, min/max depth and time step, CFL, initial/final mass, accumulated actual boundary fluxes, nominal-source integral, residual, state digest, wall time and error if any. Partition tables report interface count and synchronization; field logical units are a separate control property and do not create CPU cores or imply cell scheduling.

Run `node --test research/m3-r1/solver.test.mjs`, then `node research/m3-r1/study.mjs`. The opt-in field adapter is `node research/m3-r1/worker.mjs` with schema `ecf-fluid-advance/v1`. No remote invocation or provider service is required.

## Method references

- [Clawpack shallow-water Riemann solver reference](https://www.clawpack.org/riemann_book/html/Shallow_water_approximate.html): conserved depth/discharge, wave-speed and positivity context. This pilot uses Rusanov, not the reference page's Roe/HLLE implementations.
- [Hodges 2019, conservative finite-volume Saint-Venant forms](https://hess.copernicus.org/articles/23/1281/2019/): conservation and well-balanced topography are separate properties. The baseline here is not claimed to implement that paper's scheme.
- [USACE shallow-water equations](https://www.hec.usace.army.mil/confluence/hecras/beta/technical-reference/hydraulic-equations/shallow-water-equations): physical-model context, not validation of this fixture.

Next physical-model frontier: separately model plunge-pool and ocean storage/momentum, their interface conditions and reference/analytic validation. This pilot first tests the present river/boundary abstraction and computational organization.

## Resident RAM mode (owner-directed addition)

`resident-server.mjs` retains the solver arrays and the actual worker pool between calls, with no idle eviction or per-call process creation. It is a loopback-only, token-authenticated **research sidecar associated with an M2 field ID**. The core FieldSpec does not declare or schedule this solver. A `resident_binding` record stores the association's kernel/config identity in the field's snapshot domain.

Per-field queues serialize advances, reorganization and full checkpoint persistence. Reorganization prepares the replacement pool before altering the prior one. A failed replacement-start control proves preservation of the old pool/options/state. Checkpoint storage retains the queue until its matching state/receipt pair is written to M2.

Receipts are hash-linked records in a best-effort append log. They are not authenticated authorship or hard-crash durability evidence; the log does not promise fsync/atomic power-fail behavior. Restore refuses a log tail that differs from the explicitly saved checkpoint, rather than silently discarding or replaying unsaved work. Physical ledgers permit signed boundary fluxes, validate nonnegative time/CFL and time-step consistency, and recheck mass balance; Float32 storage has a stated precision-dependent consistency bound, not the float64 accuracy claim.

The residency pilot compares one 20-call trajectory per arm, 80 solver steps per call: cold process with save each call; resident RAM with save at end; resident with save each call. The two saved-each arms match full-checkpoint frequency. Report median/p95/min/max, setup time and sampled process RSS baseline/delta. Samples are dependent continuation calls on one host, not independent scaling trials. The resident host's RSS includes all active sessions.

After the local runtime and resident server are running:

```powershell
node research/m3-r1/resident-ctl.mjs status
node research/m3-r1/resident-ctl.mjs advance 80
node research/m3-r1/resident-ctl.mjs checkpoint
node research/m3-r1/resident-ctl.mjs reorganize 2 partitioned-workers
```

Advancing changes RAM immediately; use `checkpoint` for an explicit saved state. There is no schedule, auto-run loop or automatic process restart.
