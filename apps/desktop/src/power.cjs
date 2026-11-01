// Sleep / wake handling for GlowPilot Desktop.
// - Wake timers: one Windows scheduled task per alarm (folder \GlowPilot\, "wake the computer to run
//   this task", runs a no-op). Works without admin rights; needs wake timers allowed in the power plan.
// - Keep awake: while an alarm/sunrise is running, Windows must not go back to sleep after waking.
const { powerSaveBlocker } = require('electron');
const { spawn } = require('node:child_process');

const DAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const psq = (s) => `'${String(s).replace(/'/g, "''")}'`;

/**
 * @param {{ id: string, name: string, time: string, days: number[], once?: string }[]} wakes
 *   time "HH:MM" (already shifted earlier than the alarm), days 0=Sunday…, or `once` = ISO date-time.
 * @returns {string} PowerShell script that replaces all GlowPilot wake tasks.
 */
function wakeTasksScript(wakes) {
  const lines = [
    "$ErrorActionPreference = 'Continue'",
    "Get-ScheduledTask -TaskPath '\\GlowPilot\\' -ErrorAction SilentlyContinue | Unregister-ScheduledTask -Confirm:$false",
    "$a = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument '/c exit 0'",
    '$s = New-ScheduledTaskSettingsSet -WakeToRun -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 1)',
  ];
  wakes.forEach((w, i) => {
    const trigger = w.once
      ? `New-ScheduledTaskTrigger -Once -At ([datetime]${psq(w.once)})`
      : w.days.length === 7 || w.days.length === 0
        ? `New-ScheduledTaskTrigger -Daily -At ${psq(w.time)}`
        : `New-ScheduledTaskTrigger -Weekly -DaysOfWeek ${w.days.map((d) => DAY[d]).join(',')} -At ${psq(w.time)}`;
    lines.push(`Register-ScheduledTask -TaskPath '\\GlowPilot\\' -TaskName ${psq(`Wake ${i + 1} - ${w.name}`.slice(0, 200))} -Action $a -Trigger (${trigger}) -Settings $s -Description 'Wakes the PC so GlowPilot can run this alarm.' | Out-Null`);
  });
  return lines.join('\n');
}

let lastSignature = '';
function syncWakeTasks(wakes, log = () => {}) {
  if (process.platform !== 'win32') return;
  const sig = JSON.stringify(wakes);
  if (sig === lastSignature) return;
  lastSignature = sig;
  const ps = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', wakeTasksScript(wakes)], { windowsHide: true });
  let err = '';
  ps.stderr.on('data', (d) => (err += d));
  ps.on('exit', (code) => log(`wake tasks: ${wakes.length} registered (exit ${code})${err ? ' ' + err.trim().slice(0, 300) : ''}`));
}

let blockerId = null;
function keepAwake(on) {
  if (on && blockerId === null) blockerId = powerSaveBlocker.start('prevent-app-suspension');
  if (!on && blockerId !== null) {
    powerSaveBlocker.stop(blockerId);
    blockerId = null;
  }
}

module.exports = { wakeTasksScript, syncWakeTasks, keepAwake };
