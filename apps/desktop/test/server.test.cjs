const { test } = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const WebSocket = require('ws');
const { LocalApiServer, isPrivateAddress } = require('../src/server.cjs');

test('only private addresses are accepted', () => {
  for (const a of ['127.0.0.1', '::1', '::ffff:192.168.1.5', '10.0.0.2', '172.20.1.1', 'fe80::1']) assert.ok(isPrivateAddress(a), a);
  for (const a of ['8.8.8.8', '172.32.0.1', '::ffff:1.2.3.4', '2001:db8::1', '']) assert.ok(!isPrivateAddress(a), a);
});

function client(port) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  const inbox = [];
  const waiters = [];
  ws.on('message', (d) => { const m = JSON.parse(String(d)); const w = waiters.shift(); w ? w(m) : inbox.push(m); });
  return {
    ws,
    open: () => new Promise((r) => ws.on('open', r)),
    send: (m) => ws.send(JSON.stringify(m)),
    next: () => (inbox.length ? Promise.resolve(inbox.shift()) : new Promise((r) => waiters.push(r))),
  };
}

test('pairing, auth, command forwarding and revocation', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gp-'));
  const received = [];
  const port = 47900 + Math.floor(Math.random() * 50);
  const api = new LocalApiServer({ port, staticDir: dir, storeFile: path.join(dir, 'tokens.json'), onMessage: (c, m) => received.push([c, m]) });
  api.start();
  await new Promise((r) => api.server.once('listening', r));

  const c = client(port);
  await c.open();
  c.send({ t: 'command', cmd: { type: 'power', on: true } });
  assert.deepStrictEqual(await c.next(), { t: 'denied', reason: 'Not authenticated' });
  assert.strictEqual(received.length, 0);

  c.send({ t: 'pair', code: '000000' === api.code ? '111111' : '000000', clientName: 'Phone' });
  assert.strictEqual((await c.next()).reason, 'Wrong pairing code');

  const code = api.code;
  c.send({ t: 'pair', code, clientName: 'Phone' });
  const paired = await c.next();
  assert.strictEqual(paired.t, 'paired');
  assert.notStrictEqual(api.code, code, 'code is single-use');

  api.broadcastState({ x: 1 });
  c.send({ t: 'auth', token: paired.token });
  assert.strictEqual((await c.next()).t, 'authed');
  assert.deepStrictEqual(await c.next(), { t: 'state', state: { x: 1 } });

  c.send({ t: 'command', cmd: { type: 'power', on: false } });
  await new Promise((r) => setTimeout(r, 50));
  assert.deepStrictEqual(received, [['Phone', { t: 'command', cmd: { type: 'power', on: false } }]]);

  const closed = new Promise((r) => c.ws.on('close', r));
  api.revokeAll();
  await closed;

  const c2 = client(port);
  await c2.open();
  c2.send({ t: 'auth', token: paired.token });
  assert.strictEqual((await c2.next()).t, 'denied');
  c2.ws.close();
  api.stop();
});

test('elevated update command quotes the installer path safely', () => {
  const Module = require('node:module');
  const orig = Module._load;
  Module._load = function (req, ...rest) {
    if (req === 'electron') return { app: { getPath: () => String.raw`C:\Program Files\GlowPilot\GlowPilot.exe` }, ipcMain: {}, Notification: {} };
    return orig.call(this, req, ...rest);
  };
  try {
    delete require.cache[require.resolve('../src/updater.cjs')];
    const { elevatedInstallCommand, isPerMachineInstall } = require('../src/updater.cjs');
    const cmd = elevatedInstallCommand(String.raw`C:\Users\o'brien\AppData\Local\@glowpilotdesktop-updater\pending\GlowPilot-Setup-0.0.5.exe`);
    assert.strictEqual(cmd, String.raw`Start-Process -FilePath 'C:\Users\o''brien\AppData\Local\@glowpilotdesktop-updater\pending\GlowPilot-Setup-0.0.5.exe' -ArgumentList '--updated','/S','/allusers','--force-run' -Verb RunAs`);
    process.env.ProgramFiles = String.raw`C:\Program Files`;
    assert.strictEqual(isPerMachineInstall(), true);
  } finally {
    Module._load = orig;
  }
});

test('alarm API for the phone: token required, status and phone alarm', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gp-'));
  const received = [];
  const port = 48000 + Math.floor(Math.random() * 50);
  const api = new LocalApiServer({ port, staticDir: dir, storeFile: path.join(dir, 't.json'), onMessage: (c, m) => received.push([c, m]) });
  api.tokens = { tok: { name: 'Phone' } };
  api.start();
  await new Promise((r) => api.server.once('listening', r));
  const base = `http://127.0.0.1:${port}`;
  assert.strictEqual((await fetch(`${base}/api/status`)).status, 401);
  const auth = { authorization: 'Bearer tok' };
  api.broadcastState({ status: 'connected', lights: [{ id: 'a', name: 'x', status: 'connected' }], alarmActive: true });
  assert.deepStrictEqual(await (await fetch(`${base}/api/status`, { headers: auth })).json(), { connected: true, alarmActive: true });
  const r = await fetch(`${base}/api/phone-alarm`, { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify({ at: 1790000000000, minutes: 45, color: '#ff0000' }) });
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual(received, [['Phone', { t: 'phoneAlarm', at: 1790000000000, minutes: 45, color: '#ff0000' }]]);
  api.stop();
});
