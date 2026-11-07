import { describe, expect, it, vi } from 'vitest';

// The case that failed in real life: the phone holds the light, "Take control" is pressed on the PC.
// The PC must reach the phone directly (port 47822, native listener) and the phone must let go.

const native = vi.hoisted(() => {
  const listeners: Record<string, (e: { from: string }) => void> = {};
  const holding: boolean[] = [];
  const proxy = new Proxy({}, {
    get: (_, k: string) => {
      if (k === 'addListener') return async (ev: string, cb: (e: { from: string }) => void) => { listeners[ev] = cb; return { remove: async () => {} }; };
      if (k === 'setHolding') return async (o: { holding: boolean }) => { holding.push(o.holding); };
      return async () => ({});
    },
  });
  return { listeners, holding, proxy };
});
vi.mock('@capacitor/core', () => ({
  Capacitor: { getPlatform: () => 'android', isNativePlatform: () => false },
  registerPlugin: () => native.proxy,
}));

localStorage.clear();
localStorage.setItem('gp.settings', JSON.stringify({ mode: 'local', onboarded: true }));
localStorage.setItem('gp.devices', JSON.stringify([{ id: 'BE:27:DA:00:7C:83', name: 'ELK-BLEDDM', driverId: 'elk' }]));
const { store } = await import('../src/store');
const { askPhonesToYield, PHONE_PORT } = await import('../src/discovery');

describe('Take control on the PC while the phone holds the light', () => {
  it('phone: tells Android it holds the light, and lets go as soon as the PC asks', async () => {
    const light = store.lights[0];
    const disconnect = vi.spyOn(light.controller, 'disconnect').mockResolvedValue();
    light.status = 'connected';
    (store as unknown as { refresh: () => void }).refresh();
    await new Promise((r) => setTimeout(r, 0));
    expect(native.holding.at(-1)).toBe(true);
    expect(native.listeners.yield).toBeTypeOf('function');

    native.listeners.yield({ from: '192.168.1.21' });
    expect(disconnect).toHaveBeenCalled();
    expect(store.state.lostTo).toBe('your PC');
  });

  it('phone: ignores a request when it does not hold the light', () => {
    const light = store.lights[0];
    light.status = 'disconnected';
    store.state.lostTo = null;
    const disconnect = vi.spyOn(light.controller, 'disconnect').mockClear();
    native.listeners.yield({ from: '192.168.1.21' });
    expect(disconnect).not.toHaveBeenCalled();
    expect(store.state.lostTo).toBeNull();
  });

  it('PC: asks a phone seen before right away, without scanning the network', async () => {
    localStorage.setItem('gp.phones', JSON.stringify(['192.168.1.40']));
    const urls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (u: string) => { urls.push(u); return { ok: true, json: async () => ({}) }; }));
    expect(await askPhonesToYield()).toBe(1);
    expect(urls).toEqual([`http://192.168.1.40:${PHONE_PORT}/yield`]);
  });

  it('PC: finds the phone on the network, remembers it and asks it to let go', async () => {
    localStorage.removeItem('gp.phones');
    const urls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (u: string) => {
      urls.push(u);
      if (!u.includes('192.168.1.77')) throw new Error('nothing there');
      return { ok: true, json: async () => ({ app: 'GlowPilot', role: 'phone', lightsConnected: true }) };
    }));
    expect(await askPhonesToYield()).toBe(1);
    expect(urls).toContain(`http://192.168.1.77:${PHONE_PORT}/yield`);
    expect(JSON.parse(localStorage.getItem('gp.phones')!)).toEqual(['192.168.1.77']);
  });
});
