$ErrorActionPreference = 'SilentlyContinue'
$pid8765 = (Get-NetTCPConnection -LocalPort 8765 -State Listen).OwningProcess
if ($pid8765) { Stop-Process -Id $pid8765 -Force }
Start-Sleep 2
cd C:\Users\Cho-zen\secscan-rebuild-test\alterego
$env:PC_BRIDGE_FULL_ACCESS = '1'
Start-Process 'C:\Users\Cho-zen\secscan-rebuild-test\alterego\pc-agent\.venv\Scripts\python.exe' -ArgumentList 'pc-agent\server.py' -WorkingDirectory 'C:\Users\Cho-zen\secscan-rebuild-test\alterego'
