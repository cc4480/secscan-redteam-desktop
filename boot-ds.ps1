Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force
$env:Path = 'C:\Users\Cho-zen\pnpm-home\bin;C:\Program Files\nodejs;' + $env:Path
$env:MODEL_API_KEY = [Environment]::GetEnvironmentVariable('MODEL_API_KEY','User')
$env:DEEPSEEK_API_KEY = [Environment]::GetEnvironmentVariable('DEEPSEEK_API_KEY','User')
$env:REDTEAM_LLM_PROVIDER = 'deepseek'
Set-Location 'C:\Users\Cho-zen\secscan-rebuild-test\apps\desktop'
pnpm dev *>> 'C:\Users\Cho-zen\secscan-rebuild-test\dev-boot-log-1104-ds.txt'
