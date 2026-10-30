# M3 resident fluid research

The three rounds extend the reference model while keeping computation resident and rendering only SVG. These are synthetic, bounded research prototypes, not calibrated natural-water models or a production CFD runtime.

| Round | Implemented model | Main finding |
|---|---|---|
| [R1](m3-r1/README.md) | Original river equations, persistent arrays/workers, checkpoint and organization receipts | Process reuse avoids repeated startup; small-grid barriers still cost more than they save |
| [R2](m3-r2/README.md) | Independent waterfall inventory, deep basin, river and finite ocean storage | Shared accepted transfers close regional/global budgets; storage capacity changes transient response |
| [R3](m3-r3/README.md) | Tributaries, finite-volume confluences, fixed tiles, parallel face/update work | Larger grids repay synchronization; graph interfaces and remaining serial work affect the crossover |

[Measured results and scope](RESULTS.md) · [Public measurement files](evidence/README.md)

## Requirements and numerical tests

Node.js24 and Go1.27 are the measured toolchain. Numerical tests require no third-party Node packages, browser, credentials or running service:

```
node research/run-tests.mjs
```

Python with matplotlib is optional for reproducing the standalone SVG figures. Playwright/Chromium is optional for browser verification; set `ECF_PLAYWRIGHT_PACKAGE` to its installed package and `PLAYWRIGHT_BROWSERS_PATH` when using a custom browser cache. No private package or remote compute provider is required.

## Start a local resident SVG field

Run from the repository root:

```
node research/setup-local.mjs
```

This builds the reference executable, creates a local token and registers fixed trusted workloads only when the local registry is absent. Existing credentials, registries and field data are preserved. Set `ECF_GO` if Go is not on PATH; `--no-build` reuses an existing `build/evefield` executable (`.exe` on Windows).

Terminal1, Linux/macOS:

```
./build/evefield serve -data .evefield-local/fields -token-file .evefield-local/control.token -workloads .evefield-local/workloads.json
```

Terminal1, Windows PowerShell:

```
.\build\evefield.exe serve -data .evefield-local/fields -token-file .evefield-local/control.token -workloads .evefield-local/workloads.json
```

Terminal2 starts one resident implementation, for example R3:

```
node research/m3-r3/resident-server.mjs
```

Terminal3 creates two new synthetic fields and performs a bounded resident study:

```
node research/m3-r3/resident-study.mjs
```

Open `http://127.0.0.1:8768/` and select the6144-cell demo or65536-cell field. The viewer reads actual backend state. Refresh/freeze changes reading only; explicit calls advance and checkpoint:

```
node research/m3-r3/resident-ctl.mjs status
node research/m3-r3/resident-ctl.mjs advance 64
node research/m3-r3/resident-ctl.mjs checkpoint
```

R2 can be started similarly with its `resident-server.mjs` and `resident-study.mjs`, then viewed at `http://127.0.0.1:8767/`. Previous-round preservation checks run only when a local prior-round association exists; a fresh clone does not require another person's field IDs. Re-running a resident study creates additional fields and can hit the stated session cap. Use existing control/checkpoint commands for continued work.

For an explicit restart, save first, stop only that resident process, start it again and run its study with `--restore-readback`. This validates saved-head continuation; it is not an automatic restart/recovery policy. R3 restores require the associated local binary blobs as well as the M2 manifest. Keep referenced blobs. Unsaved audit tails require explicit recovery.

Default ports are authority8765 and R1/R2/R3 8766/8767/8768. `ECF_FIELD_PORT`, `ECF_R1_PORT`, `ECF_R2_PORT`, `ECF_R3_PORT` override them; pass the matching `-listen 127.0.0.1:PORT` to the authority. Local runtime files are ignored. Tokens never enter viewer URLs or published evidence. These trusted local programs are not a sandbox.

## Evidence and limitations

Published evidence is a curated derivation of the measured rounds: numerical samples and configurations are retained, while local paths, field identifiers, native execution/session bindings and private operational records are omitted. Published file hashes refer to these delivered bytes. Kernels retain their measured identities; portability wrappers and documentation were updated afterward, so historical timings are not presented as fresh timings of the publication wrappers.

The original Go/browser solver remains available. R2/R3 use reduced one-dimensional rivers and horizontal-surface storages. They do not resolve impact jets, tributary-angle momentum mixing, wet/dry fronts or ocean waves. Logical field units are metadata, distinct from actual worker threads. There is no idle eviction, background simulation schedule, automatic provider invocation or automatic restart.
