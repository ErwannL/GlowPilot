// Automatic updates from GitHub Releases (latest.yml published by the release workflow).
// Downloads in the background, installs silently on quit, and lets the UI offer "Restart now".
const { app, ipcMain } = require('electron');

function setupAutoUpdate(getWin, beforeQuit) {
  if (!app.isPackaged) return; // dev builds never self-update
  const { autoUpdater } = require('electron-updater');
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  const send = (info) => getWin()?.webContents.send('update', info);
  autoUpdater.on('checking-for-update', () => send({ state: 'checking' }));
  autoUpdater.on('update-not-available', () => send({ state: 'none', current: app.getVersion() }));
  autoUpdater.on('update-available', (i) => send({ state: 'downloading', version: i.version }));
  autoUpdater.on('download-progress', (p) => send({ state: 'downloading', percent: Math.round(p.percent) }));
  autoUpdater.on('update-downloaded', (i) => send({ state: 'ready', version: i.version }));
  autoUpdater.on('error', (e) => send({ state: 'error', message: String(e?.message ?? e).slice(0, 200) }));

  ipcMain.on('update-install', () => { beforeQuit(); autoUpdater.quitAndInstall(true, true); });
  ipcMain.on('update-check', () => void autoUpdater.checkForUpdates().catch(() => {}));

  const check = () => void autoUpdater.checkForUpdates().catch(() => {});
  setTimeout(check, 10_000);
  setInterval(check, 4 * 60 * 60 * 1000);
}

module.exports = { setupAutoUpdate };
