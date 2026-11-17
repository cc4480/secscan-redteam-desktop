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
$env:PC_BRIDGE_PERMISSION_MODE = 'acceptEdits'
if (-not $env:GHIDRA_INSTALL_DIR) { $env:GHIDRA_INSTALL_DIR = 'C:\tools\ghidra_12.1.4_PUBLIC' }

$probe = (Get-Command nmap -ErrorAction SilentlyContinue)
if (-not $probe) { Write-Output 'FATAL: nmap still not resolvable after PATH rebuild'; exit 1 }
Write-Output ('nmap resolves: ' + $probe.Source)

$py = 'C:\Users\Cho-zen\pc-mcp-bridge\pc-agent\.venv\Scripts\python.exe'
$cwd = 'C:\Users\Cho-zen\pc-mcp-bridge'
$log = Join-Path $cwd 'supervisor-restart.log'
Start-Process -FilePath $py -ArgumentList 'pc-agent\supervisor.py' -WorkingDirectory $cwd -WindowStyle Minimized -RedirectStandardOutput $log -RedirectStandardError ($log + '.err')
Write-Output ('supervisor launched; PATH entries: ' + (($env:Path -split ';') | Where-Object { $_ -match 'tools|Nmap|Wireshark|metasploit' }).Count)