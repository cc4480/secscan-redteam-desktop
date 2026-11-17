# Fail fast if another bridge already owns the port (see bridge-guard.ps1).
& (Join-Path $PSScriptRoot './bridge-guard.ps1') -Check
if ($LASTEXITCODE -eq 1) { exit 1 }
$ErrorActionPreference = 'Continue'
$log = 'C:\Users\Cho-zen\secscan-rebuild-test\alterego\restart-bridge.log'
("helper start " + (Get-Date -Format u)) | Out-File $log
Start-Sleep -Seconds 3
$procs = Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'pc-agent\\server\.py' }
foreach ($p in $procs) { try { Stop-Process -Id $p.ProcessId -Force; ("killed " + $p.ProcessId) | Out-File $log -Append } catch { ("kill failed " + $p.ProcessId) | Out-File $log -Append } }
Start-Sleep -Seconds 2
$env:PC_BRIDGE_FULL_ACCESS = '1'
Start-Process -FilePath 'C:\Users\Cho-zen\secscan-rebuild-test\alterego\pc-agent\.venv\Scripts\python.exe' -ArgumentList 'pc-agent\server.py' -WorkingDirectory 'C:\Users\Cho-zen\secscan-rebuild-test\alterego' -WindowStyle Minimized
("relaunched " + (Get-Date -Format u)) | Out-File $log -Append
