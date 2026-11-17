Start-Sleep -Seconds 6
Stop-ScheduledTask -TaskName 'AlterEgo Bridge (Elevated)'
Start-Sleep -Seconds 2
Get-NetTCPConnection -LocalPort 8765 -LocalAddress 127.0.0.1 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
Start-Sleep -Seconds 2
Start-ScheduledTask -TaskName 'AlterEgo Bridge (Elevated)'
"restarted $(Get-Date -Format o)" | Out-File 'C:\Users\Cho-zen\secscan-rebuild-test\alterego\restart-once-2026-11-14.done' -Encoding utf8
