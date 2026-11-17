$ErrorActionPreference='SilentlyContinue'
$log = 'C:\Users\Cho-zen\secscan-rebuild-test\alterego\restart-dontask.log'
"restart fired " + (Get-Date).ToString('HH:mm:ss') | Out-File $log -Encoding UTF8
Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -match 'supervisor\.py' } | ForEach-Object { "killing supervisor " + $_.ProcessId | Out-File $log -Append; Stop-Process -Id $_.ProcessId -Force }
Start-Sleep -Seconds 2
Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -match 'server\.py' } | ForEach-Object { "killing server " + $_.ProcessId | Out-File $log -Append; Stop-Process -Id $_.ProcessId -Force }
Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'watchdog-hidden' } | ForEach-Object { "killing watchdog " + $_.ProcessId | Out-File $log -Append; Stop-Process -Id $_.ProcessId -Force }
Start-Sleep -Seconds 3
Start-ScheduledTask -TaskName 'AlterEgo Bridge (Elevated)'
"elevated task started" | Out-File $log -Append
Start-Sleep -Seconds 2
Unregister-ScheduledTask -TaskName 'BridgeDontAskRestart' -Confirm:$false
