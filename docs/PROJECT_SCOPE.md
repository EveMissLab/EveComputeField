# Project scope and enduring boundaries

EveComputeField is a standalone, local-first software system to declare and operate virtual compute fields. A field defines persistent logical identity, virtual logical units, logical memory domains, topology/dependencies, execution placement and observable state transitions. It must not require AI to run.

### Included in v0.1 reference

- Formal JSON field contract and explicit resource limits.
- Deterministic DAG planning, bounded local execution and replaceable executors.
- Local field state serialization and restore.
- mTLS remote worker execution on a coordinator-authorized pure task, as a loopback prototype.
- Negative-path tests, local validation evidence and release gates.

### Out of scope for v0.1

- Transparent system-wide application virtualization, GPU driver integration, hardware-cycle control, zero-copy distributed memory and OS scheduler replacement.
- Persistent cloud execution, fault-tolerant distributed consensus and full remote-state migration.
- Native execution of NOVA/EML-SF/TCGCT/ODTS/MACR/GMA implementations.
- Performance/energy claims for single- or multicore pulse differential algorithms.

### Future adapter intent (not an implementation claim)

Keep logical field semantics independent of the chosen runtime. Evolve with versioned provider contracts, per-backend feature negotiation, explicit placement/resource budgets and auditable execution traces. Any private theory adapter should be optional and separate from the MIT reference core until separately reviewed for release.
