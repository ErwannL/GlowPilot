import { describe, expect, it, vi } from 'vitest';
import {
  applyCalibration, AutomationEngine, colorName, CommandQueue, DeviceController, effectColorAt, elkDriver,
  EXAMPLE_RULES, exportScenes, findConflicts, GlowEngine, hexToRgb, hsvToRgb, IDENTITY_CALIBRATION, importScenes,
  kelvinToRgb, nextRun, pickRule, rampLevel, alarmAt, playableSteps, rgbToHex, rgbToHsv, BUILTIN_SCENES, SimulatorTransport, toHex,
  type AutomationRule, type Schedule,
} from '../src';

const hex = (f: { bytes: Uint8Array }) => toHex(f.bytes).replace(/ /g, '');

describe('ELK protocol frames (match the frames echoed by the real ELK-BLEDDM on 2026-10-31)', () => {
  it('power', () => {
    expect(hex(elkDriver.power(true))).toBe('7e0404010001ff00ef');
    expect(hex(elkDriver.power(false))).toBe('7e0404000000ff00ef');
  });
  it('rgb', () => {
    expect(hex(elkDriver.rgb(255, 0, 0))).toBe('7e070503ff000010ef');
    expect(hex(elkDriver.rgb(255, 80, 0))).toBe('7e070503ff500010ef');
    expect(hex(elkDriver.rgb(300, -5, 12.6))).toBe('7e070503ff000d10ef');
  });
  it('brightness, speed, effect', () => {
    expect(hex(elkDriver.brightness(20))).toBe('7e040114ffffff00ef');
    expect(hex(elkDriver.brightness(150))).toBe('7e040164ffffff00ef');
    expect(hex(elkDriver.speed(80))).toBe('7e040250ffffff00ef');
    expect(hex(elkDriver.effect(0x87))).toBe('7e05038703ffff00ef');
  });
  it('every frame is 9 bytes 7E…EF', () => {
    for (const f of [elkDriver.power(true), elkDriver.rgb(1, 2, 3), elkDriver.colorTemperature(30, 70), elkDriver.microphone(true)]) {
      expect(f.bytes.length).toBe(9);
      expect(f.bytes[0]).toBe(0x7e);
      expect(f.bytes[8]).toBe(0xef);
    }
  });
  it('matches padded advertised names', () => {
    expect(elkDriver.matches('ELK-BLEDDM    ')).toBe(true);
    expect(elkDriver.matches('ELK-BLEDOM')).toBe(true);
    expect(elkDriver.matches('Washer')).toBe(false);
    expect(elkDriver.effects[0].id).toBe(0x80);
  });
});

describe('colour', () => {
  it('round-trips hsv and hex', () => {
    for (const c of [{ r: 255, g: 110, b: 0 }, { r: 12, g: 200, b: 99 }, { r: 0, g: 0, b: 0 }]) {
      expect(hsvToRgb(rgbToHsv(c))).toEqual(c);
      expect(hexToRgb(rgbToHex(c))).toEqual(c);
    }
    expect(hexToRgb('#f80')).toEqual({ r: 255, g: 136, b: 0 });
    expect(hexToRgb('nope')).toBeNull();
  });
  it('names colours distinctly', () => {
    expect(colorName({ r: 255, g: 0, b: 0 })).toBe('Red');
    expect(colorName({ r: 255, g: 110, b: 0 })).toBe('Orange');
    expect(colorName({ r: 255, g: 210, b: 0 })).toBe('Yellow');
    expect(colorName({ r: 140, g: 0, b: 255 })).toBe('Purple');
    expect(colorName({ r: 0, g: 0, b: 255 })).toBe('Blue');
  });
  it('kelvin is warm at 2700 and neutral near 6600', () => {
    const warm = kelvinToRgb(2700);
    expect(warm.r).toBe(255);
    expect(warm.b).toBeLessThan(warm.g);
    const n = kelvinToRgb(6600);
    expect(n.r).toBeGreaterThan(240);
    expect(n.b).toBeGreaterThan(240);
  });
  it('identity calibration is a no-op', () => {
    expect(applyCalibration({ r: 10, g: 20, b: 30 }, IDENTITY_CALIBRATION)).toEqual({ r: 10, g: 20, b: 30 });
  });
  it('warm green cut keeps orange from turning yellow', () => {
    const cal = { ...IDENTITY_CALIBRATION, warmGreenCut: 0.5 };
    const out = applyCalibration({ r: 255, g: 110, b: 0 }, cal);
    expect(out.g).toBeLessThan(110);
    expect(applyCalibration({ r: 0, g: 0, b: 255 }, cal)).toEqual({ r: 0, g: 0, b: 255 });
  });
  it('channel order remaps pins', () => {
    const cal = { ...IDENTITY_CALIBRATION, order: 'grb' as const };
    // Strip shows green on pin 1: to show logical red, red value must go to pin 2.
    expect(applyCalibration({ r: 255, g: 0, b: 0 }, cal)).toEqual({ r: 0, g: 255, b: 0 });
  });
});

