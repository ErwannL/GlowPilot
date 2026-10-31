import { elkDriver, normalizeName } from './protocol/elk';

export interface DiscoveredDevice {
  id: string;
  name: string;
  rssi?: number;
}

/**
 * Platform BLE abstraction. Implemented by Web Bluetooth (browser, Electron),
 * Capacitor BLE (Android) and the simulator.
 */
export interface BleTransport {
  readonly kind: 'web-bluetooth' | 'capacitor' | 'simulator' | 'remote';
  /** Ask the user to pick a device (browser chooser) or scan (native). Never auto-picks. */
  requestDevice(namePrefixes: string[], services: string[]): Promise<DiscoveredDevice>;
  /** Reconnect to a previously selected device without user interaction, if the platform allows. */
  connect(deviceId: string, service: string, writeChar: string, notifyChar?: string): Promise<void>;
  disconnect(): Promise<void>;
  write(bytes: Uint8Array): Promise<void>;
  onNotify(cb: (bytes: Uint8Array) => void): void;
  onDisconnect(cb: () => void): void;
  readonly connected: boolean;
}

/** Visible simulated strip: holds the colour the real controller would show. */
export interface SimulatedStripState {
  on: boolean;
  r: number;
  g: number;
  b: number;
  brightness: number;
  speed: number;
  effect: number | null;
}

/**
 * Simulator transport. Decodes ELK frames exactly like the controller is believed to,
 * echoes them on "FFF4" and can be told to drop the link to test reconnection.
 */
export class SimulatorTransport implements BleTransport {
  readonly kind = 'simulator' as const;
  connected = false;
  state: SimulatedStripState = { on: false, r: 255, g: 255, b: 255, brightness: 100, speed: 50, effect: null };
  log: Uint8Array[] = [];
  failNextConnects = 0;
  /** Fraction of written frames silently lost (no apply, no echo), to test resends. */
  dropRate = 0;
  private notifyCbs: ((b: Uint8Array) => void)[] = [];
  private discCbs: (() => void)[] = [];
  private stateCbs: ((s: SimulatedStripState) => void)[] = [];

  constructor(public device: DiscoveredDevice = { id: 'SIM:00:00:00:00:01', name: 'ELK-BLEDDM (simulated)', rssi: -50 }) {}

  async requestDevice(): Promise<DiscoveredDevice> {
    return this.device;
  }

  async connect(deviceId: string, service: string): Promise<void> {
    if (deviceId !== this.device.id) throw new Error('Unknown simulated device');
    if (service !== elkDriver.service) throw new Error('Service not found');
    if (this.failNextConnects > 0) {
      this.failNextConnects--;
      throw new Error('Simulated connection failure');
    }
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    this.connected = false;
  }

  /** Simulate the controller dropping the link. */
  drop(): void {
    this.connected = false;
    this.discCbs.forEach((cb) => cb());
  }

  async write(bytes: Uint8Array): Promise<void> {
    if (!this.connected) throw new Error('Not connected');
    this.log.push(bytes);
    if (this.dropRate && Math.random() < this.dropRate) return;
    this.apply(bytes);
    const copy = bytes.slice();
    queueMicrotask(() => this.notifyCbs.forEach((cb) => cb(copy)));
  }

  onNotify(cb: (b: Uint8Array) => void): void {
    this.notifyCbs.push(cb);
  }
  onDisconnect(cb: () => void): void {
    this.discCbs.push(cb);
  }
  onState(cb: (s: SimulatedStripState) => void): void {
    this.stateCbs.push(cb);
  }

  private apply(f: Uint8Array): void {
    if (f.length !== 9 || f[0] !== 0x7e || f[8] !== 0xef) return;
    const s = { ...this.state };
    switch (f[2]) {
      case 0x04: s.on = f[3] === 1; break;
      case 0x01: s.brightness = f[3]; break;
      case 0x02: s.speed = f[3]; break;
      case 0x03: s.effect = f[3]; break;
      case 0x05:
        if (f[3] === 0x03) Object.assign(s, { r: f[4], g: f[5], b: f[6], effect: null });
        if (f[3] === 0x02) Object.assign(s, { r: 255, g: 180 + Math.round((f[5] / 100) * 75), b: 120 + Math.round((f[5] / 100) * 135), effect: null });
        break;
    }
    this.state = s;
    this.stateCbs.forEach((cb) => cb(s));
  }
}

export { normalizeName };
