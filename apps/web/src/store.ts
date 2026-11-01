import { useSyncExternalStore } from 'react';
import {
  API_PORT, AutomationEngine, BUILTIN_SCENES, DEFAULT_CALIBRATION, DEFAULT_STATE, DeviceController, elkDriver, EXAMPLE_RULES,
  GlowEngine, newId, RETIRED_RULE_PROCESSES, SimulatorTransport, toHex, wakeTimes, type WakeTime,
  type ActivitySnapshot, type AutomationRule, type BleTransport, type Calibration, type ClientMessage, type Command,
  type ConnectionStatus, type EngineSnapshot, type RemoteState, type SavedDevice, type Scene, type Schedule,
  type ServerMessage, type SimulatedStripState,
} from '@glowpilot/core';
import { WebBluetoothTransport } from './transports/webBluetooth';
import { CapacitorBleTransport } from './transports/capacitor';
import { alarmsForPhone, phoneAlarmsAvailable, syncPhoneAlarms } from './phoneAlarm';

/** Bridge exposed by GlowPilot Desktop's preload script. Absent in a normal browser. */
export interface DesktopBridge {
  onActivity(cb: (s: ActivitySnapshot) => void): void;
  onBluetoothDevices(cb: (list: { id: string; name: string }[]) => void): void;
  selectBluetoothDevice(id: string): void;
  /** Let main answer the next chooser automatically, but only with this (previously user-picked) id. */
  autoSelect?(id: string): void;
  /** Ask main to call __glowpilotAutoconnect again with a fresh user gesture. */
  requestAutoconnect?(): void;
  legacyTrustedId?(): Promise<string | null>;
  setTrustedDevice(id: string | null): void;
  publishState(s: RemoteState): void;
  onRemoteCommand(cb: (clientName: string, msg: ClientMessage) => void): void;
  getPairing(): Promise<{ code: string; addresses: string[]; port: number; clients: string[] }>;
  revokeClients(): Promise<void>;
  setLaunchAtLogin(on: boolean): void;
  launchAtLogin?(): Promise<boolean>;
  /** Called before GlowPilot Desktop really quits; the returned promise is awaited (max 1.5 s). */
  onPrepareQuit?(cb: () => Promise<void>): void;
  /** Tray menu "Pause GlowPilot / Resume GlowPilot". */
  onTogglePause?(cb: () => void): void;
  setPausedInTray?(paused: boolean): void;
  /** 'suspend' just before Windows sleeps, 'resume' after it wakes. */
  onPower?(cb: (what: 'suspend' | 'resume') => void): void;
  /** Windows scheduled tasks that wake the PC before alarms. */
  setWakeTasks?(wakes: WakeTime[]): void;
  /** Stop Windows from sleeping while an alarm/sunrise runs. */
  setKeepAwake?(on: boolean): void;
  onUpdate?(cb: (info: UpdateInfo) => void): void;
  installUpdate?(): void;
  checkForUpdates?(): void;
  updateStatus?(): Promise<UpdateInfo>;
  steamGames?(): Promise<{ appid: string; name: string; exes: string[] }[]>;
}

export interface UpdateInfo {
  state: 'idle' | 'checking' | 'none' | 'downloading' | 'ready' | 'error';
  version?: string;
  current?: string;
  percent?: number;
  message?: string;
}
declare global {
  interface Window {
    glowpilotDesktop?: DesktopBridge;
    __glowpilotAutoconnect?: () => void;
  }
}
export const desktop = typeof window !== 'undefined' ? window.glowpilotDesktop : undefined;

export type Mode = 'local' | 'remote' | 'simulator';

export interface FrameLogEntry { at: number; dir: 'tx' | 'ack'; hex: string; light: string }

/** A saved controller. `chooserId` is the id Electron's chooser used when the user picked it. */
export interface StoredDevice extends SavedDevice {
  chooserId?: string;
}

export interface LightGroup {
  id: string;
  name: string;
  icon: string;
  deviceIds: string[];
}

export interface LightView {
  id: string;
  device: StoredDevice;
  status: ConnectionStatus;
  snapshot: EngineSnapshot;
  sim: SimulatedStripState | null;
  error: string | null;
}

/** 'all', a group id, or 'dev:<deviceId>'. */
export type Target = string;

export interface Settings {
  mode: Mode;
  remoteUrl: string;
  remoteToken: string | null;
  clientName: string;
  overrideMinutes: number;
  /** Android: start the wake-up lights N minutes before the phone's own alarm clock. */
  phoneAlarmSync: boolean;
  phoneAlarmMinutes: number;
  phoneAlarmColor: string;
  automationEnabled: boolean;
  onboarded: boolean;
}

