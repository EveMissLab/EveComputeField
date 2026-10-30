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