describe('command queue', () => {
  it('coalesces same-key frames and deduplicates repeats', async () => {
    const written: string[] = [];
    const q = new CommandQueue(async (b) => void written.push(toHex(b)), 0, async () => {});
    for (let i = 0; i < 50; i++) q.push(elkDriver.rgb(i, 0, 0));
    await q.idle();
    expect(written.length).toBeLessThan(5);
    expect(written.at(-1)).toBe(toHex(elkDriver.rgb(49, 0, 0).bytes));
    q.push(elkDriver.rgb(49, 0, 0));
    await q.idle();
    expect(written.length).toBeLessThan(5);
    const n = written.length;
    q.push(elkDriver.rgb(49, 0, 0), true);
    await q.idle();
    expect(written.length).toBe(n + 1);
  });
  it('survives write errors', async () => {
    let fail = true;
    const ok: string[] = [];
    const q = new CommandQueue(async (b) => { if (fail) { fail = false; throw new Error('x'); } ok.push(toHex(b)); }, 0, async () => {});
    q.push(elkDriver.power(true));
    q.push(elkDriver.rgb(1, 1, 1));
    await q.idle();
    expect(ok).toHaveLength(1);
  });
});

describe('device controller with simulator', () => {
  const setup = async () => {
    const sim = new SimulatorTransport();
    const c = new DeviceController(sim, elkDriver, { minGapMs: 0 });
    const dev = await c.pick();
    dev.calibration = IDENTITY_CALIBRATION;
    await c.connect(dev);
    return { sim, c };
  };
  it('connects, sends state and receives echo acks', async () => {
    const { sim, c } = await setup();
    const acks: Uint8Array[] = [];
    c.on('ack', (a) => acks.push(a));
    c.setColor({ r: 0, g: 0, b: 255 });
    await c.idle();
    await Promise.resolve();
    expect(c.status).toBe('connected');
    expect(sim.state).toMatchObject({ on: true, r: 0, g: 0, b: 255 });
    expect(acks.length).toBeGreaterThan(0);
  });
  it('never sends while disconnected and reconnects after a drop', async () => {
    vi.useFakeTimers();
    const { sim, c } = await setup();
    sim.drop();
    expect(c.status).toBe('reconnecting');
    c.setColor({ r: 1, g: 2, b: 3 });
    await vi.advanceTimersByTimeAsync(600);
    expect(c.status).toBe('connected');
    await vi.advanceTimersByTimeAsync(50);
    expect(sim.state).toMatchObject({ r: 1, g: 2, b: 3 });
    vi.useRealTimers();
  });
  it('backs off on repeated failures and stops on manual disconnect', async () => {
    vi.useFakeTimers();
    const { sim, c } = await setup();
    sim.failNextConnects = 3;
    sim.drop();
    await vi.advanceTimersByTimeAsync(500 + 1000 + 2000 + 4000 + 100);
    expect(c.status).toBe('connected');
    await c.disconnect();
    sim.drop();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(c.status).toBe('disconnected');
    vi.useRealTimers();
  });
  it('rejects unsupported devices on pick', async () => {
    const sim = new SimulatorTransport({ id: 'x', name: 'Washer' });
    const c = new DeviceController(sim, elkDriver);
    await expect(c.pick()).rejects.toThrow(/not a supported/);
  });
});

describe('effects', () => {
  const R = { r: 255, g: 0, b: 0 }, B = { r: 0, g: 0, b: 255 };
  it('fade blends between colours', () => {
    const e = { type: 'fade' as const, colors: [R, B], speed: 50 };
    expect(effectColorAt(e, 0)).toEqual(R);
    const mid = effectColorAt(e, 0.5 * 1280); // half a period at speed 50 (~1280 ms)
    expect(mid.r).toBeGreaterThan(0);
    expect(mid.b).toBeGreaterThan(0);
  });
  it('strobe alternates with black', () => {
    const e = { type: 'strobe' as const, colors: [R], speed: 100 };
    const seen = new Set([0, 70, 140, 210].map((t) => effectColorAt(e, t).r));
    expect(seen.has(0)).toBe(true);
    expect(seen.has(255)).toBe(true);
  });
});

