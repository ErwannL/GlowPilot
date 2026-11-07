import { API_PORT } from '@glowpilot/core';

export interface Instance {
  url: string;
  role: 'hub' | 'desktop';
  lightsConnected: boolean;
}

const HOME_SUBNETS = ['192.168.1', '192.168.0', '192.168.2', '192.168.178', '192.168.68', '10.0.0', '10.0.1', '172.16.0'];

async function probe(ip: string): Promise<Instance | null> {
  const base = `http://${ip}:${API_PORT}`;
  try {
    const r = await fetch(`${base}/api/info`, { signal: AbortSignal.timeout(1200), cache: 'no-store' });
    if (r.ok) {
      const info = await r.json();
      if (info.app === 'GlowPilot') return { url: `ws://${ip}:${API_PORT}`, role: info.role === 'hub' ? 'hub' : 'desktop', lightsConnected: !!info.lightsConnected };
    } else {
      // GlowPilot Desktop ≤ 0.1.0 has no /api/info: recognise it by its manifest.
      const m = await fetch(`${base}/manifest.webmanifest`, { signal: AbortSignal.timeout(1200) });
      if (m.ok && (await m.json()).name === 'GlowPilot') return { url: `ws://${ip}:${API_PORT}`, role: 'desktop', lightsConnected: false };
    }
  } catch {
    /* nothing there */
  }
  return null;
}

/** Every GlowPilot (hub or PC) on the local network. `subnets` defaults to the usual home ranges. */
export async function discoverAll(subnets = HOME_SUBNETS, onProgress?: (done: number, total: number) => void, signal?: AbortSignal): Promise<Instance[]> {
  const hosts = subnets.flatMap((n) => Array.from({ length: 254 }, (_, i) => `${n}.${i + 1}`));
  const found: Instance[] = [];
  let done = 0;
  for (let i = 0; i < hosts.length && !signal?.aborted; i += 64) {
    const batch = await Promise.all(hosts.slice(i, i + 64).map(probe));
    batch.forEach((x) => x && found.push(x));
    done += Math.min(64, hosts.length - i);
    onProgress?.(done, hosts.length);
    // Stop after the subnet where something was found.
    if (found.length && (i + 64) % 254 < 64) break;
  }
  return found;
}

/** The best instance to control the lights through: the one holding them, else a hub, else a PC. */
export function pickMaster(list: Instance[]): Instance | null {
  return list.find((x) => x.lightsConnected) ?? list.find((x) => x.role === 'hub') ?? list[0] ?? null;
}

/** Finds GlowPilot on the local network without typing an IP address. Returns the WebSocket URL, or null. */
export async function discoverDesktop(onProgress?: (done: number, total: number) => void, signal?: AbortSignal): Promise<string | null> {
  return pickMaster(await discoverAll(undefined, onProgress, signal))?.url ?? null;
}

/** The /24 subnet of a ws://a.b.c.d:port URL, to rescan quickly around a known instance. */
export const subnetOf = (url: string) => /^wss?:\/\/(\d+\.\d+\.\d+)\.\d+/.exec(url)?.[1] ?? null;

/**
 * Direct Bluetooth: the light accepts one connection and goes invisible while it has one.
 * Ask every GlowPilot (hub, PC) that holds it to let go. Returns how many were asked.
 */
/** Port where GlowPilot for Android listens for "Take control" (GlowAlarmPlugin.PHONE_PORT). */
export const PHONE_PORT = 47822;

/**
 * PC: ask the phones holding the light to let go. Phones seen before first (instant), then a quick
 * sweep of the home network for any other one. Returns how many let go.
 */
export async function askPhonesToYield(): Promise<number> {
  const yieldAt = (ip: string) => fetch(`http://${ip}:${PHONE_PORT}/yield`, { method: 'POST', signal: AbortSignal.timeout(1500) }).then((r) => r.ok, () => false);
  let known: string[] = [];
  try { known = JSON.parse(localStorage.getItem('gp.phones') ?? '[]'); } catch { /* ignore */ }
  if ((await Promise.all(known.map(yieldAt))).some(Boolean)) return 1;
  const isPhone = async (ip: string) => ((await fetch(`http://${ip}:${PHONE_PORT}/info`, { signal: AbortSignal.timeout(1000) }).then((r) => r.json(), () => null)) as { role?: string } | null)?.role === 'phone';
  const found: string[] = [];
  for (const net of ['192.168.1', '192.168.0']) {
    const ips = Array.from({ length: 254 }, (_, i) => `${net}.${i + 1}`);
    for (let i = 0; i < ips.length; i += 64) {
      const batch = ips.slice(i, i + 64);
      const res = await Promise.all(batch.map(isPhone));
      batch.forEach((ip, j) => res[j] && found.push(ip));
    }
    if (found.length) break;
  }
  if (found.length) try { localStorage.setItem('gp.phones', JSON.stringify(found)); } catch { /* ignore */ }
  return (await Promise.all(found.map(yieldAt))).filter(Boolean).length;
}

export async function askOthersToYield(): Promise<number> {
  const ask = (url: string) => fetch(`${url.replace(/^ws/, 'http')}/api/yield`, { method: 'POST', signal: AbortSignal.timeout(3000) }).then(() => true, () => false);
  // The ones already known answer in a second; scanning the whole network takes ~10 s.
  const known = knownPeers();
  if (known.length) {
    const ok = (await Promise.all(known.map(ask))).filter(Boolean).length;
    if (ok) return ok;
  }
  const holders = (await findPeers()).filter((x) => x.lightsConnected);
  await Promise.all(holders.map((x) => ask(x.url)));
  return holders.length;
}

/** GlowPilots (PC, hub) seen on the home network, remembered so a phone can watch for "Take control". */
export async function findPeers(): Promise<Instance[]> {
  const list = await discoverAll(['192.168.1', '192.168.0']);
  if (list.length) try { localStorage.setItem('gp.peers', JSON.stringify(list.map((x) => x.url))); } catch { /* ignore */ }
  return list;
}

export function knownPeers(): string[] {
  try { return JSON.parse(localStorage.getItem('gp.peers') ?? '[]'); } catch { return []; }
}
