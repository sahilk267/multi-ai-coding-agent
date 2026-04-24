#Requires -Version 5.1
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$HERE   = Split-Path -Parent $MyInvocation.MyCommand.Path
$ROOT   = Split-Path -Parent $HERE
$VENV   = Join-Path $ROOT "backend\.venv"

if (-not (Test-Path $VENV)) {
    Write-Host "No virtualenv found. Running install first..."
    & "$HERE\install.ps1"
}

$python = Join-Path $VENV "Scripts\python.exe"

$HOST_ADDR = if ($env:HOST) { $env:HOST } else { "127.0.0.1" }
$PORT      = if ($env:PORT) { $env:PORT } else { "8765" }

Set-Location $ROOT
Write-Host "==> Starting backend at http://${HOST_ADDR}:${PORT}"
& $python -m uvicorn backend.server:app --host $HOST_ADDR --port $PORT
