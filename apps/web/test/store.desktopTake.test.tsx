import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// GlowPilot Desktop in Direct Bluetooth with a controller picked earlier (chooserId). Chromium never
// remembers it across launches, so connecting by id fails and the PC must search for it on its own.
const bridge = {
  onActivity: vi.fn(), onBluetoothDevices: vi.fn(), onRemoteCommand: vi.fn(), onTogglePause: vi.fn(), onPower: vi.fn(),
  onPrepareQuit: vi.fn(), onUpdate: vi.fn(), selectBluetoothDevice: vi.fn(), autoSelect: vi.fn(), requestAutoconnect: vi.fn(),
  setTrustedDevice: vi.fn(), publishState: vi.fn(), setWakeTasks: vi.fn(), setKeepAwake: vi.fn(), setPausedInTray: vi.fn(),
};
(window as unknown as { glowpilotDesktop: typeof bridge }).glowpilotDesktop = bridge;
Object.defineProperty(navigator, 'bluetooth', { configurable: true, value: { getDevices: async () => [], requestDevice: vi.fn(() => new Promise(() => {})) } });
vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
localStorage.clear();
localStorage.setItem('gp.settings', JSON.stringify({ mode: 'local', onboarded: true }));
localStorage.setItem('gp.devices', JSON.stringify([{ id: 'I9/A6SUp2Z', name: 'ELK-BLEDDM', driverId: 'elk', chooserId: 'BE:27:DA:00:7C:83' }]));
const { store } = await import('../src/store');
const { TakeControl } = await import('../src/App');
afterEach(cleanup);

describe('Take control on the PC', () => {
  it('starts searching for the saved light at once and shows it is working', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    bridge.requestAutoconnect.mockClear();
    render(<TakeControl />);
    await act(async () => { await store.takeControl(); await vi.advanceTimersByTimeAsync(50); });
    // The phone lets go within ~10 s: the PC must not wait for a network scan before looking.
    expect(bridge.requestAutoconnect).toHaveBeenCalled();
    expect(screen.getByText('Searching…')).toBeTruthy();
    expect(screen.getByTestId('take-control').textContent).toContain('Taking the lights');
  });

  it('says the light was not found instead of silently doing nothing', async () => {
    await act(async () => { await vi.advanceTimersByTimeAsync(36_000); });
    expect(store.state.taking).toBe('notFound');
    expect(screen.queryByText('Searching…')).toBeNull();
    render(<TakeControl />);
    expect(screen.getByTestId('take-control').textContent).toContain('Light not found');
    vi.useRealTimers();
  });
});