describe('scenes', () => {
  it('has all required built-ins', () => {
    for (const n of ['Halloween', 'Christmas', 'Cinema', 'Gaming', 'Work', 'Relax', 'Sunset', 'Night', 'Reading', 'Cyberpunk', 'Horror', 'Custom'])
      expect(BUILTIN_SCENES.some((s) => s.name === n)).toBe(true);
  });
  it('export → import round-trips and validates', () => {
    const { scenes, errors } = importScenes(exportScenes(BUILTIN_SCENES.slice(0, 3)));
    expect(errors).toEqual([]);
    expect(scenes.map((s) => s.name)).toEqual(['Halloween', 'Christmas', 'Cinema']);
    expect(scenes[0].builtin).toBeUndefined();
    const bad = importScenes('{"scenes":[{"name":"x","colors":["zz"]},{"colors":["#fff"]},{"name":"ok","colors":["#fff"],"brightness":900}]}');
    expect(bad.errors).toHaveLength(2);
    expect(bad.scenes[0].brightness).toBe(100);
    expect(importScenes('not json').errors).toHaveLength(1);
  });
});

describe('automation', () => {
  const base = { enabled: true, cooldownSec: 10, restorePrevious: true };
  const rules: AutomationRule[] = [
    { ...base, id: 'r0', name: 'Cyberpunk', process: 'Cyberpunk2077.exe', trigger: 'running', sceneId: 'cyberpunk', priority: 90 },
    { ...base, id: 'r1', name: 'Fortnite', process: 'FortniteClient-Win64-Shipping.exe', trigger: 'running', sceneId: 'gaming', priority: 80 },
    { ...base, id: 'r2', name: 'VS Code', process: 'Code.exe', trigger: 'foreground', sceneId: 'work', priority: 20, cooldownSec: 30 },
    { ...base, id: 'r3', name: 'Chrome', process: 'chrome.exe', trigger: 'foreground', sceneId: 'relax', priority: 10, enabled: false },
  ];
  it('ships only the user\'s games as defaults', () => {
    const procs = EXAMPLE_RULES.map((r) => r.process.toLowerCase());
    expect(procs).toContain('timberborn.exe');
    expect(procs.some((p) => /code|chrome|fortnite|cyberpunk/.test(p))).toBe(false);
  });
  it('matches alternatives separated by |', () => {
    const r: AutomationRule = { ...rules[0], process: 'FactoryGameSteam.exe | factorygame*shipping.exe' };
    expect(pickRule([r], { processes: ['factorygamesteam-win64-shipping.exe'], foreground: null })).toBe(r);
    expect(pickRule([r], { processes: ['factory.exe'], foreground: null })).toBeNull();
  });
  it('picks by priority and trigger', () => {
    expect(pickRule(rules, { processes: ['code.exe', 'cyberpunk2077.exe'], foreground: 'code.exe' })?.sceneId).toBe('cyberpunk');
    expect(pickRule(rules, { processes: ['code.exe'], foreground: 'explorer.exe' })).toBeNull();
    expect(pickRule(rules, { processes: ['code.exe'], foreground: 'Code.exe' })?.sceneId).toBe('work');
    expect(pickRule(rules, { processes: ['chrome.exe'], foreground: 'chrome.exe' })).toBeNull(); // disabled by default
  });
  it('supports wildcards', () => {
    const r: AutomationRule = { ...rules[0], process: 'steam*.exe' };
    expect(pickRule([r], { processes: ['steamwebhelper.exe'], foreground: null })).toBe(r);
  });
  it('activates, restores the previous scene and respects cooldown and overrides', () => {
    const e = new AutomationEngine(rules);
    const game = { processes: ['fortniteclient-win64-shipping.exe'], foreground: null };
    const idle = { processes: [], foreground: null };
    expect(e.evaluate(game, 'relax', 0)).toEqual({ type: 'activate', ruleId: 'r1', sceneId: 'gaming' });
    expect(e.evaluate(game, 'gaming', 1000)).toEqual({ type: 'none' });
    expect(e.evaluate(idle, 'gaming', 2000)).toEqual({ type: 'restore', sceneId: 'relax' });
    expect(e.evaluate(game, 'relax', 3000)).toEqual({ type: 'none' }); // cooldown 10 s
    expect(e.evaluate(game, 'relax', 12_000).type).toBe('activate');
    e.manualOverride(5, 13_000);
    expect(e.evaluate(idle, 'x', 14_000)).toEqual({ type: 'none' });
  });
  it('detects shadowed rules', () => {
    const a = { ...rules[2], id: 'a' }, b = { ...rules[2], id: 'b', sceneId: 'relax' };
    const [a2, b2] = [a, b].map((r) => ({ ...r, enabled: true }));
    expect(findConflicts([a2, b2])).toEqual([{ ruleId: 'b', shadowedBy: 'a' }]);
  });
});

