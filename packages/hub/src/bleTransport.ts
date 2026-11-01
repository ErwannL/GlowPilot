import type { BleTransport, DiscoveredDevice } from '@glowpilot/core';
import { normalizeName } from '@glowpilot/core';

// node-ble talks to BlueZ over the system D-Bus (no root, no native module).
import { createBluetooth } from 'node-ble';

type Adapter = Awaited<ReturnType<ReturnType<typeof createBluetooth>['bluetooth']['defaultAdapter']>>;
type Device = Awaited<ReturnType<Adapter['waitDevice']>>;
type Characteristic = Awaited<ReturnType<Awaited<ReturnType<Awaited<ReturnType<Device['gatt']>>['getPrimaryService']>>['getCharacteristic']>>;

let adapterPromise: Promise<Adapter> | null = null;
/** One BlueZ adapter shared by every light. */
export function adapter(): Promise<Adapter> {
  if (!adapterPromise) {
    const { bluetooth } = createBluetooth();
    adapterPromise = bluetooth.defaultAdapter().then(async (a) => {
      if (!(await a.isPowered())) throw new Error('Bluetooth adapter is off (bluetoothctl power on)');
      return a;
    });
    adapterPromise.catch(() => (adapterPromise = null));
  }
  return adapterPromise;
}

/** Scan for a few seconds and list controllers whose name matches (never connects to anything). */
export async function scan(matches: (name: string) => boolean, ms = 10_000): Promise<DiscoveredDevice[]> {
  const a = await adapter();
  if (!(await a.isDiscovering())) await a.startDiscovery().catch(() => {});
  await new Promise((r) => setTimeout(r, ms));
  await a.stopDiscovery().catch(() => {});
  const out: DiscoveredDevice[] = [];
  for (const addr of await a.devices()) {
    try {
      const d = await a.getDevice(addr);
      const name = normalizeName(await d.getName().catch(() => ''));
      if (name && matches(name)) out.push({ id: addr, name, rssi: Number(await d.getRSSI().catch(() => NaN)) || undefined });
    } catch {
      /* vanished */
    }
  }
  return out;
}

/** BLE transport for one controller, addressed by its Bluetooth address. */
export class BlueZTransport implements BleTransport {
  readonly kind = 'web-bluetooth' as const; // same capabilities as the browser transport
  private device: Device | null = null;
  private char: Characteristic | null = null;
  private notifyCbs: ((b: Uint8Array) => void)[] = [];
  private discCbs: (() => void)[] = [];

  get connected(): boolean {
    return !!this.char;
  }

  async requestDevice(): Promise<DiscoveredDevice> {
    throw new Error('On the hub, pick a controller from a scan (Devices → Add a light).');
  }

  async connect(address: string, service: string, writeChar: string, notifyChar?: string): Promise<void> {
    const a = await adapter();
    const addr = address.toUpperCase();
    // Scanning while connecting makes this kind of adapter abort the connection
    // ("le-connection-abort-by-local"): only scan if BlueZ doesn't know the light yet, then stop first.
    let d: Device;
    try {
      d = await a.getDevice(addr);
    } catch {
      if (!(await a.isDiscovering())) await a.startDiscovery().catch(() => {});
      d = await a.waitDevice(addr, 20_000).catch(() => {
        throw new Error('Light not visible: it is probably connected to another device (GlowPilot on a phone/PC, or Lotus Lantern), switched off, or out of range');
      });
    }
    if (await a.isDiscovering().catch(() => false)) {
      await a.stopDiscovery().catch(() => {});
      await new Promise((r) => setTimeout(r, 800));
    }
    const step = (m: string) => process.env.GLOWPILOT_BLE_DEBUG && console.log(new Date().toISOString(), `[ble ${addr}] ${m}`);
    step(`found, connected=${await d.isConnected().catch(() => '?')}`);
    if (!(await d.isConnected())) await d.connect();
    step('connected, resolving services');
    this.device = d;
    d.removeAllListeners('disconnect');
    d.on('disconnect', () => {
      this.char = null;
      this.discCbs.forEach((cb) => cb());
    });
    const gatt = await d.gatt();
    step('services resolved');
    const svc = await gatt.getPrimaryService(service);
    this.char = await svc.getCharacteristic(writeChar);
    if (notifyChar) {
      try {
        const n = await svc.getCharacteristic(notifyChar);
        n.on('valuechanged', (buf: Buffer) => this.notifyCbs.forEach((cb) => cb(new Uint8Array(buf))));
        await n.startNotifications();
        step('echo notifications on');
      } catch (e) {
        step(`echo notifications unavailable: ${(e as Error).message}`); // optional
      }
    }
  }

  async disconnect(): Promise<void> {
    this.char = null;
    await this.device?.disconnect().catch(() => {});
  }

  async write(bytes: Uint8Array): Promise<void> {
    if (!this.char) throw new Error('Not connected');
    await this.char.writeValueWithoutResponse(Buffer.from(bytes));
  }

  onNotify(cb: (b: Uint8Array) => void): void {
    this.notifyCbs.push(cb);
  }
  onDisconnect(cb: () => void): void {
    this.discCbs.push(cb);
  }
}
