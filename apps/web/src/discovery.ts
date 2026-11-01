import { API_PORT } from '@glowpilot/core';

/**
 * Finds GlowPilot on the local network without typing an IP address.
 * Probes the usual home subnets; a GlowPilot Hub (always-on light master) wins over a PC running
 * GlowPilot Desktop. Returns the WebSocket URL, or null.
 */
export async function discoverDesktop(onProgress?: (done: number, total: number) => void, signal?: AbortSignal): Promise<string | null> {
  const subnets = ['192.168.1', '192.168.0', '192.168.2', '192.168.178', '192.168.68', '10.0.0', '10.0.1', '172.16.0'];
  const hosts = subnets.flatMap((n) => Array.from({ length: 254 }, (_, i) => `${n}.${i + 1}`));
  let done = 0;
  let hub: string | null = null;
  let desktop: string | null = null;
  const probe = async (ip: string) => {
    if (hub || signal?.aborted) return;
    const base = `http://${ip}:${API_PORT}`;
    try {
      const r = await fetch(`${base}/api/info`, { signal: AbortSignal.timeout(1200), cache: 'no-store' });
      if (r.ok) {
        const info = await r.json();
        if (info.app === 'GlowPilot') (info.role === 'hub' ? (hub = `ws://${ip}:${API_PORT}`) : (desktop ??= `ws://${ip}:${API_PORT}`));
      } else {
        // GlowPilot Desktop ≤ 0.1.0 has no /api/info: recognise it by its manifest.
        const m = await fetch(`${base}/manifest.webmanifest`, { signal: AbortSignal.timeout(1200) });
        if (m.ok && (await m.json()).name === 'GlowPilot') desktop ??= `ws://${ip}:${API_PORT}`;
      }
    } catch {
      /* nothing there */
    } finally {
      onProgress?.(++done, hosts.length);
    }
  };
  // 64 probes at a time: a /24 subnet takes about 5 s. Keep going after a PC is found, in case there is a hub.
  for (let i = 0; i < hosts.length && !hub && !signal?.aborted; i += 64) {
    await Promise.all(hosts.slice(i, i + 64).map(probe));
    if (desktop && i >= 254) break; // searched the subnet where the PC was found: good enough
  }
  return hub ?? desktop;
}
