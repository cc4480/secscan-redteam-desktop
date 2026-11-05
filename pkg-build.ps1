$ErrorActionPreference = 'Continue'
$clone = 'C:\Users\Cho-zen\secscan-rebuild-test'
$log = Join-Path $clone 'pkg-build-log.txt'
$done = Join-Path $clone 'pkg-build-done.txt'
Remove-Item $done -ErrorAction SilentlyContinue
$node = 'C:\Program Files\nodejs\node.exe'
$pnpm = 'C:\Users\Cho-zen\pnpm-home\bin\pnpm.cjs'
"BUILD START $(Get-Date -Format o)" | Out-File $log -Encoding utf8
Set-Location $clone
& $node $pnpm install --frozen-lockfile >> $log 2>&1
$installCode = $LASTEXITCODE
"INSTALL EXIT $installCode $(Get-Date -Format o)" | Out-File $log -Append -Encoding utf8
if ($installCode -eq 0) {
  & $node $pnpm run build >> $log 2>&1
  $rootCode = $LASTEXITCODE
} else { $rootCode = -1 }
"ROOT BUILD EXIT $rootCode $(Get-Date -Format o)" | Out-File $log -Append -Encoding utf8
if ($rootCode -eq 0) {
  Set-Location (Join-Path $clone 'apps\desktop')
  & $node $pnpm run build >> $log 2>&1
  $deskCode = $LASTEXITCODE
} else { $deskCode = -1 }
"DESKTOP BUILD EXIT $deskCode $(Get-Date -Format o)" | Out-File $log -Append -Encoding utf8
"INSTALL=$installCode ROOT=$rootCode DESKTOP=$deskCode" | Out-File $done -Encoding utf8
