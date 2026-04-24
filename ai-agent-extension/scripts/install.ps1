#Requires -Version 5.1
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$HERE   = Split-Path -Parent $MyInvocation.MyCommand.Path
$ROOT   = Split-Path -Parent $HERE
$VENV   = Join-Path $ROOT "backend\.venv"
$REQS   = Join-Path $ROOT "backend\requirements.txt"

# Locate Python
$PY = $env:PYTHON
if (-not $PY) {
    foreach ($candidate in @("python3", "python")) {
        if (Get-Command $candidate -ErrorAction SilentlyContinue) {
            $PY = $candidate; break
        }
    }
}
if (-not $PY) {
    Write-Error "Python 3 not found. Install Python 3.10+ and re-run."
    exit 1
}

Write-Host "==> Creating virtualenv at $VENV"
& $PY -m venv $VENV

$pip = Join-Path $VENV "Scripts\pip.exe"

Write-Host "==> Upgrading pip"
& $pip install --upgrade pip wheel

Write-Host "==> Installing backend requirements"
& $pip install -r $REQS

foreach ($dir in @("$ROOT\logs", "$ROOT\projects")) {
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir | Out-Null }
}

Write-Host ""
Write-Host "Install complete."
Write-Host "Run the backend with: ai-agent-extension\scripts\run.ps1"
Write-Host "Then load ai-agent-extension\extension\ as an unpacked extension in chrome://extensions"
