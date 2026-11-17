$log = 'C:\Users\Cho-zen\secscan-rebuild-test\alterego\restart2.log'
"helper start " + (Get-Date).ToString('HH:mm:ss') | Out-File $log -Encoding UTF8
Start-Sleep -Seconds 5
try {
  Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -match 'supervisor\.py' } | ForEach-Object { "kill supervisor " + $_.ProcessId | Out-File $log -Append; Stop-Process -Id $_.ProcessId -Force -ErrorAction Stop }
  Start-Sleep -Seconds 2
  Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -match 'server\.py' } | ForEach-Object { "kill server " + $_.ProcessId | Out-File $log -Append; Stop-Process -Id $_.ProcessId -Force -ErrorAction Stop }
  Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'watchdog-hidden' } | ForEach-Object { "kill watchdog " + $_.ProcessId | Out-File $log -Append; Stop-Process -Id $_.ProcessId -Force -ErrorAction Stop }
} catch { "KILL ERROR: " + $_.Exception.Message | Out-File $log -Append }
Start-Sleep -Seconds 3
try { Start-ScheduledTask -TaskName 'AlterEgo Bridge (Elevated)'; "task started" | Out-File $log -Append } catch { "TASK ERROR: " + $_.Exception.Message | Out-File $log -Append }
$found = $null
foreach ($i in 1..15) {
  Start-Sleep -Seconds 2
  $found = Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'server\.py' } | Select-Object -First 1
  if ($found) { break }
}
if ($found) { "new server PID " + $found.ProcessId + " at " + (Get-Date).ToString('HH:mm:ss') | Out-File $log -Append }
else {
  "no server after task start - WMI fallback" | Out-File $log -Append
  $r = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = 'cmd /c "C:\Users\Cho-zen\secscan-rebuild-test\alterego\start-bridge-elevated.bat"' }
  "wmi create return: " + $r.ReturnValue + " pid: " + $r.ProcessId | Out-File $log -Append
}
"helper end" | Out-File $log -Append
