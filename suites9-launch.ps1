Set-Location 'C:\Users\Cho-zen\secscan-rebuild-test'
$env:Path = 'C:\Users\Cho-zen\pnpm-home\bin;C:\Program Files\nodejs;' + $env:Path
Remove-Item Env:MODEL_API_KEY -ErrorAction SilentlyContinue
Remove-Item Env:META_API_KEY -ErrorAction SilentlyContinue
Remove-Item Env:DEEPSEEK_API_KEY -ErrorAction SilentlyContinue
pnpm vitest run packages/client/ui-conversation packages/client/ui-sidebar/tests --reporter=json --outputFile=suites9.json > suites9.log 2>&1
"EXIT=$LASTEXITCODE" | Out-File suites9.done
