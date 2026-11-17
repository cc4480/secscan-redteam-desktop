$log = 'C:\Users\Cho-zen\secscan-rebuild-test\alterego\deploy-restart-log.txt'
"orchestrator start $(Get-Date -Format o)" | Out-File $log
Start-Sleep -Seconds 3
$targets = Get-CimInstance Win32_Process -Filter "Name='python.exe'" | Where-Object { $_.CommandLine -match 'pc-agent/server\.py' }
foreach ($t in $targets) { "killing pid $($t.ProcessId)" | Out-File $log -Append; taskkill /PID $t.ProcessId /T /F | Out-File $log -Append }
Start-Sleep -Seconds 2
for ($i=0; $i -lt 40; $i++) {
  $l = Get-NetTCPConnection -LocalPort 8765 -State Listen -ErrorAction SilentlyContinue | Where-Object { $_.LocalAddress -eq '127.0.0.1' }
  if ($l) { "listening after ~$($i*3)s, pid $($l.OwningProcess)" | Out-File $log -Append; break }
  try { Start-ScheduledTask -TaskName 'AlterEgo Bridge (Elevated)' -ErrorAction Stop; "start-task attempt $i ok" | Out-File $log -Append } catch { "start-task attempt $i : $($_.Exception.Message)" | Out-File $log -Append }
  Start-Sleep -Seconds 3
}
"orchestrator done $(Get-Date -Format o)" | Out-File $log -Append
