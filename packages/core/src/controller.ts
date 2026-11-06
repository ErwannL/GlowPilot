import { applyCalibration, DEFAULT_CALIBRATION, type Calibration, type RGB } from './color';
import { normalizeName, toHex } from './protocol/elk';
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
  /** A notification that does not echo anything GlowPilot sent: someone else (IR/RF remote, another app) changed the light. */
  external: Uint8Array;
}

/** How long our own frames may take to be echoed back on FFF4. */
const ECHO_WINDOW_MS = 8000;

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
  /** Last colour/effect frame written and still waiting for its FFF4 echo. */
  private awaitingEcho: { hex: string; bytes: Uint8Array; retried: boolean; timer: ReturnType<typeof setTimeout> } | null = null;
  resendCount = 0;
  private writeFailures = 0;
  writeCount = 0;
  private lastWriteAt = 0;
  private connectedAt = 0;
  private watchdog: ReturnType<typeof setInterval>;
  /** No echo for this long while sending = dead link (the controller echoes every frame on FFF4). */
  livenessMs = 8000;
  /** Longest wait between reconnection attempts (raised by the hub when a light has been gone a long time). */
  maxBackoffMs = 30_000;
  zombieCount = 0;
  /** Frames written in the last few seconds, to tell our echoes from changes made elsewhere. */
  private recentSent: { hex: string; at: number }[] = [];

  constructor(
    public transport: BleTransport,
    public driver: ProtocolDriver,
    opts: { minGapMs?: number } = {},
  ) {
    super();
    this.queue = new CommandQueue(async (b) => {
      // Track before writing: the echo can arrive before write() resolves.
      this.trackEcho(b);
      const t = Date.now();
      this.recentSent.push({ hex: toHex(b), at: t });
      // Keep everything from the last ECHO_WINDOW_MS, however fast an effect writes.
      if (this.recentSent.length > 50 && t - this.recentSent[0].at > ECHO_WINDOW_MS) this.recentSent = this.recentSent.filter((x) => t - x.at < ECHO_WINDOW_MS);
      try {
        await this.transport.write(b);
        this.writeFailures = 0;
        this.lastWriteAt = Date.now();
        this.writeCount++;
      } catch (e) {
        // A write that keeps failing means the link is gone even if no disconnect event came.
        if (++this.writeFailures >= 3 && this.status === 'connected') this.linkLost('writes failing');
        throw e;
      }
    }, opts.minGapMs ?? 40);
    this.watchdog = setInterval(() => this.checkLiveness(), 4000);
    (this.watchdog as { unref?: () => void }).unref?.();
    transport.onNotify((b) => {
      const hex = toHex(b);
      if (this.awaitingEcho && hex === this.awaitingEcho.hex) {
        clearTimeout(this.awaitingEcho.timer);
        this.awaitingEcho = null;
      }
      const now = Date.now();
      if (this.lastAckAt) this.checkExternal(b, hex, now);
      this.lastAckAt = now;
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

  /** Max time for one connection attempt; a hung attempt used to block every later retry. */
  connectTimeoutMs = 30_000;
  private inFlight: Promise<void> | null = null;

  /** Connect (or join the attempt already running: concurrent attempts made the link flap). */
  connect(device: SavedDevice): Promise<void> {
    if (this.inFlight && this.device?.id === device.id) return this.inFlight;
    this.inFlight = this.doConnect(device).finally(() => { this.inFlight = null; });
    return this.inFlight;
  }

  private async doConnect(device: SavedDevice): Promise<void> {
    this.device = device;
    this.manualDisconnect = false;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.setStatus(this.reconnectAttempt ? 'reconnecting' : 'connecting');
    try {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<never>((_, rej) => { timer = setTimeout(() => rej(new Error('Connection attempt timed out')), this.connectTimeoutMs); });
      try {
        await Promise.race([
          this.transport.connect(device.id, this.driver.service, this.driver.writeCharacteristic, this.driver.notifyCharacteristic),
          timeout,
        ]);
      } catch (e) {
        void this.transport.disconnect().catch(() => {}); // abandon the half-open attempt
        throw e;
      } finally {
        clearTimeout(timer);
      }
      this.reconnectAttempt = 0;
      this.writeFailures = 0;
      this.lastAckAt = 0;
      this.connectedAt = Date.now();
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
    if (this.awaitingEcho) clearTimeout(this.awaitingEcho.timer);
    this.awaitingEcho = null;
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
    const c = applyCalibration(color, this.calibration, this.state.brightness);
    this.send(this.driver.rgb(c.r, c.g, c.b));
  }

  setBrightness(level: number): void {
    const before = this.state.brightness;
    this.patch({ brightness: level });
    this.send(this.driver.brightness(level));
    // The colour balance depends on the level below 50 %: resend a static colour when it changes.
    if (this.state.controllerEffect == null && (before < 50 || level < 50) && before !== level) this.sendColor();
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

  /**
   * Zombie links: BlueZ sometimes forgets a device without telling us, so writes "succeed" into the void
   * and the light freezes. This controller echoes every frame: frames going out with no echo coming back
   * means the link is dead → drop it and reconnect.
   */
  private checkLiveness(): void {
    if (this.status !== 'connected' || !this.driver.caps(this.device?.name ?? '').echoAck) return;
    // Only judge a link whose echo has worked: some stacks (BlueZ here) don't deliver the notifications at all.
    if (this.lastAckAt === 0) return;
    if (this.lastWriteAt - this.lastAckAt > this.livenessMs) {
      this.zombieCount++;
      this.linkLost('no echo from the controller');
    }
  }

  private linkLost(reason: string): void {
    this.emit('error', `Link lost (${reason}), reconnecting`);
    this.queue.clear();
    void this.transport.disconnect().catch(() => {});
    this.handleDrop();
  }

  /**
   * Is this notification someone else (IR remote, another app) changing the light?
   * It must not echo anything we sent in the last ECHO_WINDOW_MS (echoes can be late under load),
   * be a well-formed frame, and be confirmed: a second foreign frame within 4 s, or a single one
   * while we were not writing (a remote press on a steady light). A false positive pauses GlowPilot,
   * so this errs on the side of "it was us".
   */
  private pendingExternal: { b: Uint8Array; at: number; timer: ReturnType<typeof setTimeout> } | null = null;
  private checkExternal(b: Uint8Array, hex: string, now: number): void {
    if (b.length !== 9 || b[0] !== 0x7e || b[8] !== 0xef) return;
    if (this.recentSent.some((x) => x.hex === hex && now - x.at < ECHO_WINDOW_MS)) return;
    const p = this.pendingExternal;
    if (p && now - p.at < 4000) {
      clearTimeout(p.timer);
      this.pendingExternal = null;
      this.emit('external', b);
      return;
    }
    if (p) clearTimeout(p.timer);
    const quietBefore = now - this.lastWriteAt > 1500;
    const pending = {
      b, at: now,
      timer: setTimeout(() => {
        if (this.pendingExternal !== pending) return;
        this.pendingExternal = null;
        // Single press: only trust it if we were quiet before and after.
        if (quietBefore && this.lastWriteAt <= pending.at) this.emit('external', b);
      }, 1500),
    };
    this.pendingExternal = pending;
  }

  /** Stop background timers (tests, removed lights). */
  dispose(): void {
    clearInterval(this.watchdog);
    void this.disconnect();
  }

  /** Reconnect right away (e.g. the PC just woke up), skipping the remaining backoff delay. */
  reconnectNow(): void {
    if (!this.device || this.manualDisconnect || this.status === 'connected' || this.status === 'connecting') return;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.reconnectAttempt = 0;
    this.connect(this.device).catch(() => {});
  }

  /** Drop frames not written yet (e.g. animation frames that would overwrite the IR remote's colour). */
  cancelPending(): void {
    this.queue.clear();
    if (this.awaitingEcho) clearTimeout(this.awaitingEcho.timer);
    this.awaitingEcho = null;
  }

  idle(): Promise<void> {
    return this.queue.idle();
  }

  // --- internals ------------------------------------------------------------

  /**
   * The controller echoes every frame it accepted on FFF4. Under load (fast strobes) BLE
   * write-without-response frames can be lost, which showed up as wrong or missing colours.
   * If a colour frame is not echoed within 300 ms and nothing newer replaced it, send it once more.
   */
  private trackEcho(b: Uint8Array): void {
    const isColor = b[2] === 0x05 || b[2] === 0x03;
    if (!isColor || !this.lastAckAt || !this.driver.caps(this.device?.name ?? '').echoAck) return;
    const prev = this.awaitingEcho;
    if (prev) clearTimeout(prev.timer);
    const hex = toHex(b);
    const retried = !!prev && prev.hex === hex && prev.retried;
    this.awaitingEcho = {
      hex, bytes: b, retried,
      timer: setTimeout(() => {
        const a = this.awaitingEcho;
        if (!a || a.hex !== hex || a.retried || this.status !== 'connected') return;
        a.retried = true;
        this.resendCount++;
        this.queue.push({ key: 'color', bytes: a.bytes }, true);
      }, 300),
    };
  }

  private sendColor(): void {
    const c = applyCalibration(this.state.color, this.calibration, this.state.brightness);
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
    if (this.manualDisconnect || !this.device || this.inFlight) return;
    if (this.autoReconnect) this.scheduleReconnect();
    else this.setStatus('disconnected');
  }

  private scheduleReconnect(): void {
    if (!this.device || this.reconnectTimer) return;
    this.setStatus('reconnecting');
    const delay = Math.min(this.maxBackoffMs, 500 * 2 ** this.reconnectAttempt++);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.device && !this.manualDisconnect) this.connect(this.device).catch(() => {});
    }, delay);
  }
}
