import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BUILTIN_SCENES, DEFAULT_STATE } from '@glowpilot/core';

class FakeWS {
  static OPEN = 1;
  static last: FakeWS;
  readyState = 0;
  sent: Record<string, unknown>[] = [];
  onopen?: () => void;
  onmessage?: (e: { data: string }) => void;
  onclose?: () => void;
  constructor(public url: string) { FakeWS.last = this; }
  send(d: string) { this.sent.push(JSON.parse(d)); }
  close() { this.readyState = 3; this.onclose?.(); }
  open() { this.readyState = 1; this.onopen?.(); }
  recv(m: object) { this.onmessage?.({ data: JSON.stringify(m) }); }
}
vi.stubGlobal('WebSocket', FakeWS);

const HUB = 'ws://192.168.1.2:47821';
localStorage.clear();
localStorage.setItem('gp.settings', JSON.stringify({ mode: 'remote', onboarded: true, remoteUrl: HUB, remoteTokens: {} }));
const { store } = await import('../src/store');
const { App, PAGES } = await import('../src/App');
window.confirm = () => true;
afterEach(cleanup);

/** Back on a fresh, authenticated hub link (the page sweep may switch modes). */
function online() {
  store.updateSettings({ remoteUrl: HUB, remoteTokens: { [HUB]: 'T' } });
  store.setupMode('remote');
  const ws = FakeWS.last;
  ws.open();
  ws.recv({ t: 'authed' });
  ws.recv({ t: 'state', state: hubState });
  return ws;
}

const snapshot = { light: { ...DEFAULT_STATE }, activeSceneId: null, softwareEffect: null, sleepTimerEndsAt: null, ramp: null, activeRule: null, mixStepSceneId: null };
const hubState = {
  snapshot, status: 'connected', deviceName: 'ELK-BLEDDM', scenes: BUILTIN_SCENES, rules: [], schedules: [], foreground: null, owner: 'hub',
  lights: [{ id: 'l1', name: 'Bed', deviceName: 'ELK-BLEDDM', status: 'connected' }],
  groups: [{ id: 'g', name: 'Bedroom', icon: '*', deviceIds: ['l1'] }],
  lightNames: ['ELK-BLEDDM'], lightAddresses: ['BE:27:DA:00:7C:83'],
  hub: true, scan: [{ id: 'new', name: 'ELK-BLEDOM', rssi: -60 }], scanning: false,
  noyau: { url: 'https://noyau.test', musicSync: true, colors: ['#ff0000'], target: 'all', hasToken: true, status: 'listening', playing: true },
};

describe('remote mode (hub over WebSocket)', () => {
  it('pairs, authenticates and mirrors the hub state', () => {
    const ws = FakeWS.last;
    expect(ws.url).toBe(HUB);
    ws.open();
    expect(store.state.remote.state).toBe('needsPairing');
    store.pair(' 123456 ');
    expect(ws.sent.at(-1)).toMatchObject({ t: 'pair', code: '123456' });
    ws.recv({ t: 'paired', token: 'T' });
    expect(store.tokenFor(HUB)).toBe('T');
    expect(ws.sent.at(-1)).toEqual({ t: 'auth', token: 'T' });
    ws.recv({ t: 'authed' });
    expect(store.state.remote.state).toBe('connected');
    ws.recv({ t: 'state', state: hubState });
    expect(store.state.hub).toBe(true);
    expect(store.state.lights[0].device.alias).toBe('Bed');
    expect(store.state.hubNoyau?.playing).toBe(true);
  });

  it('every page renders against the hub and sends its commands over the socket', async () => {
    const ws = FakeWS.last;
    for (const p of PAGES) {
      render(<App />);
      await act(async () => { location.hash = p.id; window.dispatchEvent(new HashChangeEvent('hashchange')); });
      for (const b of Array.from(document.querySelectorAll('main button')) as HTMLButtonElement[]) {
        if (!b.isConnected || b.disabled || /reset|forget|remove|delete|revoke|export|import|disconnect|pair/i.test(b.textContent ?? '')) continue;
        await act(async () => { fireEvent.click(b); });
      }
      cleanup();
    }
    expect(ws.sent.length).toBeGreaterThan(5);
  });

  it('hub-only actions go to the hub', () => {
    const ws = online();
    store.hubScanLights();
    expect(store.state.hubScanning).toBe(true);
    store.hubAddLight('new', 'ELK');
    store.connectLight('l1');
    store.renameLight('l1', 'Desk');
    store.removeLight('l1');
    store.saveHubNoyau({ musicSync: false });
    const types = ws.sent.map((m) => m.t);
    for (const t of ['scanLights', 'addLight', 'connectLight', 'renameLight', 'removeLight', 'saveNoyau']) expect(types).toContain(t);
  });

  it('a revoked token asks to pair again; a lost link retries', async () => {
    const ws = online();
    vi.useFakeTimers();
    ws.recv({ t: 'denied', reason: 'Unknown token' });
    expect(store.state.remote).toEqual({ state: 'needsPairing', message: 'Unknown token' });
    expect(store.tokenFor(HUB)).toBeNull();
    ws.recv({ t: 'authed' });
    ws.onclose?.();
    expect(store.state.remote.state).toBe('error');
    vi.advanceTimersByTime(4000);
    expect(FakeWS.last).not.toBe(ws);
    vi.useRealTimers();
  });

  it('Take control in remote mode asks the hub', () => {
    const ws = online();
    void store.takeControl();
    expect(ws.sent.at(-1)).toEqual({ t: 'requestOwnership' });
    vi.useFakeTimers();
    store.takeOverFromDesktop();
    vi.advanceTimersByTime(900);
    expect(store.state.mode).toBe('local');
    vi.useRealTimers();
  });

  it('without an address it says where to find it', () => {
    store.updateSettings({ remoteUrl: '' });
    store.setupMode('remote');
    expect(store.state.remote.state).toBe('error');
  });
});