describe('schedules', () => {
  const base: Schedule = { id: 's', name: 'x', enabled: true, time: '07:30', days: [1, 2, 3, 4, 5], action: { type: 'on' } };
  it('finds the next weekday occurrence', () => {
    const sat = new Date(2026, 9, 31, 12, 0); // Saturday
    const n = nextRun(base, sat)!;
    expect(n.getDay()).toBe(1);
    expect(n.getHours()).toBe(7);
    expect(n.getMinutes()).toBe(30);
  });
  it('starts sunrise before the alarm time', () => {
    const s: Schedule = { ...base, days: [], action: { type: 'sunrise', minutes: 20, brightness: 100, color: '#ffa040' } };
    const n = nextRun(s, new Date(2026, 9, 31, 6, 0))!;
    expect(n.getHours()).toBe(7);
    expect(n.getMinutes()).toBe(10);
  });
  it('one-shot schedules do not repeat once fired', () => {
    expect(nextRun({ ...base, days: [], firedAt: 1 }, new Date())).toBeNull();
    expect(nextRun({ ...base, enabled: false }, new Date())).toBeNull();
  });
  it('ramp levels are monotonic', () => {
    const up = [0, 0.25, 0.5, 1].map((f) => rampLevel(f * 1000, 1000, 1, 100));
    expect(up).toEqual([...up].sort((a, b) => a - b));
    expect(up[3]).toBe(100);
    expect(rampLevel(1000, 1000, 80, 0)).toBe(0);
  });
});

describe('engine integration', () => {
  it('applies a controller-effect scene and a software scene through the simulator', async () => {
    vi.useFakeTimers();
    const sim = new SimulatorTransport();
    const c = new DeviceController(sim, elkDriver, { minGapMs: 0 });
    const dev = await c.pick();
    await c.connect(dev);
    const eng = new GlowEngine(c);
    eng.scenes = [
      ...BUILTIN_SCENES,
      { ...BUILTIN_SCENES[0], id: 'hw', steps: undefined, animation: { kind: 'controller', effectId: 0x88 } },
    ];
    eng.exec({ type: 'scene', sceneId: 'hw' });
    await vi.advanceTimersByTimeAsync(50);
    expect(sim.state.effect).toBe(0x88);
    eng.exec({ type: 'scene', sceneId: 'gaming' });
    const before = sim.log.length;
    await vi.advanceTimersByTimeAsync(3000);
    expect(sim.log.length).toBeGreaterThan(before + 5);
    expect(eng.snapshot().activeSceneId).toBe('gaming');
    eng.exec({ type: 'power', on: false });
    await vi.advanceTimersByTimeAsync(50);
    const after = sim.log.length;
    await vi.advanceTimersByTimeAsync(2000);
    expect(sim.log.length).toBe(after); // effect stopped, no traffic
    expect(sim.state.on).toBe(false);
    vi.useRealTimers();
  });
});

