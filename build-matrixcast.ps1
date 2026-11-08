$env:Path = 'C:\Users\Cho-zen\pnpm-home\bin;C:\Program Files\nodejs;' + $env:Path
Remove-Item Env:MODEL_API_KEY -ErrorAction SilentlyContinue
Remove-Item Env:META_API_KEY -ErrorAction SilentlyContinue
Remove-Item Env:DEEPSEEK_API_KEY -ErrorAction SilentlyContinue
Set-Location 'C:\Users\Cho-zen\secscan-rebuild-test'
pnpm build:lib > 'C:\Users\Cho-zen\secscan-rebuild-test\build-matrixcast.log' 2>&1
$LASTEXITCODE | Out-File 'C:\Users\Cho-zen\secscan-rebuild-test\build-matrixcast.done'