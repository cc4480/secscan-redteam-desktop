# Local-PC agent bridge: Windows helper.
#
# Called by the Node bridge as `powershell -NoProfile -File win.ps1 -Request <json>`.
# Reads one JSON request, writes one JSON reply on stdout. Every operation is
# read-only except `input` and `clip_set`, which the Node tier gate allows only
# for approved sessions.
#
# Operations: screenshot | windows | tree | focused | hash | clip_get | clip_set |
#             input | assert
param([Parameter(Mandatory = $true)][string]$Request)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
# Node parses stdout as UTF-8; without this Windows PowerShell may emit a BOM.
try { [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false) } catch { }

function Write-Json($value) {
  $value | ConvertTo-Json -Depth 8 -Compress
}

# UIA reports NaN/Infinity (and ±32000 sentinels) for minimized or cloaked
# windows; casting those to Int32 throws and kills the whole tree walk.
function Safe-Int($value) {
  if ($null -eq $value) { return 0 }
  $number = 0.0
  if (-not [double]::TryParse([string]$value, [ref]$number)) { return 0 }
  if ([double]::IsNaN($number) -or [double]::IsInfinity($number)) { return 0 }
  if ($number -lt -2147483648 -or $number -gt 2147483647) { return 0 }
  return [int]$number
}

function Get-Screens {
  Add-Type -AssemblyName System.Windows.Forms
  [System.Windows.Forms.Screen]::AllScreens
}

function Get-WindowRect($title) {
  Add-Type -AssemblyName System.Windows.Forms
  Add-Type -AssemblyName UIAutomationClient
  Add-Type -AssemblyName UIAutomationTypes
  $root = [System.Windows.Automation.AutomationElement]::RootElement
  $cond = New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::NameProperty, $title)
  $element = $root.FindFirst([System.Windows.Automation.TreeScope]::Children, $cond)
  if ($null -eq $element) { return $null }
  $rect = $element.Current.BoundingRectangle
  return @{
    x = (Safe-Int $rect.X); y = (Safe-Int $rect.Y)
    width = (Safe-Int $rect.Width); height = (Safe-Int $rect.Height)
  }
}

function Invoke-Screenshot($request) {
  Add-Type -AssemblyName System.Drawing
  $bounds = $null
  if ($request.window) {
    $bounds = Get-WindowRect $request.window
  }
  if ($null -eq $bounds) {
    $screen = Get-Screens | Where-Object { $_.Primary } | Select-Object -First 1
    $bounds = @{
      x = $screen.Bounds.X; y = $screen.Bounds.Y
      width = $screen.Bounds.Width; height = $screen.Bounds.Height
    }
  }
  $width = [Math]::Max(1, [int]$bounds.width)
  $height = [Math]::Max(1, [int]$bounds.height)
  $bitmap = New-Object System.Drawing.Bitmap($width, $height)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  try {
    $graphics.CopyFromScreen([int]$bounds.x, [int]$bounds.y, 0, 0, $bitmap.Size)
    $scale = 1.0
    if ($request.scale -and $request.scale -gt 0 -and $request.scale -lt 1) { $scale = [double]$request.scale }
    if ($scale -lt 1) {
      $small = New-Object System.Drawing.Bitmap([int]($width * $scale), [int]($height * $scale))
      $target = [System.Drawing.Graphics]::FromImage($small)
      try { $target.DrawImage($bitmap, 0, 0, $small.Width, $small.Height) } finally { $target.Dispose() }
      $bitmap.Dispose()
      $bitmap = $small
    }
    $stream = New-Object System.IO.MemoryStream
    $bitmap.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
    $bytes = $stream.ToArray()
    return @{
      width = $bitmap.Width; height = $bitmap.Height
      bounds = $bounds
      mimeType = 'image/png'
      base64 = [Convert]::ToBase64String($bytes)
      bytes = $bytes.Length
    }
  } finally {
    $graphics.Dispose()
    $bitmap.Dispose()
  }
}

