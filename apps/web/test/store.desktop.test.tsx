import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

type Cb<T extends unknown[]> = (...a: T) => void;
const h: Record<string, Cb<never[]>> = {};
const on = (k: string) => vi.fn((cb: Cb<never[]>) => { h[k] = cb; });
const bridge = {
  onActivity: on('activity'), onBluetoothDevices: on('bt'), onRemoteCommand: on('remote'), onTogglePause: on('pause'), onPower: on('power'),
  onPrepareQuit: on('quit'), onUpdate: on('update'),
  selectBluetoothDevice: vi.fn(), autoSelect: vi.fn(), requestAutoconnect: vi.fn(), setTrustedDevice: vi.fn(), publishState: vi.fn(),
  getPairing: vi.fn(async () => ({ code: '123456', addresses: ['192.168.1.5'], port: 47821, clients: ['Phone'] })), revokeClients: vi.fn(async () => {}),
  setLaunchAtLogin: vi.fn(), launchAtLogin: vi.fn(async () => true), setPausedInTray: vi.fn(), setWakeTasks: vi.fn(), setKeepAwake: vi.fn(),
  installUpdate: vi.fn(), checkForUpdates: vi.fn(), updateStatus: vi.fn(async () => ({ state: 'idle' as const })), steamGames: vi.fn(async () => [{ appid: '1', name: 'Game', exes: ['game.exe'] }]),
};
(window as unknown as { glowpilotDesktop: typeof bridge }).glowpilotDesktop = bridge;
localStorage.clear();
localStorage.setItem('gp.settings', JSON.stringify({ mode: 'simulator', onboarded: true, automationEnabled: true }));
const { store } = await import('../src/store');
const { App } = await import('../src/App');
const call = (k: string, ...a: unknown[]) => (h[k] as unknown as Cb<unknown[]>)(...a);
const until = async (f: () => boolean) => { for (let i = 0; i < 100 && !f(); i++) await new Promise((r) => setTimeout(r, 10)); expect(f()).toBe(true); };

describe('GlowPilot Desktop bridge', () => {
  it('publishes state to the local API with claimAt', async () => {
    await until(() => store.state.lights[0]?.status === 'connected');
    await until(() => bridge.publishState.mock.calls.length > 0);
    expect(bridge.publishState.mock.calls.at(-1)![0]).toMatchObject({ owner: 'desktop', claimAt: 0, lightNames: ['ELK-BLEDDM (simulated 1)'] });
  });

  it('phone alarm from the phone becomes a one-shot schedule, and null removes it', () => {
    call('remote', 'Pixel', { t: 'phoneAlarm', at: Date.now() + 3_600_000, minutes: 30, color: '#ff0000', endBrightness: 60, flash: false });
    const s = store.state.schedules.find((x) => x.id === 'phone-alarm')!;
    expect(s.name).toBe('Phone alarm (Pixel)');
    expect(s.action).toMatchObject({ type: 'alarm', rhythm: 'steady', endBrightness: 60, flashDuringBuildup: false });
    call('remote', 'Pixel', { t: 'phoneAlarm', at: null, minutes: 30, color: '#ff0000' });
    expect(store.state.schedules.some((x) => x.id === 'phone-alarm')).toBe(false);
  });

  it('a phone asking for the light makes the PC let go and show "On your phone"; releasing gives it back', async () => {
    call('remote', 'phone 192.168.1.20', { t: 'requestOwnership' });
    expect(store.state.lostTo).toBe('your phone');
    expect(store.state.owner).toBe('phone 192.168.1.20');
    call('remote', 'phone 192.168.1.20', { t: 'releaseOwnership' });
    expect(store.state.owner).toBe('desktop');
    await store.takeControl();
    expect(store.state.lostTo).toBeNull();
    expect(store.state.claimAt).toBeGreaterThan(0);
  });

  it('forwards commands, scenes, rules, schedules and alarm stop', () => {
    call('remote', 'Noyau', { t: 'command', cmd: { type: 'brightness', level: 33 } });
    expect(store.state.snapshot.light.brightness).toBe(33);
    call('remote', 'Noyau', { t: 'saveScenes', scenes: store.state.scenes });
    call('remote', 'Noyau', { t: 'saveRules', rules: [] });
    call('remote', 'Noyau', { t: 'saveSchedules', schedules: [] });
    call('remote', 'Noyau', { t: 'alarmStop' });
  });

  it('automation activates the rule scene for the foreground app and restores the previous scene', () => {
    const scene = store.state.scenes.find((x) => !x.steps?.length)!;
    store.saveRules([{ id: 'r', name: 'Game', enabled: true, process: 'game.exe', trigger: 'foreground', sceneId: scene.id, priority: 1 } as never]);
    call('activity', { foreground: 'game.exe', running: ['game.exe'] });
    expect(store.lights[0].engine.activeRule).toBe('r');
    expect(store.lights[0].engine.activeSceneId).toBe(scene.id);
    call('activity', { foreground: 'explorer.exe', running: [] });
    expect(store.lights[0].engine.activeRule).toBeNull();
  });

  it('tray pause, sleep/resume, quit, chooser and update banner', async () => {
    call('pause');
    expect(store.state.paused?.reason).toBe('manual');
    expect(bridge.setPausedInTray).toHaveBeenLastCalledWith(true);
    call('pause');
    vi.useFakeTimers();
    call('power', 'suspend');
    call('power', 'resume');
    vi.advanceTimersByTime(2600);
    vi.useRealTimers();
    await (h.quit as unknown as () => Promise<void>)();
    call('bt', [{ id: 'AA', name: 'ELK' }]);
    store.chooseBluetooth('AA');
    expect(bridge.selectBluetoothDevice).toHaveBeenCalledWith('AA');
    for (const update of [{ state: 'downloading', version: '9.9.9', percent: 40 }, { state: 'ready', version: '9.9.9' }, { state: 'error', message: 'x' }, { state: 'checking' }, { state: 'none' }]) {
      call('update', update);
      render(<App />);
      for (const b of Array.from(document.querySelectorAll('button'))) if (/install|restart|check|later|dismiss|retry/i.test(b.textContent ?? '')) await act(async () => { fireEvent.click(b); });
      cleanup();
    }
    expect(bridge.installUpdate.mock.calls.length + bridge.checkForUpdates.mock.calls.length).toBeGreaterThan(0);
  });

  it('Settings and Automation pages use the desktop features', async () => {
    window.confirm = () => true;
    for (const page of ['settings', 'automation', 'devices']) {
      render(<App />);
      await act(async () => { location.hash = page; window.dispatchEvent(new HashChangeEvent('hashchange')); });
      await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
      for (const b of Array.from(document.querySelectorAll('main button')) as HTMLButtonElement[]) {
        if (!b.isConnected || b.disabled || /reset|forget|remove|delete|export|import|bluetooth|direct|via|simulator/i.test(b.textContent ?? '')) continue;
        await act(async () => { fireEvent.click(b); });
      }
      for (const i of Array.from(document.querySelectorAll('main input[type=checkbox]')) as HTMLInputElement[]) await act(async () => { fireEvent.click(i); });
      cleanup();
    }
    expect(bridge.getPairing).toHaveBeenCalled();
  });
});
