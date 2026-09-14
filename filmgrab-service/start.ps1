# One-click launcher for the FilmGrab screenshot proxy (Windows PowerShell)
# Detects local proxy at 127.0.0.1:7890: sets proxy env if present, otherwise connects directly.

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

$pythonExe = Join-Path $PSScriptRoot ".venv\Scripts\python.exe"
if (-not (Test-Path $pythonExe)) {
    Write-Host "Virtualenv not found. Creating it and installing dependencies (first run only)..." -ForegroundColor Yellow
    python -m venv .venv
    & $pythonExe -m pip install -r requirements.txt
}

# Probe whether a local proxy is listening on port 7890
$client = New-Object System.Net.Sockets.TcpClient
$proxyOn = $false
try {
    $client.Connect("127.0.0.1", 7890)
    $proxyOn = $true
} catch {
    $proxyOn = $false
} finally {
    $client.Close()
}

if ($proxyOn) {
    $env:HTTPS_PROXY = "http://127.0.0.1:7890"
    $env:HTTP_PROXY = "http://127.0.0.1:7890"
    Write-Host "Local proxy enabled: http://127.0.0.1:7890" -ForegroundColor Green
} else {
    Write-Host "No local proxy detected, connecting directly" -ForegroundColor DarkGray
}

Write-Host "Starting FilmGrab proxy at http://localhost:8000 ..." -ForegroundColor Cyan
& $pythonExe main.py
