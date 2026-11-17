# Fail fast if another bridge already owns the port (see bridge-guard.ps1).
& (Join-Path $PSScriptRoot './bridge-guard.ps1') -Check
if ($LASTEXITCODE -eq 1) { exit 1 }
Start-Sleep -Seconds 3
Get-Process python -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Seconds 2
$repo = "$env:USERPROFILE\pc-mcp-bridge"
$env:PC_BRIDGE_FULL_ACCESS = "1"
Start-Process python -ArgumentList "$repo\pc-agent\server.py" -WorkingDirectory $repo -WindowStyle Minimized
