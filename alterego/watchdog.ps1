# AlterEgo bridge watchdog v3 - upgraded 2026-11-14 at Carlos's explicit order:
# if it disconnects, reconnect immediately, retry until it connects again,
# and never ask him. This supersedes the v2 two-failure rule and the
# 5-restarts-per-15-min storm hold.
# Runs every 1 min from the 'AlterEgo Bridge Watchdog' scheduled task (Highest).
#
# Probe = the REAL command channel: an MCP tools/call (shell_exec echo)
# against http://127.0.0.1:8765/mcp with the saved session token. (v1 only
# checked for a port listener; that stayed green through the 2026-11-14
# wedges, when /health answered while shell calls hung.)
# On the FIRST failed probe this run restarts the bridge (stop the
# 'AlterEgo Bridge (Elevated)' task, tree-kill any survivor holding the
# loopback port, start the task), then verifies the channel answers.
# Up to 3 restart attempts per run with a pause between; if the channel is
# still down, the next 1-minute run keeps retrying - it never gives up
# and never asks. Every action is written to watchdog.log.
$ErrorActionPreference = 'Continue'
$base = 'C:\Users\Cho-zen\pc-mcp-bridge'
$data = Join-Path $env:APPDATA 'pc-mcp-bridge'
$log = Join-Path $base 'watchdog.log'
$lockFile = Join-Path $base 'watchdog-running.txt'
function Log($m) { Add-Content -Path $log -Value ("{0} {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $m) }

# Single-instance lock: a restart run can outlive one 1-min tick.
if (Test-Path $lockFile) {
  $age = ((Get-Date) - (Get-Item $lockFile).LastWriteTime).TotalSeconds
  if ($age -lt 600) { exit 0 }
}
Set-Content -Path $lockFile -Value (Get-Date -Format 'yyyy-MM-dd HH:mm:ss')

function Get-BridgeToken {
  $f = Join-Path $data 'session_token'
  if (-not (Test-Path $f)) { return $null }
  $raw = (Get-Content $f -Raw).Trim()
  if (-not $raw) { return $null }
  try {
    $j = $raw | ConvertFrom-Json
    if ($j -is [string]) { return $j }
    $items = @($j)
    if ($items.Count -eq 0) { return $null }
    $last = $items[$items.Count - 1]
    if ($last -is [string]) { return $last }
    return $last.token
  } catch {
    return ($raw -split "`n")[0].Trim()
  }
}

function Test-Channel {
  # $true only if a real shell_exec echo round-trips through the MCP endpoint.
  $tok = Get-BridgeToken
  if (-not $tok) { Log 'probe: no session token on disk - cannot probe channel'; return $false }
  $ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
  $hdr = @{ Authorization = "Bearer $tok"; Accept = 'application/json, text/event-stream' }
  $url = 'http://127.0.0.1:8765/mcp'
  try {
    $init = @{ jsonrpc = '2.0'; id = 1; method = 'initialize'; params = @{ protocolVersion = '2025-06-18'; capabilities = @{}; clientInfo = @{ name = 'watchdog'; version = '3.0' } } } | ConvertTo-Json -Depth 6 -Compress
    $r = Invoke-WebRequest -Uri $url -Method Post -Body $init -ContentType 'application/json' -Headers $hdr -UserAgent $ua -TimeoutSec 10 -UseBasicParsing
    $sid = $r.Headers['Mcp-Session-Id']
    if ($sid) { $hdr['Mcp-Session-Id'] = $sid }
    $note = @{ jsonrpc = '2.0'; method = 'notifications/initialized' } | ConvertTo-Json -Compress
    try { Invoke-WebRequest -Uri $url -Method Post -Body $note -ContentType 'application/json' -Headers $hdr -UserAgent $ua -TimeoutSec 5 -UseBasicParsing | Out-Null } catch {}
    $call = @{ jsonrpc = '2.0'; id = 2; method = 'tools/call'; params = @{ name = 'shell_exec'; arguments = @{ command = 'echo wdprobe'; timeout_s = 10 } } } | ConvertTo-Json -Depth 6 -Compress
    $r2 = Invoke-WebRequest -Uri $url -Method Post -Body $call -ContentType 'application/json' -Headers $hdr -UserAgent $ua -TimeoutSec 20 -UseBasicParsing
    return ($r2.Content -match 'wdprobe')
  } catch {
    return $false
  }
}

function Get-LoopbackOwners {
  $c = Get-NetTCPConnection -LocalPort 8765 -State Listen -ErrorAction SilentlyContinue | Where-Object { $_.LocalAddress -eq '127.0.0.1' }
  if ($c) { return @($c | Select-Object -ExpandProperty OwningProcess -Unique) }
  return @()
}

function Restart-Once {
  Log 'restart: stopping bridge task'
  Stop-ScheduledTask -TaskName 'AlterEgo Bridge (Elevated)' -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 3
  foreach ($opid in (Get-LoopbackOwners)) {
    Log "restart: tree-killing survivor pid $opid"
    taskkill /PID $opid /T /F 2>$null | Out-Null
  }
  for ($i = 0; $i -lt 15; $i++) {
    if ((Get-LoopbackOwners).Count -eq 0) { break }
    Start-Sleep -Seconds 1
  }
  Log 'restart: starting bridge task'
  try { Start-ScheduledTask -TaskName 'AlterEgo Bridge (Elevated)' -ErrorAction Stop }
  catch { Log "restart: start call said: $($_.Exception.Message) - verifying anyway" }
  for ($i = 0; $i -lt 6; $i++) {
    Start-Sleep -Seconds 10
    if (Test-Channel) { Log 'restart: verified - command channel answers again'; return $true }
  }
  Log 'restart: attempt did not verify within 60 s'
  return $false
}

try {
  $listen = (Get-LoopbackOwners).Count -gt 0
  $ok = $false
  if (-not $listen) { Log 'probe: no listener on 127.0.0.1:8765 - channel DOWN'; $ok = $false }
  else { $ok = Test-Channel }
  if ($ok) { exit 0 }
  Log 'channel DOWN - reconnecting now'
  for ($attempt = 1; $attempt -le 3; $attempt++) {
    if (Restart-Once) { Log "recovered on attempt $attempt"; exit 0 }
    if ($attempt -lt 3) {
      $wait = 20 * $attempt
      Log "still down - retrying in $wait s (attempt $($attempt + 1) of 3)"
      Start-Sleep -Seconds $wait
    }
  }
  Log 'still down after 3 attempts this run - next check in 1 min keeps retrying'
} finally {
  Remove-Item $lockFile -Force -ErrorAction SilentlyContinue
}
