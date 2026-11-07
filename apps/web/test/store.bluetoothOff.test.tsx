import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Real case: Bluetooth switched off in Windows. Chromium still says Bluetooth is "available" but finds
// nothing, so "Take control", "Add a light" and "Connect" all looked dead. The PC must say why.
let radio: 'on' | 'off' | 'none' = 'off';
const bridge = {
  onActivity: vi.fn(), onBluetoothDevices: vi.fn(), onRemoteCommand: vi.fn(), onTogglePause: vi.fn(), onPower: vi.fn(),
  onPrepareQuit: vi.fn(), onUpdate: vi.fn(), selectBluetoothDevice: vi.fn(), autoSelect: vi.fn(), requestAutoconnect: vi.fn(),
  setTrustedDevice: vi.fn(), publishState: vi.fn(), setWakeTasks: vi.fn(), setKeepAwake: vi.fn(), setPausedInTray: vi.fn(),
  bluetoothRadio: vi.fn(async () => radio),
  bluetoothRadioOn: vi.fn(async () => { radio = 'on'; return radio; }),
};
(window as unknown as { glowpilotDesktop: typeof bridge }).glowpilotDesktop = bridge;
const requestDevice = vi.fn(() => new Promise(() => {}));
Object.defineProperty(navigator, 'bluetooth', { configurable: true, value: { getDevices: async () => [], requestDevice } });
vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
localStorage.clear();
localStorage.setItem('gp.settings', JSON.stringify({ mode: 'local', onboarded: true }));
localStorage.setItem('gp.devices', JSON.stringify([{ id: 'I9/A6SUp2Z', name: 'ELK-BLEDDM', driverId: 'elk', chooserId: 'BE:27:DA:00:7C:83' }]));
const { store } = await import('../src/store');
const { TakeControl } = await import('../src/App');
afterEach(cleanup);

describe('PC with Bluetooth switched off', () => {
  it('"Take control" does not pretend to search: it says Bluetooth is off', async () => {
    bridge.requestAutoconnect.mockClear();
    render(<TakeControl />);
    await act(async () => { await store.takeControl(); });
    expect(store.state.bluetoothOff).toBe('off');
    expect(store.state.taking).toBeNull();
    expect(bridge.requestAutoconnect).not.toHaveBeenCalled();
    expect(screen.getByTestId('bluetooth-off').textContent).toContain('Bluetooth is off on this PC');
  });

  it('"Add a light" does not open an empty chooser either', async () => {
    await act(async () => { await store.addLight(); });
    expect(requestDevice).not.toHaveBeenCalled();
    expect(store.state.btChooser).toBeNull();
  });

  it('"Turn Bluetooth on" switches the radio on, hides the warning and looks for the light again', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(<TakeControl />);
    await act(async () => { fireEvent.click(screen.getByText('Turn Bluetooth on')); await vi.advanceTimersByTimeAsync(2100); });
    expect(bridge.bluetoothRadioOn).toHaveBeenCalled();
    expect(store.state.bluetoothOff).toBeNull();
    expect(screen.queryByTestId('bluetooth-off')).toBeNull();
    expect(bridge.requestAutoconnect).toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('with Bluetooth on, "Add a light" opens the list at once with "Scanning…"', async () => {
    void store.addLight();
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(requestDevice).toHaveBeenCalled();
    expect(store.state.btChooser).toEqual([]);
  });

  it('a PC without any Bluetooth adapter says so', async () => {
    radio = 'none';
    expect(await store.checkBluetooth()).toBe(false);
    render(<TakeControl />);
    expect(screen.getByTestId('bluetooth-off').textContent).toContain('No Bluetooth adapter');
    expect(screen.queryByText('Turn Bluetooth on')).toBeNull();
  });
});
