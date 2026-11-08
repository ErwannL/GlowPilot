import { describe, expect, it, vi } from 'vitest';

// PC case: GlowPilot starts hidden in the tray (Windows startup, after an update). The saved scene must
// come back anyway; the "don't relight unseen" rule is for a phone in a pocket.
const bridge = {
  onActivity: vi.fn(), onBluetoothDevices: vi.fn(), onRemoteCommand: vi.fn(), onTogglePause: vi.fn(), onPower: vi.fn(),
  onPrepareQuit: vi.fn(), onUpdate: vi.fn(), selectBluetoothDevice: vi.fn(), autoSelect: vi.fn(), requestAutoconnect: vi.fn(),
  setTrustedDevice: vi.fn(), publishState: vi.fn(), setWakeTasks: vi.fn(), setKeepAwake: vi.fn(), setPausedInTray: vi.fn(),
};
(window as unknown as { glowpilotDesktop: typeof bridge }).glowpilotDesktop = bridge;
Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
localStorage.clear();
localStorage.setItem('gp.settings', JSON.stringify({ mode: 'simulator', onboarded: true }));
localStorage.setItem('gp.look.SIM:00:00:00:00:01', JSON.stringify({ sceneId: 'relax', effect: null, ramp: null }));
const { store } = await import('../src/store');

describe('PC started hidden in the tray', () => {
  it('brings the saved scene back once the light connects', async () => {
    for (let i = 0; i < 100 && store.state.lights[0]?.status !== 'connected'; i++) await new Promise((r) => setTimeout(r, 10));
    expect(store.lights[0].engine.activeSceneId).toBe('relax');
  });
});
