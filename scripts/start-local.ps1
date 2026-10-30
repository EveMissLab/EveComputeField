# EveComputeField M2 Windows localhost bootstrap (PowerShell 5.1+).
# From repository: powershell -ExecutionPolicy Bypass -File .\scripts\start-local.ps1
# This script does not enroll or contact any cloud service.
param(
    [string]$Listen = '127.0.0.1:8765',
    [string]$DataDir = ''
)
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Push-Location $repo
try {
    if (-not (Get-Command go -ErrorAction SilentlyContinue)) {
        throw 'Go toolchain not found in PATH. Install a supported Go version first.'
    }
    $binDir = Join-Path $repo 'build'
    New-Item -ItemType Directory -Path $binDir -Force | Out-Null
    $exe = Join-Path $binDir 'evefield.exe'
    & go build -o $exe ./cmd/evefield
    if ($LASTEXITCODE -ne 0) { throw 'go build failed' }

    if ([string]::IsNullOrWhiteSpace($DataDir)) {
        $DataDir = Join-Path $repo '.evefield-local'
    }
    New-Item -ItemType Directory -Path $DataDir -Force | Out-Null
    $DataDir = (Resolve-Path $DataDir).Path
    $token = Join-Path $DataDir 'control.token'
    $fields = Join-Path $DataDir 'fields'
    $registry = Join-Path $DataDir 'workloads.json'
    if (-not (Test-Path -LiteralPath $token)) {
        & $exe token -out $token
        if ($LASTEXITCODE -ne 0) { throw 'token creation failed' }
    }
    if (-not (Test-Path -LiteralPath $registry)) {
        $manifest = @{
            workloads = @(
                @{name='hash'; program=$exe; args=@('tool','sha256'); timeout_ms=3000; max_output_bytes=4096},
                @{name='uppercase'; program=$exe; args=@('tool','uppercase'); timeout_ms=3000; max_output_bytes=131072},
                @{name='lines'; program=$exe; args=@('tool','lines'); timeout_ms=3000; max_output_bytes=4096}
            )
        }
        $json = ConvertTo-Json -InputObject $manifest -Depth 6
        $utf8 = New-Object System.Text.UTF8Encoding($false)
        [System.IO.File]::WriteAllText($registry, $json, $utf8)
    }

    Write-Host 'EveComputeField M2 Local service - press Ctrl+C to stop.'
    Write-Host "Registry: $registry"
    Write-Host "Data: $fields"
    Write-Host "Example second terminal (from repository):"
    Write-Host "  & '$exe' ctl status -token-file '$token'"
    Write-Host "  & '$exe' ctl create -spec examples/local.json -token-file '$token'"
    Write-Host "  & '$exe' ctl resize -id reference-local -units 720 -token-file '$token'"
    Write-Host "  & '$exe' ctl invoke -id reference-local -workload hash -input-file examples/invoke.txt -save-domain continuity -save-key last_hash -token-file '$token'"
    & $exe serve -data $fields -listen $Listen -token-file $token -workloads $registry
    if ($LASTEXITCODE -ne 0) { throw 'local service stopped with an error' }
} finally {
    Pop-Location
}
