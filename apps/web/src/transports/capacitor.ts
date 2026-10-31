import type { BleTransport, DiscoveredDevice } from '@glowpilot/core';
import { Capacitor } from '@capacitor/core';

/**
 * Native Android BLE via @capacitor-community/bluetooth-le. Unlike Web Bluetooth it can
 * reconnect to a remembered device id without showing a chooser.
 */
export class CapacitorBleTransport implements BleTransport {
  readonly kind = 'capacitor' as const;
  connected = false;
  private id: string | null = null;
  private svc = '';
  private wc = '';
  private notifyCbs: ((b: Uint8Array) => void)[] = [];
  private discCbs: (() => void)[] = [];
  private initialized = false;

  static get available(): boolean {
    return Capacitor.isNativePlatform();
  }

  private async ble() {
    const { BleClient } = await import('@capacitor-community/bluetooth-le');
    if (!this.initialized) {
      await BleClient.initialize({ androidNeverForLocation: true });
      this.initialized = true;
    }
    return BleClient;
  }

  async requestDevice(namePrefixes: string[]): Promise<DiscoveredDevice> {
    const ble = await this.ble();
    // The plugin's chooser accepts one prefix; list the remaining ones by name filter after the fact.
    const d = await ble.requestDevice({ namePrefix: namePrefixes[0] === 'ELK-' ? 'ELK' : namePrefixes[0] });
    return { id: d.deviceId, name: d.name ?? 'Unknown' };
  }

  async connect(deviceId: string, service: string, writeChar: string, notifyChar?: string): Promise<void> {
    const ble = await this.ble();
    this.id = deviceId;
    this.svc = service;
    this.wc = writeChar;
    await ble.connect(deviceId, () => {
      this.connected = false;
      this.discCbs.forEach((cb) => cb());
    }, { timeout: 15000 });
    this.connected = true;
    if (notifyChar) {
      try {
        await ble.startNotifications(deviceId, service, notifyChar, (v) => {
          const b = new Uint8Array(v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength));
          this.notifyCbs.forEach((cb) => cb(b));
        });
      } catch {
        /* optional */
      }
    }
  }

  async disconnect(): Promise<void> {
    if (this.id) await (await this.ble()).disconnect(this.id).catch(() => {});
    this.connected = false;
  }

  async write(bytes: Uint8Array): Promise<void> {
    if (!this.id || !this.connected) throw new Error('Not connected');
    const ble = await this.ble();
    await ble.writeWithoutResponse(this.id, this.svc, this.wc, new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength));
  }

  onNotify(cb: (b: Uint8Array) => void): void {
    this.notifyCbs.push(cb);
  }
  onDisconnect(cb: () => void): void {
    this.discCbs.push(cb);
  }
}
