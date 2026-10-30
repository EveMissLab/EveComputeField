## 2026-10-30 — M3 Fluid SVG Benchmark (reference)

- Single continuous waterfall → river → ocean SVG-only scene, offline HTML controls;
  deterministic browser finite-volume solver and downloadable still-frame SVG.
- Deterministic Go 1D Saint-Venant/Rusanov finite-volume numerical workload (`tool fluid`)
  usable via the M2 named local workload registry, plus reference input scenario.
- Mass balance, tide and inflow sensitivity, replay and malformed-input tests;
  Go/JS numerical-parity audit, Linux persistent field integration smoke.
- Windows first-run bootstrap registers `fluid` only for newly generated registries;
  pre-existing user-owned registries are never rewritten.
- Explicit physical/visual model limitations: no 2D waterfall jet, ocean solver,
  true core-pulse acceleration, sandboxing, or distributed computation.

# Changelog

## M1 — Persistent Field Authority — 2026-10-30 (reference)

- New single-writer multi-field manager, persisted identity/state, per-field
  serial execution and atomic checkpoint-before-commit transitions.
- New `serve`, `token`, `ctl` CLI commands with local-only authenticated control
  API and field memory-domain read/write. Existing one-shot `run` remains.
- Go tests for concurrent calls, corruption/invalid input denial, persistence
  failure rollback, restart recovery, token/Origin protection.
- Verified Linux loopback end-to-end restart; no Windows or two-host LAN claim.
- Field protocol envelope remains `field/v0.1`; M1 is an additive management
  interface, not a new execution semantics standard.

## v0.1.0-reference — 2026-10-30

- Initial publicly separable Go reference prototype for a local-first Virtual Compute Field.
- Versioned field protocol, stable identity, logical-unit resize, DAG-based pure numeric execution.
- Volatile/snapshot memory domains with explicit quotas, epoch and snapshot state.
- mTLS-only stateless LAN worker, development certificate helper, local and LAN examples.
- Unit tests, race test, lint/vet and local-loopback two-process demonstration.
- Explicit non-goals, upstream adapter boundaries and repository naming discussion.

This is a code-and-contract baseline, not proof of hardware performance or production networking.

## Repository initialization (2026-10-30)

- Selected independent organizational home `EveMissLab/EveComputeField`.
- Set canonical Go module path and CLI `cmd/evefield`.
- Added standalone repository scope, publisher instructions and GitHub Go CI template.
- Remote repo creation intentionally remains a separate authenticated operation.

## 2026-10-30 — M2 local-first executable field (candidate)

- Add local authority quiescent field resize with crash-replay journal.
- Add local-only allowlisted executable registry, bounded `invoke` endpoint,
  opt-in named local workloads, and built-in test helpers.
- Add Windows PowerShell bootstrap, Linux end-to-end smoke, and cross-platform
  unit-test CI matrix. Cloud continuity and physical pulse claims remain out
  of scope.
- Harden field ID validation for path aliases and Windows device names.
