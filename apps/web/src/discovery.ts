import { API_PORT } from '@glowpilot/core';

/**
 * Finds GlowPilot Desktop on the local network without typing an IP address.
 * Probes the usual home subnets for the desktop's HTTP server (it only answers private addresses).
 * Returns the WebSocket URL of the first desktop found, or null.
 */
export async function discoverDesktop(onProgress?: (done: number, total: number) => void, signal?: AbortSignal): Promise<string | null> {
  const subnets = ['192.168.1', '192.168.0', '192.168.2', '192.168.178', '192.168.68', '10.0.0', '10.0.1', '172.16.0'];
  const hosts = subnets.flatMap((n) => Array.from({ length: 254 }, (_, i) => `${n}.${i + 1}`));
  let done = 0;
  let found: string | null = null;
  const probe = async (ip: string) => {
    if (found || signal?.aborted) return;
    try {
      const r = await fetch(`http://${ip}:${API_PORT}/manifest.webmanifest`, { signal: AbortSignal.timeout(1200), cache: 'no-store' });
      if (r.ok && (await r.json()).name === 'GlowPilot') found = `ws://${ip}:${API_PORT}`;
    } catch {
      /* nothing there */
    } finally {
      onProgress?.(++done, hosts.length);
    }
  };
  // 64 probes at a time: a /24 subnet takes about 5 s.
  for (let i = 0; i < hosts.length && !found && !signal?.aborted; i += 64) await Promise.all(hosts.slice(i, i + 64).map(probe));
  return found;
}
