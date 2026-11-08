Set-Location 'C:\Users\Cho-zen\secscan-rebuild-test'
$env:Path = 'C:\Users\Cho-zen\pnpm-home\bin;C:\Program Files\nodejs;' + $env:Path
Remove-Item Env:MODEL_API_KEY -ErrorAction SilentlyContinue
Remove-Item Env:META_API_KEY -ErrorAction SilentlyContinue
Remove-Item Env:DEEPSEEK_API_KEY -ErrorAction SilentlyContinue
pnpm vitest run packages/client/ui-primitives/tests/glass-screenshot-proof.client.spec.tsx packages/client/ui-sidebar/tests/sidebar-root.client.spec.tsx packages/client/ui-sidebar/tests/sidebar-snapshot.client.spec.tsx --reporter=json --outputFile=suites4.json > suites4.log 2>&1
"VITEST_EXIT=$LASTEXITCODE" | Out-File suites4.done