export interface UIState {
  mode: Mode;
  transportKind: BleTransport['kind'] | 'none';
  lights: LightView[];
  groups: LightGroup[];
  target: Target;
  /** Primary light of the current target (first one); what single-light screens show. */
  status: ConnectionStatus;
  device: StoredDevice | null;
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
  music: { running: boolean; level: number };
  /**
   * GlowPilot stepped back: it stops animating and sending, so the IR remote / Lotus Lantern keep control.
   * 'remote' = detected automatically, 'manual' = the user pressed Pause.
   */
  paused: null | { reason: 'remote' | 'manual'; at: number };
  update: UpdateInfo | null;
  /** What the PC reports about its lights (used by the phone's alarm to find them on its own). */
  remoteLights: { names: string[]; addresses: string[] };
  /** Android: next ring of the phone's alarm clock, and when the phone will run a light alarm. */
  phoneAlarm: { systemAt: number | null; nextAt: number | null; exact: boolean } | null;
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

/** 0.0.1 shipped a default calibration (gamma 1.6) that turned purple into blue; replace it if untouched. */
function migrateDevice<T extends SavedDevice>(d: T): T {
  const c = d.calibration;
  if (c && c.gamma === 1.6 && c.gain.g === 0.85 && c.gain.b === 0.9 && c.warmGreenCut === 0.35)
    return { ...d, calibration: { ...DEFAULT_CALIBRATION, gain: { ...DEFAULT_CALIBRATION.gain }, order: c.order } };
  return d;
}

function loadDevices(): StoredDevice[] {
  const list = load<StoredDevice[] | null>('devices', null);
  if (list) return list.map(migrateDevice);
  const single = load<StoredDevice | null>('device', null); // ≤ 0.0.2 stored one device
  return single ? [migrateDevice(single)] : [];
}

/**
 * Rules migration (0.0.4): the old examples (Cyberpunk, Fortnite, VS Code, Chrome) are not the user's apps,
 * so remove them, and add the user's games that are missing.
 */
function loadRules(): AutomationRule[] {
  const rules = load<AutomationRule[] | null>('rules', null);
  if (!rules) return EXAMPLE_RULES.map((r) => ({ ...r, id: newId('rule') }));
  if (load('migrated.rules004', false)) return rules;
  save('migrated.rules004', true);
  const migrated = rules.filter((r) => !RETIRED_RULE_PROCESSES.includes(r.process.trim().toLowerCase()));
  for (const ex of EXAMPLE_RULES)
    if (!migrated.some((r) => r.name.toLowerCase() === ex.name.toLowerCase() || r.process.toLowerCase() === ex.process.toLowerCase()))
      migrated.push({ ...ex, id: newId('rule') });
  save('rules', migrated);
  return migrated;
}

/** 0.0.4 rebuilt Halloween as a mix; drop saved copies of the old Halloween / Halloween frights so the new one shows. */
function loadUserScenes(): Scene[] {
  const scenes = load<Scene[]>('scenes', []);
  if (load('migrated.scenes004', false)) return scenes;
  save('migrated.scenes004', true);
  const kept = scenes.filter((x) => x.id !== 'halloween' && x.id !== 'halloween-frights');
  save('scenes', kept);
  return kept;
}

const defaultSchedules = (): Schedule[] => [
  { id: newId('sch'), name: 'Wake-up alarm', enabled: true, time: '06:00', days: [1, 2, 3, 4, 5], action: { type: 'alarm', minutes: 60, color: '#ff8a30' } },
  { id: newId('sch'), name: 'Wind down', enabled: false, time: '23:00', days: [0, 1, 2, 3, 4, 5, 6], action: { type: 'sunset', minutes: 15 } },
];

function loadSchedules(): Schedule[] {
  const list = load<Schedule[] | null>('schedules', null);
  if (!list) return defaultSchedules();
  if (load('migrated.sched003', false)) return list;
  save('migrated.sched003', true);
  // Requested in 0.0.3: weekday 6:00 alarm building up for an hour, then flashing until turned off.
  if (!list.some((s) => s.action.type === 'alarm')) {
    const next = [defaultSchedules()[0], ...list];
    save('schedules', next);
    return next;
  }
  return list;
}

const defaultSettings: Settings = {
  mode: WebBluetoothTransport.available || CapacitorBleTransport.available || desktop ? 'local' : 'simulator',
  remoteUrl: location.protocol.startsWith('http') && location.port === String(API_PORT) ? `ws://${location.host}` : '',
  remoteToken: null,
  clientName: /Android/i.test(navigator.userAgent) ? 'Android phone' : 'Web browser',
  overrideMinutes: 30,
  phoneAlarmSync: true,
  phoneAlarmMinutes: 60,
  phoneAlarmColor: '#ff8a30',
  automationEnabled: true,
  onboarded: false,
};

const EMPTY_SNAPSHOT: EngineSnapshot = { light: { ...DEFAULT_STATE }, activeSceneId: null, softwareEffect: null, sleepTimerEndsAt: null, ramp: null, activeRule: null, mixStepSceneId: null };

// --- one physical light ------------------------------------------------------------

class Light {
  controller: DeviceController;
  engine: GlowEngine;
  status: ConnectionStatus = 'disconnected';
  snapshot: EngineSnapshot;
  sim: SimulatedStripState | null = null;
  error: string | null = null;
  stopScheduler: () => void = () => {};
  /** Scene to restore when the automation rule that took over this light ends. */
  savedSceneId: string | null = null;

