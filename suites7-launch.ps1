Set-Location 'C:\Users\Cho-zen\secscan-rebuild-test'
$env:Path = 'C:\Users\Cho-zen\pnpm-home\bin;C:\Program Files\nodejs;' + $env:Path
Remove-Item Env:MODEL_API_KEY -ErrorAction SilentlyContinue
Remove-Item Env:META_API_KEY -ErrorAction SilentlyContinue
Remove-Item Env:DEEPSEEK_API_KEY -ErrorAction SilentlyContinue
pnpm vitest run packages/client/ui-sidebar/tests/sidebar-snapshot.client.spec.tsx -u > suites7.log 2>&1
"SNAP_EXIT=$LASTEXITCODE" | Out-File suites7.done
pnpm vitest run packages/client/ui-sidebar/tests --reporter=json --outputFile=suites8.json > suites8.log 2>&1
"SIDEBAR_TESTS_EXIT=$LASTEXITCODE" | Out-File -Append suites7.done
