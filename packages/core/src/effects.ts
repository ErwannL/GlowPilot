import { hsvToRgb, mixRgb, scaleRgb, type RGB } from './color';

/**
 * Two kinds of effects:
 * - "controller": built-in modes (0x80…) executed by the LED controller itself; one BLE write, zero traffic after.
 * - "software": computed by GlowPilot and streamed as colour frames; any palette, but needs the app running.
 */
export type SoftwareEffectType = 'static' | 'fade' | 'breathe' | 'rainbow' | 'strobe' | 'flash' | 'cycle' | 'sequence' | 'candle';

export interface SoftwareEffect {
  type: SoftwareEffectType;
  colors: RGB[];
  /** 0–100 */
  speed: number;
}

export const SOFTWARE_EFFECTS: { type: SoftwareEffectType; name: string; description: string }[] = [
  { type: 'static', name: 'Static', description: 'One steady colour' },
  { type: 'fade', name: 'Colour fade', description: 'Smoothly blends through your colours' },
  { type: 'breathe', name: 'Breathing', description: 'Gently pulses brightness' },
  { type: 'rainbow', name: 'Rainbow', description: 'Rotates through the whole hue wheel' },
  { type: 'strobe', name: 'Strobe', description: 'Fast on/off flashes' },
  { type: 'flash', name: 'Flash', description: 'Jumps between colours' },
  { type: 'cycle', name: 'Colour cycle', description: 'Holds each colour, then crossfades' },
  { type: 'sequence', name: 'Custom sequence', description: 'Steps through your colours in order' },
  { type: 'candle', name: 'Candle flicker', description: 'Warm random flicker' },
];

/** Period in ms of one colour step for a speed 0–100 (higher speed = shorter). */
export const periodFor = (speed: number) => Math.round(6000 * Math.pow(0.04, Math.max(0, Math.min(100, speed)) / 100)) + 80;

/** Pure function: the colour an effect shows at time t (ms). Deterministic except candle (seeded by t). */
export function effectColorAt(e: SoftwareEffect, t: number): RGB {
  const colors = e.colors.length ? e.colors : [{ r: 255, g: 255, b: 255 }];
  const p = periodFor(e.speed);
  const n = colors.length;
  switch (e.type) {
    case 'static':
      return colors[0];
    case 'fade': {
      const pos = (t / p) % n;
      const i = Math.floor(pos);
      return mixRgb(colors[i], colors[(i + 1) % n], smooth(pos - i));
    }
    case 'breathe': {
      const i = Math.floor(t / (p * 2)) % n;
      const phase = (t % (p * 2)) / (p * 2);
      return scaleRgb(colors[i], 0.08 + 0.92 * (0.5 - 0.5 * Math.cos(phase * 2 * Math.PI)));
    }
    case 'rainbow':
      return hsvToRgb({ h: ((t / (p * 6)) * 360) % 360, s: 1, v: 1 });
    case 'strobe': {
      const sp = Math.max(60, p / 4);
      const i = Math.floor(t / (sp * 2)) % n;
      return (t % (sp * 2)) < sp ? colors[i] : { r: 0, g: 0, b: 0 };
    }
    case 'flash':
    case 'sequence':
      return colors[Math.floor(t / p) % n];
    case 'cycle': {
      const pos = (t / p) % n;
      const i = Math.floor(pos);
      const f = pos - i;
      return f < 0.7 ? colors[i] : mixRgb(colors[i], colors[(i + 1) % n], smooth((f - 0.7) / 0.3));
    }
    case 'candle': {
      const k = Math.floor(t / 90);
      const noise = (Math.sin(k * 12.9898) * 43758.5453) % 1;
      return scaleRgb(colors[0], 0.6 + 0.4 * Math.abs(noise));
    }
  }
}

const smooth = (x: number) => x * x * (3 - 2 * x);

/** Frame interval for streaming: no point sending faster than the colour actually changes. */
export function tickIntervalFor(e: SoftwareEffect): number {
  const p = periodFor(e.speed);
  if (e.type === 'static') return Infinity;
  if (e.type === 'flash' || e.type === 'sequence') return p;
  if (e.type === 'strobe') return Math.max(60, p / 4);
  return Math.max(50, Math.min(150, p / 20));
}

export interface Clock {
  now(): number;
  setInterval(cb: () => void, ms: number): unknown;
  clearInterval(h: unknown): void;
}

export const realClock: Clock = {
  now: () => Date.now(),
  setInterval: (cb, ms) => setInterval(cb, ms),
  clearInterval: (h) => clearInterval(h as ReturnType<typeof setInterval>),
};

/** Streams a software effect to a sink. Skips frames identical to the previous one. */
export class EffectRunner {
  current: SoftwareEffect | null = null;
  private handle: unknown = null;
  private start = 0;
  private last = '';

  constructor(private sink: (c: RGB) => void, private clock: Clock = realClock) {}

  run(e: SoftwareEffect): void {
    this.stop();
    this.current = e;
    this.start = this.clock.now();
    this.tick();
    const iv = tickIntervalFor(e);
    if (Number.isFinite(iv)) this.handle = this.clock.setInterval(() => this.tick(), iv);
  }

  stop(): void {
    if (this.handle != null) this.clock.clearInterval(this.handle);
    this.handle = null;
    this.current = null;
    this.last = '';
  }

  get running(): boolean {
    return this.current != null;
  }

  private tick(): void {
    if (!this.current) return;
    const c = effectColorAt(this.current, this.clock.now() - this.start);
    const sig = `${c.r},${c.g},${c.b}`;
    if (sig === this.last) return;
    this.last = sig;
    this.sink(c);
  }
}
