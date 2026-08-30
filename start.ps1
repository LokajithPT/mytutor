# mytutor — Windows launcher (mirrors start.sh)
# Boots Vite frontend + local faster-whisper STT server together.
# Requires: Node, npm, uv (or python), and server/.env with NIM key.
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

function Need($cmd){ if(-not (Get-Command $cmd -ErrorAction SilentlyContinue)){ Write-Error "Missing required tool: $cmd"; exit 1 } }
Need node
Need npm
# uv is preferred; fallback to python if missing
$hasUv = $null -ne (Get-Command uv -ErrorAction SilentlyContinue)
if(-not $hasUv){ Write-Host "uv not found — falling back to python" -ForegroundColor Yellow }

if(-not (Test-Path node_modules)){
  Write-Host "Installing frontend dependencies..."
  npm install
}

Write-Host ""
Write-Host "Starting mytutor (frontend + local STT server)..."
Write-Host "Open http://localhost:5173"
Write-Host "Ctrl-C stops both."
Write-Host ""

if($hasUv){ npm run dev:all } else { npm run dev }
