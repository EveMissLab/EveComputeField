# M2 — Local-First Executable Field / 本地可用計算場

**Date:** 2026-10-30 (Asia/Taipei)
**Status:** Executable reference prototype; not a general operating system, VM, sandbox, or verified acceleration mechanism.

## Scope and rationale

M2 prioritizes **one computer**. It upgrades the M1 loopback field authority into a
small but useful local runtime, without requiring cloud accounts, remote workers,
Dot, Grok or another physical machine. Go is a replaceable bootstrap language.

We explicitly **defer** distributed field migration, live cloud continuity,
node orchestration, network memory, OS scheduler integration, NOVA, EML-SF,
TCGCT, and pulse optimization. The existing stateless mTLS worker demo is
retained for backwards compatibility but is not involved in M2's acceptance.

## Implemented

1. Long-lived loopback field authority with multiple field identities, DAG
   execution, typed logical KV domains and durable snapshots (M1 foundation).
2. `PUT /v1/fields/{id}/resize` — quiescent local logical-unit count changes
   between 1 and 65,536. Existing unit indices survive within the new bound;
   field ID, epoch, numerical results and memory are preserved. Logical count
   is **not** CPU cores, physical pulses, threads or allocated memory pages.
3. Interrupted resize recovery — an on-disk `.resize.pending.json` intent is
   written before spec/state replacement. Startup replays valid intents to
   completion; malformed intents fail closed instead of silently discarding
   metadata. An interrupted write that fails while the authority is active
   blocks further mutation for that field until a restart/recovery.
4. Optional named local workload registry (`serve -workloads`): fixed absolute
   executable and fixed arguments, process input via standard input, capped
   standard output and error, per-call timeouts, bounded concurrency, and
   non-shell execution. No executable path, arguments or shell script is
   accepted from the HTTP caller.
5. `POST /v1/fields/{id}/invoke/{workload}` executes a registered workload on
   the local machine. The caller may save UTF-8 stdout to a named snapshot
   domain/key (`save_domain` + `save_key`). Result includes duration, exit
   code and saved flag. This is a *field-associated process invocation*, not
   execution of a general-purpose instruction graph inside a VM.
6. `GET /v1/status`, `GET /v1/workloads`, `ctl status`, `ctl resize`, `ctl
   workloads`, `ctl invoke` and deterministic built-in local helpers.
7. PowerShell local bootstrap and a Linux end-to-end smoke test.

## Windows first-use (PowerShell)

Prerequisite: locally installed Go toolchain and a writable clone of this
repository. Open **PowerShell A** at the repository root:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\start-local.ps1
```

The script compiles `build/evefield.exe` locally, creates a control token once,
creates a local workload registry **only if missing**, then starts the loopback
service. It stores private runtime files in `.evefield-local/` (gitignored).
No network access is required by the application; obtaining Go itself is a
separate installation task. The script does **not** install a Windows service,
configure an OS scheduler, or guarantee Windows ACL hardening.

Open **PowerShell B** at the same repository root:

```powershell
$exe = '.\build\evefield.exe'
$token = '.\.evefield-local\control.token'
& $exe ctl status -token-file $token
& $exe ctl create -spec examples/local.json -token-file $token
& $exe ctl resize -id reference-local -units 720 -token-file $token
& $exe ctl run -id reference-local -token-file $token
& $exe ctl workloads -token-file $token
& $exe ctl invoke -id reference-local -workload hash -input-file examples/invoke.txt -save-domain continuity -save-key last_hash -token-file $token
& $exe ctl get -id reference-local -domain continuity -key last_hash -token-file $token
```

The sample creates a 720-unit **logical** field, executes the existing reference
DAG (`output=52`), invokes a specifically registered `sha256` helper program,
and saves its output as a snapshot-domain string. Stop PowerShell A with
Ctrl+C and restart it; inspect/read the field to verify durable continuity.
If you already created `reference-local` before, skip `ctl create` and use
`ctl inspect` instead. Never run a second authority for the same data root.

## Linux / macOS (manual local-only example)

```bash
go build -o ./evefield ./cmd/evefield
mkdir -p .evefield-local
./evefield token -out .evefield-local/control.token
```

Build a local-only registry containing the **absolute** executable path:

```json
{
  "workloads": [
    {
      "name": "hash",
      "program": "/absolute/path/to/repo/evefield",
      "args": ["tool", "sha256"],
      "timeout_ms": 3000,
      "max_output_bytes": 4096
    }
  ]
}
```

Save it to `.evefield-local/workloads.json`. Then:

```bash
./evefield serve -data .evefield-local/fields -token-file .evefield-local/control.token -workloads .evefield-local/workloads.json
```

In another terminal, use `./evefield ctl ...` with the same token path.

## Local REST contract

Every request requires `Authorization: Bearer <TOKEN>`. The daemon only accepts
an explicit loopback IP literal such as `127.0.0.1`; do **not** reverse-proxy
it into a LAN or cloud. The worker mTLS API remains separate.

- `GET /v1/status` returns local mode, field count, registered workload names.
- `GET /v1/workloads` returns names **only**, not executable paths.
- `PUT /v1/fields/{id}/resize` accepts exactly `{"unit_count":720}`.
- `POST /v1/fields/{id}/invoke/{registered-name}` accepts:

```json
{"input":"hello","save_domain":"continuity","save_key":"last_output"}
```

`save_domain` and `save_key` are optional together. They never allow changing
the program or CLI arguments. Input is <=64 KiB; JSON request body is also
bounded. Output must be UTF-8 and fits each registration's declared limit
(maximum 256 KiB for stdout, separately for stderr), and persisted stdout
must fit the field's target memory-domain quota. Workload timeouts range from
100 to 60,000 milliseconds; maximum concurrent registered processes is 32.
The registry is loaded from disk only at daemon startup.

## Execution and crash semantics

- DAG `run` is the existing pure reference operation. Successful runs advance
  the compute epoch. `resize` and memory writes **do not** increment it.
- Each field serializes its metadata mutations; resize does not happen inside
  a DAG execution. A resize does not allocate or reserve `unit_count` cores.
- Only completed local field state is considered committed. Resize journaling
  provides *local startup roll-forward*, **not** hard power-loss guarantees,
  synchronized fsync of directories, multi-node consensus or rollback of
  external process side effects.
- A registered workload runs as a normal OS process under the same account.
  It may write to the filesystem or network. Such side effects are NOT
  sandboxed, not transactionally coupled to field state, and not rolled back
  if the snapshot save subsequently fails. Choose only trusted executables.
- Workload invocations do not automatically become DAG nodes or advance the
  DAG epoch; they are the first general local application interface.
- `volatile` data exists only while the authority process runs. A resumed
  `snapshot` domain is logical KV state, not address-space restoration.
- Do not edit `spec.json`, `state.json`, or `.resize.pending.json` while the
  daemon is running. On recovery failure, take a backup and inspect rather
  than deleting a journal automatically.

## Acceptance evidence and pending checks

The required test classes are: unit tests; data integrity across resize and
restart; recovery after an interrupted two-file resize; invalid/reserved path
rejection; denied unregistered workloads; process timeout/output limits;
authenticated HTTP; `go vet`, `go test -race`, and Linux daemon smoke.
Windows CI verifies compilation/tests when completed; independent Windows
workstation startup and ACL checks remain distinct.

Benchmark claims (performance gains, scheduler efficiency, single-core or
multi-core physical pulse control) are **OUT OF SCOPE** for M2.
