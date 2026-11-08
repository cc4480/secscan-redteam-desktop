Set-Location 'C:\Users\Cho-zen\secscan-rebuild-test'
$env:Path = 'C:\Users\Cho-zen\pnpm-home\bin;C:\Program Files\nodejs;' + $env:Path
Remove-Item Env:MODEL_API_KEY -ErrorAction SilentlyContinue
Remove-Item Env:META_API_KEY -ErrorAction SilentlyContinue
Remove-Item Env:DEEPSEEK_API_KEY -ErrorAction SilentlyContinue
$out = @()
foreach ($pkg in '@deepseek-ai/dsh-client-ui-sidebar','@deepseek-ai/dsh-client-ui-primitives','@deepseek-ai/dsh-client-ui-conversation','@deepseek-ai/dsh-client-ui-layout') {
  "=== $pkg ===" | Out-File suites2.log -Append
  pnpm --filter $pkg exec vitest run >> suites2.log 2>&1
  $out += "$pkg exit=$LASTEXITCODE"
}
$out | Out-File suites2.done
