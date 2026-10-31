// Runs activity.ps1 as a long-lived child process and emits parsed snapshots.
const { spawn } = require('node:child_process');
const path = require('node:path');
const readline = require('node:readline');

class ActivityWatcher {
  constructor(onSnapshot, intervalMs = 1500) {
    this.onSnapshot = onSnapshot;
    this.intervalMs = intervalMs;
    this.proc = null;
    this.stopped = false;
  }

  start() {
    if (process.platform !== 'win32') return;
    this.stopped = false;
    const script = path.join(__dirname, 'activity.ps1').replace('app.asar', 'app.asar.unpacked');
    this.proc = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, '-IntervalMs', String(this.intervalMs)], { windowsHide: true });
    readline.createInterface({ input: this.proc.stdout }).on('line', (line) => {
      try {
        const j = JSON.parse(line);
        this.onSnapshot({
          foreground: j.foreground ? String(j.foreground).toLowerCase() : null,
          processes: (j.processes || []).map((p) => String(p).toLowerCase()),
          mediaPlaying: typeof j.mediaPlaying === 'boolean' ? j.mediaPlaying : undefined,
        });
      } catch { /* ignore partial lines */ }
    });
    this.proc.on('exit', () => {
      if (!this.stopped) setTimeout(() => this.start(), 5000);
    });
  }

  stop() {
    this.stopped = true;
    this.proc?.kill();
  }
}

module.exports = { ActivityWatcher };
