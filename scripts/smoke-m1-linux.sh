#!/usr/bin/env bash
# An on-host loopback-only CLI smoke; no credentials are committed.
set -euo pipefail
cd "$(dirname "$0")/.."
tmp="$(mktemp -d)"
pid=""
cleanup() {
  if [[ -n "$pid" ]]; then kill -TERM "$pid" 2>/dev/null || true; wait "$pid" 2>/dev/null || true; fi
  rm -rf "$tmp"
}
trap cleanup EXIT
go build -o "$tmp/evefield" ./cmd/evefield
"$tmp/evefield" token -out "$tmp/control.token" >/dev/null
start() {
  "$tmp/evefield" serve -listen 127.0.0.1:18665 -data "$tmp/data" -token-file "$tmp/control.token" >"$tmp/serve.log" 2>&1 &
  pid=$!
  local ok=0
  for _ in {1..50}; do
    if "$tmp/evefield" ctl list -url http://127.0.0.1:18665 -token-file "$tmp/control.token" > /dev/null 2>&1; then ok=1; break; fi
    sleep 0.1
  done
  if [[ "$ok" != 1 ]]; then cat "$tmp/serve.log" >&2; return 1; fi
}
stop() {
  kill -TERM "$pid"
  wait "$pid"
  pid=""
}
start
"$tmp/evefield" ctl create -spec examples/local.json -url http://127.0.0.1:18665 -token-file "$tmp/control.token" >/dev/null
"$tmp/evefield" ctl run -id reference-local -url http://127.0.0.1:18665 -token-file "$tmp/control.token" >"$tmp/run.json"
"$tmp/evefield" ctl put -id reference-local -domain continuity -key marker -value durable -url http://127.0.0.1:18665 -token-file "$tmp/control.token" >/dev/null
stop
start
"$tmp/evefield" ctl inspect -id reference-local -url http://127.0.0.1:18665 -token-file "$tmp/control.token" >"$tmp/state.json"
"$tmp/evefield" ctl get -id reference-local -domain continuity -key marker -url http://127.0.0.1:18665 -token-file "$tmp/control.token" >"$tmp/value.json"
python3 - "$tmp/run.json" "$tmp/state.json" "$tmp/value.json" <<'PY2'
import json,sys
r,s,v=[json.load(open(path)) for path in sys.argv[1:]]
assert r['epoch']==s['epoch']==1, (r,s)
assert r['results']['output']==s['results']['output']==52
assert v['value']=='durable'
print('M1_SMOKE_PASS: create, run, checkpoint, graceful restart, restore, memory read')
PY2
stop
