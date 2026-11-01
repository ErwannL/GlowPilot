// Local API for phones and browsers on the same network.
// - Serves the built PWA over HTTP and a WebSocket JSON API on the same port.
// - Only private/loopback addresses are accepted; everything else is dropped.
// - Clients must pair with a 6-digit code once, then authenticate with a random token.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const os = require('node:os');
const { WebSocketServer } = require('ws');

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png' };

function isPrivateAddress(addr) {
  const a = String(addr || '').replace(/^::ffff:/, '');
  return a === '::1' || a === '127.0.0.1' || /^10\./.test(a) || /^192\.168\./.test(a) || /^172\.(1[6-9]|2\d|3[01])\./.test(a)
    || /^169\.254\./.test(a) || /^f[cd][0-9a-f]{2}:/i.test(a) || /^fe80:/i.test(a);
}

function lanAddresses() {
  return Object.values(os.networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4' && !i.internal && isPrivateAddress(i.address)).map((i) => i.address);
}

class LocalApiServer {
  /**
   * @param {{ port: number, staticDir: string, storeFile: string, onMessage: (clientName: string, msg: any) => void }} opts
   */
  constructor(opts) {
    this.opts = opts;
    this.code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
    this.tokens = this.loadTokens();
    this.sockets = new Set();
    this.lastState = null;
    this.failedPairs = new Map();
  }

  loadTokens() {
    try { return JSON.parse(fs.readFileSync(this.opts.storeFile, 'utf8')); } catch { return {}; }
  }
  saveTokens() {
    fs.mkdirSync(path.dirname(this.opts.storeFile), { recursive: true });
    fs.writeFileSync(this.opts.storeFile, JSON.stringify(this.tokens));
  }

  /** Single-use 6-digit code → long-lived token. Five wrong codes from an address block it. */
  pair(ip, code, clientName) {
    const fails = this.failedPairs.get(ip) || 0;
    if (fails >= 5) return { error: 'Too many wrong codes. Restart GlowPilot to get a new code.' };
    if (String(code) !== this.code) {
      this.failedPairs.set(ip, fails + 1);
      return { error: 'Wrong pairing code' };
    }
    const token = crypto.randomBytes(24).toString('hex');
    this.tokens[token] = { name: String(clientName || 'Device').slice(0, 40), pairedAt: Date.now() };
    this.saveTokens();
    this.code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0'); // single-use code
    return { token };
  }

  pairingInfo() {
    return { code: this.code, addresses: lanAddresses(), port: this.opts.port, clients: Object.values(this.tokens).map((t) => t.name) };
  }

  revokeAll() {
    this.tokens = {};
    this.saveTokens();
    for (const ws of this.sockets) ws.close(4001, 'revoked');
    this.code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
  }

  start() {
    const server = http.createServer((req, res) => {
      if (!isPrivateAddress(req.socket.remoteAddress)) { req.socket.destroy(); return; }
      const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
      // Public: lets phones find GlowPilot on the network and prefer a hub over a PC.
      if (urlPath === '/api/info') return res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ app: 'GlowPilot', role: this.opts.role || 'desktop' }));
      // Pairing code, only from the machine itself (the hub has no screen: Noyau or an SSH session shows it).
      if (urlPath === '/api/pairing') {
        const a = String(req.socket.remoteAddress || '').replace(/^::ffff:/, '');
        if (a !== '127.0.0.1' && a !== '::1') return res.writeHead(403).end();
        return res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(this.pairingInfo()));
      }
      if (urlPath.startsWith('/api/')) return this.handleApi(req, res, urlPath);
      const file = path.normalize(path.join(this.opts.staticDir, urlPath === '/' ? 'index.html' : urlPath));
      if (!file.startsWith(path.normalize(this.opts.staticDir))) { res.writeHead(403).end(); return; }
      fs.readFile(file, (err, data) => {
        if (err) {
          fs.readFile(path.join(this.opts.staticDir, 'index.html'), (e2, html) => (e2 ? res.writeHead(404).end('Build the web app first: npm run build') : res.writeHead(200, { 'content-type': 'text/html' }).end(html)));
          return;
        }
        res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'x-content-type-options': 'nosniff' }).end(data);
      });
    });

    const wss = new WebSocketServer({ server, maxPayload: 512 * 1024 });
    wss.on('connection', (ws, req) => {
      const ip = req.socket.remoteAddress;
      if (!isPrivateAddress(ip)) { ws.terminate(); return; }
      let client = null; // { token, name } once authenticated
      this.sockets.add(ws);
      ws.on('close', () => this.sockets.delete(ws));
      ws.on('message', (raw) => {
        let msg;
        try { msg = JSON.parse(String(raw)); } catch { return; }
        if (msg.t === 'pair') {
          const r = this.pair(ip, msg.code, msg.clientName);
          return send(ws, r.token ? { t: 'paired', token: r.token } : { t: 'denied', reason: r.error });
        }
        if (msg.t === 'auth') {
          const entry = this.tokens[msg.token];
          if (!entry) return send(ws, { t: 'denied', reason: 'Unknown token, pair again' });
          client = { token: msg.token, name: entry.name };
          ws.client = client;
          send(ws, { t: 'authed' });
          if (this.lastState) send(ws, { t: 'state', state: this.lastState });
          return;
        }
        if (!client) return send(ws, { t: 'denied', reason: 'Not authenticated' });
        if (!this.tokens[client.token]) return ws.close(4001, 'revoked');
        this.opts.onMessage(client.name, msg);
      });
    });

    server.on('error', (e) => {
      // Port taken (another GlowPilot running…): keep the app working without the phone API instead of crashing.
      console.error(`GlowPilot local API not started: ${e.message}`);
      this.error = e.message;
    });
    server.listen(this.opts.port, '0.0.0.0');
    this.server = server;
    return server;
  }

  /**
   * Small authenticated HTTP API for the Android alarm service (it runs without the web app):
   * GET /api/status        → is the PC connected to the lights / running an alarm right now?
   * POST /api/phone-alarm  → { at: ms | null, minutes, color }: light alarm before the phone's alarm clock.
   */
  handleApi(req, res, urlPath) {
    const json = (code, body) => res.writeHead(code, { 'content-type': 'application/json' }).end(JSON.stringify(body));
    const readBody = (cb) => {
      let body = '';
      req.on('data', (d) => { body += d; if (body.length > 65536) req.destroy(); });
      req.on('end', () => { try { cb(JSON.parse(body || '{}')); } catch { json(400, { error: 'bad json' }); } });
    };
    // HTTP pairing, for services that don't speak WebSocket (e.g. Noyau): { code, clientName } → { token }.
    if (req.method === 'POST' && urlPath === '/api/pair') {
      return readBody((b) => {
        const r = this.pair(String(req.socket.remoteAddress || ''), b.code, b.clientName);
        json(r.token ? 200 : 403, r.token ? { token: r.token } : { error: r.error });
      });
    }
    const token = /^Bearer\s+(\S+)$/.exec(req.headers.authorization || '')?.[1];
    const client = token && this.tokens[token];
    if (!client) return json(401, { error: 'pair this device first' });
    if (req.method === 'GET' && urlPath === '/api/status') {
      const st = this.lastState;
      const connected = !!st && (st.lights?.length ? st.lights.some((l) => l.status === 'connected') : st.status === 'connected');
      return json(200, { connected, alarmActive: !!st?.alarmActive });
    }
    if (req.method === 'POST' && urlPath === '/api/phone-alarm') {
      let body = '';
      req.on('data', (d) => { body += d; if (body.length > 4096) req.destroy(); });
      req.on('end', () => {
        try {
          const b = JSON.parse(body);
          const at = b.at == null ? null : Number(b.at);
          if (at !== null && !(at > 0)) return json(400, { error: 'bad time' });
          this.opts.onMessage(client.name, { t: 'phoneAlarm', at, minutes: Math.max(1, Math.min(180, Number(b.minutes) || 60)), color: /^#[0-9a-f]{6}$/i.test(b.color) ? b.color : '#ff8a30' });
          json(200, { ok: true });
        } catch {
          json(400, { error: 'bad json' });
        }
      });
      return;
    }
    // Full state (lights, groups, scenes, schedules…), same as the WebSocket 'state' message.
    if (req.method === 'GET' && urlPath === '/api/state') return json(200, this.lastState ?? {});
    // Any client message over HTTP: { t: 'command', cmd, target } to switch scenes, colours, power…
    if (req.method === 'POST' && urlPath === '/api/message') {
      return readBody((m) => {
        if (!m || typeof m.t !== 'string' || ['pair', 'auth'].includes(m.t)) return json(400, { error: 'bad message' });
        this.opts.onMessage(client.name, m);
        json(200, { ok: true });
      });
    }
    if (req.method === 'POST' && urlPath === '/api/alarm-stop') {
      this.opts.onMessage(client.name, { t: 'alarmStop' });
      return json(200, { ok: true });
    }
    return json(404, { error: 'unknown endpoint' });
  }

  broadcastState(state) {
    this.lastState = state;
    const data = JSON.stringify({ t: 'state', state });
    for (const ws of this.sockets) if (ws.client && ws.readyState === 1) ws.send(data);
  }

  stop() {
    this.server?.close();
  }
}

function send(ws, m) {
  if (ws.readyState === 1) ws.send(JSON.stringify(m));
}

module.exports = { LocalApiServer, isPrivateAddress, lanAddresses };