  constructor(public device: StoredDevice, public transport: BleTransport, private onChange: () => void, onLog: (dir: 'tx' | 'ack', b: Uint8Array) => void) {
    this.controller = new DeviceController(transport, elkDriver);
    this.controller.device = device;
    this.controller.state = load(`light.${device.id}`, { ...DEFAULT_STATE });
    this.engine = new GlowEngine(this.controller);
    this.snapshot = this.engine.snapshot();
    if (transport instanceof SimulatorTransport) {
      this.sim = transport.state;
      transport.onState((s) => { this.sim = s; this.onChange(); });
    }
    this.controller.on('status', (s) => {
      this.status = s;
      if (s === 'connected') {
        this.error = null;
        if (!this.restored || this.settledForSleep) {
          this.restored = true;
          this.settledForSleep = false;
          this.restoreLook();
        }
      }
      this.onChange();
    });
    this.controller.on('error', (e) => { this.error = e; this.onChange(); });
    this.controller.on('ack', (b) => onLog('ack', b));
    this.controller.on('external', (b) => this.onExternal?.(b));
    const write = transport.write.bind(transport);
    transport.write = async (b) => { await write(b); onLog('tx', b); };
    this.engine.on('snapshot', (snap) => {
      this.snapshot = snap;
      save(`light.${device.id}`, snap.light);
      // What the light is showing, so it comes back after a restart (scene, mix or GlowPilot effect).
      if (!this.halted()) save(`look.${device.id}`, { sceneId: snap.activeSceneId, effect: snap.softwareEffect, ramp: snap.ramp?.kind ?? null });
      this.onChange();
    });
  }

  private restored = false;
  /** Set when the animation was replaced by a steady colour before Windows went to sleep. */
  settledForSleep = false;

  /**
   * First connection after start: bring back the scene/effect that was running. The controller itself
   * restores its last static colour or built-in effect; GlowPilot-computed animations need the app.
   */
  /** True while the store has paused GlowPilot (keep the look to resume later). */
  halted: () => boolean = () => false;

  /** Set by the store: the light was changed by something else (IR remote, another app). */
  onExternal: ((b: Uint8Array) => void) | null = null;

  /** Mirror a frame sent by someone else into our state, so the app shows what the light really shows. */
  applyExternal(b: Uint8Array) {
    if (b.length !== 9 || b[0] !== 0x7e) return;
    const st = this.controller.state;
    if (b[2] === 0x05 && b[3] === 0x03) this.controller.state = { ...st, color: { r: b[4], g: b[5], b: b[6] }, controllerEffect: null, on: true };
    else if (b[2] === 0x04) this.controller.state = { ...st, on: b[3] !== 0 };
    else if (b[2] === 0x01) this.controller.state = { ...st, brightness: b[3] };
    else if (b[2] === 0x03) this.controller.state = { ...st, controllerEffect: b[3], on: true };
    this.engine.publish();
  }

  restoreLook() {
    const look = load<{ sceneId: string | null; effect: EngineSnapshot['softwareEffect']; ramp: string | null } | null>(`look.${this.device.id}`, null);
    if (!look || !this.controller.state.on || look.ramp === 'alarm') return;
    if (look.sceneId && this.engine.scenes.some((x) => x.id === look.sceneId)) this.engine.exec({ type: 'scene', sceneId: look.sceneId, source: 'schedule' });
    else if (look.effect) this.engine.exec({ type: 'softwareEffect', effect: look.effect });
  }

  /** Before quitting: replace a running GlowPilot animation with its main colour so the strip doesn't freeze on a random frame. */
  async settle() {
    const fx = this.engine.effects.current;
    if (this.status !== 'connected' || !fx || fx.type === 'static' || !this.controller.state.on) return;
    const look = this.snapshot;
    this.engine.effects.stop();
    this.controller.renderFrame(fx.colors[0]);
    await this.controller.idle();
    // Keep the saved look so the animation resumes on next start.
    save(`look.${this.device.id}`, { sceneId: look.activeSceneId, effect: look.softwareEffect, ramp: null });
  }

  get name() { return this.device.alias || this.device.name; }

  view(): LightView {
    return { id: this.device.id, device: this.device, status: this.status, snapshot: this.snapshot, sim: this.sim, error: this.error };
  }

