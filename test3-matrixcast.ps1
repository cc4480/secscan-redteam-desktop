$env:Path = 'C:\Users\Cho-zen\pnpm-home\bin;C:\Program Files\nodejs;' + $env:Path
Remove-Item Env:MODEL_API_KEY -ErrorAction SilentlyContinue
Remove-Item Env:META_API_KEY -ErrorAction SilentlyContinue
Remove-Item Env:DEEPSEEK_API_KEY -ErrorAction SilentlyContinue
Set-Location 'C:\Users\Cho-zen\secscan-rebuild-test'
pnpm vitest run packages/client/ui-conversation/tests/home-start.client.spec.tsx > 'C:\Users\Cho-zen\secscan-rebuild-test\test3-uiconv.log' 2>&1
"UICONV3_EXIT=$LASTEXITCODE" | Out-File 'C:\Users\Cho-zen\secscan-rebuild-test\test3.done'