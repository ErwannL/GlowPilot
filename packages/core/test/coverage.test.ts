import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  applyCalibration, colorName, DEFAULT_CALIBRATION, DeviceController, describeSchedule, dueSchedules, effectColorAt, elkDriver,
  Emitter, GlowEngine, isClientMessage, nextRun, parseTime, SimulatorTransport, wakeTimes, BUILTIN_SCENES,
  type Clock, type Schedule,
} from '../src';

/** Manual clock so engine intervals are driven by the test. */
function manualClock() {
  let t = new Date(2026, 10, 2, 6, 0).getTime();
  const iv: { fn: () => void; ms: number; next: number; id: number }[] = [];
  let id = 0;
  const clock: Clock = {
    now: () => t,
    setInterval: (fn: () => void, ms: number) => { iv.push({ fn, ms, next: t + ms, id: ++id }); return id; },
    clearInterval: (h: unknown) => { const i = iv.findIndex((x) => x.id === h); if (i >= 0) iv.splice(i, 1); },
  } as Clock;
  const advance = (ms: number) => {
    const end = t + ms;
    for (;;) {
      const due = iv.filter((x) => x.next <= end).sort((a, b) => a.next - b.next)[0];
      if (!due) break;
      t = due.next;
      due.next += due.ms;
      due.fn();
    }
    t = end;
  };
  return { clock, advance };
}

async function engine() {
  const sim = new SimulatorTransport();
  const c = new DeviceController(sim, elkDriver, { minGapMs: 0 });
  await c.connect(await c.pick());
  const m = manualClock();
  const eng = new GlowEngine(c, m.clock);
  eng.scenes = [...BUILTIN_SCENES];
  return { sim, c, eng, ...m };
}

const sched = (over: Partial<Schedule>): Schedule => ({ id: 's', name: 'S', enabled: true, time: '07:00', days: [], action: { type: 'on' }, ...over });

afterEach(() => vi.useRealTimers());

describe('api', () => {
  it('recognises client messages', () => {
    expect(isClientMessage({ t: 'pair', code: '1', clientName: 'x' })).toBe(true);
    expect(isClientMessage({ t: 'alarmStop' })).toBe(true);
    expect(isClientMessage({ t: 'nope' })).toBe(false);
    expect(isClientMessage(null)).toBe(false);
  });
});

describe('emitter', () => {
  class E extends Emitter<{ a: number }> { fire(n: number) { this.emit('a', n); } }
  it('unsubscribes', () => {
    const e = new E();
    const got: number[] = [];
    const off = e.on('a', (n) => got.push(n));
    e.fire(1); off(); e.fire(2);
    expect(got).toEqual([1]);
  });
});

describe('colour names and calibration', () => {
  it('names every hue band', () => {
    const names = [0, 20, 50, 80, 120, 170, 220, 270, 300, 340].map((h) => colorName(hue(h)));
    expect(names).toEqual(['Red', 'Orange', 'Yellow', 'Lime', 'Green', 'Cyan', 'Blue', 'Purple', 'Magenta', 'Pink']);
  });
  it('keeps colour balance at low brightness (no channel collapses to 0 while others stay lit)', () => {
    const warm = { r: 255, g: 140, b: 40 };
    for (const b of [1, 5, 14, 30, 100]) {
      const out = applyCalibration(warm, DEFAULT_CALIBRATION, b);
      expect(out.r).toBeGreaterThan(0);
      expect(out.r).toBeGreaterThanOrEqual(out.g);
      expect(out.g).toBeGreaterThanOrEqual(out.b);
    }
    expect(applyCalibration({ r: 0, g: 0, b: 0 }, DEFAULT_CALIBRATION, 5)).toEqual({ r: 0, g: 0, b: 0 });
  });
});

function hue(h: number) {
  const f = (n: number) => { const k = (n + h / 60) % 6; return Math.round(255 * (1 - Math.max(0, Math.min(k, 4 - k, 1)))); };
  return { r: f(5), g: f(3), b: f(1) };
}

describe('effects', () => {
  it('every effect type yields a colour, empty colour list falls back to white', () => {
    for (const type of ['static', 'fade', 'breathe', 'rainbow', 'strobe', 'flash', 'sequence', 'cycle', 'candle', 'horror'] as const) {
      const c = effectColorAt({ type, colors: [{ r: 255, g: 0, b: 0 }, { r: 0, g: 0, b: 255 }], speed: 50 }, 1234);
      expect(c.r + c.g + c.b).toBeGreaterThanOrEqual(0);
    }
    expect(effectColorAt({ type: 'static', colors: [], speed: 50 }, 0)).toEqual({ r: 255, g: 255, b: 255 });
    expect(effectColorAt({ type: 'cycle', colors: [{ r: 255, g: 0, b: 0 }, { r: 0, g: 255, b: 0 }], speed: 0 }, 6080 * 0.85).g).toBeGreaterThan(0);
  });
});

