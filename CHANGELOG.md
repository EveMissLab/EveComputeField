# Changelog

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
