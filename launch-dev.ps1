$ErrorActionPreference = 'Continue'
$clone = 'C:\Users\Cho-zen\secscan-rebuild-test'
$log = Join-Path $clone 'app-dev-log.txt'
"APP DEV START $(Get-Date -Format o)" | Out-File $log -Encoding utf8
Set-Location (Join-Path $clone 'apps\desktop')
& 'C:\Program Files\nodejs\node.exe' 'C:\Users\Cho-zen\pnpm-home\bin\pnpm.cjs' dev >> $log 2>&1