  dispose() {
    this.stopScheduler();
    this.engine.effects.stop();
    void this.controller.disconnect().catch(() => {});
  }
}

// --- store -------------------------------------------------------------------------

class Store {
  private listeners = new Set<() => void>();
  state: UIState;
  lights: Light[] = [];
  automation = new AutomationEngine();
  private ws: WebSocket | null = null;
  private remoteRetry: ReturnType<typeof setTimeout> | null = null;
  private lastChooserId: string | null = null;
  private music: { stop: () => void } | null = null;
  private simCounter = 0;

  constructor() {
    const settings = { ...defaultSettings, ...load<Partial<Settings>>('settings', {}) };
    if (location.port === String(API_PORT) && !settings.remoteUrl) settings.remoteUrl = `ws://${location.host}`;
    const userScenes = loadUserScenes();
    this.state = {
      mode: settings.mode,
      transportKind: 'none',
      lights: [],
      groups: load('groups', []),
      target: load('target', 'all'),
      status: 'disconnected',
      device: null,
      snapshot: EMPTY_SNAPSHOT,
      scenes: [...BUILTIN_SCENES.map((b) => userScenes.find((u) => u.id === b.id) ?? b), ...userScenes.filter((u) => !BUILTIN_SCENES.some((b) => b.id === u.id))],
      rules: loadRules(),
      schedules: loadSchedules(),
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
      music: { running: false, level: 0 },
      update: null,
      remoteLights: { names: [], addresses: [] },
      phoneAlarm: null,
      paused: null,
    };
    this.automation.rules = this.state.rules;
    this.setupMode(settings.mode);
    this.setupDesktop();
    window.__glowpilotAutoconnect = () => void this.autoconnectNext();
    this.syncWakeTasks();
    this.schedulePhoneSync();
    // The phone's alarm clock may have changed while the app was in the background.
    document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && this.schedulePhoneSync());
  }

  subscribe = (cb: () => void) => {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  };

  private set(p: Partial<UIState>) {
    this.state = { ...this.state, ...p };
    this.listeners.forEach((l) => l());
    this.publishToDesktop();
    if ('schedules' in p || 'settings' in p || 'remoteLights' in p || 'lights' in p) this.schedulePhoneSync();
  }

  private phoneSyncTimer: ReturnType<typeof setTimeout> | null = null;
  /** Android: keep the native alarm module in step with schedules, lights and the PC address. */
  schedulePhoneSync() {
    if (!phoneAlarmsAvailable() || this.phoneSyncTimer) return;
    this.phoneSyncTimer = setTimeout(() => {
      this.phoneSyncTimer = null;
      const s = this.state;
      const own = this.lights.map((l) => l.device);
      void syncPhoneAlarms({
        alarms: alarmsForPhone(s.schedules),
        addresses: [...new Set([...own.map((d) => d.id).filter((id) => /^[0-9a-f]{2}(:[0-9a-f]{2}){5}$/i.test(id)), ...s.remoteLights.addresses])],
        names: [...new Set([...own.map((d) => d.name), ...s.remoteLights.names])],
        desktopUrl: s.settings.remoteUrl.replace(/^ws/, 'http'),
        token: s.settings.remoteToken ?? '',
        syncPhoneAlarm: s.settings.phoneAlarmSync,
        minutesBefore: s.settings.phoneAlarmMinutes,
        color: s.settings.phoneAlarmColor,
      }).then(async (r) => {
        const { GlowAlarm } = await import('./phoneAlarm');
        const sys = await GlowAlarm.nextSystemAlarm().catch(() => ({ at: null }));
        this.set({ phoneAlarm: { systemAt: sys.at, nextAt: r?.nextAt ?? this.state.phoneAlarm?.nextAt ?? null, exact: r?.exact ?? this.state.phoneAlarm?.exact ?? true } });
      });
    }, 800);
  }

  /** Recompute the light views and the primary-light fields. */
  private refresh = () => {
    if (this.state.mode === 'remote') return;
    const lights = this.lights.map((l) => l.view());
    this.updateKeepAwake();
    const primary = this.targetLights()[0] ?? this.lights[0];
    this.set({
      lights,
      device: primary?.device ?? null,
      status: primary?.status ?? 'disconnected',
      snapshot: primary?.snapshot ?? EMPTY_SNAPSHOT,
      sim: primary?.sim ?? null,
      error: primary?.error ?? null,
    });
  };

  // --- targets & groups ---------------------------------------------------------------

  /** Device ids a target refers to. */
  deviceIdsFor(target: Target | null | undefined): string[] {
    const all = this.lights.map((l) => l.device.id);
    if (!target || target === 'all') return all;
    if (target.startsWith('dev:')) return all.filter((id) => id === target.slice(4));
    const g = this.state.groups.find((x) => x.id === target);
    return g ? all.filter((id) => g.deviceIds.includes(id)) : all;
  }

  targetLights(target: Target = this.state.target): Light[] {
    const ids = this.deviceIdsFor(target);
    return this.lights.filter((l) => ids.includes(l.device.id));
  }

