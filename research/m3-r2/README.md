# M3 R2 — coupled water inventories

R2 research implementation, 2026-10-31. Run `node research/run-tests.mjs`, then `node research/m3-r2/study.mjs`. See the [portable runtime setup](../README.md) and [curated measured evidence](../evidence/r2/).

Four independent components: delayed waterfall inventory, level-pool deep basin, one-dimensional shallow-water river, and level-pool ocean storage. Volumes are m³; rates are m³/s; the river width is explicit. At every accepted common step, each interface has one signed transfer used by both connected inventories. All proposals and component/global ledgers are checked before commit. A numerical rejection leaves the last accepted state intact.

River: first-order hydrostatic reconstruction, Rusanov flux, semi-implicit Manning friction. The step uses face wave speeds, optional reservoir response guard, and donor-volume limits. Wet connections are required; drying/overflow is refused, not silently clipped. Reservoirs assume horizontal surface and constant positive area. Ocean export is a signed linear rating against an external stage; negative export imports water. These are reduced models, not 3D waterfall impact or ocean wave solvers.

The waterfall uses a fixed free-fall delay sqrt(2H/g), exact integrals of declared nonnegative source profiles, and a constant prehistory. Its airborne inventory is conserved. This does not resolve impact momentum. f32-state means quantized stored state with double arithmetic; raw mass drift and explicitly accumulated quantization correction are separate results.

The coordinator assembles all faces, a shared time step and audits serially. River cell updates can run in serial partitions or a retained worker pool. Message-copy mode measures in-process structured-clone packaging at component/partition interfaces, not distributed transport. Organization metadata is excluded from physical-state hashes; all physical policies and history phases are included. No idle eviction, scheduling or automatic field advancement.

References: [HEC reservoir continuity and storage assumptions](https://www.hec.usace.army.mil/confluence/hmsdocs/hmstrm/reservoir-modeling/reservoir-modeling-concepts-and-equations), [Audusse et al. hydrostatic reconstruction, author-hosted paper](https://publications.imp.fu-berlin.de/478/1/file_2004_siam.pdf), [NASA free fall](https://www1.grc.nasa.gov/beginners-guide-to-aeronautics/free-fall-without-air-resistance/). The explicit coupling here is not HEC Modified Puls.

Historical results and limitations are in [RESULTS.md](../RESULTS.md). Generated local results remain ignored; published evidence is a curated derivation with control identifiers and private operational context removed.

## Local runtime

The existing Go field authority remains at `http://127.0.0.1:8765`, R1 at 8766. Start R2 with `node research/m3-r2/resident-server.mjs`; its read-only SVG viewer is `http://127.0.0.1:8767/`. The viewer polls synthetic demonstration state only; it never advances the solver. Control routes require the existing loopback bearer token and reject browser Origin requests. No token appears in the viewer or its URL.

With the current field associated:

```
node research/m3-r2/resident-ctl.mjs status
node research/m3-r2/resident-ctl.mjs advance 80
node research/m3-r2/resident-ctl.mjs checkpoint
node research/m3-r2/resident-ctl.mjs reorganize 2 partitioned-workers direct
```

`advance` keeps state and workers in RAM; `checkpoint` explicitly saves into the field's M2 continuity domain. A field ID associates a research sidecar; changing core logical units does not magically create hardware workers. Each resident field serializes its calls, including the complete save. A failed individual numerical step leaves the prior accepted physical state; an advance call can have earlier accepted steps before a later refusal. Such a field remains in RAM but blocks subsequent control transitions until explicit audit recovery. Logs are hash-linked best-effort append files, not authenticated authorship, fsync, or power-loss durability evidence. Restore refuses unsaved audit tails.

The R2 restore horizon is at most 10,000,000 accepted steps. It is a bounded research checkpoint schema, not a promise of unlimited lifetime. f32 validation independently bounds quantization error from declared source, maximum import, initial inventory and step count; bounded perturbations within that error envelope are not authenticated history.

## Reproduce evidence

```
node research/m3-r2/study.mjs
node research/m3-r2/refinement-study.mjs
node research/m3-r2/response-study.mjs
python -X utf8 research/m3-r2/plot-study.py
```

`resident-study.mjs` creates two new synthetic fields and keeps them resident. `--restore-readback` is only for an explicit service restart from their latest saved audit heads. It is not an automatic retry/restart policy. `render-study.mjs` requires task-local Playwright/Chromium through `ECF_PLAYWRIGHT_PACKAGE` and `PLAYWRIGHT_BROWSERS_PATH`; it uses an isolated browser, advances the declared demo by 80 explicit steps, and saves that result.
