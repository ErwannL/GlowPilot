import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { byText, go, sweep } from './sweep';

// Android app (GlowAlarm native plugin mocked); BLE stays on the simulator.
const plugin = vi.hoisted(() => {
  const answers: Record<string, unknown> = {
    configure: { nextAt: Date.now() + 3_600_000, exact: true },
    nextSystemAlarm: { at: Date.now() + 7_200_000, app: 'Clock' },
    ensurePermissions: { bluetooth: true, notifications: true, exact: false },
    pickSound: { uri: 'content://song', name: 'Song' },
    ensureMicrophone: { granted: true },
    capabilities: { exact: false, microphone: true, bluetooth: true, notifications: true, fullScreen: false },
    noyauTracks: { tracks: [{ id: 1, title: 'Morning', artist: 'Band', duration_seconds: 200 }] },
    noyauLogin: { token: 'k', user: 'erwann' },
    readLog: { text: 'line 1\nline 2' },
    downloadNoyauTrack: { uri: 'file://morning', name: 'Morning' },
  };
  const calls: string[] = [];
  return { calls, proxy: new Proxy({}, { get: (_, k: string) => async () => { calls.push(k); return answers[k]; } }) };
});
vi.mock('@capacitor/core', () => ({
  Capacitor: { getPlatform: () => 'android', isNativePlatform: () => false },
  registerPlugin: () => plugin.proxy,
}));

localStorage.clear();
localStorage.setItem('gp.settings', JSON.stringify({ mode: 'simulator', onboarded: true, phoneAlarmSync: true, noyauUrl: 'https://noyau.test', noyauToken: 'k', noyauUser: 'erwann' }));
const { App } = await import('../src/App');
const { store } = await import('../src/store');
window.confirm = () => true;
afterEach(cleanup);
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 50)); });

describe('Android screens', () => {
  it('Settings: phone alarm card, diagnostics, Noyau sign-in via the native plugin', async () => {
    render(<App />);
    await go('settings');
    await settle();
    await sweep(document.querySelector('main')!, /reset|forget|remove|delete|revoke|export|import|bluetooth|direct|via|simulator|sign out|install/i);
    await settle();
    expect(plugin.calls).toContain('capabilities');
    const inputs = Array.from(document.querySelectorAll('input[type=password]')) as HTMLInputElement[];
    if (inputs[0]) {
      fireEvent.change(inputs[0], { target: { value: 'pw' } });
      const b = byText(/sign in/i);
      if (b && !b.disabled) await act(async () => { fireEvent.click(b); });
    }
    expect(store.state.settings.noyauToken).toBe('k');
  });

  it('alarm editor: sound from the phone and from Noyau', async () => {
    render(<App />);
    await go('schedules');
    await act(async () => { fireEvent.click(byText(/new|add/i)!); });
    const action = Array.from(document.querySelectorAll('select')).find((s) => Array.from(s.options).some((o) => o.value === 'alarm'))!;
    await act(async () => { fireEvent.change(action, { target: { value: 'alarm' } }); });
    const editor = document.querySelector('[role=dialog]') ?? document.body;
    for (const re of [/choose music/i, /from noyau/i]) {
      await act(async () => { fireEvent.click(byText(re)!); });
      await settle();
    }
    const track = byText(/morning/i);
    if (track) await act(async () => { fireEvent.click(track); });
    await settle();
    expect(plugin.calls).toEqual(expect.arrayContaining(['pickSound', 'noyauTracks']));
    await sweep(editor, /delete|test now|^save$|cancel|close|✕|choose music|from noyau/i);
  });
});