  setTarget(target: Target) {
    save('target', target);
    this.set({ target });
    this.refresh();
  }

  saveGroups(groups: LightGroup[]) {
    save('groups', groups);
    this.set({ groups });
    if (!groups.some((g) => g.id === this.state.target) && !this.state.target.startsWith('dev:')) this.setTarget('all');
  }

  // --- mode setup ------------------------------------------------------------------

  private makeTransport(mode: Mode, simId?: string): BleTransport {
    if (mode === 'simulator') {
      const n = ++this.simCounter;
      return new SimulatorTransport({ id: simId ?? `SIM:00:00:00:00:0${n}`, name: `ELK-BLEDDM (simulated ${n})`, rssi: -50 });
    }
    if (CapacitorBleTransport.available) return new CapacitorBleTransport();
    return new WebBluetoothTransport();
  }

  private createLight(device: StoredDevice, transport: BleTransport): Light {
    const light = new Light(device, transport, this.refresh, (dir, b) => this.pushLog(dir, b, light.name));
    light.halted = () => !!this.state.paused;
    light.onExternal = (b) => {
      // Someone used the remote (or another app): stop fighting it.
      light.engine.halt();
      light.applyExternal(b);
      if (!this.state.paused) this.setPaused({ reason: 'remote', at: Date.now() });
    };
    light.engine.scenes = this.state.scenes;
    light.engine.on('manual', () => {
      if (this.automation.activeRuleId) this.automation.manualOverride(this.state.settings.overrideMinutes);
    });
    light.stopScheduler = light.engine.startScheduler(
      () => this.state.schedules.filter((s) => this.deviceIdsFor(s.targetGroupId).includes(light.device.id)),
      (s) => { if (!s.days.length) this.saveSchedules(this.state.schedules.map((x) => (x.id === s.id ? { ...x, firedAt: Date.now() } : x))); },
    );
    this.lights.push(light);
    return light;
  }

  setupMode(mode: Mode) {
    this.stopMusic();
    this.lights.forEach((l) => l.dispose());
    this.lights = [];
    this.ws?.close();
    this.ws = null;
    this.set({ mode, settings: { ...this.state.settings, mode }, remote: { state: 'idle' }, lights: [], error: null });
    save('settings', this.state.settings);

    if (mode === 'remote') {
      this.set({ transportKind: 'remote', status: 'disconnected', device: null, sim: null });
      this.connectRemote();
      return;
    }
    if (mode === 'simulator') {
      this.simCounter = 0;
      const sims = load<StoredDevice[]>('simDevices', []);
      const list = sims.length ? sims : [{ id: 'SIM:00:00:00:00:01', name: 'ELK-BLEDDM (simulated 1)', driverId: 'elk', calibration: DEFAULT_CALIBRATION }];
      for (const d of list) {
        const light = this.createLight(d, this.makeTransport('simulator', d.id));
        void light.controller.connect(d).catch(() => {});
      }
    } else {
      for (const d of loadDevices()) {
        const light = this.createLight(d, this.makeTransport(mode));
        // Android reopens remembered devices without a chooser; Desktop does it via __glowpilotAutoconnect.
        if (CapacitorBleTransport.available) void light.controller.connect(d).catch(() => {});
      }
    }
    this.set({ transportKind: this.lights[0]?.transport.kind ?? (CapacitorBleTransport.available ? 'capacitor' : 'web-bluetooth') });
    this.refresh();
  }

  private persistDevices() {
    const list = this.lights.map((l) => l.device);
    save(this.state.mode === 'simulator' ? 'simDevices' : 'devices', list);
  }

  private pushLog(dir: 'tx' | 'ack', b: Uint8Array, light: string) {
    const log = [{ at: Date.now(), dir, hex: toHex(b), light }, ...this.state.log].slice(0, 80);
    this.set({ log, lastAckAt: dir === 'ack' ? Date.now() : this.state.lastAckAt });
  }

  // --- devices ------------------------------------------------------------------------

  /** Scan and add a controller (or reconnect it if already known). */
  async addLight() {
    try {
      this.set({ error: null });
      const transport = this.makeTransport(this.state.mode);
      const probe = new DeviceController(transport, elkDriver);
      this.lastChooserId = null;
      const picked = await probe.pick();
      const existing = this.lights.find((l) => l.device.id === picked.id);
      if (existing) {
        // Same controller picked again: give its light the fresh transport (browser permission renewed).
        this.removeLight(existing.device.id, false);
      }
      const device: StoredDevice = {
        ...picked,
        alias: existing?.device.alias,
        calibration: existing?.device.calibration ?? picked.calibration,
        chooserId: this.lastChooserId ?? existing?.device.chooserId,
      };
      const light = this.createLight(device, transport);
      this.persistDevices();
      if (this.lights.length === 1) this.setTarget('all');
      await light.controller.connect(device);
    } catch (e) {
      const msg = (e as Error).message;
      if (!/cancel/i.test(msg)) this.set({ error: msg });
    }
  }

