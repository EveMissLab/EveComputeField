#!/usr/bin/env bash
# Completely local, field-associated fluid workload; no cloud, no external network.
set -euo pipefail
cd "$(dirname "$0")/.."
root="$(mktemp -d)"
pid=""
cleanup() {
  if [ -n "$pid" ]; then kill "$pid" 2>/dev/null || true; wait "$pid" 2>/dev/null || true; fi
  rm -rf "$root"
}
trap cleanup EXIT
go build -o "$root/evefield" ./cmd/evefield
"$root/evefield" token -out "$root/token" >/dev/null
printf '{"workloads":[{"name":"fluid","program":"%s/evefield","args":["tool","fluid"],"timeout_ms":10000,"max_output_bytes":16384}]}' "$root" > "$root/registry.json"
port=18767
start() {
  "$root/evefield" serve -listen "127.0.0.1:$port" -data "$root/data" -token-file "$root/token" -workloads "$root/registry.json" >"$root/stdout.log" 2>"$root/stderr.log" &
  pid=$!
  for i in $(seq 1 80); do
    if "$root/evefield" ctl status -url "http://127.0.0.1:$port" -token-file "$root/token" >"$root/status.json" 2>/dev/null; then return 0; fi
    if ! kill -0 "$pid" 2>/dev/null; then cat "$root/stderr.log"; exit 1; fi
    sleep .1
  done
  cat "$root/stderr.log"; exit 1
}
ctl() { "$root/evefield" ctl "$@" -url "http://127.0.0.1:$port" -token-file "$root/token"; }
# Local standalone numerical-workload contract (JSON stdin -> JSON stdout).
"$root/evefield" tool fluid < examples/fluid/scenario.json > "$root/numerical.json"
python3 - "$root/numerical.json" <<'PY'
import json, sys
p=json.load(open(sys.argv[1], encoding="utf-8"))
assert p["model"].startswith("1D Saint-Venant")
assert p["cells"]==96 and p["steps"]>100
assert abs(p["mass_residual_m2"])<1e-8
assert len(p["samples"])==17
PY
start
ctl create -spec examples/local.json > /dev/null
ctl invoke -id reference-local -workload fluid -input-file examples/fluid/scenario.json -save-domain continuity -save-key fluid_result > "$root/invoked.json"
python3 - "$root/invoked.json" <<'PY'
import json,sys
r=json.load(open(sys.argv[1],encoding="utf-8"))
assert r['saved'] is True, r
assert abs(json.loads(r['stdout'])['mass_residual_m2']) < 1e-8
PY
ctl get -id reference-local -domain continuity -key fluid_result > "$root/stored.json"
grep -q 'mass_residual_m2' "$root/stored.json"
kill "$pid"; wait "$pid" || true; pid=""
start
ctl get -id reference-local -domain continuity -key fluid_result > "$root/recovered.json"
cmp "$root/stored.json" "$root/recovered.json"
echo 'M3_FLUID_LOCAL_FIELD_SMOKE_PASS (solver/invoke/durable-restore)'
