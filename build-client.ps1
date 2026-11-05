$ErrorActionPreference = 'Continue'
$clone = 'C:\Users\Cho-zen\secscan-rebuild-test'
$log = Join-Path $clone 'build-client-log.txt'
$done = Join-Path $clone 'build-client-done.txt'
Remove-Item $done -ErrorAction SilentlyContinue
$node = 'C:\Program Files\nodejs\node.exe'
$pnpm = 'C:\Users\Cho-zen\pnpm-home\bin\pnpm.cjs'
"BUILD START $(Get-Date -Format o)" | Out-File $log -Encoding utf8
Set-Location $clone
& $node $pnpm run build >> $log 2>&1
$rootCode = $LASTEXITCODE
"ROOT BUILD EXIT $rootCode $(Get-Date -Format o)" | Out-File $log -Append -Encoding utf8
if ($rootCode -eq 0) {
  Set-Location (Join-Path $clone 'apps\desktop')
  & $node $pnpm run build >> $log 2>&1
  $deskCode = $LASTEXITCODE
} else { $deskCode = -1 }
"DESKTOP BUILD EXIT $deskCode $(Get-Date -Format o)" | Out-File $log -Append -Encoding utf8
"ROOT=$rootCode DESKTOP=$deskCode" | Out-File $done -Encoding utf8
