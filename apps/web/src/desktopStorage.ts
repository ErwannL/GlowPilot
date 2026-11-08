/**
 * GlowPilot Desktop: the saved data lives in a file written by the main process (apps/desktop/src/stateFile.cjs),
 * not only in Chromium's localStorage, which commits ~30 s late and on one PC stopped saving at all.
 * Imported first in main.tsx: before anything reads localStorage, it is filled from that file, and every
 * later change is mirrored to it. Nothing changes in the browser or on Android.
 */
interface DesktopStorage {
  snapshot(): Record<string, string> | null;
  set(key: string, value: string | null): void;
  replace(entries: Record<string, string>): void;
}

export function installDesktopStorage(win: Window = window): boolean {
  const bridge = (win as unknown as { glowpilotDesktop?: { storage?: DesktopStorage } }).glowpilotDesktop?.storage;
  if (!bridge) return false;
  const ls = win.localStorage;
  const proto = Object.getPrototypeOf(ls) as Storage;
  const setItem = proto.setItem, removeItem = proto.removeItem, clear = proto.clear;

  const snap = bridge.snapshot();
  if (snap) {
    // The file is the truth: replace whatever Chromium kept (possibly old or empty).
    clear.call(ls);
    for (const [k, v] of Object.entries(snap)) setItem.call(ls, k, v);
  } else {
    // First start with this version: move the existing data into the file.
    const all: Record<string, string> = {};
    for (let i = 0; i < ls.length; i++) { const k = ls.key(i)!; all[k] = ls.getItem(k)!; }
    bridge.replace(all);
  }

  proto.setItem = function (this: Storage, k: string, v: string) {
    setItem.call(this, k, v);
    if (this === ls) bridge.set(k, String(v));
  };
  proto.removeItem = function (this: Storage, k: string) {
    removeItem.call(this, k);
    if (this === ls) bridge.set(k, null);
  };
  proto.clear = function (this: Storage) {
    clear.call(this);
    if (this === ls) bridge.replace({});
  };
  return true;
}
