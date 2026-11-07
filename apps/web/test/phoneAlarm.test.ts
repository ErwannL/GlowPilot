import { describe, expect, it, vi } from 'vitest';
import type { Schedule } from '@glowpilot/core';

const native = vi.hoisted(() => ({ platform: 'web', configure: vi.fn(async () => ({ nextAt: 5, exact: true })), ensurePermissions: vi.fn(async () => ({})), appendLog: vi.fn(async () => {}) }));
vi.mock('@capacitor/core', () => ({
  Capacitor: { getPlatform: () => native.platform, isNativePlatform: () => native.platform !== 'web' },
  registerPlugin: () => native,
}));

import { alarmsForPhone, phoneAlarmsAvailable, phoneLog, syncPhoneAlarms, type PhoneAlarmConfig } from '../src/phoneAlarm';

const s = (o: Partial<Schedule>): Schedule => ({ id: 'a', name: 'A', enabled: true, time: '07:00', days: [1], action: { type: 'alarm', minutes: 10, color: '#ff0000' }, ...o });

describe('alarmsForPhone', () => {
  it('keeps enabled alarms and sunrises, skips the synced phone alarm and other actions', () => {
    const out = alarmsForPhone([
      s({ id: 'alarm' }),
      s({ id: 'off', enabled: false }),
      s({ id: 'phone-alarm' }),
      s({ id: 'on', action: { type: 'on' } }),
      s({ id: 'once', onceAt: 123 }),
    ]);
    expect(out.map((a) => a.id)).toEqual(['alarm', 'once']);
    expect(out[0]).toMatchObject({ time: '07:00', days: [1], minutes: 10, color: '#ff0000' });
    expect(out[1].onceAt).toBe(123);
  });
  it('a sunrise starts earlier, silent and steady, and shifts the day across midnight', () => {
    const [a] = alarmsForPhone([s({ time: '00:10', days: [1, 0], action: { type: 'sunrise', minutes: 30, brightness: 80, color: '#ffaa00' } })]);
    expect(a).toMatchObject({ time: '23:40', days: [0, 6], sound: null, rhythm: 'blink', accelerate: false, flashDuringBuildup: false });
  });
});

describe('native sync', () => {
  const cfg: PhoneAlarmConfig = { alarms: [], addresses: [], names: [], desktopUrl: '', token: '', syncPhoneAlarm: true, minutesBefore: 20, color: '#fff', endBrightness: 70, flash: false, sleep: null };
  it('does nothing in a browser', async () => {
    expect(phoneAlarmsAvailable()).toBe(false);
    expect(await syncPhoneAlarms(cfg)).toBeNull();
    phoneLog('x');
    expect(native.appendLog).not.toHaveBeenCalled();
  });
  it('on Android asks permissions once, then only calls native when something changed', async () => {
    native.platform = 'android';
    localStorage.removeItem('gp.alarmPermsAsked');
    expect(await syncPhoneAlarms(cfg)).toEqual({ nextAt: 5, exact: true });
    expect(native.ensurePermissions).toHaveBeenCalledTimes(1);
    expect(await syncPhoneAlarms(cfg)).toBeNull();
    await syncPhoneAlarms({ ...cfg, minutesBefore: 30 });
    expect(native.ensurePermissions).toHaveBeenCalledTimes(1);
    expect(native.configure).toHaveBeenCalledTimes(2);
    phoneLog('hello');
    expect(native.appendLog).toHaveBeenCalledWith({ line: 'hello' });
    native.platform = 'web';
  });
});
