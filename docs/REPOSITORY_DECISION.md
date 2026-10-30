# Repository decision — independent core system

Date: 2026-10-30 (Asia/Taipei)  
Decision: create a **new public repository** `EveMissLab/EveComputeField`.
Status: **LOCALLY PREPARED; REMOTE NOT CREATED BY THIS ARTIFACT**.

## Separation of concerns

- `EveComputeField`: standalone runtime reference implementation and future field infrastructure; GitHub category `core-systems`.
- `evemisslab-project-catalog`: existing public organization project index; **not** the runtime repository and not a build or runtime dependency. Leave it unchanged until the new repository has actually been published and is ready for indexing.
- Existing NOVA, TCGCT, MACR, ODTS, GMA and other theory/prototype repositories are upstream research candidates, not code copied into this public release. Public adapter contracts must be independently reviewed and tested.

## Repository settings

- Owner: `EveMissLab` organization.
- Name: `EveComputeField`.
- Visibility: `public`. License: MIT. Default branch: `main`.
- Topic suggestions: `distributed-computing`, `virtual-compute`, `go`, `local-first`, `runtime`, `research-prototype`.
- Description: Local-first virtual compute fields with persistent logical identity, pluggable execution, memory domains and LAN-first distributed scheduling.
- Classification: `core-systems`, `family=null`, `status=lab`, `version=0.1.0-reference`, `origin=created_in_org`.

Do not claim production readiness, a multi-machine LAN test, OS-level scheduler control, performance speedups, or completed native-theory integration.
