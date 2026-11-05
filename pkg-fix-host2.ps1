$ErrorActionPreference = 'Stop'
$clone = 'C:\Users\Cho-zen\secscan-rebuild-test'
$done = Join-Path $clone 'pkg-fix-host2-done.txt'
Remove-Item $done -ErrorAction SilentlyContinue
Set-Location $clone
$hostFile = Join-Path $clone 'apps\desktop-host\src\index.ts'
$enc = New-Object System.Text.UTF8Encoding($false)
$text = [System.IO.File]::ReadAllText($hostFile, $enc)
$needle = "'--port', '19387'"
$count = ([regex]::Matches($text, [regex]::Escape($needle))).Count
if ($count -ne 1) { "ABORT needle count $count" | Out-File $done -Encoding utf8; exit 1 }
$text = $text.Replace($needle, "'--port', '19388'")
[System.IO.File]::WriteAllText($hostFile, $text, $enc)
$hostBlob = (git hash-object apps/desktop-host/src/index.ts).Trim()
$len = (Get-Item $hostFile).Length
"HOSTBLOB=$hostBlob LEN=$len" | Out-File $done -Encoding utf8
