$ErrorActionPreference = 'Continue'
$log = 'C:\Users\Cho-zen\secscan-rebuild-test\alterego\switch-to-elevated.log'
("switch helper start " + (Get-Date -Format u)) | Out-File $log
Start-Sleep -Seconds 3
$procs = Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'pc-agent\\server\.py' }
foreach ($p in $procs) { try { Stop-Process -Id $p.ProcessId -Force; ("killed " + $p.ProcessId) | Out-File $log -Append } catch { ("kill failed " + $p.ProcessId) | Out-File $log -Append } }
Start-Sleep -Seconds 2
schtasks /Run /TN "AlterEgo Bridge (Elevated)" | Out-File $log -Append
("task started " + (Get-Date -Format u)) | Out-File $log -Append
