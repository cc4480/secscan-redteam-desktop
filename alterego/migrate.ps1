<#
.SYNOPSIS
  One-shot cutover: move the running AlterEgo bridge from the old
  C:\Users\Cho-zen\pc-mcp-bridge location to alterego\ in this repo.

.DESCRIPTION
  Run ELEVATED. Order matters: stop the old listener first so the new
  supervisor can bind 8765, then repoint every autostart hook, then
  start from the new tree and verify.

  Old location is NOT deleted -- it stays as a fallback until you have
  confirmed the new one works.
#>
$ErrorActionPreference = 'Stop'
$new = 'C:\Users\Cho-zen\secscan-rebuild-test\alterego'
$old = 'C:\Users\Cho-zen\pc-mcp-bridge'

function Say($m) { Write-Host $m -ForegroundColor Cyan }
function Err($m) { Write-Host $m -ForegroundColor Red }

Say '=== 1. stop the old bridge ==='
$holders = Get-NetTCPConnection -State Listen -LocalPort 8765 -ErrorAction SilentlyContinue |
  ForEach-Object { $_.OwningProcess } | Sort-Object -Unique
foreach ($h in $holders) {
    $p = Get-CimInstance Win32_Process -Filter "ProcessId=$h" -ErrorAction SilentlyContinue
    if ($p -and $p.Name -eq 'python.exe') {
        try { Stop-Process -Id $h -Force -ErrorAction Stop; Say ('  stopped python pid ' + $h) }
        catch { Err ('  FAILED to stop ' + $h + ': ' + $_.Exception.Message) }
    } else {
        Say ('  leaving pid ' + $h + ' (' + $p.Name + ') -- not the bridge')
    }
}
Start-Sleep -Seconds 4
$left = Get-NetTCPConnection -State Listen -LocalPort 8765 -ErrorAction SilentlyContinue |
  Where-Object { (Get-Process -Id $_.OwningProcess -ErrorAction SilentlyContinue).ProcessName -eq 'python' }
if ($left) { Err '  python still holds 8765 -- aborting'; exit 1 }
Say '  port free for python'

Say '=== 2. repoint autostart hooks ==='
$startup = "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Startup"
$bat = Join-Path $startup 'start-bridge.bat'
if (Test-Path $bat) {
    Copy-Item $bat ($bat + '.bak-migration') -Force
    $c = [System.IO.File]::ReadAllText($bat)
    [System.IO.File]::WriteAllText($bat, $c.Replace($old, $new))
    Say ('  updated ' + $bat)
}
$tasks = Get-ScheduledTask | Where-Object { $_.TaskName -match 'AlterEgo|Bridge' }
foreach ($t in $tasks) {
    $acts = $t.Actions | Where-Object { $_.Execute -or $_.Arguments }
    $needs = $false
    foreach ($a in $acts) {
        if (($a.Execute -and $a.Execute -like "*$old*") -or ($a.Arguments -and $a.Arguments -like "*$old*")) { $needs = $true }
    }
    if ($needs) {
        Say ('  task needs update: ' + $t.TaskName)
        foreach ($a in $acts) {
            $exe = $a.Execute; $arg = $a.Arguments
            if ($exe) { $exe = $exe.Replace($old, $new) }
            if ($arg) { $arg = $arg.Replace($old, $new) }
            $set = New-ScheduledTaskAction -Execute $exe -Argument $arg -WorkingDirectory $(if ($a.WorkingDirectory) { $a.WorkingDirectory.Replace($old,$new) } else { $new })
            Set-ScheduledTask -TaskName $t.TaskName -Action $set -ErrorAction SilentlyContinue | Out-Null
        }
        Say ('    repointed ' + $t.TaskName)
    }
}

Say '=== 3. start from the new tree ==='
$env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')
$env:PC_BRIDGE_PERMISSION_MODE = 'acceptEdits'
$g = [Environment]::GetEnvironmentVariable('GHIDRA_INSTALL_DIR','User')
if ($g) { $env:GHIDRA_INSTALL_DIR = $g }
$py = Join-Path $new 'pc-agent\.venv\Scripts\python.exe'
if (-not (Get-Command nmap -ErrorAction SilentlyContinue)) { Err '  nmap not resolvable -- aborting'; exit 1 }
Start-Process -FilePath $py -ArgumentList 'pc-agent\supervisor.py' -WorkingDirectory $new -WindowStyle Minimized
Start-Sleep -Seconds 15

Say '=== 4. verify ==='
$c = Get-NetTCPConnection -State Listen -LocalPort 8765 -ErrorAction SilentlyContinue
if ($c) {
    $loop = $c | Where-Object { $_.LocalAddress -eq '127.0.0.1' }
    if ($loop) { Say ('  loopback 8765 owned by pid ' + $loop.OwningProcess) }
    else { Err '  nothing on loopback 8765' }
} else { Err '  NOTHING on 8765' }
Say ''
Say 'Done. Old tree kept at: '
Say ('  ' + $old)