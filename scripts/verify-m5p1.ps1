# Native Windows evidence gate. Run at the checked-out EveComputeField root.
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location $root
Write-Host 'M5-P1 Native Windows validation (NO remote writes)'
Write-Host "Node: $(node --version)"
& node --test research/m5/cone-memory.test.mjs research/m4/memory.test.mjs
if ($LASTEXITCODE -ne 0) { throw 'M5-P1 focused unit tests failed' }
& node research/run-tests.mjs
if ($LASTEXITCODE -ne 0) { throw 'Full research regression tests failed' }
New-Item -Path '.evefield-local' -ItemType Directory -Force | Out-Null
$name = "m5p1-native-$([DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss')).json"
$out = Join-Path '.evefield-local' $name
& node research/m5/cone-memory-benchmark.mjs --width 64 --height 64 --horizon 5 --branches 4 --repeats 5 --out $out
if ($LASTEXITCODE -ne 0) { throw 'M5-P1 native benchmark failed' }
$report = Get-Content -Raw -Encoding UTF8 $out | ConvertFrom-Json
if (@($report.records | Where-Object { -not $_.fully_equal }).Count -gt 0) {
  throw 'Independent full oracle disagrees with cone result'
}
$sha=(Get-FileHash -Algorithm SHA256 $out).Hash
Write-Host "M5_P1_NATIVE_FUNCTIONAL_PASS | file=$out | SHA256=$sha"
Write-Host 'Do not label this as a general speedup, physical pulse control, or NUMA result.'
