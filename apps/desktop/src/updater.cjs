// Automatic updates from GitHub Releases (latest.yml published by the release workflow).
// GlowPilot normally lives in the tray and never quits, so "install on quit" alone never happens:
// once an update is downloaded it installs right away if the window is hidden, otherwise as soon as
// the window is hidden, and the app comes back hidden in the tray.
const { app, ipcMain } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const relaunchFlag = () => path.join(app.getPath('userData'), 'relaunch-hidden');

/** True (once) when this launch follows an update installed from the tray. */
function consumeRelaunchHidden() {
  try {
    fs.unlinkSync(relaunchFlag());
    return true;
  } catch {
    return false;
  }
}

function setupAutoUpdate(getWin, beforeQuit) {
  let last = { state: 'idle', current: app.getVersion() };
  const send = (info) => {
    last = { ...info, current: app.getVersion() };
    getWin()?.webContents.send('update', last);
  };
  ipcMain.handle('update-status', () => last);

  if (!app.isPackaged) {
    ipcMain.on('update-check', () => send({ state: 'error', message: 'Updates only work in the installed app.' }));
    ipcMain.on('update-install', () => {});
    return;
  }
  const { autoUpdater } = require('electron-updater');
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  let ready = false;
  const install = () => {
    beforeQuit();
    if (!getWin()?.isVisible()) fs.writeFileSync(relaunchFlag(), '1');
    autoUpdater.quitAndInstall(true, true);
  };

  autoUpdater.on('checking-for-update', () => send({ state: 'checking' }));
  autoUpdater.on('update-not-available', () => send({ state: 'none' }));
  autoUpdater.on('update-available', (i) => send({ state: 'downloading', version: i.version, percent: 0 }));
  autoUpdater.on('download-progress', (p) => send({ state: 'downloading', version: last.version, percent: Math.round(p.percent) }));
  autoUpdater.on('update-downloaded', (i) => {
    ready = true;
    send({ state: 'ready', version: i.version });
    const win = getWin();
    if (!win || !win.isVisible()) setTimeout(install, 3000);
  });
  autoUpdater.on('error', (e) => send({ state: 'error', message: String(e?.message ?? e).split('\n')[0].slice(0, 200) }));

  // Window hidden to the tray with an update waiting: install now.
  const hookWindow = () => getWin()?.on('hide', () => { if (ready) setTimeout(install, 1500); });
  setTimeout(hookWindow, 0);

  ipcMain.on('update-install', install);
  ipcMain.on('update-check', () => {
    if (ready) return send({ state: 'ready', version: last.version });
    void autoUpdater.checkForUpdates().catch((e) => send({ state: 'error', message: String(e?.message ?? e).split('\n')[0] }));
  });

  const check = () => void autoUpdater.checkForUpdates().catch(() => {});
  setTimeout(check, 10_000);
  setInterval(check, 2 * 60 * 60 * 1000);
}

module.exports = { setupAutoUpdate, consumeRelaunchHidden };
