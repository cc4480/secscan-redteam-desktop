Start-Sleep -Seconds 3
$conn = Get-NetTCPConnection -LocalPort 8765 -State Listen -ErrorAction SilentlyContinue
if ($conn) { $conn.OwningProcess | Select-Object -Unique | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue } }
Start-Sleep -Seconds 2
& powershell -NoProfile -ExecutionPolicy Bypass -File "C:\Users\Cho-zen\secscan-rebuild-test\alterego\scripts\start_bridge_showcase.ps1" *>> "C:\Users\Cho-zen\secscan-rebuild-test\alterego\showcase-restart.log"