describe('schedules', () => {
  it('parses times', () => {
    expect(parseTime('7:05')).toEqual({ h: 7, m: 5 });
    expect(parseTime('24:00')).toBeNull();
    expect(parseTime('x')).toBeNull();
  });
  it('one-shot onceAt, disabled and fired', () => {
    const now = new Date(2026, 10, 2, 6, 0);
    const at = now.getTime() + 3600_000;
    expect(nextRun(sched({ onceAt: at }), now)?.getTime()).toBe(at);
    expect(nextRun(sched({ onceAt: at, firedAt: 1 }), now)).toBeNull();
    expect(nextRun(sched({ enabled: false }), now)).toBeNull();
    expect(nextRun(sched({ time: 'bad' }), now)).toBeNull();
    expect(nextRun(sched({ firedAt: 1, time: '05:00' }), now)).toBeNull();
  });
  it('due between ticks', () => {
    const prev = new Date(2026, 10, 2, 6, 59, 50);
    expect(dueSchedules([sched({})], prev, new Date(2026, 10, 2, 7, 0, 5))).toHaveLength(1);
    expect(dueSchedules([sched({})], prev, new Date(2026, 10, 2, 6, 59, 55))).toHaveLength(0);
  });
  it('describes every action and day set', () => {
    expect(describeSchedule(sched({ days: [0, 1, 2, 3, 4, 5, 6] }))).toBe('Turn on · 07:00 · Every day');
    expect(describeSchedule(sched({ days: [1, 2, 3, 4, 5], action: { type: 'off' } }))).toContain('Weekdays');
    expect(describeSchedule(sched({ days: [0, 6], action: { type: 'scene', sceneId: 'x' } }))).toContain('Weekends');
    expect(describeSchedule(sched({ days: [2, 4], action: { type: 'sunrise', minutes: 20, brightness: 80, color: '#f00' } }))).toBe('Sunrise (20 min) · 07:00 · Tue, Thu');
    expect(describeSchedule(sched({ action: { type: 'alarm', minutes: 10, color: '#f00' } }))).toContain('Wake-up alarm (10 min build-up) · 07:00 · Once');
    expect(describeSchedule(sched({ action: { type: 'sunset', minutes: 5 } }))).toContain('Fade out (5 min)');
    expect(describeSchedule(sched({ onceAt: Date.now() }))).toMatch(/^Turn on · /);
  });
  it('wake times skip off/sunset/invalid, shift across midnight, one-shots get an exact moment', () => {
    const now = new Date(2026, 10, 2, 6, 0);
    const list = [
      sched({ id: 'off', action: { type: 'off' } }),
      sched({ id: 'bad', time: 'x', days: [1] }),
      sched({ id: 'mid', time: '00:01', days: [1, 0] }),
      sched({ id: 'once', time: '07:00' }),
      sched({ id: 'gone', time: '05:00', firedAt: 1 }),
    ];
    const w = wakeTimes(list, now);
    expect(w.map((x) => x.id)).toEqual(['mid', 'once']);
    expect(w[0]).toMatchObject({ time: '23:58', days: [0, 6] });
    expect(w[1].once).toBe('2026-11-02T06:57:00');
  });
});

