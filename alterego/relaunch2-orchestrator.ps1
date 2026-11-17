# Fail fast if another bridge already owns the port (see bridge-guard.ps1).
& (Join-Path $PSScriptRoot './bridge-guard.ps1') -Check
if ($LASTEXITCODE -eq 1) { exit 1 }

$log = 'C:\Users\Cho-zen\secscan-rebuild-test\alterego\relaunch2.log'
"orch start $(Get-Date -Format o)" | Out-File $log -Encoding utf8
Start-Sleep -Seconds 3
try {
  $conn = Get-NetTCPConnection -LocalAddress 127.0.0.1 -LocalPort 8765 -State Listen -ErrorAction SilentlyContinue
  if ($conn) {
    $conn.OwningProcess | Select-Object -Unique | ForEach-Object {
      "killing listener pid $_" | Out-File $log -Append -Encoding utf8
      Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue
    }
  } else { "no 127.0.0.1:8765 listener found" | Out-File $log -Append -Encoding utf8 }
} catch { "kill err: $_" | Out-File $log -Append -Encoding utf8 }
Start-Sleep -Seconds 2
try {
  $inner = '$env:PC_BRIDGE_FULL_ACCESS=''1''; $env:PC_BRIDGE_FULL_ACCESS_CONFIRM=''0''; Set-Location ''C:\Users\Cho-zen\secscan-rebuild-test\alterego''; & python pc-agent\server.py'
  $p = Start-Process powershell -ArgumentList '-NoProfile','-Command', $inner -WorkingDirectory 'C:\Users\Cho-zen\secscan-rebuild-test\alterego' -PassThru
  "started host powershell pid $($p.Id)" | Out-File $log -Append -Encoding utf8
} catch { "start err: $_" | Out-File $log -Append -Encoding utf8 }

