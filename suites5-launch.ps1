Set-Location 'C:\Users\Cho-zen\secscan-rebuild-test'
$env:Path = 'C:\Users\Cho-zen\pnpm-home\bin;C:\Program Files\nodejs;' + $env:Path
Remove-Item Env:MODEL_API_KEY -ErrorAction SilentlyContinue
Remove-Item Env:META_API_KEY -ErrorAction SilentlyContinue
Remove-Item Env:DEEPSEEK_API_KEY -ErrorAction SilentlyContinue
pnpm vitest run packages/client/ui-sidebar/tests/sidebar-snapshot.client.spec.tsx -u > suites5.log 2>&1
"SNAP_EXIT=$LASTEXITCODE" | Out-File suites5.done
pnpm vitest run packages/client/ui-sidebar --reporter=json --outputFile=suites6.json > suites6.log 2>&1
"SIDEBAR_EXIT=$LASTEXITCODE" | Out-File -Append suites5.done
