import { useSyncExternalStore } from 'react';
import {
  API_PORT, AutomationEngine, BUILTIN_SCENES, DEFAULT_CALIBRATION, DeviceController, elkDriver, EXAMPLE_RULES, GlowEngine,
  newId, SimulatorTransport, toHex,
  type ActivitySnapshot, type AutomationRule, type BleTransport, type Calibration, type ClientMessage, type Command,
  type ConnectionStatus, type EngineSnapshot, type RemoteState, type SavedDevice, type Scene, type Schedule,
  type ServerMessage, type SimulatedStripState,
} from '@glowpilot/core';
import { WebBluetoothTransport } from './transports/webBluetooth';
import { CapacitorBleTransport } from './transports/capacitor';

/** Bridge exposed by GlowPilot Desktop's preload script. Absent in a normal browser. */
export interface DesktopBridge {
  onActivity(cb: (s: ActivitySnapshot) => void): void;
  onBluetoothDevices(cb: (list: { id: string; name: string }[]) => void): void;
  selectBluetoothDevice(id: string): void;
  setTrustedDevice(id: string | null): void;
  publishState(s: RemoteState): void;
  onRemoteCommand(cb: (clientName: string, msg: ClientMessage) => void): void;
  getPairing(): Promise<{ code: string; addresses: string[]; port: number; clients: string[] }>;
  revokeClients(): Promise<void>;
  setLaunchAtLogin(on: boolean): void;
}
declare global {
  interface Window {
    glowpilotDesktop?: DesktopBridge;
  }
}
export const desktop = typeof window !== 'undefined' ? window.glowpilotDesktop : undefined;

export type Mode = 'local' | 'remote' | 'simulator';

export interface FrameLogEntry { at: number; dir: 'tx' | 'ack'; hex: string }

export interface Settings {
  mode: Mode;
  remoteUrl: string;
  remoteToken: string | null;
  clientName: string;
  overrideMinutes: number;
  automationEnabled: boolean;
  onboarded: boolean;
}

export interface UIState {
  mode: Mode;
  transportKind: BleTransport['kind'] | 'none';
  status: ConnectionStatus;
  device: SavedDevice | null;
  snapshot: EngineSnapshot;
  scenes: Scene[];
  rules: AutomationRule[];
  schedules: Schedule[];
  foreground: string | null;
  activity: ActivitySnapshot | null;
  owner: string;
  log: FrameLogEntry[];
  lastAckAt: number;
  error: string | null;
  remote: { state: 'idle' | 'connecting' | 'needsPairing' | 'connected' | 'error'; message?: string };
  sim: SimulatedStripState | null;
  settings: Settings;
  btChooser: { id: string; name: string }[] | null;
}

// --- persistence ---------------------------------------------------------------

const load = <T,>(k: string, d: T): T => {
  try {
    const v = localStorage.getItem('gp.' + k);
    return v ? (JSON.parse(v) as T) : d;
  } catch {
    return d;
  }
};
const save = (k: string, v: unknown) => {
  try {
    localStorage.setItem('gp.' + k, JSON.stringify(v));
  } catch {
    /* storage unavailable */
  }
};

const defaultRules = (): AutomationRule[] => EXAMPLE_RULES.map((r) => ({ ...r, id: newId('rule') }));
const defaultSchedules = (): Schedule[] => [
  { id: newId('sch'), name: 'Wake up', enabled: false, time: '07:00', days: [1, 2, 3, 4, 5], action: { type: 'sunrise', minutes: 20, brightness: 90, color: '#ffa860' } },
  { id: newId('sch'), name: 'Wind down', enabled: false, time: '23:00', days: [0, 1, 2, 3, 4, 5, 6], action: { type: 'sunset', minutes: 15 } },
];

const defaultSettings: Settings = {
  mode: WebBluetoothTransport.available || CapacitorBleTransport.available || desktop ? 'local' : 'simulator',
  remoteUrl: location.protocol.startsWith('http') && location.port === String(API_PORT) ? `ws://${location.host}` : '',
  remoteToken: null,
  clientName: /Android/i.test(navigator.userAgent) ? 'Android phone' : 'Web browser',
  overrideMinutes: 30,
  automationEnabled: true,
  onboarded: false,
};

// --- store -------------------------------------------------------------------------