  /** Legacy name used by a few screens. */
  pickDevice() {
    return this.addLight();
  }

  addSimulatedLight() {
    const transport = this.makeTransport('simulator', `SIM:00:00:00:00:${String(this.lights.length + 1).padStart(2, '0')}`) as SimulatorTransport;
    const d: StoredDevice = { id: transport.device.id, name: transport.device.name, driverId: 'elk', calibration: DEFAULT_CALIBRATION };
    const light = this.createLight(d, transport);
    this.persistDevices();
    void light.controller.connect(d);
    this.refresh();
  }

  connectLight(id: string) {
    const light = this.lights.find((l) => l.device.id === id);
    if (!light) return;
    void light.controller.connect(light.device).catch((e: Error) => {
      // Browser permission expired: the chooser is needed (this call comes from a click).
      if (/select the controller again/i.test(e.message)) {
        void light.controller.disconnect();
        void this.addLight();
      }
    });
  }

  reconnect() {
    this.targetLights().filter((l) => l.status !== 'connected').forEach((l) => this.connectLight(l.device.id));
  }

  async disconnect(id?: string) {
    await Promise.all((id ? this.lights.filter((l) => l.device.id === id) : this.targetLights()).map((l) => l.controller.disconnect()));
  }

  removeLight(id: string, persist = true) {
    const light = this.lights.find((l) => l.device.id === id);
    if (!light) return;
    light.dispose();
    this.lights = this.lights.filter((l) => l !== light);
    if (persist) {
      this.persistDevices();
      if (this.state.target === `dev:${id}`) this.setTarget('all');
    }
    this.refresh();
  }

  forgetDevice() {
    const p = this.targetLights()[0];
    if (p) this.removeLight(p.device.id);
  }

  renameLight(id: string, alias: string) {
    const light = this.lights.find((l) => l.device.id === id);
    if (!light) return;
    light.device = { ...light.device, alias };
    light.controller.device = light.device;
    this.persistDevices();
    this.refresh();
  }

  renameDevice(alias: string) {
    const p = this.targetLights()[0];
    if (p) this.renameLight(p.device.id, alias);
  }

  setCalibration(cal: Calibration, id?: string) {
    const light = id ? this.lights.find((l) => l.device.id === id) : this.targetLights()[0];
    if (!light) return;
    light.device = { ...light.device, calibration: cal };
    light.controller.updateCalibration(cal);
    this.persistDevices();
    this.refresh();
  }

  sendRaw(bytes: Uint8Array) {
    this.targetLights().forEach((l) => l.controller.sendRaw(bytes));
  }

  /** Desktop: reopen saved controllers one at a time (each chooser call needs its own user gesture). */
  private autoconnectBusy = false;
  private async autoconnectNext() {
    // 0.0.2 kept the chooser id in the main process; attach it to the single saved device once.
    if (this.lights.length === 1 && !this.lights[0].device.chooserId && desktop?.legacyTrustedId) {
      const legacy = await desktop.legacyTrustedId();
      if (legacy) {
        this.lights[0].device = { ...this.lights[0].device, chooserId: legacy };
        this.persistDevices();
      }
    }
    if (this.autoconnectBusy || this.state.mode !== 'local' || !desktop?.autoSelect) return;
    const light = this.lights.find((l) => l.status !== 'connected' && l.device.chooserId && l.status !== 'connecting');
    if (!light) return;
    this.autoconnectBusy = true;
    try {
      desktop.autoSelect(light.device.chooserId!);
      const fresh = this.makeTransport('local');
      const d = await new DeviceController(fresh, elkDriver).pick();
      if (d.id) {
        const oldId = light.device.id;
        const device = { ...light.device, id: d.id };
        if (oldId !== d.id) {
          // Chromium may hand out a new id for the same controller: keep groups and the target pointing at it.
          this.saveGroups(this.state.groups.map((g) => ({ ...g, deviceIds: g.deviceIds.map((x) => (x === oldId ? d.id : x)) })));
          if (this.state.target === `dev:${oldId}`) this.setTarget(`dev:${d.id}`);
        }
        this.removeLight(oldId, false);
        const nl = this.createLight(device, fresh);
        this.persistDevices();
        await nl.controller.connect(device).catch(() => {});
      }
    } catch {
      /* not in range: retried later */
    } finally {
      this.autoconnectBusy = false;
      const more = this.lights.some((l) => l.status !== 'connected' && l.device.chooserId);
      setTimeout(() => desktop.requestAutoconnect?.(), more ? 2_000 : 60_000);
    }
  }

  // --- commands ------------------------------------------------------------------------

