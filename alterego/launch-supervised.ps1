# LAUNCHER GUARD
# The AlterEgo bridge is owned by the remote agent and listens on 8765.
# Starting a second instance here fights it for the port (both run
# reap_zombies and kill the other's child). This script therefore refuses
# to start unless ALTEREGO_ALLOW_SECOND_INSTANCE=1 is set, and always uses
# a DIFFERENT port when it does.
if ($env:ALTEREGO_ALLOW_SECOND_INSTANCE -ne '1') {
    Write-Host 'refusing to start: an AlterEgo bridge may already own 8765.' -ForegroundColor Yellow
    Write-Host 'This launcher exists for deliberate second instances only.' -ForegroundColor Yellow
    Write-Host 'Set $env:ALTEREGO_ALLOW_SECOND_INSTANCE = ''1'' and $env:PC_BRIDGE_PORT = ''8766'' to override.' -ForegroundColor Yellow
    exit 1
}
$ErrorActionPreference = 'Stop'
# Build PATH from the registry, not from this shell: eliminates stale inheritance.
$u = [Environment]::GetEnvironmentVariable('Path','User')
$m = [Environment]::GetEnvironmentVariable('Path','Machine')
$env:Path = $m + ';' + $u
# Carry registry env the server needs -- rebuilt at launch, never inherited.
foreach ($v in 'GHIDRA_INSTALL_DIR','JAVA_HOME','REA_GHIDRA_STARTUP_TIMEOUT_MS') {
    $val = [Environment]::GetEnvironmentVariable($v,'User')
    if ($val) { Set-Item -Path ('Env:' + $v) -Value $val }
}
$env:PC_BRIDGE_DATA_DIR = 'C:\Users\Cho-zen\secscan-rebuild-test\alterego\data'
$env:PC_BRIDGE_PERMISSION_MODE = 'acceptEdits'
if (-not $env:GHIDRA_INSTALL_DIR) { $env:GHIDRA_INSTALL_DIR = 'C:\tools\ghidra_12.1.4_PUBLIC' }

$probe = (Get-Command nmap -ErrorAction SilentlyContinue)
if (-not $probe) { Write-Output 'FATAL: nmap still not resolvable after PATH rebuild'; exit 1 }
Write-Output ('nmap resolves: ' + $probe.Source)

$py = 'C:\Users\Cho-zen\secscan-rebuild-test\alterego\pc-agent\.venv\Scripts\python.exe'
$cwd = 'C:\Users\Cho-zen\secscan-rebuild-test\alterego'
$log = Join-Path $cwd 'supervisor-restart.log'
Start-Process -FilePath $py -ArgumentList 'pc-agent\supervisor.py' -WorkingDirectory $cwd -WindowStyle Minimized -RedirectStandardOutput $log -RedirectStandardError ($log + '.err')
Write-Output ('supervisor launched; PATH entries: ' + (($env:Path -split ';') | Where-Object { $_ -match 'tools|Nmap|Wireshark|metasploit' }).Count)