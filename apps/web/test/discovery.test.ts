import { describe, expect, it } from 'vitest';
import { askOthersToYield, discoverAll, discoverDesktop, findPeers, knownPeers, pickMaster, subnetOf } from '../src/discovery';
import { routeFetch } from './setup';

describe('discovery', () => {
  it('picks the instance holding the lights, else a hub, else the first', () => {
    const pc = { url: 'ws://a', role: 'desktop' as const, lightsConnected: false };
    const hub = { url: 'ws://b', role: 'hub' as const, lightsConnected: false };
    const holder = { url: 'ws://c', role: 'desktop' as const, lightsConnected: true };
    expect(pickMaster([pc, hub, holder])).toBe(holder);
    expect(pickMaster([pc, hub])).toBe(hub);
    expect(pickMaster([pc])).toBe(pc);
    expect(pickMaster([])).toBeNull();
    expect(subnetOf('ws://192.168.1.20:47821')).toBe('192.168.1');
    expect(subnetOf('nope')).toBeNull();
  });

  it('finds hubs, PCs and old PCs (manifest only) on the network', async () => {
    routeFetch({
      '192.168.1.10:47821/api/info': () => ({ app: 'GlowPilot', role: 'hub', lightsConnected: true }),
      '192.168.1.11:47821/api/info': () => new Response('', { status: 404 }),
      '192.168.1.11:47821/manifest': () => ({ name: 'GlowPilot' }),
      '192.168.1.12:47821/api/info': () => ({ app: 'Other' }),
    });
    const progress: number[] = [];
    const list = await discoverAll(['192.168.1'], (d) => progress.push(d));
    expect(list).toEqual([
      { url: 'ws://192.168.1.10:47821', role: 'hub', lightsConnected: true },
      { url: 'ws://192.168.1.11:47821', role: 'desktop', lightsConnected: false },
    ]);
    expect(progress.at(-1)).toBe(254);
    expect(await discoverDesktop()).toBe('ws://192.168.1.10:47821');
  });

  it('asks the holders to yield and remembers peers', async () => {
    localStorage.removeItem('gp.peers');
    expect(knownPeers()).toEqual([]);
    const calls = routeFetch({
      '192.168.0.7:47821/api/info': () => ({ app: 'GlowPilot', role: 'desktop', lightsConnected: true }),
      '/api/yield': () => ({}),
    });
    expect(await askOthersToYield()).toBe(1);
    expect(calls.some((c) => c.url === 'http://192.168.0.7:47821/api/yield' && c.init?.method === 'POST')).toBe(true);
    expect(knownPeers()).toEqual(['ws://192.168.0.7:47821']);
    localStorage.setItem('gp.peers', '{bad');
    expect(knownPeers()).toEqual([]);
    routeFetch({});
    expect(await findPeers()).toEqual([]);
  });
});