class Store {
  private listeners = new Set<() => void>();
  state: UIState;
  engine!: GlowEngine;
  controller!: DeviceController;
  automation = new AutomationEngine();
  private ws: WebSocket | null = null;
  private stopScheduler: (() => void) | null = null;
  private remoteRetry: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    const settings = { ...defaultSettings, ...load<Partial<Settings>>('settings', {}) };
    if (location.port === String(API_PORT) && !settings.remoteUrl) settings.remoteUrl = `ws://${location.host}`;
    const userScenes = load<Scene[]>('scenes', []);
    this.state = {
      mode: settings.mode,
      transportKind: 'none',
      status: 'disconnected',
      device: load<SavedDevice | null>('device', null),
      snapshot: { light: load('light', { on: true, color: { r: 255, g: 120, b: 40 }, brightness: 80, speed: 50, controllerEffect: null }), activeSceneId: null, softwareEffect: null, sleepTimerEndsAt: null, ramp: null, activeRule: null },
      scenes: [...BUILTIN_SCENES.map((b) => userScenes.find((u) => u.id === b.id) ?? b), ...userScenes.filter((u) => !BUILTIN_SCENES.some((b) => b.id === u.id))],
      rules: load('rules', defaultRules()),
      schedules: load('schedules', defaultSchedules()),
      foreground: null,
      activity: null,
      owner: 'desktop',
      log: [],
      lastAckAt: 0,
      error: null,
      remote: { state: 'idle' },
      sim: null,
      settings,
      btChooser: null,
    };
    this.setupMode(settings.mode);
    this.setupDesktop();
  }

  subscribe = (cb: () => void) => {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  };
  private set(p: Partial<UIState>) {
    this.state = { ...this.state, ...p };
    this.listeners.forEach((l) => l());
    this.publishToDesktop();
  }

  // --- mode setup ------------------------------------------------------------------

  private makeTransport(mode: Mode): BleTransport {
    if (mode === 'simulator') {
      const sim = new SimulatorTransport();
      sim.onState((s) => this.set({ sim: s }));
      this.set({ sim: sim.state });
      return sim;
    }
    if (CapacitorBleTransport.available) return new CapacitorBleTransport();
    return new WebBluetoothTransport();
  }

  setupMode(mode: Mode) {
    this.stopScheduler?.();
    this.engine?.effects.stop();
    void this.controller?.disconnect().catch(() => {});
    this.ws?.close();
    this.ws = null;
    this.set({ mode, settings: { ...this.state.settings, mode }, status: 'disconnected', remote: { state: 'idle' }, sim: null, error: null });
    save('settings', this.state.settings);

    if (mode === 'remote') {
      this.set({ transportKind: 'remote' });
      this.connectRemote();
      return;
    }
    const transport = this.makeTransport(mode);
    const controller = new DeviceController(transport, elkDriver);
    controller.state = { ...this.state.snapshot.light };
    this.controller = controller;
    this.engine = new GlowEngine(controller);
    this.engine.scenes = this.state.scenes;
    this.set({ transportKind: transport.kind });

    controller.on('status', (status) => this.set({ status, error: status === 'connected' ? null : this.state.error }));
    controller.on('error', (error) => this.set({ error }));
    controller.on('ack', (b) => this.pushLog('ack', b));
    const origWrite = transport.write.bind(transport);
    transport.write = async (b) => {
      await origWrite(b);
      this.pushLog('tx', b);
    };
    this.engine.on('snapshot', (snapshot) => {
      save('light', snapshot.light);
      this.set({ snapshot });
    });
    this.engine.on('manual', () => {
      if (this.automation.activeRuleId) this.automation.manualOverride(this.state.settings.overrideMinutes);
    });
    this.stopScheduler = this.engine.startScheduler(
      () => this.state.schedules,
      (s) => { if (!s.days.length) this.saveSchedules(this.state.schedules.map((x) => (x.id === s.id ? { ...x, firedAt: Date.now() } : x))); },
    );
    this.automation.rules = this.state.rules;
    this.engine.publish();

    if (mode === 'simulator') {
      void controller.pick().then((d) => this.connectDevice({ ...d, calibration: this.state.device?.calibration ?? DEFAULT_CALIBRATION }, false));
    } else if (this.state.device && CapacitorBleTransport.available) {
      // Android reopens the device the user selected before, without a chooser.
      void this.connectDevice(this.state.device).catch(() => {});
    }
    // Desktop: main process calls this with a user gesture and answers the chooser for the trusted device only.
    (window as unknown as { __glowpilotAutoconnect?: () => void }).__glowpilotAutoconnect = () => {
      if (this.state.mode === 'local' && this.state.device && this.state.status !== 'connected') void this.pickDevice();
    };
  }

  private pushLog(dir: 'tx' | 'ack', b: Uint8Array) {
    const log = [{ at: Date.now(), dir, hex: toHex(b) }, ...this.state.log].slice(0, 80);
    this.set({ log, lastAckAt: dir === 'ack' ? Date.now() : this.state.lastAckAt });
  }

  // --- device ------------------------------------------------------------------------

  async pickDevice() {
    try {
      this.set({ error: null });
      const d = await this.controller.pick();
      const prev = this.state.device;
      await this.connectDevice(prev?.id === d.id ? { ...d, alias: prev.alias, calibration: prev.calibration } : d);
    } catch (e) {
      const msg = (e as Error).message;
      if (!/cancel/i.test(msg)) this.set({ error: msg });
    }
  }

  async connectDevice(d: SavedDevice, persist = true) {
    if (persist) {
      save('device', d);
      desktop?.setTrustedDevice(d.id);
    }
    this.set({ device: d });
    await this.controller.connect(d);
  }

  reconnect() {
    if (!this.state.device) return;
    void this.connectDevice(this.state.device).catch((e: Error) => {
      // Browser permission for this device expired: fall back to the chooser (needs this click).
      if (/select the controller again/i.test(e.message)) {
        void this.controller.disconnect();
        void this.pickDevice();
      }
    });
  }

  async disconnect() {
    await this.controller?.disconnect();
  }

  forgetDevice() {
    void this.disconnect();
    save('device', null);
    desktop?.setTrustedDevice(null);
    this.set({ device: null });
  }

  renameDevice(alias: string) {
    if (!this.state.device) return;
    const d = { ...this.state.device, alias };
    save('device', d);
    this.set({ device: d });
  }

  setCalibration(cal: Calibration) {
    if (!this.state.device) return;
    const d = { ...this.state.device, calibration: cal };
    if (this.state.mode !== 'simulator') save('device', d);
    this.controller.updateCalibration(cal);
    this.set({ device: d });
  }

  sendRaw(bytes: Uint8Array) {
    this.controller?.sendRaw(bytes);
  }

  // --- commands ------------------------------------------------------------------------

  exec(cmd: Command) {
    if (this.state.mode === 'remote') return this.sendRemote({ t: 'command', cmd });
    if (cmd.type === 'scene' && (cmd.source ?? 'manual') === 'manual' && this.automation.activeRuleId)
      this.automation.manualOverride(this.state.settings.overrideMinutes);
    this.engine.exec(cmd);
  }

  saveScenes(scenes: Scene[]) {
    save('scenes', scenes.filter((s) => !s.builtin || JSON.stringify(s) !== JSON.stringify(BUILTIN_SCENES.find((b) => b.id === s.id))));
    if (this.engine) this.engine.scenes = scenes;
    this.set({ scenes });
    if (this.state.mode === 'remote') this.sendRemote({ t: 'saveScenes', scenes });
  }

  resetScene(id: string) {
    const b = BUILTIN_SCENES.find((s) => s.id === id);
    if (b) this.saveScenes(this.state.scenes.map((s) => (s.id === id ? b : s)));
  }

  saveRules(rules: AutomationRule[]) {
    save('rules', rules);
    this.automation.rules = rules;
    this.set({ rules });
    if (this.state.mode === 'remote') this.sendRemote({ t: 'saveRules', rules });
  }

  saveSchedules(schedules: Schedule[]) {
    save('schedules', schedules);
    this.set({ schedules });
    if (this.state.mode === 'remote') this.sendRemote({ t: 'saveSchedules', schedules });
  }

  updateSettings(p: Partial<Settings>) {
    const settings = { ...this.state.settings, ...p };
    save('settings', settings);
    this.set({ settings });
  }

  clearOverride() {
    this.automation.clearOverride();
    this.set({});
  }

  // --- desktop (this window is GlowPilot Desktop) -----------------------------------

  private setupDesktop() {
    if (!desktop) return;
    desktop.onActivity((a) => {
      this.set({ activity: a, foreground: a.foreground });
      if (!this.state.settings.automationEnabled || this.state.mode === 'remote' || !this.engine) return;
      const d = this.automation.evaluate(a, this.engine.activeSceneId);
      if (d.type === 'activate') {
        this.engine.activeRule = d.ruleId;
        this.engine.exec({ type: 'scene', sceneId: d.sceneId, source: 'automation' });
      } else if (d.type === 'restore') {
        this.engine.activeRule = null;
        if (d.sceneId) this.engine.exec({ type: 'scene', sceneId: d.sceneId, source: 'automation' });
        else this.engine.publish();
      }
    });
    desktop.onBluetoothDevices((list) => this.set({ btChooser: list }));
    desktop.onRemoteCommand((client, msg) => {
      if (msg.t === 'command') this.exec(msg.cmd);
      else if (msg.t === 'saveScenes') this.saveScenes(msg.scenes);
      else if (msg.t === 'saveRules') this.saveRules(msg.rules);
      else if (msg.t === 'saveSchedules') this.saveSchedules(msg.schedules);
      else if (msg.t === 'requestOwnership') {
        void this.disconnect();
        this.set({ owner: client });
      } else if (msg.t === 'releaseOwnership' && this.state.owner === client) {
        this.set({ owner: 'desktop' });
        this.reconnect();
      }
    });
  }

  chooseBluetooth(id: string) {
    desktop?.selectBluetoothDevice(id);
    this.set({ btChooser: null });
  }

  private publishTimer: ReturnType<typeof setTimeout> | null = null;
  private publishToDesktop() {
    if (!desktop || this.publishTimer) return;
    this.publishTimer = setTimeout(() => {
      this.publishTimer = null;
      const s = this.state;
      desktop.publishState({
        snapshot: s.snapshot, status: s.status, deviceName: s.device ? s.device.alias || s.device.name : null,
        scenes: s.scenes, rules: s.rules, schedules: s.schedules, foreground: s.foreground, owner: s.owner,
      });
    }, 50);
  }

  // --- remote (this client controls GlowPilot Desktop over the LAN) -----------------------

  connectRemote() {
    const url = this.state.settings.remoteUrl;
    if (!url) return this.set({ remote: { state: 'error', message: 'Enter the address shown in GlowPilot Desktop → Settings.' } });
    if (this.remoteRetry) clearTimeout(this.remoteRetry);
    this.set({ remote: { state: 'connecting' } });
    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch {
      return this.set({ remote: { state: 'error', message: 'Invalid address' } });
    }
    this.ws = ws;
    ws.onopen = () => {
      const token = this.state.settings.remoteToken;
      if (token) ws.send(JSON.stringify({ t: 'auth', token } satisfies ClientMessage));
      else this.set({ remote: { state: 'needsPairing' } });
    };
    ws.onmessage = (ev) => {
      const m = JSON.parse(String(ev.data)) as ServerMessage;
      if (m.t === 'paired') {
        this.updateSettings({ remoteToken: m.token });
        ws.send(JSON.stringify({ t: 'auth', token: m.token } satisfies ClientMessage));
      } else if (m.t === 'authed') this.set({ remote: { state: 'connected' } });
      else if (m.t === 'denied') {
        if (/token/i.test(m.reason)) this.updateSettings({ remoteToken: null });
        this.set({ remote: { state: 'needsPairing', message: m.reason } });
      } else if (m.t === 'state') {
        const r = m.state;
        this.set({ snapshot: r.snapshot, status: r.status, scenes: r.scenes, rules: r.rules, schedules: r.schedules, foreground: r.foreground, owner: r.owner,
          device: r.deviceName ? { id: 'remote', name: r.deviceName, driverId: 'elk', calibration: DEFAULT_CALIBRATION } : null });
      }
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      if (this.state.mode === 'remote' && this.state.remote.state !== 'needsPairing') {
        this.set({ remote: { state: 'error', message: 'Lost connection to GlowPilot Desktop. Retrying…' } });
        this.remoteRetry = setTimeout(() => this.connectRemote(), 4000);
      }
    };
  }

  pair(code: string) {
    this.sendRemote({ t: 'pair', code: code.trim(), clientName: this.state.settings.clientName });
  }

  sendRemote(m: ClientMessage) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
  }

  /** Android/web: ask the desktop to release the BLE link, then take it over locally. */
  takeOverFromDesktop() {
    this.sendRemote({ t: 'requestOwnership' });
    setTimeout(() => this.setupMode('local'), 800);
  }
}

export const store = new Store();
export const useStore = <T,>(sel: (s: UIState) => T): T => useSyncExternalStore(store.subscribe, () => sel(store.state));
