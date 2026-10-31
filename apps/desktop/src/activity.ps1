# GlowPilot activity watcher: prints one JSON line per interval with the foreground
# executable, running executables and whether Windows media playback is active.
param([int]$IntervalMs = 1500, [int]$Count = 0)
$ErrorActionPreference = 'SilentlyContinue'
Add-Type @"
using System; using System.Runtime.InteropServices;
public static class GpWin {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
}
"@
$mgr = $null
try {
  Add-Type -AssemblyName System.Runtime.WindowsRuntime
  $asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]
  $null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime]
  $t = $asTask.MakeGenericMethod([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]).Invoke($null, @([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()))
  $null = $t.Wait(5000); $mgr = $t.Result
} catch { $mgr = $null }

$n = 0
while ($true) {
  $fg = $null
  $h = [GpWin]::GetForegroundWindow(); $fpid = 0
  $null = [GpWin]::GetWindowThreadProcessId($h, [ref]$fpid)
  if ($fpid) { $p = Get-Process -Id $fpid; if ($p) { $fg = $p.ProcessName + '.exe' } }
  $procs = @(Get-Process | ForEach-Object { $_.ProcessName + '.exe' } | Sort-Object -Unique)
  $media = $null
  if ($mgr) {
    $media = $false
    foreach ($s in $mgr.GetSessions()) { if ($s.GetPlaybackInfo().PlaybackStatus -eq 'Playing') { $media = $true } }
  }
  [Console]::Out.WriteLine((@{ foreground = $fg; processes = $procs; mediaPlaying = $media } | ConvertTo-Json -Compress))
  [Console]::Out.Flush()
  $n++; if ($Count -gt 0 -and $n -ge $Count) { break }
  Start-Sleep -Milliseconds $IntervalMs
}
