Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force
$env:Path = 'C:\Users\Cho-zen\pnpm-home\bin;C:\Program Files\nodejs;' + $env:Path
$env:MODEL_API_KEY = [Environment]::GetEnvironmentVariable('MODEL_API_KEY','User')
cd 'C:\Users\Cho-zen\secscan-rebuild-test\apps\desktop'
pnpm dev