function Invoke-Windows {
  Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -ne '' } |
    Select-Object @{n = 'ref'; e = { 'w-' + $_.Id } }, @{n = 'title'; e = { $_.MainWindowTitle } },
      @{n = 'pid'; e = { $_.Id } }, @{n = 'process'; e = { $_.ProcessName } } |
    ConvertTo-Json -Depth 4 -Compress
}

function Invoke-Tree($request) {
  Add-Type -AssemblyName UIAutomationClient
  Add-Type -AssemblyName UIAutomationTypes
  $root = [System.Windows.Automation.AutomationElement]::RootElement
  $window = $root
  if ($request.window) {
    $cond = New-Object System.Windows.Automation.PropertyCondition(
      [System.Windows.Automation.AutomationElement]::NameProperty, $request.window)
    $found = $root.FindFirst([System.Windows.Automation.TreeScope]::Children, $cond)
    if ($null -ne $found) { $window = $found }
  }
  $max = 400
  if ($request.maxNodes) { $max = [int]$request.maxNodes }
  $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
  $nodes = New-Object System.Collections.Generic.List[object]

  function Visit($element, $path) {
    if ($nodes.Count -ge $max) { return }
    if ($null -eq $element) { return }
    $current = $element.Current
    $id = 'n-' + $nodes.Count
    $patterns = @()
    foreach ($name in @('InvokePattern', 'ValuePattern', 'TogglePattern', 'SelectionItemPattern')) {
      try {
        $pattern = $element.GetCurrentPattern([System.Windows.Automation.AutomationElement]::$name.Replace('Pattern', 'Pattern').GetProperty([type]))
      } catch { }
    }
    $nodes.Add([pscustomobject]@{
        ref = $id
        role = $current.ControlType.ProgrammaticName
        name = $current.Name
        automationId = $current.AutomationId
        enabled = $current.IsEnabled
        offscreen = $current.IsOffscreen
        bounds = @{ x = (Safe-Int $current.BoundingRectangle.X); y = (Safe-Int $current.BoundingRectangle.Y)
          width = (Safe-Int $current.BoundingRectangle.Width); height = (Safe-Int $current.BoundingRectangle.Height) }
        path = $path
      })
    $child = $walker.GetFirstChild($element)
    while ($null -ne $child) {
      if ($nodes.Count -ge $max) { break }
      Visit $child "$path/$id"
      $child = $walker.GetNextSibling($child)
    }
  }

  Visit $window 'root'
  $json = ConvertTo-Json -InputObject $nodes.ToArray() -Depth 6 -Compress
  Write-Output $json
}

