$enc = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes("& 'C:\\Users\\Cho-zen\\pc-mcp-bridge\\restart-worker.ps1'"))
$r = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = "powershell -NoProfile -EncodedCommand $enc" }
"orch wmi return=$($r.ReturnValue) pid=$($r.ProcessId)" | Out-File "C:\Users\Cho-zen\secscan-rebuild-test\alterego\restart2.log" -Append -Encoding ascii
