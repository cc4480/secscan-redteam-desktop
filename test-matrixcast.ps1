$env:Path = 'C:\Users\Cho-zen\pnpm-home\bin;C:\Program Files\nodejs;' + $env:Path
Remove-Item Env:MODEL_API_KEY -ErrorAction SilentlyContinue
Remove-Item Env:META_API_KEY -ErrorAction SilentlyContinue
Remove-Item Env:DEEPSEEK_API_KEY -ErrorAction SilentlyContinue
Set-Location 'C:\Users\Cho-zen\secscan-rebuild-test\packages\client\ui-conversation'
pnpm test > 'C:\Users\Cho-zen\secscan-rebuild-test\test-uiconv-matrixcast.log' 2>&1
"UICONV_EXIT=$LASTEXITCODE" | Out-File 'C:\Users\Cho-zen\secscan-rebuild-test\test-matrixcast.done'
Set-Location 'C:\Users\Cho-zen\secscan-rebuild-test\apps\redteam-runner'
pnpm test test/speaker.test.ts test/fleet-assembly.test.ts test/report-html.test.ts test/peer-review.test.ts > 'C:\Users\Cho-zen\secscan-rebuild-test\test-runner-matrixcast.log' 2>&1
"RUNNER_EXIT=$LASTEXITCODE" | Out-File -Append 'C:\Users\Cho-zen\secscan-rebuild-test\test-matrixcast.done'