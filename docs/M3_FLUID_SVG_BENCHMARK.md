# M3 — One continuous SVG fluid scene / 單場景流體 SVG 挑戰

**Date:** 2026-10-30 (Asia/Taipei)  
**Scope:** offline-first, single-PC reference and benchmark fixture.  
**Status:** implemented baseline; physically meaningful 1D river model, **not** validated full 2D/3D fluid dynamics.

## The challenge

One scene contains a waterfall falling from an upland source into a plunge pool,
then a meandering river carrying water to an estuary, then an ocean boundary.
There is no Canvas, WebGL, map tile, remote asset, CDN or cloud backend.
**All visible scenery and animated water geometry are SVG nodes**. Standard
HTML/CSS is used only for external controls and numerical readouts.

- Interactive scene: [examples/fluid/index.html](../examples/fluid/index.html) — open locally in a modern browser.
- Exported stand-alone **static** SVG sample: [examples/fluid/scene.svg](../examples/fluid/scene.svg).
- Renderer: `examples/fluid/scene.js` (only SVG DOM mutations).
- Browser solver: `examples/fluid/fluid-core.js` (pure, deterministic JS).
- Go solver: `internal/fluid/solver.go`, CLI `evefield tool fluid`.
- Scenario: `examples/fluid/scenario.json`.

## Physics actually represented

The 96-cell rectangular, one-dimensional river uses the conservative Saint-Venant
shallow-water equations and a first-order Rusanov finite-volume flux. Each cell
has depth `h`, unit-width discharge `q=h*u` and fixed bed elevation `zb`.

Canonical math text in this source uses `$...$` / `$$...$$` only:

$$
\frac{\partial h}{\partial t}+\frac{\partial q}{\partial x}=0
$$

$$
\frac{\partial q}{\partial t}+\frac{\partial}{\partial x}\left(\frac{q^2}{h}+\frac{gh^2}{2}\right)=ghS_0-ghS_f
$$

$$
S_0=-\frac{\partial z_b}{\partial x},\qquad S_f=n^2\frac{q|q|}{h^{10/3}}
$$

The implemented momentum friction is `$-g n^2 q|q|/h^{7/3}$` for the wide-channel
approximation. For mathematical consistency, this corresponds to `$-g h S_f$`
with `$S_f=n^2 q|q|/h^{10/3}$`. `g=9.81 m/s²`. The solver uses an adaptive
CFL-controlled time step, fixed upstream depth, configurable upstream discharge,
and a configurable **static downstream tidal stage**. It has an open system:
water enters at the waterfall-fed upstream boundary, leaves at the ocean-facing
downstream boundary, and the model tracks both boundary fluxes.

**Mass balance audit** (units of area per unit channel width, m²):

$$
R_M=M_{final}-M_{initial}-\int F_{in}\,dt+\int F_{out}\,dt
$$

Acceptance: `abs(R_M) < 1e-8 m²` for the normal reference scenario, finite
positive depth in all cells, max CFL <= 0.39, deterministic replay. The same
reference scenario produces bitwise identical Go/JS final water mass and
boundary-flux totals on the tested Linux/Node environment.

## What is illustrative, not solved as hydrodynamics

- The **free-falling waterfall** is drawn with advected streaks and
  ballistic-style droplets; impact foam/splash is visually procedural. The
  mass entering the river is driven by the specified inlet flux; droplet
  positions are **not** used to integrate a 2D impact-jet Navier–Stokes solver.
- The **ocean** is a downstream tailwater/tidal boundary with SVG wave
  patterns influenced by the outgoing river flux. It is **not** a discretized
  2D shallow-water or 3D wave solver. Tidal amplitude is a manually set
  boundary offset, not a celestial tide predictor.
- The river's drawn width responds to local water depth, but the illustrated
  terrain/topology and tracer-speed scale are not survey-accurate or
  metrically registered. Flow tracers are **not conserved particles**.
- SVG update rate is a presentation metric, **not** a CPU-core acceleration or
  strict wall-clock simulation performance claim.

## Open locally on Windows (no service required)

From the repository root in PowerShell:

```powershell
# One-time compile of the fluid workload backend
New-Item -ItemType Directory -Force build | Out-Null
go build -o .\build\evefield.exe .\cmd\evefield
Get-Content -Raw -Encoding UTF8 .\examples\fluid\scenario.json | .\build\evefield.exe tool fluid
Start-Process .\examples\fluid\index.html
```

The browser viewer has a flow slider, downstream tide slider, Manning roughness
slider, pause/resume, reset, and current-frame **SVG export**. It runs even
if no EveComputeField authority service is active. No network requests.

### Associate the numerical solver with the persistent local field (M2)

If first-time user, `scripts/start-local.ps1` generates an opt-in workload
registry with `fluid` permitted. If the registry **already exists**, it is
never overwritten: add a trusted entry yourself, then restart the daemon:

```json
{"name":"fluid","program":"<absolute path to the evefield executable>","args":["tool","fluid"],"timeout_ms":10000,"max_output_bytes":16384}
```

The program path must be the actual absolute path to your own binary.
As a second terminal, after creating the `reference-local` field:

```powershell
$exe = '.\build\evefield.exe'
$token = '.\.evefield-local\control.token'
& $exe ctl invoke -id reference-local -workload fluid -input-file examples/fluid/scenario.json -save-domain continuity -save-key fluid_result -token-file $token
& $exe ctl get -id reference-local -domain continuity -key fluid_result -token-file $token
```

This demonstrates **field-associated invocation and durable storage of an
actual physics simulation result**. It does **not** prove that the M1 `sum`/`mul`
DAG scheduler distributes fluid cells across its logical units. It remains an
explicitly registered local process and is not sandboxed.

## Acceptance and future experiment contract

1. `go test ./...`, `go test -race ./...`, `go vet ./...`, `go build ./...`.
2. `node --test examples/fluid/fluid.test.js` — deterministic mass and parameter
   sensitivity tests (no dependencies).
3. `go run ./cmd/evefield tool fluid < examples/fluid/scenario.json > fluid-result.json`
   followed by `node scripts/check-fluid-parity.cjs fluid-result.json`.
4. `bash scripts/smoke-m3-fluid-linux.sh` — tests the actual M2 local daemon,
   trusted workload registration, snapshot persistence and service restart.
5. Browser smoke — verify continuous SVG scene, control slider changes, mass
   residual, pause, export and valid XML of static SVG, with no page errors.
6. Windows CI compile/test is a clean-run proxy; a user's Windows machine and
   hardware/GPU render characteristics require separate measurements.

**Next benchmark (not claimed here):** record isolated solver wall time,
actual local-field invocation wall time, process spawn/serialization cost,
CPU/RAM/energy, and SVG frame time. Only after comparable measurements should
field cell-block partitions or dynamic scheduling be considered. Never assume
logical-unit count increases computation throughput.

## References and limitations

- US Army Corps of Engineers, Channel Flow Fundamentals: https://www.hec.usace.army.mil/confluence/hmsdocs/hmstrm/channel-flow/channel-flow-basic-concepts-equations-and-solution-techniques
- Conservative finite-volume Saint-Venant context: https://hess.copernicus.org/articles/23/1281/2019/hess-23-1281-2019.html
- MDN SVG path reference: https://developer.mozilla.org/en-US/docs/Web/SVG/Reference/Element/path

This is a controllable numerical/visual experimental fixture, not a verified
scientific prediction of a specific real-world river, waterfall or coast.
