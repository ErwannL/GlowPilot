import type { BleTransport, DiscoveredDevice } from '@glowpilot/core';

/**
 * Web Bluetooth transport (Chrome/Edge desktop & Android, and Electron).
 * The browser chooser guarantees the user explicitly selects the controller.
 */
export class WebBluetoothTransport implements BleTransport {
  readonly kind = 'web-bluetooth' as const;
  private device: BluetoothDevice | null = null;
  private char: BluetoothRemoteGATTCharacteristic | null = null;
  private notifyCbs: ((b: Uint8Array) => void)[] = [];
  private discCbs: (() => void)[] = [];

  static get available(): boolean {
    return typeof navigator !== 'undefined' && !!navigator.bluetooth;
  }

  get connected(): boolean {
    return !!this.device?.gatt?.connected && !!this.char;
  }

  async requestDevice(namePrefixes: string[], services: string[]): Promise<DiscoveredDevice> {
    if (!navigator.bluetooth) throw new Error('Web Bluetooth is not available in this browser. Use Chrome or Edge, or connect to GlowPilot Desktop.');
    const d = await navigator.bluetooth.requestDevice({
      filters: namePrefixes.map((namePrefix) => ({ namePrefix })),
      optionalServices: services,
    });
    this.attach(d);
    return { id: d.id, name: d.name ?? 'Unknown' };
  }

  private attach(d: BluetoothDevice) {
    if (this.device === d) return;
    this.device = d;
    d.addEventListener('gattserverdisconnected', () => {
      this.char = null;
      this.discCbs.forEach((cb) => cb());
    });
  }

  async connect(deviceId: string, service: string, writeChar: string, notifyChar?: string): Promise<void> {
    if (!this.device || this.device.id !== deviceId) {
      // Chrome can return previously permitted devices without a chooser (when supported).
      const known = (await navigator.bluetooth?.getDevices?.()) ?? [];
      const d = known.find((k) => k.id === deviceId);
      if (!d) throw new Error('Select the controller again (browser permission expired).');
      this.attach(d);
    }
    const gatt = await this.device!.gatt!.connect();
    // Windows/WinRT sometimes needs a retry for service discovery on BLEDOM clones.
    let svc: BluetoothRemoteGATTService | null = null;
    for (let i = 0; i < 4 && !svc; i++) {
      try {
        svc = await gatt.getPrimaryService(service);
      } catch (e) {
        if (i === 3) throw e;
        await new Promise((r) => setTimeout(r, 400));
      }
    }
    this.char = await svc!.getCharacteristic(writeChar);
    if (notifyChar) {
      try {
        const n = await svc!.getCharacteristic(notifyChar);
        await n.startNotifications();
        n.addEventListener('characteristicvaluechanged', (ev) => {
          const v = (ev.target as BluetoothRemoteGATTCharacteristic).value;
          if (v) this.notifyCbs.forEach((cb) => cb(new Uint8Array(v.buffer.slice(0))));
        });
      } catch {
        /* echo is optional */
      }
    }
  }

  async disconnect(): Promise<void> {
    this.char = null;
    this.device?.gatt?.disconnect();
  }

  async write(bytes: Uint8Array): Promise<void> {
    if (!this.char) throw new Error('Not connected');
    if (this.char.writeValueWithoutResponse) await this.char.writeValueWithoutResponse(bytes as Uint8Array<ArrayBuffer>);
    else await this.char.writeValue(bytes as Uint8Array<ArrayBuffer>);
  }

  onNotify(cb: (b: Uint8Array) => void): void {
    this.notifyCbs.push(cb);
  }
  onDisconnect(cb: () => void): void {
    this.discCbs.push(cb);
  }
}
