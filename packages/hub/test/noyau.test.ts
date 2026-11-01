import { test } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import { NoyauMusicSync } from '../src/noyauMusic';

test('follows Noyau playback over SSE and pulses on the beats', async () => {
  let sse: http.ServerResponse | null = null;
  const seen: string[] = [];
  const server = http.createServer((req, res) => {
    seen.push(`${req.method} ${req.url} ${req.headers.authorization}`);
    if (req.url === '/api/music/playback/events') {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      sse = res;
      return;
    }
    if (req.url === '/api/music/tracks/7/beats') return res.end(JSON.stringify({ bpm: 120, beats: [0, 0.5, 1, 1.5, 2, 2.5, 3] }));
    res.writeHead(404).end();
  });
  await new Promise<void>((r) => server.listen(0, r));
  const port = (server.address() as { port: number }).port;
  const frames: number[] = [];
  const active: boolean[] = [];
  const sync = new NoyauMusicSync(
    () => ({ url: `http://127.0.0.1:${port}`, token: 'tok', musicSync: true, colors: ['#ff0000'], target: 'all' }),
    (on) => active.push(on),
    (c) => frames.push(c.r),
    () => {},
  );
  sync.restart();
  for (let i = 0; i < 50 && !sse; i++) await new Promise((r) => setTimeout(r, 20));
  const send = (p: object) => sse!.write(`data: ${JSON.stringify(p)}\n\n`);
  send({ queue: [[7, 0]], queue_index: 0, position_seconds: 0, playing: true, server_time: Date.now() / 1000 });
  await new Promise((r) => setTimeout(r, 1300));
  assert.deepStrictEqual(active, [true]);
  assert.ok(seen.some((s) => s === 'GET /api/music/tracks/7/beats Bearer tok'), 'beats requested with the token');
  // Pulses: bright right after a beat (~255), dim between beats (~64).
  assert.ok(Math.max(...frames) > 200 && Math.min(...frames) < 100, `frames ${Math.min(...frames)}..${Math.max(...frames)}`);
  send({ queue: [[7, 0]], queue_index: 0, position_seconds: 1.3, playing: false, server_time: Date.now() / 1000 });
  await new Promise((r) => setTimeout(r, 100));
  assert.deepStrictEqual(active, [true, false]);
  sync.stop();
  (sse as unknown as http.ServerResponse)?.end();
  server.close();
});
