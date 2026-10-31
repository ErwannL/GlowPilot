import { applyCalibration, DEFAULT_CALIBRATION, type Calibration, type RGB } from './color';
import { normalizeName } from './protocol/elk';
import type { ProtocolDriver } from './protocol/types';
import { CommandQueue } from './queue';
import type { BleTransport, DiscoveredDevice } from './transport';
import { Emitter } from './emitter';

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'error';

export interface LightState {
  on: boolean;
  color: RGB;
  /** 0–100 */
  brightness: number;
  /** 0–100 */
  speed: number;
  /** Built-in controller effect id, or null for a static colour / software effect. */
  controllerEffect: number | null;
}

export interface SavedDevice {
  id: string;
  name: string;
  alias?: string;
  driverId: string;
  calibration: Calibration;
}

export interface ControllerEvents {
  status: ConnectionStatus;
  state: LightState;
  error: string;
  ack: Uint8Array;
}

export const DEFAULT_STATE: LightState = { on: true, color: { r: 255, g: 120, b: 40 }, brightness: 80, speed: 50, controllerEffect: null };

/**
 * Owns one BLE link to one controller. Only connects to devices the user selected
 * (requestDevice) or saved before; never to an arbitrary nearby controller.
 */
export class DeviceController extends Emitter<ControllerEvents> {
  status: ConnectionStatus = 'disconnected';
  state: LightState = { ...DEFAULT_STATE };
  device: SavedDevice | null = null;
  lastAckAt = 0;
  autoReconnect = true;
  private queue: CommandQueue;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempt = 0;
  private manualDisconnect = false;

  constructor(
    public transport: BleTransport,
    public driver: ProtocolDriver,
    opts: { minGapMs?: number } = {},
  ) {
    super();
    this.queue = new CommandQueue((b) => this.transport.write(b), opts.minGapMs ?? 25);
    transport.onNotify((b) => {
      this.lastAckAt = Date.now();
      this.emit('ack', b);
    });
    transport.onDisconnect(() => this.handleDrop());
  }

  get calibration(): Calibration {
    return this.device?.calibration ?? DEFAULT_CALIBRATION;
  }

  /** User-initiated: opens the platform chooser. Returns the selection without connecting. */
  async pick(): Promise<SavedDevice> {
    const d: DiscoveredDevice = await this.transport.requestDevice(this.driver.namePrefixes, [this.driver.service]);
    const name = normalizeName(d.name);
    if (!this.driver.matches(name)) throw new Error(`"${name}" is not a supported controller`);
    return { id: d.id, name, driverId: this.driver.id, calibration: { ...DEFAULT_CALIBRATION, gain: { ...DEFAULT_CALIBRATION.gain } } };
  }

  async connect(device: SavedDevice): Promise<void> {
    this.device = device;
    this.manualDisconnect = false;
    this.setStatus(this.reconnectAttempt ? 'reconnecting' : 'connecting');
    try {
      await this.transport.connect(device.id, this.driver.service, this.driver.writeCharacteristic, this.driver.notifyCharacteristic);
      this.reconnectAttempt = 0;
      this.setStatus('connected');
      this.queue.resetDedup();
      this.pushAll();
    } catch (e) {
      this.emit('error', (e as Error).message);
      if (this.autoReconnect && !this.manualDisconnect) this.scheduleReconnect();
      else this.setStatus('error');
      throw e;
    }
  }

  async disconnect(): Promise<void> {
    this.manualDisconnect = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.reconnectAttempt = 0;
    this.queue.clear();
    await this.transport.disconnect();
    this.setStatus('disconnected');
  }

  updateCalibration(cal: Calibration): void {
    if (!this.device) return;
    this.device = { ...this.device, calibration: cal };
    this.sendColor();
  }

  // --- intents --------------------------------------------------------------

  setPower(on: boolean): void {
    this.patch({ on });
    this.send(this.driver.power(on));
  }

  setColor(color: RGB): void {
    this.patch({ color, controllerEffect: null, on: true });
    this.sendColor();
  }

  /** Raw colour for software effects: not stored as the user's chosen colour. */
  renderFrame(color: RGB): void {
    if (this.status !== 'connected') return;
    const c = applyCalibration(color, this.calibration);
    this.send(this.driver.rgb(c.r, c.g, c.b));
  }

  setBrightness(level: number): void {
    this.patch({ brightness: level });
    this.send(this.driver.brightness(level));
  }

  setSpeed(level: number): void {
    this.patch({ speed: level });
    this.send(this.driver.speed(level));
  }

  setControllerEffect(id: number): void {
    this.patch({ controllerEffect: id, on: true });
    this.send(this.driver.effect(id));
    this.send(this.driver.speed(this.state.speed));
  }

  setColorTemperature(warmPct: number): void {
    this.patch({ controllerEffect: null });
    this.send(this.driver.colorTemperature(warmPct, 100 - warmPct));
  }

  /** Raw frame for the hardware test mode. */
  sendRaw(bytes: Uint8Array): void {
    this.send({ key: 'raw-' + Math.random(), bytes });
  }

  idle(): Promise<void> {
    return this.queue.idle();
  }

  // --- internals ------------------------------------------------------------

  private sendColor(): void {
    const c = applyCalibration(this.state.color, this.calibration);
    this.send(this.driver.rgb(c.r, c.g, c.b));
  }

  private pushAll(): void {
    this.send(this.driver.power(this.state.on), true);
    if (!this.state.on) return;
    if (this.state.controllerEffect != null) this.send(this.driver.effect(this.state.controllerEffect), true);
    else this.sendColor();
    this.send(this.driver.brightness(this.state.brightness), true);
  }

  private send(frame: { key: string; bytes: Uint8Array }, force = false): void {
    if (this.status !== 'connected') return;
    this.queue.push(frame, force);
  }

  private patch(p: Partial<LightState>): void {
    this.state = { ...this.state, ...p };
    this.emit('state', this.state);
  }

  private setStatus(s: ConnectionStatus): void {
    this.status = s;
    this.emit('status', s);
  }

  private handleDrop(): void {
    if (this.manualDisconnect || !this.device) return;
    if (this.autoReconnect) this.scheduleReconnect();
    else this.setStatus('disconnected');
  }

  private scheduleReconnect(): void {
    if (!this.device || this.reconnectTimer) return;
    this.setStatus('reconnecting');
    const delay = Math.min(30_000, 500 * 2 ** this.reconnectAttempt++);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.device && !this.manualDisconnect) this.connect(this.device).catch(() => {});
    }, delay);
  }
}
