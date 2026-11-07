import { afterEach, vi } from 'vitest';

// No network in tests: every request fails unless a test routes it.
globalThis.fetch = vi.fn(async () => { throw new Error('offline'); }) as typeof fetch;
window.scrollTo = () => {};
window.matchMedia ??= ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false })) as typeof window.matchMedia;
HTMLElement.prototype.scrollIntoView ??= () => {};
// jsdom has no canvas: a 2D context that records nothing (the colour wheel draws into it).
HTMLCanvasElement.prototype.getContext = (() => new Proxy({}, {
  get: (_, k) => (k === 'createImageData' || k === 'getImageData' ? (w = 1, h = 1) => ({ data: new Uint8ClampedArray(Number(w) * Number(h) * 4 || 4), width: w, height: h }) : () => {}),
  set: () => true,
})) as unknown as typeof HTMLCanvasElement.prototype.getContext;

afterEach(() => {
  vi.mocked(globalThis.fetch).mockReset();
  vi.mocked(globalThis.fetch).mockImplementation(async () => { throw new Error('offline'); });
});

/** Route fetch by URL substring; unmatched URLs fail like an unreachable host. */
export function routeFetch(routes: Record<string, (init?: RequestInit) => unknown>) {
  const calls: { url: string; init?: RequestInit }[] = [];
  vi.mocked(globalThis.fetch).mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    const hit = Object.keys(routes).find((k) => url.includes(k));
    if (!hit) throw new Error('offline');
    const v = routes[hit](init);
    if (v instanceof Response) return v;
    return new Response(JSON.stringify(v ?? {}), { status: 200, headers: { 'content-type': 'application/json' } });
  });
  return calls;
}
