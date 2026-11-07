import { describe, expect, it, vi } from 'vitest';
import { routeFetch } from './setup';

const PC = 'ws://192.168.1.5:47821';
localStorage.clear();
localStorage.setItem('gp.settings', JSON.stringify({ mode: 'local', onboarded: true, remoteUrl: PC, remoteTokens: { [PC]: 'tok' } }));
localStorage.setItem('gp.devices', JSON.stringify([{ id: 'BE:27:DA:00:7C:83', name: 'ELK-BLEDDM', driverId: 'elk' }]));
localStorage.setItem('gp.peers', JSON.stringify([PC]));
vi.useFakeTimers({ toFake: ['setInterval', 'setTimeout', 'Date'] });
const { store } = await import('../src/store');

describe('Direct Bluetooth: phone and PC never steal the light from each other', () => {
  it('starts with the saved light, not connected, and nothing asked to yield', () => {
    expect(store.state.mode).toBe('local');
    expect(store.state.lights).toHaveLength(1);
    expect(store.state.lights[0].status).toBe('disconnected');
    expect(store.state.claimAt).toBe(0);
  });

  it('"Take control" tells the paired PC, asks holders to yield, then connects', async () => {
    const calls = routeFetch({
      '/api/message': () => ({ ok: true }),
      '192.168.1.5:47821/api/info': () => ({ app: 'GlowPilot', role: 'desktop', lightsConnected: true }),
      '/api/yield': () => ({}),
    });
    const connect = vi.spyOn(store.lights[0].controller, 'connect').mockResolvedValue(undefined as never);
    await store.takeControl();
    expect(store.state.claimAt).toBe(Date.now());
    expect(store.state.lostTo).toBeNull();
    const msg = calls.find((c) => c.url === 'http://192.168.1.5:47821/api/message')!;
    expect(JSON.parse(String(msg.init!.body))).toEqual({ t: 'requestOwnership' });
    expect((msg.init!.headers as Record<string, string>).authorization).toBe('Bearer tok');
    expect(calls.some((c) => c.url.endsWith('/api/yield'))).toBe(true);
    expect(connect).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2600);
    expect(connect).toHaveBeenCalledTimes(1);
  });

  it('watchClaims: lets go when the PC was told "Take control" after this phone connected', async () => {
    const light = store.lights[0];
    const disconnect = vi.spyOn(light.controller, 'disconnect').mockResolvedValue(undefined as never);
    let claimAgoMs: number | null = null;
    routeFetch({ '/api/info': () => ({ app: 'GlowPilot', role: 'desktop', lightsConnected: false, claimAgoMs }) });
    light.status = 'connected';
    (store as unknown as { refresh: () => void }).refresh();
    await vi.advanceTimersByTimeAsync(10_000); // first check: starts the "held since" clock
    await vi.advanceTimersByTimeAsync(10_000); // no claim yet
    expect(disconnect).not.toHaveBeenCalled();
    claimAgoMs = 600_000; // an old claim, from before this phone connected: ignored
    await vi.advanceTimersByTimeAsync(10_000);
    expect(disconnect).not.toHaveBeenCalled();
    claimAgoMs = 3_000; // pressed on the PC 3 s ago
    await vi.advanceTimersByTimeAsync(10_000);
    expect(disconnect).toHaveBeenCalled();
    expect(store.state.lostTo).toBe('your PC');
  });

  it('a hub claim names the hub; nothing is checked while the light is not held', async () => {
    const light = store.lights[0];
    vi.spyOn(light.controller, 'disconnect').mockResolvedValue(undefined as never);
    const calls = routeFetch({ '/api/info': () => ({ app: 'GlowPilot', role: 'hub', claimAgoMs: 1000 }) });
    light.status = 'disconnected';
    (store as unknown as { refresh: () => void }).refresh();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(calls.filter((c) => c.url.endsWith('/api/info') && c.url.includes('192.168.1.5'))).toHaveLength(0);
    light.status = 'connected';
    (store as unknown as { refresh: () => void }).refresh();
    await vi.advanceTimersByTimeAsync(10_000);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(store.state.lostTo).toBe('the hub');
  });

  it('switching to the PC hands the light back', async () => {
    const calls = routeFetch({ '/api/message': () => ({ ok: true }) });
    store.setupMode('remote');
    await vi.advanceTimersByTimeAsync(10);
    const m = calls.find((c) => c.url.endsWith('/api/message'));
    expect(JSON.parse(String(m!.init!.body))).toEqual({ t: 'releaseOwnership' });
    expect(store.state.mode).toBe('remote');
  });
});
