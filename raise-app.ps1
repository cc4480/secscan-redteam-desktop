Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class W2 {
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int n);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
}
"@
[W2]::ShowWindow([IntPtr]7472186, 9) | Out-Null
[W2]::SetForegroundWindow([IntPtr]7472186) | Out-Null
Start-Sleep -Seconds 2
Write-Output RAISED2
