$ErrorActionPreference = 'Continue'
$clone = 'C:\Users\Cho-zen\secscan-rebuild-test'
$target = '72291ee5db63c9f250a226260fb66e78b7b3b24a'
$log = Join-Path $clone 'pkg-update-log.txt'
$done = Join-Path $clone 'pkg-update-done.txt'
Remove-Item $done -ErrorAction SilentlyContinue
"UPDATE START $(Get-Date -Format o)" | Out-File $log -Encoding utf8
Set-Location $clone
"REMOTE: $(git remote get-url origin)" | Out-File $log -Append -Encoding utf8
git fetch origin >> $log 2>&1
"FETCH EXIT $LASTEXITCODE" | Out-File $log -Append -Encoding utf8
git reset --hard $target >> $log 2>&1
"RESET EXIT $LASTEXITCODE" | Out-File $log -Append -Encoding utf8
$headAfter = (git rev-parse HEAD).Trim()
"HEAD AFTER RESET: $headAfter" | Out-File $log -Append -Encoding utf8
# Re-apply Carlos's host patch: host port 19387 -> 19388 (exactly one occurrence)
$hostFile = Join-Path $clone 'apps\desktop-host\src\index.ts'
$content = Get-Content $hostFile -Raw
$needle = "'--port', '19387'"
$count = ([regex]::Matches($content, [regex]::Escape($needle))).Count
"PATCH NEEDLE COUNT: $count" | Out-File $log -Append -Encoding utf8
if ($count -eq 1) {
  $content = $content.Replace($needle, "'--port', '19388'")
  Set-Content $hostFile -Value $content -NoNewline -Encoding utf8
  "PATCH APPLIED" | Out-File $log -Append -Encoding utf8
} else {
  "PATCH ABORTED: needle count $count" | Out-File $log -Append -Encoding utf8
}
$hostBlob = (git hash-object apps/desktop-host/src/index.ts).Trim()
"HOST BLOB: $hostBlob" | Out-File $log -Append -Encoding utf8
"LAUNCH SCRIPT PRESENT: $(Test-Path (Join-Path $clone 'launch-app2.ps1'))" | Out-File $log -Append -Encoding utf8
$envFile = Join-Path $clone 'apps\desktop\.env.windows'
$envCount = 0
if (Test-Path $envFile) { $envCount = (Get-Content $envFile | Where-Object { $_ -match '^[A-Z_]+=' }).Count }
"ENV KEY COUNT: $envCount" | Out-File $log -Append -Encoding utf8
$porc = (git status --porcelain | Measure-Object -Line).Lines
"PORCELAIN AFTER: $porc" | Out-File $log -Append -Encoding utf8
git status --porcelain >> $log 2>&1
"HEAD=$headAfter HOSTBLOB=$hostBlob ENVKEYS=$envCount" | Out-File $done -Encoding utf8
"UPDATE DONE $(Get-Date -Format o)" | Out-File $log -Append -Encoding utf8
