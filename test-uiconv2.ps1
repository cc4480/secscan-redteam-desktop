$env:Path = 'C:\Users\Cho-zen\pnpm-home\bin;C:\Program Files\nodejs;' + $env:Path
Remove-Item Env:MODEL_API_KEY -ErrorAction SilentlyContinue
Remove-Item Env:META_API_KEY -ErrorAction SilentlyContinue
Remove-Item Env:DEEPSEEK_API_KEY -ErrorAction SilentlyContinue
Set-Location 'C:\Users\Cho-zen\secscan-rebuild-test\packages\client\ui-conversation'
pnpm vitest run > 'C:\Users\Cho-zen\secscan-rebuild-test\test-uiconv2-matrixcast.log' 2>&1
"VITEST_EXIT=$LASTEXITCODE" | Out-File 'C:\Users\Cho-zen\secscan-rebuild-test\test-uiconv2.done'