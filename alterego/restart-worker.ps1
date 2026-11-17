# Fail fast if another bridge already owns the port (see bridge-guard.ps1).
& (Join-Path $PSScriptRoot './bridge-guard.ps1') -Check
if ($LASTEXITCODE -eq 1) { exit 1 }
$log = "C:\Users\Cho-zen\secscan-rebuild-test\alterego\restart2.log"
"worker start $(Get-Date -Format o)" | Out-File $log -Encoding ascii
Get-CimInstance Win32_Process -Filter "Name = 'python.exe'" | Where-Object { $_.CommandLine -like "*pc-agent\server.py*" } | ForEach-Object { "killing $($_.ProcessId)" | Out-File $log -Append -Encoding ascii; Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
$n = 0
while ((Get-NetTCPConnection -LocalPort 8765 -State Listen -ErrorAction SilentlyContinue) -and $n -lt 25) { Start-Sleep -Seconds 1; $n++ }
"port free after $n s" | Out-File $log -Append -Encoding ascii
$env:PC_BRIDGE_PERMISSION_MODE = "dontAsk"
$env:PC_BRIDGE_FULL_ACCESS = "1"
$env:PC_BRIDGE_FULL_ACCESS_CONFIRM = "0"
Start-Process python -ArgumentList "pc-agent\server.py" -WorkingDirectory "C:\Users\Cho-zen\secscan-rebuild-test\alterego" -WindowStyle Hidden
"new server launched dontAsk" | Out-File $log -Append -Encoding ascii
