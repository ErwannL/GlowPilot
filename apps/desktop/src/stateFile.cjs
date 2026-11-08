// GlowPilot Desktop keeps the web UI's saved data (lights, scenes, rules, schedules, settings…) in a plain
// JSON file next to the app data, written by the main process.
// Why not only Chromium's localStorage: it commits to disk ~30 s after a change, and on this user's PC
// it had stopped writing at all, so every restart (and every update) lost scenes, rules and settings.
const fs = require('node:fs');
const path = require('node:path');

class StateFile {
  constructor(file, { delayMs = 300 } = {}) {
    this.file = file;
    this.delayMs = delayMs;
    this.timer = null;
    this.data = null;
    try { this.data = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { this.data = null; }
    if (this.data !== null && (typeof this.data !== 'object' || Array.isArray(this.data))) this.data = null;
  }

  /** Everything saved, or null the very first time (then the renderer migrates its localStorage). */
  snapshot() {
    return this.data;
  }

  set(key, value) {
    if (typeof key !== 'string') return;
    if (!this.data) this.data = {};
    if (value === null || value === undefined) delete this.data[key];
    else this.data[key] = String(value);
    this.schedule();
  }

  replaceAll(entries) {
    this.data = {};
    for (const [k, v] of Object.entries(entries || {})) if (typeof v === 'string') this.data[k] = v;
    this.schedule();
  }

  schedule() {
    if (this.timer) return;
    this.timer = setTimeout(() => this.flush(), this.delayMs);
  }

  /** Write now (atomic: temp file then rename, so a crash never leaves half a file). */
  flush() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (!this.data) return;
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(this.data));
      fs.renameSync(tmp, this.file);
    } catch (e) {
      console.error('GlowPilot: could not save state', e);
    }
  }
}

module.exports = { StateFile };
