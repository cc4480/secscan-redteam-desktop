<#
.SYNOPSIS
  Refuse to start a second AlterEgo bridge unless explicitly allowed.

.DESCRIPTION
  The bridge on port 8765 is owned by the remote agent. Every launcher in
  this repo (restart-*, start-*, bridge-admin, watchdog, orchestrators) can
  spawn a server, and two servers on one port destroy each other: each calls
  reap_zombies(), which terminates the other's child. That is what made the
  bridge appear to "randomly crash" all session.

  Dot-source or invoke this before starting anything:
      . "$PSScriptRoot\bridge-guard.ps1"          # throws on conflict
      & "$PSScriptRoot\bridge-guard.ps1" -Check  # exit 1 on conflict

  ALTEREGO_ALLOW_SECOND_INSTANCE=1 overrides, but only together with a
  non-default port, so a second instance can never land on 8765.
#>
param(
    [int] $Port = $(if ($env:PC_BRIDGE_PORT) { [int]$env:PC_BRIDGE_PORT } else { 8765 }),
    [switch] $Check
)

$conflict = $null
$owners = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue |
    ForEach-Object { $_.OwningProcess } | Sort-Object -Unique
foreach ($procId in $owners) {
    $proc = Get-Process -Id $procId -ErrorAction SilentlyContinue
    if ($proc -and $proc.ProcessName -match 'python') {
        $conflict = $procId
    }
}

if ($conflict) {
    if ($env:ALTEREGO_ALLOW_SECOND_INSTANCE -eq '1' -and $Port -ne 8765) {
        Write-Warning "port $Port already held by pid $conflict; proceeding (explicit override)"
        return
    }
    $msg = "refusing to start: port $Port is already held by python pid $conflict. " +
           "An AlterEgo bridge is running. Use ALTEREGO_ALLOW_SECOND_INSTANCE=1 " +
           "with PC_BRIDGE_PORT set to a NON-8765 port for a deliberate second instance."
    if ($Check) {
        Write-Host $msg -ForegroundColor Yellow
        exit 1
    }
    throw $msg
}

Write-Verbose "port $Port is free"