  /** Run a command on the current target (or an explicit one). */
  exec(cmd: Command, target: Target = this.state.target) {
    if (this.state.mode === 'remote') return this.sendRemote({ t: 'command', cmd, target });
    // Using GlowPilot again ends a pause (the light follows the newest instruction).
    const manual = cmd.type !== 'scene' || (cmd.source ?? 'manual') === 'manual';
    if (this.state.paused && manual) this.setPaused(null);
    if (this.state.paused) return; // automation waits while paused (schedules like the alarm still run)
    if (cmd.type === 'scene' && (cmd.source ?? 'manual') === 'manual' && this.automation.activeRuleId)
      this.automation.manualOverride(this.state.settings.overrideMinutes);
    if (this.music && (cmd.type === 'power' || cmd.type === 'scene' || cmd.type === 'brightness')) this.stopMusic(false);
    for (const l of this.targetLights(target)) l.engine.exec(cmd);
  }

  testSchedule(s: Schedule) {
    this.targetLights(s.targetGroupId ?? 'all').forEach((l) => l.engine.runScheduleAction(s));
  }

  saveScenes(scenes: Scene[]) {
    save('scenes', scenes.filter((s) => !s.builtin || JSON.stringify(s) !== JSON.stringify(BUILTIN_SCENES.find((b) => b.id === s.id))));
    this.lights.forEach((l) => (l.engine.scenes = scenes));
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
    this.syncWakeTasks();
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

  /** Desktop: wake the PC from sleep a few minutes before each alarm / sunrise / scheduled scene. */
  syncWakeTasks() {
    if (!desktop?.setWakeTasks || this.state.mode === 'remote') return;
    desktop.setWakeTasks(wakeTimes(this.state.schedules, new Date()));
  }

  private keepAwake = false;
  /** Desktop: an alarm or sunrise must not be cut short by Windows going back to sleep. */
  private updateKeepAwake() {
    const on = this.lights.some((l) => l.snapshot.ramp != null);
    if (on === this.keepAwake) return;
    this.keepAwake = on;
    desktop?.setKeepAwake?.(on);
  }

  // --- pause: let the remote control the lights ------------------------------------------

  private setPaused(paused: UIState['paused']) {
    this.set({ paused });
    desktop?.setPausedInTray?.(!!paused);
  }

  pause() {
    this.stopMusic(false);
    this.lights.forEach((l) => l.engine.halt());
    this.setPaused({ reason: 'manual', at: Date.now() });
  }

  /** Give the lights back to GlowPilot: each one resumes the scene/effect it had before the pause. */
  resume() {
    this.setPaused(null);
    this.automation.clearOverride();
    this.lights.forEach((l) => l.restoreLook());
  }

  togglePause() {
    if (this.state.paused) this.resume();
    else this.pause();
  }

  // --- music mode (lives in the store so it survives page changes) ------------------------

  async startMusic() {
    if (this.music) return;
    const lights = this.targetLights();
    const restore = lights.map((l) => [l, l.controller.state.brightness] as const);
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
    } catch {
      this.set({ error: 'Microphone permission is required for music mode.' });
      return;
    }
    const ctx = new AudioContext();
    const an = ctx.createAnalyser();
    an.fftSize = 512;
    ctx.createMediaStreamSource(stream).connect(an);
    const buf = new Uint8Array(an.frequencyBinCount);
    let avg = 0, lastSent = -1;
    const h = setInterval(() => {
      an.getByteFrequencyData(buf);
      let sum = 0;
      for (let i = 1; i < 20; i++) sum += buf[i];
      const bass = sum / 19 / 255;
      avg = avg * 0.92 + bass * 0.08;
      const v = Math.max(0, Math.min(1, (bass - avg * 0.7) * 3));
      const level = Math.round(8 + v * 92);
      this.set({ music: { running: true, level: v } });
      // Only write when the change is visible, so the BLE queue never backs up.
      if (Math.abs(level - lastSent) >= 6) {
        lastSent = level;
        lights.forEach((l) => l.controller.setBrightness(level));
      }
    }, 80);
    this.music = {
      stop: () => {
        clearInterval(h);
        stream.getTracks().forEach((t) => t.stop());
        void ctx.close();
      },
    };
    this.set({ music: { running: true, level: 0 } });
    this.musicRestore = restore;
  }

  private musicRestore: (readonly [Light, number])[] = [];

  stopMusic(restoreBrightness = true) {
    if (!this.music) return;
    this.music.stop();
    this.music = null;
    if (restoreBrightness) this.musicRestore.forEach(([l, b]) => l.controller.setBrightness(b));
    this.musicRestore = [];
    this.set({ music: { running: false, level: 0 } });
  }

  // --- desktop (this window is GlowPilot Desktop) -----------------------------------

