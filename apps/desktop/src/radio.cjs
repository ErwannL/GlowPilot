// Windows Bluetooth radio. When it is switched off (Action Center, airplane mode), Chromium still
// reports Bluetooth as "available" but never finds a single device: every scan silently came back empty.
// Read the real state, and switch it back on when the user asks (no admin rights needed).
const { spawn } = require('node:child_process');

const PRELUDE = `
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\`1' })[0]
function Await($op, $t) { $task = $asTask.MakeGenericMethod($t).Invoke($null, @($op)); $task.Wait(-1) | Out-Null; $task.Result }
[Windows.Devices.Radios.Radio,Windows.System.Devices,ContentType=WindowsRuntime] | Out-Null
$radios = Await ([Windows.Devices.Radios.Radio]::GetRadiosAsync()) ([System.Collections.Generic.IReadOnlyList[Windows.Devices.Radios.Radio]])
$bt = $radios | Where-Object { $_.Kind -eq 'Bluetooth' } | Select-Object -First 1
`;

/** PowerShell that prints the Bluetooth radio state: On, Off, Disabled or none. */
const READ_SCRIPT = `${PRELUDE}
if ($bt) { $bt.State.ToString() } else { 'none' }`;

/** PowerShell that switches the Bluetooth radio on, then prints the new state. */
const ON_SCRIPT = `${PRELUDE}
if (-not $bt) { 'none'; exit }
[Windows.Devices.Radios.RadioAccessStatus,Windows.System.Devices,ContentType=WindowsRuntime] | Out-Null
Await ([Windows.Devices.Radios.Radio]::RequestAccessAsync()) ([Windows.Devices.Radios.RadioAccessStatus]) | Out-Null
Await ($bt.SetStateAsync([Windows.Devices.Radios.RadioState]::On)) ([Windows.Devices.Radios.RadioAccessStatus]) | Out-Null
$bt.State.ToString()`;

/** 'on' | 'off' | 'none' (no adapter) | 'unknown' (not Windows, or PowerShell failed). */
function parseState(out) {
  const s = String(out || '').trim().split(/\r?\n/).pop().toLowerCase();
  if (s === 'on') return 'on';
  if (s === 'off' || s === 'disabled') return 'off';
  if (s === 'none') return 'none';
  return 'unknown';
}

function run(script) {
  if (process.platform !== 'win32') return Promise.resolve('unknown');
  return new Promise((resolve) => {
    let out = '';
    const ps = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], { windowsHide: true });
    ps.stdout.on('data', (d) => (out += d));
    ps.on('error', () => resolve('unknown'));
    ps.on('exit', () => resolve(parseState(out)));
    setTimeout(() => { ps.kill(); resolve('unknown'); }, 15_000);
  });
}

const bluetoothRadio = () => run(READ_SCRIPT);
const bluetoothRadioOn = () => run(ON_SCRIPT);

module.exports = { bluetoothRadio, bluetoothRadioOn, parseState, READ_SCRIPT, ON_SCRIPT };
