$ErrorActionPreference = 'Continue'
$clone = 'C:\Users\Cho-zen\secscan-rebuild-test'
$log = Join-Path $clone 'pkg-fix-host-log.txt'
$done = Join-Path $clone 'pkg-fix-host-done.txt'
Remove-Item $done -ErrorAction SilentlyContinue
Set-Location $clone
git checkout -- apps/desktop-host/src/index.ts >> $log 2>&1
$baseBlob = (git hash-object apps/desktop-host/src/index.ts).Trim()
$patch = @'
diff --git a/apps/desktop-host/src/index.ts b/apps/desktop-host/src/index.ts
--- a/apps/desktop-host/src/index.ts
+++ b/apps/desktop-host/src/index.ts
@@ -25,7 +25,7 @@ async function main(): Promise<void> {
     profile: 'desktop',
     resolvedProfile: { profile, installAnchor },
     patchFiles: [],
-    args: ['--no-open', '--port', '19387'],
+    args: ['--no-open', '--port', '19388'],
     ...(process.argv[5] === undefined ? {} : {
       packageManager: {
         command: process.execPath,
'@
$patchPath = Join-Path $clone 'host.patch'
[System.IO.File]::WriteAllText($patchPath, $patch, (New-Object System.Text.UTF8Encoding($false)))
git apply $patchPath >> $log 2>&1
$applyCode = $LASTEXITCODE
Remove-Item $patchPath -ErrorAction SilentlyContinue
$hostBlob = (git hash-object apps/desktop-host/src/index.ts).Trim()
"BASE=$baseBlob APPLY=$applyCode HOSTBLOB=$hostBlob" | Out-File $done -Encoding utf8