describe('v0.0.3 features', () => {
  it('horror has dim flicker, blackouts and lightning', () => {
    const e = { type: 'horror' as const, colors: [{ r: 255, g: 0, b: 0 }, { r: 255, g: 255, b: 255 }], speed: 55 };
    const seen = Array.from({ length: 4000 }, (_, i) => effectColorAt(e, i * 30));
    expect(seen.some((c) => c.r === 0 && c.g === 0)).toBe(true);
    expect(seen.some((c) => c.g === 255)).toBe(true);
    expect(seen.some((c) => c.r > 0 && c.r < 200 && c.g === 0)).toBe(true);
  });
  it('strobe never flashes faster than the controller can follow', () => {
    const e = { type: 'strobe' as const, colors: [{ r: 200, g: 0, b: 255 }], speed: 100 };
    let changes = 0, last = '';
    for (let t = 0; t < 3000; t += 10) { const c = JSON.stringify(effectColorAt(e, t)); if (c !== last) changes++; last = c; }
    expect(changes).toBeLessThanOrEqual(21);
  });
  it('alarm builds up, starts flashing halfway, keeps flashing after', () => {
    const total = 60 * 60_000;
    expect(alarmAt(0, total).level).toBeLessThan(0.05);
    expect(alarmAt(0.25 * total, total).on).toBe(true);
    const late = Array.from({ length: 50 }, (_, i) => alarmAt(0.9 * total + i * 100, total).on);
    expect(late).toContain(false);
    const after = Array.from({ length: 10 }, (_, i) => alarmAt(total + 1000 + i * 100, total));
    expect(after.every((a) => a.level === 1)).toBe(true);
    expect(after.map((a) => a.on)).toContain(false);
  });
  it('alarm runs until a manual action', async () => {
    vi.useFakeTimers();
    const sim = new SimulatorTransport();
    const c = new DeviceController(sim, elkDriver, { minGapMs: 0 });
    await c.connect(await c.pick());
    const eng = new GlowEngine(c);
    eng.runScheduleAction({ id: 'a', name: 'wake', enabled: true, time: '06:00', days: [1], action: { type: 'alarm', minutes: 1, color: '#ff8a30' } });
    await vi.advanceTimersByTimeAsync(120_000);
    expect(eng.snapshot().ramp?.kind).toBe('alarm');
    eng.exec({ type: 'power', on: false });
    expect(eng.snapshot().ramp).toBeNull();
    const n = sim.log.length;
    await vi.advanceTimersByTimeAsync(5000);
    expect(sim.log.length).toBe(n);
    vi.useRealTimers();
  });
  it('scene mix plays steps in order and loops', async () => {
    vi.useFakeTimers();
    const sim = new SimulatorTransport();
    const c = new DeviceController(sim, elkDriver, { minGapMs: 0 });
    await c.connect(await c.pick());
    const eng = new GlowEngine(c);
    eng.scenes = BUILTIN_SCENES;
    eng.scenes = [...BUILTIN_SCENES, { ...BUILTIN_SCENES[0], id: 'mix', steps: [{ sceneId: 'halloween', seconds: 5 }, { sceneId: 'horror', seconds: 8 }] }];
    // A mix that references another mix (Halloween) skips that step.
    eng.exec({ type: 'scene', sceneId: 'mix' });
    expect(eng.snapshot()).toMatchObject({ activeSceneId: 'mix', mixStepSceneId: 'horror' });
    // Built-in Halloween: inline looks, in order, looping.
    eng.exec({ type: 'scene', sceneId: 'halloween' });
    expect(eng.snapshot()).toMatchObject({ activeSceneId: 'halloween', mixStepSceneId: 'step:0' });
    await vi.advanceTimersByTimeAsync(18_500);
    expect(eng.snapshot().mixStepSceneId).toBe('step:1');
    expect(eng.snapshot().softwareEffect?.type).toBe('strobe');
    await vi.advanceTimersByTimeAsync(4_000);
    expect(eng.snapshot().softwareEffect?.type).toBe('horror');
    const total = BUILTIN_SCENES[0].steps!.reduce((a, st) => a + st.seconds, 0) * 1000;
    await vi.advanceTimersByTimeAsync(total - 22_000);
    expect(eng.snapshot().mixStepSceneId).toBe('step:0');
    eng.exec({ type: 'color', color: { r: 1, g: 1, b: 1 } });
    expect(eng.snapshot().mixStepSceneId).toBeNull();
    eng.effects.stop();
    vi.useRealTimers();
  });
  it('ignores nested mixes and self references, imports steps', () => {
    const look = { animation: { kind: 'software' as const, effect: 'strobe' as const }, colors: ['#ff3c00'], speed: 80, brightness: 100 };
    const mix = { ...BUILTIN_SCENES[0], id: 'm', steps: [{ sceneId: 'm', seconds: 5 }, { sceneId: 'halloween', seconds: 5 }, { sceneId: 'night', seconds: 5 }, { seconds: 3, look }] };
    expect(playableSteps(mix, [...BUILTIN_SCENES, mix]).map((s) => s.sceneId ?? 'look')).toEqual(['night', 'look']);
    const { scenes } = importScenes(exportScenes([mix]));
    expect(scenes[0].steps).toHaveLength(4);
    expect(scenes[0].steps![3].look).toEqual(look);
  });
  it('resends a colour frame the controller did not echo', async () => {
    const sim = new SimulatorTransport();
    const c = new DeviceController(sim, elkDriver, { minGapMs: 0 });
    const d = await c.pick();
    d.calibration = IDENTITY_CALIBRATION;
    await c.connect(d);
    await c.idle();
    await new Promise((r) => setTimeout(r, 10)); // first echo arrives
    sim.dropRate = 1;
    c.setColor({ r: 9, g: 8, b: 7 });
    await c.idle();
    sim.dropRate = 0;
    await new Promise((r) => setTimeout(r, 400));
    await c.idle();
    expect(c.resendCount).toBe(1);
    expect(sim.state).toMatchObject({ r: 9, g: 8, b: 7 });
  });
});
