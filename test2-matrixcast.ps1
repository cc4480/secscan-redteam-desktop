$env:Path = 'C:\Users\Cho-zen\pnpm-home\bin;C:\Program Files\nodejs;' + $env:Path
Remove-Item Env:MODEL_API_KEY -ErrorAction SilentlyContinue
Remove-Item Env:META_API_KEY -ErrorAction SilentlyContinue
Remove-Item Env:DEEPSEEK_API_KEY -ErrorAction SilentlyContinue
Set-Location 'C:\Users\Cho-zen\secscan-rebuild-test\apps\redteam-runner'
pnpm exec tsc -p tsconfig.test.json > 'C:\Users\Cho-zen\secscan-rebuild-test\test2-compile.log' 2>&1
"TSC_EXIT=$LASTEXITCODE" | Out-File 'C:\Users\Cho-zen\secscan-rebuild-test\test2.done'
node --test --import ./dist-test/test/_pool-isolation.js dist-test/test/speaker.test.js dist-test/test/engagement-tools.test.js dist-test/test/report-scribe.test.js dist-test/test/fleet-assembly.test.js dist-test/test/report-html.test.js dist-test/test/peer-review.test.js > 'C:\Users\Cho-zen\secscan-rebuild-test\test2-runner.log' 2>&1
"RUNNER2_EXIT=$LASTEXITCODE" | Out-File -Append 'C:\Users\Cho-zen\secscan-rebuild-test\test2.done'
Set-Location 'C:\Users\Cho-zen\secscan-rebuild-test'
pnpm vitest run packages/client/ui-conversation/tests > 'C:\Users\Cho-zen\secscan-rebuild-test\test2-uiconv.log' 2>&1
"UICONV2_EXIT=$LASTEXITCODE" | Out-File -Append 'C:\Users\Cho-zen\secscan-rebuild-test\test2.done'