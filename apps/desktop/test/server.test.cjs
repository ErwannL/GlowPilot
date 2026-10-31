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
