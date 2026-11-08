Set-Location 'C:\Users\Cho-zen\secscan-rebuild-test'
$env:Path = 'C:\Users\Cho-zen\pnpm-home\bin;C:\Program Files\nodejs;' + $env:Path
Remove-Item Env:MODEL_API_KEY -ErrorAction SilentlyContinue
Remove-Item Env:META_API_KEY -ErrorAction SilentlyContinue
Remove-Item Env:DEEPSEEK_API_KEY -ErrorAction SilentlyContinue
pnpm build:lib > build4.log 2>&1
"BUILD_EXIT=$LASTEXITCODE" | Out-File build4.done
