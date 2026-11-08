import { describe, expect, it } from 'vitest';
import { installDesktopStorage } from '../src/desktopStorage';

function fakeWindow(snapshot: Record<string, string> | null) {
  const writes: [string, string | null][] = [];
  const replaced: Record<string, string>[] = [];
  const win = { localStorage, glowpilotDesktop: { storage: { snapshot: () => snapshot, set: (k: string, v: string | null) => writes.push([k, v]), replace: (e: Record<string, string>) => replaced.push(e) } } };
  return { win: win as unknown as Window, writes, replaced };
}

describe('PC: saved data comes from the file the main process writes', () => {
  it('first start migrates what localStorage had into the file', () => {
    localStorage.clear();
    localStorage.setItem('gp.rules', '[1]');
    const f = fakeWindow(null);
    expect(installDesktopStorage(f.win)).toBe(true);
    expect(f.replaced).toEqual([{ 'gp.rules': '[1]' }]);
  });

  it('later starts: the file wins over a stale or empty localStorage, and every change is mirrored', () => {
    localStorage.clear();
    localStorage.setItem('gp.stale', 'x');
    const f = fakeWindow({ 'gp.look.l1': '{"sceneId":"relax"}', 'gp.rules': '[2]' });
    installDesktopStorage(f.win);
    expect(localStorage.getItem('gp.stale')).toBeNull();
    expect(localStorage.getItem('gp.look.l1')).toBe('{"sceneId":"relax"}');
    localStorage.setItem('gp.look.l1', '{"sceneId":"night"}');
    localStorage.removeItem('gp.rules');
    expect(f.writes).toEqual([['gp.look.l1', '{"sceneId":"night"}'], ['gp.rules', null]]);
  });

  it('does nothing outside GlowPilot Desktop', () => {
    expect(installDesktopStorage({ localStorage } as unknown as Window)).toBe(false);
  });
});
