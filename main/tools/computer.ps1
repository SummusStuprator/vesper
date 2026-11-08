# Vesper computer-use input driver (Windows). Reads a JSON action from $env:VESPER_ACTION (base64).
$ErrorActionPreference = 'Stop'
$json = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:VESPER_ACTION))
$a = $json | ConvertFrom-Json

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class VIn {
  [StructLayout(LayoutKind.Sequential)] public struct MOUSEINPUT { public int dx, dy; public uint mouseData, dwFlags, time; public IntPtr extra; }
  [StructLayout(LayoutKind.Sequential)] public struct KEYBDINPUT { public ushort wVk, wScan; public uint dwFlags, time; public IntPtr extra; }
  [StructLayout(LayoutKind.Explicit)] public struct U { [FieldOffset(0)] public MOUSEINPUT mi; [FieldOffset(0)] public KEYBDINPUT ki; }
  [StructLayout(LayoutKind.Sequential)] public struct INPUT { public uint type; public U u; }
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
  [DllImport("user32.dll")] public static extern uint SendInput(uint n, INPUT[] i, int size);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT p);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  static void Send(INPUT x) { SendInput(1, new INPUT[] { x }, Marshal.SizeOf(typeof(INPUT))); }
  public static void Mouse(uint flags, uint data) { var x = new INPUT(); x.type = 0; x.u.mi.dwFlags = flags; x.u.mi.mouseData = data; Send(x); }
  public static void Key(ushort vk, bool up) { var x = new INPUT(); x.type = 1; x.u.ki.wVk = vk; x.u.ki.dwFlags = up ? 2u : 0u; Send(x); }
  public static void Uni(char c) {
    var d = new INPUT(); d.type = 1; d.u.ki.wScan = c; d.u.ki.dwFlags = 4; Send(d);
    var u = new INPUT(); u.type = 1; u.u.ki.wScan = c; u.u.ki.dwFlags = 6; Send(u);
  }
}
"@
[void][VIn]::SetProcessDPIAware()

$vk = @{
  'ctrl'=0x11; 'control'=0x11; 'shift'=0x10; 'alt'=0x12; 'win'=0x5B; 'cmd'=0x5B; 'meta'=0x5B; 'super'=0x5B;
  'enter'=0x0D; 'return'=0x0D; 'tab'=0x09; 'esc'=0x1B; 'escape'=0x1B; 'space'=0x20; 'backspace'=0x08; 'delete'=0x2E; 'del'=0x2E;
  'insert'=0x2D; 'home'=0x24; 'end'=0x23; 'pageup'=0x21; 'pagedown'=0x22; 'up'=0x26; 'down'=0x28; 'left'=0x25; 'right'=0x27;
  'capslock'=0x14; 'printscreen'=0x2C; 'menu'=0x5D;
  'f1'=0x70;'f2'=0x71;'f3'=0x72;'f4'=0x73;'f5'=0x74;'f6'=0x75;'f7'=0x76;'f8'=0x77;'f9'=0x78;'f10'=0x79;'f11'=0x7A;'f12'=0x7B
}
function VkOf([string]$k) {
  $k = $k.ToLower().Trim()
  if ($vk.ContainsKey($k)) { return [uint16]$vk[$k] }
  if ($k.Length -eq 1) {
    $c = [char]$k.ToUpper()
    if (($c -ge 'A' -and $c -le 'Z') -or ($c -ge '0' -and $c -le '9')) { return [uint16][int]$c }
    $map = @{ '-'=0xBD; '='=0xBB; '['=0xDB; ']'=0xDD; ';'=0xBA; "'"=0xDE; ','=0xBC; '.'=0xBE; '/'=0xBF; '\'=0xDC; '`'=0xC0 }
    if ($map.ContainsKey($k)) { return [uint16]$map[$k] }
  }
  throw "Unknown key: $k"
}
function Click([string]$btn, [int]$n) {
  $f = switch ($btn) { 'right' { @(0x08, 0x10) } 'middle' { @(0x20, 0x40) } default { @(0x02, 0x04) } }
  for ($i = 0; $i -lt $n; $i++) { [VIn]::Mouse($f[0], 0); Start-Sleep -Milliseconds 20; [VIn]::Mouse($f[1], 0); Start-Sleep -Milliseconds 60 }
}

if ($null -ne $a.x -and $null -ne $a.y) { [void][VIn]::SetCursorPos([int]$a.x, [int]$a.y); Start-Sleep -Milliseconds 40 }

switch ($a.action) {
  'move' { }
  'click' { Click ($(if ($a.button) { $a.button } else { 'left' })) 1 }
  'double_click' { Click 'left' 2 }
  'right_click' { Click 'right' 1 }
  'middle_click' { Click 'middle' 1 }
  'mouse_down' { [VIn]::Mouse(0x02, 0) }
  'mouse_up' { [VIn]::Mouse(0x04, 0) }
  'drag' {
    [VIn]::Mouse(0x02, 0); Start-Sleep -Milliseconds 80
    $steps = 12
    $p = New-Object VIn+POINT; [void][VIn]::GetCursorPos([ref]$p)
    for ($i = 1; $i -le $steps; $i++) {
      $nx = $p.X + ([int]$a.to_x - $p.X) * $i / $steps; $ny = $p.Y + ([int]$a.to_y - $p.Y) * $i / $steps
      [void][VIn]::SetCursorPos([int]$nx, [int]$ny); Start-Sleep -Milliseconds 15
    }
    [VIn]::Mouse(0x04, 0)
  }
  'scroll' {
    $amt = if ($a.amount) { [int]$a.amount } else { 3 }
    $dir = if ($a.direction) { $a.direction } else { 'down' }
    $flag = if ($dir -eq 'left' -or $dir -eq 'right') { 0x1000 } else { 0x0800 }
    $sign = if ($dir -eq 'down' -or $dir -eq 'left') { -1 } else { 1 }
    $data = if ($sign -gt 0) { [uint32]120 } else { [uint32]4294967176 }  # -120 as DWORD
    for ($i = 0; $i -lt $amt; $i++) { [VIn]::Mouse($flag, $data); Start-Sleep -Milliseconds 30 }
  }
  'type' { foreach ($ch in ([string]$a.text).ToCharArray()) { if ($ch -eq "`n") { [VIn]::Key(0x0D,$false); [VIn]::Key(0x0D,$true) } elseif ($ch -ne "`r") { [VIn]::Uni($ch) }; Start-Sleep -Milliseconds 4 } }
  'key' {
    foreach ($combo in ([string]$a.keys -split '\s+')) {
      if (-not $combo) { continue }
      $parts = $combo -split '\+'
      $codes = @($parts | ForEach-Object { VkOf $_ })
      foreach ($c in $codes) { [VIn]::Key($c, $false); Start-Sleep -Milliseconds 15 }
      [array]::Reverse($codes)
      foreach ($c in $codes) { [VIn]::Key($c, $true); Start-Sleep -Milliseconds 15 }
      Start-Sleep -Milliseconds 40
    }
  }
  'cursor_position' { }
  default { throw "Unknown action $($a.action)" }
}
$p = New-Object VIn+POINT; [void][VIn]::GetCursorPos([ref]$p)
Write-Output "$($p.X),$($p.Y)"
