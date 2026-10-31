const { contextBridge, ipcRenderer } = require('electron');

// Bridge between the web UI (which owns the BLE link and the engine) and the main process.
contextBridge.exposeInMainWorld('glowpilotDesktop', {
  onActivity: (cb) => ipcRenderer.on('activity', (_e, s) => cb(s)),
  onBluetoothDevices: (cb) => ipcRenderer.on('bt-devices', (_e, list) => cb(list)),
  selectBluetoothDevice: (id) => ipcRenderer.send('bt-select', id),
  setTrustedDevice: (id) => ipcRenderer.send('trusted-device', id),
  publishState: (s) => ipcRenderer.send('state', s),
  onRemoteCommand: (cb) => ipcRenderer.on('remote', (_e, client, msg) => cb(client, msg)),
  getPairing: () => ipcRenderer.invoke('pairing'),
  revokeClients: () => ipcRenderer.invoke('revoke'),
  setLaunchAtLogin: (on) => ipcRenderer.send('login-item', on),
  onUpdate: (cb) => ipcRenderer.on('update', (_e, info) => cb(info)),
  installUpdate: () => ipcRenderer.send('update-install'),
  checkForUpdates: () => ipcRenderer.send('update-check'),
});
