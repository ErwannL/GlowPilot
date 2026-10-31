// GlowPilot Desktop main process.
// The renderer (the shared web UI) owns the BLE link through Chromium's Web Bluetooth,
// so Windows, Android and the browser run the same protocol code. Main adds:
// device chooser handling, app/process detection, the local API, tray and autostart.
const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { LocalApiServer } = require('./server.cjs');
const { ActivityWatcher } = require('./activity.cjs');
const { setupAutoUpdate } = require('./updater.cjs');

const API_PORT = Number(process.env.GLOWPILOT_PORT || 47821);
const WEB_DIST = app.isPackaged ? path.join(process.resourcesPath, 'web') : path.resolve(__dirname, '../../web/dist');
const DATA = app.getPath('userData');
const trustedFile = path.join(DATA, 'trusted-device.json');

let win = null;
let tray = null;
let quitting = false;
let pendingBtCallback = null;
// Chooser id picked by the user in 0.0.2 (single device); handed to the renderer once as a migration.
const legacyTrustedId = readJson(trustedFile)?.id ?? null;
let autoSelect = null; // { id, until }

function readJson(f) {
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; }
}

// Single instance: a second launch focuses the existing window.
if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', () => { win?.show(); win?.focus(); });

app.commandLine.appendSwitch('enable-experimental-web-platform-features'); // Web Bluetooth getDevices()
app.commandLine.appendSwitch('enable-web-bluetooth-new-permissions-backend');

const api = new LocalApiServer({
  port: API_PORT,
  staticDir: WEB_DIST,
  storeFile: path.join(DATA, 'paired-clients.json'),
  onMessage: (client, msg) => win?.webContents.send('remote', client, msg),
});

function createWindow() {
  win = new BrowserWindow({
    width: 1280, height: 840, minWidth: 380, minHeight: 600,
    backgroundColor: '#0b0a14', title: 'GlowPilot', show: false, autoHideMenuBar: true,
    icon: path.join(WEB_DIST, 'icon.svg'),
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true },
  });
  win.once('ready-to-show', () => { if (!process.argv.includes('--hidden')) win.show(); });
  win.on('close', (e) => { if (!quitting) { e.preventDefault(); win.hide(); } }); // keep automations running in the tray
  win.webContents.setWindowOpenHandler(({ url }) => { void shell.openExternal(url); return { action: 'deny' }; });

  // Web Bluetooth chooser. The UI shows the list and the user picks. The only exception is reconnecting:
  // the renderer names one id the user picked before, and only that id is auto-selected.
  win.webContents.on('select-bluetooth-device', (event, devices, callback) => {
    event.preventDefault();
    pendingBtCallback = callback;
    const list = devices.map((d) => ({ id: d.deviceId, name: d.deviceName || '' }));
    if (autoSelect && Date.now() < autoSelect.until) {
      const hit = list.find((d) => d.id === autoSelect.id);
      if (hit) {
        autoSelect = null;
        pendingBtCallback = null;
        callback(hit.id);
      }
      return; // keep scanning silently until the deadline
    }
    win.webContents.send('bt-devices', list);
  });

  const ses = win.webContents.session;
  ses.setPermissionCheckHandler((_wc, permission) => ['bluetooth', 'media', 'clipboard-sanitized-write'].includes(permission));
  ses.setDevicePermissionHandler((d) => d.deviceType === 'bluetooth');

  const index = path.join(WEB_DIST, 'index.html');
  if (process.env.GLOWPILOT_DEV_URL) void win.loadURL(process.env.GLOWPILOT_DEV_URL);
  else if (fs.existsSync(index)) void win.loadFile(index);
  else void win.loadURL('data:text/html,<body style="background:%230b0a14;color:white;font-family:sans-serif;padding:40px"><h2>Web UI not built</h2><p>Run <code>npm run build</code> in the repository root.</p></body>');

  win.webContents.on('did-finish-load', () => autoConnect());
}

/** Give the renderer a user gesture so it can reopen saved controllers (one per call). */
function autoConnect() {
  if (!win) return;
  void win.webContents.executeJavaScript('window.__glowpilotAutoconnect && window.__glowpilotAutoconnect()', true).catch(() => {});
}

function createTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, '../assets/tray.png'));
  tray = new Tray(icon);
  tray.setToolTip('GlowPilot');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open GlowPilot', click: () => { win?.show(); win?.focus(); } },
    { label: 'Lights on', click: () => win?.webContents.send('remote', 'tray', { t: 'command', cmd: { type: 'power', on: true } }) },
    { label: 'Lights off', click: () => win?.webContents.send('remote', 'tray', { t: 'command', cmd: { type: 'power', on: false } }) },
    { label: 'Cinema mode', click: () => win?.webContents.send('remote', 'tray', { t: 'command', cmd: { type: 'scene', sceneId: 'cinema' } }) },
    { type: 'separator' },
    { label: 'Quit', click: () => { quitting = true; app.quit(); } },
  ]));
  tray.on('click', () => { win?.show(); win?.focus(); });
}

ipcMain.on('bt-select', (_e, id) => {
  if (pendingBtCallback) { pendingBtCallback(id || ''); pendingBtCallback = null; }
});
ipcMain.on('trusted-device', () => {});
ipcMain.handle('legacy-trusted-id', () => legacyTrustedId);
ipcMain.on('auto-select', (_e, id) => {
  autoSelect = { id: String(id), until: Date.now() + 20_000 };
  // Controller off or out of range: give up after 20 s so the renderer can retry later.
  setTimeout(() => {
    if (autoSelect && Date.now() >= autoSelect.until && pendingBtCallback) { pendingBtCallback(''); pendingBtCallback = null; autoSelect = null; }
  }, 20_500);
});
ipcMain.on('autoconnect-again', () => autoConnect());
ipcMain.on('state', (_e, s) => api.broadcastState(s));
ipcMain.handle('pairing', () => api.pairingInfo());
ipcMain.handle('revoke', () => api.revokeAll());
ipcMain.on('login-item', (_e, on) => app.setLoginItemSettings({ openAtLogin: !!on, args: ['--hidden'] }));

const watcher = new ActivityWatcher((snap) => win?.webContents.send('activity', snap));

app.whenReady().then(() => {
  createWindow();
  createTray();
  try { api.start(); } catch (e) { console.error('Local API failed to start', e); }
  watcher.start();
  setupAutoUpdate(() => win, () => { quitting = true; });
});

app.on('before-quit', () => { quitting = true; watcher.stop(); api.stop(); });
app.on('window-all-closed', () => { /* stay in tray */ });
