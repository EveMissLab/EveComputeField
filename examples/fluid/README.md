# SVG fluid field — one scene, three connected hydraulic regions

![An actual SVG reference frame of the river-to-ocean visualization](scene.svg)

Open `index.html` directly in a browser, or use **GitHub Pages / any local static
server**. The viewer does not call the network and does not require a daemon.
All scenery is real SVG paths, gradients, circles, and masks — **no Canvas,
WebGL, image raster layers, third-party JavaScript or generated images**.

The upper waterfall supplies the upstream boundary of a 96-cell finite-volume
shallow-water river. The tidal ocean supplies its downstream water-level
boundary. The river height/discharge are computed; waterfall droplets, splash
foam and ocean surface wavelets are *explanatory artistic projections*, not a
fully resolved turbulent waterfall or 2D ocean model.

The exported `scene.svg` is a **static snapshot** captured from the running
renderer. For a changing scene, run `index.html`; its `Export SVG` button
creates another fully native SVG frame.

The Go-side scientific workload is `go run ./cmd/evefield tool fluid` with
`scenario.json` as standard input, or the named local `fluid` workload on the
EveComputeField M2 authority. See
[`docs/M3_FLUID_SVG_BENCHMARK.md`](../../docs/M3_FLUID_SVG_BENCHMARK.md)
for numerical audit, limitations and local CLI steps.
