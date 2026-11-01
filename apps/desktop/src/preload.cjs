const { contextBridge, ipcRenderer } = require('electron');

// Bridge between the web UI (which owns the BLE link and the engine) and the main process.
contextBridge.exposeInMainWorld('glowpilotDesktop', {
  onActivity: (cb) => ipcRenderer.on('activity', (_e, s) => cb(s)),
  onBluetoothDevices: (cb) => ipcRenderer.on('bt-devices', (_e, list) => cb(list)),
  selectBluetoothDevice: (id) => ipcRenderer.send('bt-select', id),
  setTrustedDevice: (id) => ipcRenderer.send('trusted-device', id),
  autoSelect: (id) => ipcRenderer.send('auto-select', id),
  requestAutoconnect: () => ipcRenderer.send('autoconnect-again'),
  legacyTrustedId: () => ipcRenderer.invoke('legacy-trusted-id'),
  publishState: (s) => ipcRenderer.send('state', s),
  onRemoteCommand: (cb) => ipcRenderer.on('remote', (_e, client, msg) => cb(client, msg)),
  getPairing: () => ipcRenderer.invoke('pairing'),
  revokeClients: () => ipcRenderer.invoke('revoke'),
  setLaunchAtLogin: (on) => ipcRenderer.send('login-item', on),
  launchAtLogin: () => ipcRenderer.invoke('login-item-state'),
  onPrepareQuit: (cb) => ipcRenderer.on('prepare-quit', async () => { try { await cb(); } finally { ipcRenderer.send('quit-ready'); } }),
  onTogglePause: (cb) => ipcRenderer.on('toggle-pause', () => cb()),
  setPausedInTray: (p) => ipcRenderer.send('tray-paused', p),
  onUpdate: (cb) => ipcRenderer.on('update', (_e, info) => cb(info)),
  installUpdate: () => ipcRenderer.send('update-install'),
  checkForUpdates: () => ipcRenderer.send('update-check'),
  updateStatus: () => ipcRenderer.invoke('update-status'),
  steamGames: () => ipcRenderer.invoke('steam-games'),
});
