/**
 * Follows what Noyau Musique plays (SSE /api/music/playback/events) and makes the lights pulse on the
 * beats (GET /api/music/tracks/{id}/beats). See docs/NOYAU_INTEGRATION.md. Everything degrades:
 * no beats → steady pulse at the BPM, no BPM → 120 BPM; YouTube tracks → plain colour cycle.
 */
import type { RGB } from '@glowpilot/core';

export interface NoyauSettings {
  url: string;
  token: string;
  musicSync: boolean;
  colors: string[];
  /** 'all' or a group id. */
  target: string;
}

interface Playback {
  queue: [number, number][] | number[];
  queue_index: number;
  position_seconds: number;
  playing: boolean;
  server_time: number;
}

interface Beats { bpm?: number; beats?: number[] }

export class NoyauMusicSync {
  private abort: AbortController | null = null;
  private tick: NodeJS.Timeout | null = null;
  private playback: Playback | null = null;
  private receivedAt = 0;
  private beats: number[] = [];
  private bpm = 120;
  private trackId: number | null = null;
  private beatIndex = 0;
  private lastBeatAt = -1;
  private colorIndex = 0;
  active = false;
  status = 'off';

  constructor(
    private settings: () => NoyauSettings | null,
    /** Called when music starts (true) / stops (false): the hub pauses / restores the scene. */
    private onActive: (on: boolean) => void,
    /** Draw one frame on the target lights. */
    private render: (c: RGB) => void,
    private log: (...a: unknown[]) => void,
  ) {}

  restart() {
    this.stop();
    const s = this.settings();
    if (!s?.musicSync || !s.url || !s.token) { this.status = 'off'; return; }
    void this.listen(s);
  }

  stop() {
    this.abort?.abort();
    this.abort = null;
    this.setActive(false);
  }

  private headers(s: NoyauSettings) {
    return { Authorization: `Bearer ${s.token}`, Accept: 'text/event-stream' };
  }

  /** Reads the SSE stream; reconnects after errors. */
  private async listen(s: NoyauSettings) {
    const ctrl = new AbortController();
    this.abort = ctrl;
    while (!ctrl.signal.aborted) {
      try {
        const res = await fetch(`${s.url.replace(/\/$/, '')}/api/music/playback/events`, { headers: this.headers(s), signal: ctrl.signal });
        if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
        this.status = 'listening';
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let buf = '';
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let i;
          while ((i = buf.indexOf('\n\n')) >= 0) {
            const chunk = buf.slice(0, i);
            buf = buf.slice(i + 2);
            const data = chunk.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).join('');
            if (data) this.onPlayback(JSON.parse(data) as Playback, s);
          }
        }
      } catch (e) {
        if (ctrl.signal.aborted) return;
        this.status = `error: ${(e as Error).message}`;
        this.setActive(false);
      }
      await new Promise((r) => setTimeout(r, 10_000));
    }
  }

  private currentTrack(p: Playback): number | null {
    const item = p.queue?.[p.queue_index] as unknown;
    if (Array.isArray(item)) return Number(item[0]);
    return typeof item === 'number' ? item : null;
  }

  private onPlayback(p: Playback, s: NoyauSettings) {
    this.playback = p;
    this.receivedAt = Date.now();
    const id = this.currentTrack(p);
    if (id !== this.trackId) {
      this.trackId = id;
      this.beats = [];
      this.bpm = 120;
      this.beatIndex = 0;
      if (id != null) void this.loadBeats(id, s);
    }
    this.setActive(!!p.playing);
  }

  private async loadBeats(id: number, s: NoyauSettings) {
    try {
      const r = await fetch(`${s.url.replace(/\/$/, '')}/api/music/tracks/${id}/beats`, { headers: { Authorization: `Bearer ${s.token}` } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const b = (await r.json()) as Beats;
      if (this.trackId !== id) return;
      this.beats = (b.beats ?? []).filter((x) => Number.isFinite(x)).sort((a, c) => a - c);
      if (b.bpm && b.bpm > 30 && b.bpm < 260) this.bpm = b.bpm;
      this.log(`noyau: track ${id}, ${this.beats.length} beats, ${this.bpm} bpm`);
    } catch (e) {
      this.log(`noyau: no beats for track ${id} (${(e as Error).message}), pulsing at ${this.bpm} bpm`);
    }
  }

  private setActive(on: boolean) {
    if (on === this.active) return;
    this.active = on;
    this.onActive(on);
    if (this.tick) clearInterval(this.tick);
    this.tick = null;
    if (on) this.tick = setInterval(() => this.frame(), 30);
  }

  /** Position in the track now, from the last playback event (server clock ≈ ours on the same machine). */
  private position(): number {
    const p = this.playback;
    if (!p) return 0;
    return p.position_seconds + (Date.now() - this.receivedAt) / 1000;
  }

  private frame() {
    const s = this.settings();
    if (!s) return;
    const colors = (s.colors.length ? s.colors : ['#8b5cf6', '#f97316']).map(hex);
    const pos = this.position();
    let sinceBeat: number;
    if (this.beats.length) {
      while (this.beatIndex > 0 && this.beats[this.beatIndex] > pos) this.beatIndex--; // seek back
      while (this.beatIndex + 1 < this.beats.length && this.beats[this.beatIndex + 1] <= pos) this.beatIndex++;
      sinceBeat = pos - this.beats[this.beatIndex];
      if (this.beats[this.beatIndex] !== this.lastBeatAt && sinceBeat >= 0) { this.lastBeatAt = this.beats[this.beatIndex]; this.colorIndex++; }
    } else {
      const period = 60 / this.bpm;
      const n = Math.floor(pos / period);
      if (n !== this.lastBeatAt) { this.lastBeatAt = n; this.colorIndex++; }
      sinceBeat = pos - n * period;
    }
    // Sharp attack on the beat, quick decay to a glow.
    const level = sinceBeat < 0 ? 0.25 : 0.25 + 0.75 * Math.exp(-sinceBeat / 0.12);
    const c = colors[this.colorIndex % colors.length];
    this.render({ r: Math.round(c.r * level), g: Math.round(c.g * level), b: Math.round(c.b * level) });
  }
}

function hex(h: string): RGB {
  const n = parseInt(h.replace('#', ''), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}