  private setupDesktop() {
    if (!desktop) return;
    desktop.onTogglePause?.(() => this.togglePause());
    desktop.onPower?.((what) => {
      if (what === 'suspend') {
        // Best effort: Windows gives little time before the Bluetooth radio goes down.
        this.lights.forEach((l) => {
          if (l.engine.effects.running) l.settledForSleep = true;
          void l.settle();
        });
      } else {
        // Give the Bluetooth adapter a moment to come back, then reconnect without waiting for the backoff.
        setTimeout(() => {
          this.lights.forEach((l) => l.controller.reconnectNow());
          if (this.lights.some((l) => l.status !== 'connected' && l.device.chooserId)) desktop.requestAutoconnect?.();
        }, 2500);
      }
    });
    desktop.onPrepareQuit?.(async () => {
      this.stopMusic();
      await Promise.all(this.lights.map((l) => l.settle()));
    });
    desktop.onUpdate?.((update) => this.set({ update }));
    void desktop.updateStatus?.().then((update) => this.set({ update }));
    desktop.onActivity((a) => {
      this.set({ activity: a, foreground: a.foreground });
      if (!this.state.settings.automationEnabled || this.state.mode === 'remote' || !this.lights.length || this.state.paused) return;
      const primary = this.lights[0];
      const d = this.automation.evaluate(a, primary.engine.activeSceneId);
      if (d.type === 'activate') {
        const rule = this.state.rules.find((r) => r.id === d.ruleId);
        for (const l of this.targetLights(rule?.targetGroupId ?? 'all')) {
          if (!this.automation.activeRuleId || l.engine.activeRule == null) l.savedSceneId = l.engine.activeSceneId;
          l.engine.activeRule = d.ruleId;
          l.engine.exec({ type: 'scene', sceneId: d.sceneId, source: 'automation' });
        }
      } else if (d.type === 'restore') {
        for (const l of this.lights.filter((x) => x.engine.activeRule)) {
          l.engine.activeRule = null;
          if (l.savedSceneId) l.engine.exec({ type: 'scene', sceneId: l.savedSceneId, source: 'automation' });
          else l.engine.publish();
          l.savedSceneId = null;
        }
      }
    });
    desktop.onBluetoothDevices((list) => this.set({ btChooser: list }));
    desktop.onRemoteCommand((client, msg) => {
      if (msg.t === 'command') this.exec(msg.cmd, msg.target ?? 'all');
      else if (msg.t === 'saveScenes') this.saveScenes(msg.scenes);
      else if (msg.t === 'saveRules') this.saveRules(msg.rules);
      else if (msg.t === 'saveSchedules') this.saveSchedules(msg.schedules);
      else if (msg.t === 'phoneAlarm') {
        const rest = this.state.schedules.filter((x) => x.id !== 'phone-alarm');
        this.saveSchedules(msg.at == null ? rest : [...rest, {
          id: 'phone-alarm', name: `Phone alarm (${client})`, enabled: true, time: '', days: [], onceAt: msg.at,
          action: { type: 'alarm', minutes: msg.minutes, color: msg.color },
        }]);
      }
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
    this.lastChooserId = id || null;
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
        lights: s.lights.map((l) => ({ id: l.id, name: l.device.alias || l.device.name, status: l.status })),
        alarmActive: this.lights.some((l) => l.snapshot.ramp?.kind === 'alarm'),
        lightNames: this.lights.map((l) => l.device.name),
        lightAddresses: this.lights.map((l) => l.device.chooserId).filter((x): x is string => !!x && /^[0-9a-f]{2}(:[0-9a-f]{2}){5}$/i.test(x)),
        groups: s.groups.map((g) => ({ id: g.id, name: g.name, icon: g.icon, deviceIds: g.deviceIds })),
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
        this.set({
          snapshot: r.snapshot, status: r.status, scenes: r.scenes, rules: r.rules, schedules: r.schedules, foreground: r.foreground, owner: r.owner,
          device: r.deviceName ? { id: 'remote', name: r.deviceName, driverId: 'elk', calibration: DEFAULT_CALIBRATION } : null,
          groups: (r.groups ?? []) as LightGroup[],
          remoteLights: { names: r.lightNames ?? [], addresses: r.lightAddresses ?? [] },
          lights: (r.lights ?? []).map((l) => ({ id: l.id, device: { id: l.id, name: l.name, driverId: 'elk', calibration: DEFAULT_CALIBRATION }, status: l.status, snapshot: r.snapshot, sim: null, error: null })),
        });
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

/** Human label for a target. */
export function targetLabel(s: UIState, t: Target): string {
  if (t === 'all') return s.lights.length > 1 ? 'All lights' : s.lights[0] ? s.lights[0].device.alias || s.lights[0].device.name : 'All lights';
  if (t.startsWith('dev:')) {
    const l = s.lights.find((x) => x.id === t.slice(4));
    return l ? l.device.alias || l.device.name : 'Missing light';
  }
  return s.groups.find((g) => g.id === t)?.name ?? 'All lights';
}
