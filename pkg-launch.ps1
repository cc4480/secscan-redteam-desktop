Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force
$env:MODEL_API_KEY = [Environment]::GetEnvironmentVariable('MODEL_API_KEY','User')
& 'C:\Users\Cho-zen\secscan-rebuild-test\launch-app2.ps1'
