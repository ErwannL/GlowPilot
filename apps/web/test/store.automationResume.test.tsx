import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Real case (08/11): Timberborn running, rule "Timberborn → Relax". The user picked yellow by hand,
// automation paused 30 min… and Relax never came back, not even with "Resume".
type Cb = (...a: unknown[]) => void;
const h: Record<string, Cb> = {};
const on = (k: string) => vi.fn((cb: Cb) => { h[k] = cb; });
const bridge = {
  onActivity: on('activity'), onBluetoothDevices: vi.fn(), onRemoteCommand: vi.fn(), onTogglePause: vi.fn(), onPower: vi.fn(),
  onPrepareQuit: vi.fn(), onUpdate: vi.fn(), selectBluetoothDevice: vi.fn(), autoSelect: vi.fn(), requestAutoconnect: vi.fn(),
  setTrustedDevice: vi.fn(), publishState: vi.fn(), setWakeTasks: vi.fn(), setKeepAwake: vi.fn(), setPausedInTray: vi.fn(),
};
(window as unknown as { glowpilotDesktop: typeof bridge }).glowpilotDesktop = bridge;
localStorage.clear();
localStorage.setItem('gp.settings', JSON.stringify({ mode: 'simulator', onboarded: true, automationEnabled: true, overrideMinutes: 30 }));
localStorage.setItem('gp.rules', JSON.stringify([
  { id: 'tb', name: 'Timberborn', enabled: true, process: 'Timberborn.exe', trigger: 'running', sceneId: 'relax', priority: 80, cooldownSec: 10, restorePrevious: true },
]));
const { store } = await import('../src/store');
const { Dashboard } = await import('../src/pages/Dashboard');
afterEach(cleanup);
const until = async (f: () => boolean) => { for (let i = 0; i < 100 && !f(); i++) await new Promise((r) => setTimeout(r, 10)); expect(f()).toBe(true); };
const playing = { foreground: 'timberborn.exe', processes: ['timberborn.exe', 'explorer.exe'] };
const scene = () => store.lights[0].engine.activeSceneId;

describe('automation after a manual change', () => {
  it('the game starts: Relax', async () => {
    await until(() => store.state.lights[0]?.status === 'connected');
    h.activity(playing);
    expect(scene()).toBe('relax');
  });

  it('picking yellow by hand pauses automation, and Home says so', async () => {
    store.exec({ type: 'color', color: { r: 255, g: 246, b: 40 } });
    h.activity(playing);
    expect(scene()).toBeNull();
    expect(store.automation.overrideUntil).toBeGreaterThan(Date.now());
    render(<Dashboard />);
    expect(screen.getByTestId('automation-paused').textContent).toContain('Paused by your manual change');
  });

  it('"Resume" brings Relax back right away while the game is still running', async () => {
    render(<Dashboard />);
    await act(async () => { fireEvent.click(screen.getByText('Resume')); });
    h.activity(playing);
    expect(scene()).toBe('relax');
  });

  it('without Resume, Relax comes back by itself when the 30 min pause is over', async () => {
    store.exec({ type: 'color', color: { r: 255, g: 246, b: 40 } });
    h.activity(playing);
    expect(scene()).toBeNull();
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now + 31 * 60_000);
    h.activity(playing);
    expect(scene()).toBe('relax');
    vi.restoreAllMocks();
  });
});
