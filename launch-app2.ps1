$ErrorActionPreference = 'Continue'
$clone = 'C:\Users\Cho-zen\secscan-rebuild-test'
$log = Join-Path $clone 'app-start2-log.txt'
"APP START $(Get-Date -Format o)" | Out-File $log -Encoding utf8
Set-Location (Join-Path $clone 'apps\desktop')
& 'C:\Program Files\nodejs\node.exe' 'C:\Users\Cho-zen\pnpm-home\bin\pnpm.cjs' start >> $log 2>&1