describe('engine', () => {
  it('power/colour/brightness/speed/effects/temperature commands', async () => {
    const { eng, sim, c, advance } = await engine();
    const manual = vi.fn();
    eng.on('manual', manual);
    eng.exec({ type: 'softwareEffect', effect: { type: 'fade', colors: [{ r: 255, g: 0, b: 0 }, { r: 0, g: 0, b: 255 }], speed: 50 } });
    eng.exec({ type: 'speed', level: 90 });
    expect(eng.effects.current?.speed).toBe(90);
    eng.exec({ type: 'power', on: false });
    eng.exec({ type: 'softwareEffect', effect: { type: 'static', colors: [{ r: 1, g: 2, b: 3 }], speed: 50 } });
    expect(c.state.on).toBe(true);
    eng.exec({ type: 'controllerEffect', id: 0x87 });
    eng.exec({ type: 'colorTemperature', warm: 70 });
    eng.exec({ type: 'brightness', level: 40 });
    eng.exec({ type: 'color', color: { r: 9, g: 9, b: 9 } });
    eng.exec({ type: 'sleepTimer', minutes: 10 });
    expect(eng.snapshot().sleepTimerEndsAt).toBeGreaterThan(0);
    eng.exec({ type: 'sleepTimer', minutes: null });
    expect(eng.snapshot().sleepTimerEndsAt).toBeNull();
    advance(100);
    await c.idle();
    expect(manual).toHaveBeenCalledTimes(10);
    expect(sim.state.on).toBe(true);
  });

  it('scene mix loops its steps; missing scene and empty mix do nothing; duration reverts', async () => {
    vi.useFakeTimers();
    const { eng } = await engine();
    eng.scenes.push(
      { ...BUILTIN_SCENES[0], id: 'mix', steps: [{ sceneId: 'short', seconds: 1 }, { seconds: 1, look: { colors: ['#00ff00'], brightness: 50, speed: 50, animation: { kind: 'software', effect: 'static' } } }] },
      { ...BUILTIN_SCENES[0], id: 'deadmix', steps: [{ sceneId: 'gone', seconds: 1 }] },
      { ...BUILTIN_SCENES[0], id: 'short', steps: undefined, durationMin: 1, transitionMs: 300, animation: { kind: 'software', effect: 'static' } },
    );
    eng.applyScene('nope');
    expect(eng.activeSceneId).toBeNull();
    eng.applyScene('mix');
    const first = eng.snapshot().mixStepSceneId;
    expect(first).toBeTruthy();
    await vi.advanceTimersByTimeAsync(1100);
    expect(eng.snapshot().mixStepSceneId).not.toBe(first);
    eng.applyScene('deadmix');
    expect(eng.snapshot().mixStepSceneId).toBeNull();
    eng.applyScene('short');
    eng.applyScene(BUILTIN_SCENES[2].id);
    eng.scenes.find((s) => s.id === BUILTIN_SCENES[2].id)!.durationMin = 1;
    eng.applyScene('short');
    await vi.advanceTimersByTimeAsync(61_000);
    expect(eng.activeSceneId).toBe(BUILTIN_SCENES[2].id);
  });

  it('crossfades a static scene with software frames', async () => {
    const { eng, c, advance } = await engine();
    eng.scenes.push({ ...BUILTIN_SCENES[0], id: 'st', steps: undefined, transitionMs: 600, colors: ['#0000ff'], animation: { kind: 'software', effect: 'static' } });
    const frames = vi.spyOn(c, 'renderFrame');
    eng.applyScene('st');
    advance(700);
    expect(frames).toHaveBeenCalled();
    expect(c.state.color).toEqual({ r: 0, g: 0, b: 255 });
  });

  it('sunrise and sunset ramps, sleep timer fades out, halt stops everything', async () => {
    const { eng, c, advance } = await engine();
    eng.startRamp('sunrise', 1, 60);
    advance(61_000);
    expect(c.state.brightness).toBe(60);
    expect(eng.ramp).toBeNull();
    eng.startRamp('sunset', 1);
    advance(61_000);
    expect(c.state.on).toBe(false);

    const fired: string[] = [];
    const stop = eng.startScheduler(() => [], (s) => fired.push(s.id), 1000);
    eng.exec({ type: 'power', on: true });
    eng.setSleepTimer(1);
    advance(62_000);
    expect(eng.ramp?.kind).toBe('sunset');
    eng.halt();
    expect(eng.ramp).toBeNull();
    stop();
  });

  it('runs every schedule action kind, alarm stops on the phone button and keeps its colour', async () => {
    const { eng, c, advance } = await engine();
    eng.runScheduleAction(sched({ action: { type: 'off' } }));
    expect(c.state.on).toBe(false);
    eng.runScheduleAction(sched({ action: { type: 'on' } }));
    eng.runScheduleAction(sched({ action: { type: 'scene', sceneId: BUILTIN_SCENES[0].id } }));
    expect(eng.activeSceneId).toBe(BUILTIN_SCENES[0].id);
    eng.runScheduleAction(sched({ action: { type: 'sunrise', minutes: 1, brightness: 50, color: '#ff0000' } }));
    expect(eng.ramp?.kind).toBe('sunrise');
    eng.runScheduleAction(sched({ action: { type: 'sunset', minutes: 1 } }));
    expect(eng.ramp?.kind).toBe('sunset');
    eng.stopAlarm(); // not ringing: no-op
    eng.runScheduleAction(sched({ action: { type: 'alarm', minutes: 1, color: '#00ff00' } }));
    advance(500);
    expect(eng.ramp?.kind).toBe('alarm');
    eng.stopAlarm();
    expect(eng.ramp).toBeNull();
    expect(c.state.color).toEqual({ r: 0, g: 255, b: 0 });
    eng.startAlarm(1);
    eng.exec({ type: 'brightness', level: 20 }); // manual action stops a ringing alarm
    expect(eng.ramp).toBeNull();

    const fired: string[] = [];
    const s = sched({ id: 'w', time: '06:01', days: [0, 1, 2, 3, 4, 5, 6] });
    eng.startScheduler(() => [s], (x) => fired.push(x.id), 15_000);
    advance(90_000);
    expect(fired).toEqual(['w']);
  });
});