function Invoke-Input($request) {
  Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class Input {
  [StructLayout(LayoutKind.Sequential)] public struct MOUSEINPUT { public int dx; public int dy; public uint mouseData; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
  [StructLayout(LayoutKind.Sequential)] public struct KEYBDINPUT { public ushort wVk; public ushort wScan; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
  [StructLayout(LayoutKind.Sequential)] public struct INPUT { public uint type; public MOUSEINPUT mi; public KEYBDINPUT ki; public uint pad; }
  [DllImport("user32.dll")] public static extern uint SendInput(uint n, INPUT[] inputs, int size);
  public const uint MOUSEEVENTF_LEFTDOWN = 0x0002, MOUSEEVENTF_LEFTUP = 0x0004;
  public const uint MOUSEEVENTF_RIGHTDOWN = 0x0008, MOUSEEVENTF_RIGHTUP = 0x0010;
  public const uint MOUSEEVENTF_WHEEL = 0x0800, KEYEVENTF_KEYUP = 0x0002;
}
"@
  function Move-Cursor([int]$x, [int]$y) {
    Add-Type -AssemblyName System.Windows.Forms
    [System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point($x, $y)
  }
  function Click([int]$x, [int]$y, [bool]$right) {
    Move-Cursor $x $y
    Start-Sleep -Milliseconds 40
    $down = if ($right) { [Input]::MOUSEEVENTF_RIGHTDOWN } else { [Input]::MOUSEEVENTF_LEFTDOWN }
    $up = if ($right) { [Input]::MOUSEEVENTF_RIGHTUP } else { [Input]::MOUSEEVENTF_LEFTUP }
    $downInput = New-Object Input+INPUT
    $downInput.type = 0
    $downInput.mi = New-Object Input+MOUSEINPUT
    $downInput.mi.dwFlags = $down
    $upInput = New-Object Input+INPUT
    $upInput.type = 0
    $upInput.mi = New-Object Input+MOUSEINPUT
    $upInput.mi.dwFlags = $up
    $inputs = @($downInput, $upInput)
    [void][Input]::SendInput(2, $inputs, [System.Runtime.InteropServices.Marshal]::SizeOf($inputs[0]))
  }
  switch ($request.kind) {
    'click' { Click ([int]$request.x) ([int]$request.y) ($request.button -eq 'right') }
    'type' { Set-Clipboard -Value $request.text; Start-Sleep -Milliseconds 60; Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('^v') }
    'key' { Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait($request.combo) }
    'scroll' { $delta = [int]$request.delta; Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait($(if ($delta -gt 0) { '{PGUP}' } else { '{PGDN}' })) }
    default { throw "unsupported input kind: $($request.kind)" }
  }
}

if ($Request.Trim().StartsWith('{')) { $req = $Request | ConvertFrom-Json } else { throw 'request must be JSON' }

switch ($req.op) {
  'system_info' {
    $os = Get-CimInstance Win32_OperatingSystem
    Write-Json @{
      hostname = $env:COMPUTERNAME
      os = $os.Caption
      version = $os.Version
      architecture = $os.OSArchitecture
      user = $env:USERNAME
      ramMb = [int]($os.TotalVisibleMemorySize / 1024)
      cpu = (Get-CimInstance Win32_Processor | Select-Object -First 1).Name
      elevated = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    }
  }
  'windows' { Invoke-Windows }
  'screenshot' { Write-Json (Invoke-Screenshot $req) }
  'tree' { Invoke-Tree $req }
  'focused' {
    Add-Type -AssemblyName UIAutomationClient
    Add-Type -AssemblyName UIAutomationTypes
    $element = [System.Windows.Automation.AutomationElement]::FocusedElement
    Write-Json @{ name = $element.Current.Name; role = $element.Current.ControlType.ProgrammaticName
      automationId = $element.Current.AutomationId }
  }
  'hash' {
    $shot = Invoke-Screenshot @{ scale = 0.25 }
    $bytes = [Convert]::FromBase64String($shot.base64)
    $sha = [System.Security.Cryptography.SHA256]::Create()
    $digest = [BitConverter]::ToString($sha.ComputeHash($bytes)).Replace('-', '').ToLower()
    Write-Json @{ shotHash = $digest; width = $shot.width; height = $shot.height }
  }
  'clip_get' {
    Add-Type -AssemblyName System.Windows.Forms
    Write-Json @{ text = [System.Windows.Forms.Clipboard]::GetText() }
  }
  'clip_set' {
    Add-Type -AssemblyName System.Windows.Forms
    [System.Windows.Forms.Clipboard]::SetText([string]$req.text)
    Write-Json @{ ok = $true }
  }
  'input' { Invoke-Input $req; Write-Json @{ ok = $true; kind = $req.kind } }
  'assert' {
    Add-Type -AssemblyName UIAutomationClient
    Add-Type -AssemblyName UIAutomationTypes
    $element = [System.Windows.Automation.AutomationElement]::FocusedElement
    Write-Json @{ pass = $true; name = $element.Current.Name; role = $element.Current.ControlType.ProgrammaticName }
  }
  default { throw "unsupported op: $($req.op)" }
}
