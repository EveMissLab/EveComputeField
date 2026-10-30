# Release / local handoff and acceptance

Date: 2026-10-30. Initial state: **RESEARCH_REFERENCE**. Do not advertise as a production platform or an already-integrated NOVA stack.

## Direct acceptance commands

From repository root:

```bash
go version
go test ./...
go test -race ./...
go vet ./...
go run ./cmd/evefield plan -spec examples/local.json
go run ./cmd/evefield run -spec examples/local.json -state ./field-state.json
```

In two terminals, execute the mTLS LAN instructions in `README.md` and verify `local-result = 11`.

## Verification ledger

| Gate | Intent | Status when authored |
|---|---|---|
| G01 | Spec validation and rejection of unknown inputs | TESTED LOCAL |
| G02 | DAG cycle rejection and layer planning | TESTED LOCAL |
| G03 | Reference sum/mul execution | TESTED LOCAL |
| G04 | No partial field commit after task failure | TESTED LOCAL |
| G05 | Field epoch and snapshot restore | TESTED LOCAL |
| G06 | Volatile domain omitted from snapshot | TESTED LOCAL |
| G07 | Unit resize retains stable surviving unit identity | TESTED LOCAL |
| G08 | Worker requires client certificate | TESTED LOCAL |
| G09 | Worker rejects unknown operations | TESTED LOCAL |
| G10 | Multi-process coordinator→worker→coordinator | TESTED LOCAL LOOPBACK (TLS 1.3 mTLS) |
| G11 | Windows 10/11 native execution | NOT_RUN (local Windows validation required) |
| G12 | Two physical LAN machines | NOT_RUN |
| G13 | Fault injection: partition, crash, retry, recovery | NOT_RUN |
| G14 | Real application workloads / WASM or native executors | NOT_IMPLEMENTED |
| G15 | Cloud lease and remote persistent field | NOT_IMPLEMENTED |
| G16 | MACR / ODTS / EML-SF / NOVA / TCGCT real adapters | NOT_IMPLEMENTED |
| G17 | Pulse differential speedup/energy evidence | NOT_IMPLEMENTED |

### Measures needed for a future performance claim

- Each benchmark must include hardware, OS, runtime version, dataset and repeat count.
- Compare a plain serial executor, ordinary bounded-parallel executor, and each new algorithm under equivalent constraints.
- Report both improvements and regressions; do not convert a simulation number into a claimed physical core metric.
- Capture output equivalence and numerical accuracy before reporting speedup.

## GitHub open-source checklist

1. Confirm `EveMissLab/EveComputeField` is the canonical independent repository name and creation permissions.
2. Confirm module path `github.com/EveMissLab/EveComputeField` is consistent across imports and builds.
3. Audit all files for secrets, private research contents, workstation paths, and third-party licenses.
4. Confirm organizational MIT licensing / contribution policy; validate notices.
5. Local Windows tests; preferably a LAN peer test; attach exact, scoped evidence.
6. Create a new **public** repository only after naming is finalized; commit clean release and publish a conservative `v0.1.0-reference` tag only after gates are reviewed.
7. Optionally register the already-published independent repository in `EveMissLab/evemisslab-project-catalog` later as a metadata entry under `core-systems`. Do not copy the runtime into that catalog or treat the catalog as a build dependency.
8. Preserve future native-theory private implementations as separate adapters unless explicitly approved for open source.
