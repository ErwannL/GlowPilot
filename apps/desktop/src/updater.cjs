// Automatic updates from GitHub Releases (latest.yml published by the release workflow).
//
// Two things make the stock "install on quit" flow fail for GlowPilot:
// 1. It lives in the tray and never quits, so the update must be installed actively.
// 2. When installed "for all users" (C:\Program Files), the installer needs admin rights. electron-updater
//    only elevates when latest.yml says so, which it doesn't for an installer that lets the user choose,
//    so its silent install failed without a word. For those installs we start the installer ourselves
//    through a UAC prompt.
// Everything is logged to %APPDATA%\GlowPilot\updater.log.
const { app, ipcMain, Notification } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const relaunchFlag = () => path.join(app.getPath('userData'), 'relaunch-hidden');
const logFile = () => path.join(app.getPath('userData'), 'updater.log');

function log(level, ...args) {
  const line = `${new Date().toISOString()} [${level}] ${args.map((a) => (a instanceof Error ? a.stack || a.message : typeof a === 'string' ? a : JSON.stringify(a))).join(' ')}\n`;
  try {
    const f = logFile();
    if (fs.existsSync(f) && fs.statSync(f).size > 512 * 1024) fs.renameSync(f, f + '.old');
    fs.appendFileSync(f, line);
  } catch { /* logging must never break updates */ }
}

/** True (once) when this launch follows an update installed from the tray. */
function consumeRelaunchHidden() {
  try {
    fs.unlinkSync(relaunchFlag());
    return true;
  } catch {
    return false;
  }
}

/** Installed under Program Files = per-machine install = installer needs admin rights. */
function isPerMachineInstall() {
  const exe = app.getPath('exe').toLowerCase();
  return [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.ProgramW6432]
    .filter(Boolean)
    .some((dir) => exe.startsWith(dir.toLowerCase().replace(/[\\/]+$/, '') + path.win32.sep));
}

/** PowerShell command that runs the NSIS installer silently for all users, elevated, then relaunches GlowPilot. */
function elevatedInstallCommand(installer) {
  const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
  return `Start-Process -FilePath ${q(installer)} -ArgumentList '--updated','/S','/allusers','--force-run' -Verb RunAs`;
}

function setupAutoUpdate(getWin, beforeQuit) {
  let last = { state: 'idle', current: app.getVersion() };
  const send = (info) => {
    last = { ...info, current: app.getVersion() };
    log('info', 'status', last);
    getWin()?.webContents.send('update', last);
  };
  ipcMain.handle('update-status', () => last);

  if (!app.isPackaged) {
    ipcMain.on('update-check', () => send({ state: 'error', message: 'Updates only work in the installed app.' }));
    ipcMain.on('update-install', () => {});
    return;
  }
  const { autoUpdater } = require('electron-updater');
  autoUpdater.logger = { info: (...a) => log('info', ...a), warn: (...a) => log('warn', ...a), error: (...a) => log('error', ...a), debug: () => {} };
  autoUpdater.autoDownload = true;
  const perMachine = isPerMachineInstall();
  // Per-machine: the stock silent install on quit cannot elevate, so we never let it run.
  autoUpdater.autoInstallOnAppQuit = !perMachine;
  log('info', `GlowPilot ${app.getVersion()} at ${app.getPath('exe')} (perMachine=${perMachine})`);

  let downloaded = null; // { version, file }

  const install = () => {
    if (!downloaded) return;
    if (!getWin()?.isVisible()) fs.writeFileSync(relaunchFlag(), '1');
    if (perMachine) {
      const cmd = elevatedInstallCommand(downloaded.file);
      log('info', 'elevated install:', cmd);
      const ps = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', cmd], { windowsHide: true });
      ps.on('exit', (code) => {
        log('info', 'elevation exit code', code);
        if (code === 0) {
          // UAC accepted: the installer is running and will relaunch GlowPilot.
          beforeQuit();
          app.quit();
        } else {
          try { fs.unlinkSync(relaunchFlag()); } catch { /* ignore */ }
          send({ state: 'error', message: 'The update needs administrator rights (GlowPilot is installed for all users). Accept the Windows prompt to install it.' });
          setTimeout(() => send({ state: 'ready', version: downloaded.version }), 8000);
        }
      });
      return;
    }
    beforeQuit();
    autoUpdater.quitAndInstall(true, true);
  };

  autoUpdater.on('checking-for-update', () => send({ state: 'checking' }));
  autoUpdater.on('update-not-available', () => send({ state: 'none' }));
  autoUpdater.on('update-available', (i) => send({ state: 'downloading', version: i.version, percent: 0 }));
  autoUpdater.on('download-progress', (p) => send({ state: 'downloading', version: last.version, percent: Math.round(p.percent) }));
  autoUpdater.on('update-downloaded', (e) => {
    downloaded = { version: e.version, file: e.downloadedFile };
    send({ state: 'ready', version: e.version });
    const win = getWin();
    if (perMachine) {
      // A UAC prompt popping up out of nowhere is confusing: ask first.
      if (!win?.isVisible() && Notification.isSupported()) {
        const n = new Notification({ title: `GlowPilot ${e.version} is ready`, body: 'Click to install the update (Windows will ask for permission).' });
        n.on('click', install);
        n.show();
      }
    } else if (!win || !win.isVisible()) setTimeout(install, 3000);
  });
  autoUpdater.on('error', (e) => send({ state: 'error', message: String(e?.message ?? e).split('\n')[0].slice(0, 200) }));

  // Per-user install: hiding the window to the tray with an update waiting installs it.
  setTimeout(() => getWin()?.on('hide', () => { if (downloaded && !perMachine) setTimeout(install, 1500); }), 0);

  ipcMain.on('update-install', install);
  ipcMain.on('update-check', () => {
    if (downloaded) return send({ state: 'ready', version: downloaded.version });
    void autoUpdater.checkForUpdates().catch((e) => send({ state: 'error', message: String(e?.message ?? e).split('\n')[0] }));
  });

  const check = () => void autoUpdater.checkForUpdates().catch((e) => log('error', e));
  setTimeout(check, 10_000);
  setInterval(check, 2 * 60 * 60 * 1000);
}

module.exports = { setupAutoUpdate, consumeRelaunchHidden, elevatedInstallCommand, isPerMachineInstall };
