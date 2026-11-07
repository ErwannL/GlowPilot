import { describe, expect, it, vi } from 'vitest';

const ble = vi.hoisted(() => ({
  initialize: vi.fn(async () => {}),
  requestDevice: vi.fn(async () => ({ deviceId: 'BE:27', name: 'ELK-BLEDDM' })),
  connect: vi.fn(async (_id: string, _gone: () => void) => {}),
  disconnect: vi.fn(async () => {}),
  startNotifications: vi.fn(async (_d: string, _s: string, _c: string, cb: (v: DataView) => void) => { cb(new DataView(new Uint8Array([1, 2]).buffer)); }),
  requestLEScan: vi.fn(async (_o: object, cb: (r: { device: { deviceId: string } }) => void) => { cb({ device: { deviceId: 'be:27' } }); }),
  stopLEScan: vi.fn(async () => {}),
  writeWithoutResponse: vi.fn(async () => {}),
}));
vi.mock('@capacitor-community/bluetooth-le', () => ({ BleClient: ble }));

import { CapacitorBleTransport } from '../src/transports/capacitor';
import { WebBluetoothTransport } from '../src/transports/webBluetooth';

describe('Android BLE transport (plugin mocked)', () => {
  it('connects, echoes notifications, writes, disconnects', async () => {
    expect(CapacitorBleTransport.available).toBe(false);
    const t = new CapacitorBleTransport();
    await expect(t.write(new Uint8Array([1]))).rejects.toThrow('Not connected');
    expect(await t.requestDevice(['ELK-'])).toEqual({ id: 'BE:27', name: 'ELK-BLEDDM' });
    expect(ble.requestDevice).toHaveBeenCalledWith({ namePrefix: 'ELK' });
    const got: number[][] = [];
    const gone = vi.fn();
    t.onNotify((b) => got.push([...b]));
    t.onDisconnect(gone);
    await t.connect('BE:27', 'svc', 'w', 'n');
    expect(t.connected).toBe(true);
    expect(got).toEqual([[1, 2]]);
    await t.write(new Uint8Array([7, 8]));
    expect(ble.writeWithoutResponse).toHaveBeenCalled();
    ble.connect.mock.calls[0][1]();
    expect(gone).toHaveBeenCalled();
    await t.disconnect();
    expect(t.connected).toBe(false);
    expect(ble.initialize).toHaveBeenCalledTimes(1);
  });

  it('morning reconnect: a timed-out connection scans for the light and tries once more', async () => {
    const t = new CapacitorBleTransport();
    ble.connect.mockRejectedValueOnce(new Error('timeout'));
    ble.startNotifications.mockRejectedValueOnce(new Error('no notify'));
    await t.connect('BE:27', 'svc', 'w', 'n');
    expect(ble.requestLEScan).toHaveBeenCalled();
    expect(ble.stopLEScan).toHaveBeenCalled();
    expect(t.connected).toBe(true);
  });

  it('gives up when the scan does not see the light', async () => {
    vi.useFakeTimers();
    const t = new CapacitorBleTransport();
    ble.connect.mockRejectedValueOnce(new Error('timeout'));
    ble.requestLEScan.mockImplementationOnce(async () => {});
    const p = t.connect('BE:27', 'svc', 'w');
    const done = expect(p).rejects.toThrow('timeout');
    await vi.advanceTimersByTimeAsync(6000);
    await done;
    ble.connect.mockRejectedValueOnce(new Error('timeout'));
    ble.requestLEScan.mockRejectedValueOnce(new Error('no scan'));
    await expect(t.connect('BE:27', 'svc', 'w')).rejects.toThrow('timeout');
    vi.useRealTimers();
  });
});

function fakeDevice(id = 'dev1') {
  const listeners: Record<string, (e: unknown) => void> = {};
  const notifyChar = { startNotifications: vi.fn(async () => {}), addEventListener: (_: string, cb: (e: unknown) => void) => { listeners.notify = cb; } };
  const writeChar = { writeValueWithoutResponse: vi.fn(async () => {}), writeValue: vi.fn(async () => {}) };
  let fails = 1;
  const svc = { getCharacteristic: vi.fn(async (u: string) => (u === 'n' ? notifyChar : writeChar)) };
  const gatt = { connected: true, connect: vi.fn(async () => gatt), disconnect: vi.fn(), getPrimaryService: vi.fn(async () => { if (fails-- > 0) throw new Error('retry'); return svc; }) };
  const device = { id, name: 'ELK-BLEDDM', gatt, addEventListener: (_: string, cb: (e: unknown) => void) => { listeners.gone = cb; } };
  return { device, gatt, writeChar, listeners };
}

describe('Web Bluetooth transport (navigator.bluetooth mocked)', () => {
  it('explains when the browser has no Web Bluetooth', async () => {
    expect(WebBluetoothTransport.available).toBe(false);
    await expect(new WebBluetoothTransport().requestDevice(['ELK'], ['s'])).rejects.toThrow(/not available/);
  });

  it('picks, connects (retrying service discovery), echoes, writes and notices a disconnect', async () => {
    const f = fakeDevice();
    (navigator as unknown as { bluetooth: object }).bluetooth = { requestDevice: vi.fn(async () => f.device), getDevices: vi.fn(async () => [f.device]) };
    const t = new WebBluetoothTransport();
    expect(WebBluetoothTransport.available).toBe(true);
    expect(await t.requestDevice(['ELK'], ['s'])).toEqual({ id: 'dev1', name: 'ELK-BLEDDM' });
    const got: number[][] = [];
    const gone = vi.fn();
    t.onNotify((b) => got.push([...b]));
    t.onDisconnect(gone);
    await t.connect('dev1', 's', 'w', 'n');
    expect(f.gatt.getPrimaryService).toHaveBeenCalledTimes(2);
    expect(t.connected).toBe(true);
    f.listeners.notify({ target: { value: new DataView(new Uint8Array([9]).buffer) } });
    expect(got).toEqual([[9]]);
    await t.write(new Uint8Array([1]));
    expect(f.writeChar.writeValueWithoutResponse).toHaveBeenCalled();
    f.listeners.gone({});
    expect(gone).toHaveBeenCalled();
    await expect(t.write(new Uint8Array([1]))).rejects.toThrow('Not connected');
    await t.disconnect();
    expect(f.gatt.disconnect).toHaveBeenCalled();
  });

  it('reopens a permitted device without a chooser, or asks to pick it again', async () => {
    const f = fakeDevice('known');
    (navigator as unknown as { bluetooth: object }).bluetooth = { getDevices: vi.fn(async () => [f.device]) };
    const t = new WebBluetoothTransport();
    await t.connect('known', 's', 'w');
    (f.writeChar as { writeValueWithoutResponse?: unknown }).writeValueWithoutResponse = undefined;
    await t.write(new Uint8Array([2]));
    expect(f.writeChar.writeValue).toHaveBeenCalled();
    await expect(new WebBluetoothTransport().connect('other', 's', 'w')).rejects.toThrow(/select the controller again/);
    delete (navigator as unknown as { bluetooth?: object }).bluetooth;
  });
});
