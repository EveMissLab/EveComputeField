#!/usr/bin/env bash
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
printf '{"workloads":[{"name":"hash","program":"%s/evefield","args":["tool","sha256"],"timeout_ms":3000,"max_output_bytes":4096}]}' "$root" > "$root/registry.json"
port=18766
start() {
  "$root/evefield" serve -listen "127.0.0.1:$port" -data "$root/data" -token-file "$root/token" -workloads "$root/registry.json" >"$root/stdout.log" 2>"$root/stderr.log" &
  pid=$!
  for i in $(seq 1 80); do
    if "$root/evefield" ctl status -url "http://127.0.0.1:$port" -token-file "$root/token" > "$root/status.json" 2>/dev/null; then return 0; fi
    if ! kill -0 "$pid" 2>/dev/null; then cat "$root/stderr.log"; exit 1; fi
    sleep 0.1
  done
  cat "$root/stderr.log"; exit 1
}
ctl() { "$root/evefield" ctl "$@" -url "http://127.0.0.1:$port" -token-file "$root/token"; }
start
ctl create -spec examples/local.json > /dev/null
ctl resize -id reference-local -units 720 > "$root/resized.json"
grep -q '"logical_units":720' "$root/resized.json"
ctl run -id reference-local > "$root/compute.json"
grep -q '"output":52' "$root/compute.json"
ctl invoke -id reference-local -workload hash -input-file examples/invoke.txt -save-domain continuity -save-key digest > "$root/invoked.json"
grep -q '"saved":true' "$root/invoked.json"
expected="$(sha256sum examples/invoke.txt | cut -d' ' -f1)"
ctl get -id reference-local -domain continuity -key digest > "$root/value.json"
grep -q "$expected" "$root/value.json"
kill "$pid"; wait "$pid" || true; pid=""
start
ctl inspect -id reference-local > "$root/restored.json"
grep -q '"logical_units":720' "$root/restored.json"
ctl get -id reference-local -domain continuity -key digest > "$root/recovered-value.json"
grep -q "$expected" "$root/recovered-value.json"
echo 'M2_LOCAL_FIRST_SMOKE_PASS (resize/invoke/restore)'
