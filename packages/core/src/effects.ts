import { hsvToRgb, mixRgb, scaleRgb, type RGB } from './color';

/**
 * Two kinds of effects:
 * - "controller": built-in modes (0x80…) executed by the LED controller itself; one BLE write, zero traffic after.
 * - "software": computed by GlowPilot and streamed as colour frames; any palette, but needs the app running.
 */
export type SoftwareEffectType = 'static' | 'fade' | 'breathe' | 'rainbow' | 'strobe' | 'flash' | 'cycle' | 'sequence' | 'candle' | 'horror';

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
  { type: 'horror', name: 'Horror', description: 'Dying-bulb flicker, blackouts and lightning' },
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
      // Below ~150 ms per half-period these controllers start dropping or mixing frames.
      const sp = Math.max(STROBE_MIN_MS, p / 4);
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
    case 'candle':
      return scaleRgb(colors[0], 0.6 + 0.4 * hash(Math.floor(t / 90)));
    case 'horror':
      return horrorAt(colors, t, e.speed);
  }
}

export const STROBE_MIN_MS = 150;

/** Deterministic pseudo-random 0–1 for an integer bucket. */
const hash = (k: number, seed = 0) => {
  const x = Math.sin(k * 12.9898 + seed * 78.233) * 43758.5453;
  return x - Math.floor(x);
};

/**
 * Horror: a dying bulb. Dim unstable flicker in the main colour, sudden blackouts,
 * stutters, and rare lightning flashes in the second colour (white by default).
 */
function horrorAt(colors: RGB[], t: number, speed: number): RGB {
  const base = colors[0];
  const flash = colors[1] ?? { r: 255, g: 255, b: 255 };
  const black = { r: 0, g: 0, b: 0 };
  const tempo = 0.5 + speed / 100; // 0.5x–1.5x
  // Lightning: one 3-second slot in ~7 gets a double flash.
  const slot = Math.floor((t * tempo) / 3000), inSlot = (t * tempo) % 3000;
  if (hash(slot, 1) > 0.86 && (inSlot < 90 || (inSlot > 220 && inSlot < 300))) return flash;
  // Blackout: one 1.2-second slot in ~6 goes dark, then stutters back.
  const bslot = Math.floor((t * tempo) / 1200), inB = (t * tempo) % 1200;
  if (hash(bslot, 2) > 0.83) {
    if (inB < 700) return black;
    return hash(Math.floor(inB / 60), bslot) > 0.5 ? scaleRgb(base, 0.7) : black;
  }
  // Unstable dim flicker, sometimes nearly off.
  const n = hash(Math.floor((t * tempo) / 80), 3);
  return scaleRgb(base, n < 0.08 ? 0.05 : 0.25 + 0.45 * n);
}

/**
 * Wake-up alarm intensity. Brightens from almost off to full over `totalMs`; flashing starts
 * halfway and speeds up; after the build-up it keeps flashing until someone turns it off.
 */
export interface AlarmCurve {
  rhythm?: 'flash' | 'blink' | 'music';
  blinkSpeed?: number;
  accelerate?: boolean;
  startBrightness?: number;
  endBrightness?: number;
  flashDuringBuildup?: boolean;
}

/** Blink half-period in ms for a 0–100 speed: 1000 ms (slow) … 120 ms (fast). */
export const blinkHalfPeriod = (speed: number) => Math.round(1000 - 880 * Math.max(0, Math.min(100, speed)) / 100);

export function alarmAt(elapsedMs: number, totalMs: number, c: AlarmCurve = {}): { level: number; on: boolean } {
  const f = totalMs > 0 ? elapsedMs / totalMs : 1;
  const lo = (c.startBrightness ?? 2) / 100, hi = (c.endBrightness ?? 100) / 100;
  if (f >= 1) {
    const rhythm = c.rhythm ?? 'flash';
    if (rhythm === 'flash') return { level: hi, on: elapsedMs % 400 < 200 };
    // 'blink' (and 'music' where no audio is available, e.g. on the PC): chosen rhythm, optionally accelerating over 5 min.
    let half = blinkHalfPeriod(c.blinkSpeed ?? 50);
    if (c.accelerate ?? true) half = Math.max(80, half * (1 - 0.7 * Math.min(1, (elapsedMs - totalMs) / 300_000)));
    return { level: hi, on: (elapsedMs - totalMs) % (half * 2) < half };
  }
  const level = lo + (hi - lo) * f * f;
  if (f < 0.5 || c.flashDuringBuildup === false) return { level, on: true };
  const period = 4000 - 3400 * ((f - 0.5) / 0.5);
  return { level, on: elapsedMs % period < period * 0.6 };
}

const smooth = (x: number) => x * x * (3 - 2 * x);

/** Frame interval for streaming: no point sending faster than the colour actually changes. */
export function tickIntervalFor(e: SoftwareEffect): number {
  const p = periodFor(e.speed);
  if (e.type === 'static') return Infinity;
  if (e.type === 'flash' || e.type === 'sequence') return p;
  if (e.type === 'strobe') return Math.max(STROBE_MIN_MS, p / 4);
  if (e.type === 'horror') return 60;
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
