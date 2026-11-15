Set-Location C:\Users\Cho-zen\secscan-rebuild-test
pnpm run build:lib *> build-libs3.log
"BUILD_LIB3_EXIT=$LASTEXITCODE" | Out-File -Append build-libs3.log