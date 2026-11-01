/**
 * GlowPilot Hub: the always-on light master (runs on a Linux server, e.g. next to Noyau).
 * - It alone holds the Bluetooth link to the lights, so PC and phone never fight over it.
 * - It runs scenes, mixes, schedules and alarms 24/7 (no PC sleep, no phone in the background).
 * - PC and phone are clients over the same paired LAN API as GlowPilot Desktop; the PC also sends
 *   its foreground app so game/app automation still works.
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  AutomationEngine, BUILTIN_SCENES, DEFAULT_CALIBRATION, DeviceController, elkDriver, EXAMPLE_RULES, GlowEngine, newId,
  wakeTimes as _wakeTimes,
  type ActivitySnapshot, type AutomationRule, type Calibration, type ClientMessage, type Command, type RemoteState, type SavedDevice,
  type Scene, type Schedule,
} from '@glowpilot/core';
import { BlueZTransport, scan } from './bleTransport';
import { NoyauMusicSync, type NoyauSettings } from './noyauMusic';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { LocalApiServer } = require('../../../apps/desktop/src/server.cjs');

void _wakeTimes;
const DATA = process.env.GLOWPILOT_DATA ?? '/data';
const PORT = Number(process.env.GLOWPILOT_PORT ?? 47821);
const WEB = process.env.GLOWPILOT_WEB ?? path.join(__dirname, 'web');
const STATE_FILE = path.join(DATA, 'hub-state.json');

interface Group { id: string; name: string; icon: string; deviceIds: string[] }
interface HubState {
  devices: SavedDevice[];
  groups: Group[];
  scenes: Scene[];
  rules: AutomationRule[];
  schedules: Schedule[];
  /** Per light: what it was showing, to resume after a restart. */
  looks: Record<string, { sceneId: string | null; effect: unknown }>;
  overrideMinutes: number;
  /** Noyau Musique: follow its playback and pulse the lights on the beats. */
  noyau: NoyauSettings | null;
}

const log = (...a: unknown[]) => console.log(new Date().toISOString(), ...a);

function loadState(): HubState {
  try {
    const s = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) as Partial<HubState>;
    return {
      devices: s.devices ?? [], groups: s.groups ?? [], looks: s.looks ?? {}, overrideMinutes: s.overrideMinutes ?? 30,
      scenes: mergeScenes(s.scenes ?? []),
      rules: s.rules ?? EXAMPLE_RULES.map((r) => ({ ...r, id: newId('rule') })),
      schedules: s.schedules ?? [],
      noyau: s.noyau ?? null,
    };
  } catch {
    return { devices: [], groups: [], scenes: mergeScenes([]), rules: EXAMPLE_RULES.map((r) => ({ ...r, id: newId('rule') })), schedules: [], looks: {}, overrideMinutes: 30, noyau: null };
  }
}
const mergeScenes = (user: Scene[]) => [...BUILTIN_SCENES.map((b) => user.find((u) => u.id === b.id) ?? b), ...user.filter((u) => !BUILTIN_SCENES.some((b) => b.id === u.id))];

let saveTimer: NodeJS.Timeout | null = null;
function saveState() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    fs.mkdirSync(DATA, { recursive: true });
    const tmp = STATE_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(state, null, 1));
    fs.renameSync(tmp, STATE_FILE);
  }, 300);
}

const state = loadState();

// --- lights ------------------------------------------------------------------------------

class Light {
  controller: DeviceController;
  engine: GlowEngine;
  savedSceneId: string | null = null;
  private restored = false;
  constructor(public device: SavedDevice) {
    const t = new BlueZTransport();
    this.controller = new DeviceController(t, elkDriver);
    this.controller.device = device;
    this.engine = new GlowEngine(this.controller);
    this.engine.scenes = state.scenes;
    this.controller.on('status', (s) => {
      log(`[${this.name}] ${s}`);
      if (s === 'connected' && !this.restored) {
        this.restored = true;
        const look = state.looks[device.id];
        if (look?.sceneId) this.engine.exec({ type: 'scene', sceneId: look.sceneId, source: 'schedule' });
      }
      publish();
    });
    this.controller.on('error', (e) => log(`[${this.name}] error: ${e}`));
    this.controller.on('external', () => {
      // IR remote / another app changed the light: stop animating it.
      this.engine.halt();
      publish();
    });
    this.engine.on('snapshot', (snap) => {
      if (snap.ramp?.kind !== 'alarm') state.looks[device.id] = { sceneId: snap.activeSceneId, effect: snap.softwareEffect };
      saveState();
      publish();
    });
    this.engine.startScheduler(
      () => state.schedules.filter((s) => idsFor(s.targetGroupId).includes(device.id)),
      (s) => { if (!s.days.length) { state.schedules = state.schedules.map((x) => (x.id === s.id ? { ...x, firedAt: Date.now() } : x)); saveState(); } },
    );
    this.connect();
  }
  get name() { return this.device.alias || this.device.name; }
  connect() { this.controller.connect(this.device).catch(() => { /* controller retries with backoff */ }); }
  dispose() { this.engine.effects.stop(); void this.controller.disconnect(); }
}

let lights: Light[] = state.devices.map((d) => new Light(d));

function idsFor(target: string | null | undefined): string[] {
  const all = lights.map((l) => l.device.id);
  if (!target || target === 'all') return all;
  if (target.startsWith('dev:')) return all.filter((id) => id === target.slice(4));
  const g = state.groups.find((x) => x.id === target);
  return g ? all.filter((id) => g.deviceIds.includes(id)) : all;
}
const lightsFor = (target?: string | null) => lights.filter((l) => idsFor(target).includes(l.device.id));

// --- automation (fed by GlowPilot Desktop's activity watcher) ---------------------------------

const automation = new AutomationEngine(state.rules);
let foreground: string | null = null;

function onActivity(a: ActivitySnapshot) {
  foreground = a.foreground;
  if (!lights.length) return;
  const d = automation.evaluate(a, lights[0].engine.activeSceneId);
  if (d.type === 'activate') {
    const rule = state.rules.find((r) => r.id === d.ruleId);
    for (const l of lightsFor(rule?.targetGroupId)) {
      if (l.engine.activeRule == null) l.savedSceneId = l.engine.activeSceneId;
      l.engine.activeRule = d.ruleId;
      l.engine.exec({ type: 'scene', sceneId: d.sceneId, source: 'automation' });
    }
  } else if (d.type === 'restore') {
    for (const l of lights.filter((x) => x.engine.activeRule)) {
      l.engine.activeRule = null;
      if (l.savedSceneId) l.engine.exec({ type: 'scene', sceneId: l.savedSceneId, source: 'automation' });
      l.savedSceneId = null;
    }
  }
}

// --- API -------------------------------------------------------------------------------------

function exec(cmd: Command, target?: string) {
  if (cmd.type === 'scene' && (cmd.source ?? 'manual') === 'manual' && automation.activeRuleId) automation.manualOverride(state.overrideMinutes);
  for (const l of lightsFor(target)) l.engine.exec(cmd);
}

function remoteState(): RemoteState & Record<string, unknown> {
  const primary = lights[0];
  return {
    hub: true,
    snapshot: primary?.engine.snapshot() ?? { light: { on: false, color: { r: 0, g: 0, b: 0 }, brightness: 0, speed: 50, controllerEffect: null }, activeSceneId: null, softwareEffect: null, sleepTimerEndsAt: null, ramp: null, activeRule: null, mixStepSceneId: null },
    status: primary?.controller.status ?? 'disconnected',
    deviceName: primary?.name ?? null,
    scenes: state.scenes, rules: state.rules, schedules: state.schedules, foreground, owner: 'hub',
    lights: lights.map((l) => ({ id: l.device.id, name: l.name, status: l.controller.status, snapshot: l.engine.snapshot(), calibration: l.device.calibration, deviceName: l.device.name })),
    groups: state.groups,
    alarmActive: lights.some((l) => l.engine.snapshot().ramp?.kind === 'alarm'),
    lightNames: lights.map((l) => l.device.name),
    lightAddresses: lights.map((l) => l.device.id),
    /** Last scan: controllers seen nearby and not added yet (the user picks one). */
    scan: lastScan.filter((d) => !lights.some((l) => l.device.id === d.id)),
    // Never send the Noyau token back to clients.
    noyau: state.noyau ? { url: state.noyau.url, musicSync: state.noyau.musicSync, colors: state.noyau.colors, target: state.noyau.target, hasToken: !!state.noyau.token, status: music.status, playing: music.active } : null,
    scanning,
  };
}

let publishTimer: NodeJS.Timeout | null = null;
function publish() {
  if (publishTimer) return;
  publishTimer = setTimeout(() => { publishTimer = null; api.broadcastState(remoteState()); }, 80);
}

type HubMessage = ClientMessage
  | { t: 'activity'; activity: ActivitySnapshot }
  | { t: 'saveGroups'; groups: Group[] }
  | { t: 'scanLights' }
  | { t: 'addLight'; id: string; name: string }
  | { t: 'removeLight'; id: string }
  | { t: 'renameLight'; id: string; alias: string }
  | { t: 'setCalibration'; id: string; calibration: Calibration }
  | { t: 'connectLight'; id: string }
  | { t: 'saveNoyau'; noyau: Partial<NoyauSettings> };

let lastScan: { id: string; name: string; rssi?: number }[] = [];
let scanning = false;

async function onMessage(client: string, m: HubMessage) {
  switch (m.t) {
    case 'command': return exec(m.cmd, m.target);
    case 'activity': return onActivity(m.activity);
    case 'saveScenes': state.scenes = m.scenes; lights.forEach((l) => (l.engine.scenes = m.scenes)); break;
    case 'saveRules': state.rules = m.rules; automation.rules = m.rules; break;
    case 'saveSchedules': state.schedules = m.schedules; break;
    case 'saveGroups': state.groups = m.groups; break;
    case 'alarmStop': lights.forEach((l) => l.engine.stopAlarm()); break;
    case 'phoneAlarm': {
      const rest = state.schedules.filter((x) => x.id !== 'phone-alarm');
      state.schedules = m.at == null ? rest : [...rest, { id: 'phone-alarm', name: `Phone alarm (${client})`, enabled: true, time: '', days: [], onceAt: m.at, action: { type: 'alarm', minutes: m.minutes, color: m.color } }];
      break;
    }
    case 'scanLights': {
      // The hub owns its links: briefly scanning does not drop connected lights.
      scanning = true;
      publish();
      lastScan = await scan((n) => elkDriver.matches(n)).catch((e) => { log('scan failed', e); return []; });
      scanning = false;
      log(`scan: ${lastScan.map((d) => `${d.name} ${d.id}`).join(', ') || 'nothing'}`);
      publish();
      return;
    }
    case 'addLight': {
      if (lights.some((l) => l.device.id === m.id) || !elkDriver.matches(m.name)) return;
      // Only a controller the user picked from a scan result.
      if (!lastScan.some((d) => d.id === m.id)) return;
      const d: SavedDevice = { id: m.id, name: m.name, driverId: 'elk', calibration: { ...DEFAULT_CALIBRATION, gain: { ...DEFAULT_CALIBRATION.gain } } };
      state.devices.push(d);
      lights.push(new Light(d));
      log(`added ${m.name} ${m.id} (by ${client})`);
      break;
    }
    case 'removeLight': {
      const l = lights.find((x) => x.device.id === m.id);
      l?.dispose();
      lights = lights.filter((x) => x !== l);
      state.devices = state.devices.filter((d) => d.id !== m.id);
      break;
    }
    case 'renameLight': {
      const l = lights.find((x) => x.device.id === m.id);
      if (l) { l.device.alias = m.alias.slice(0, 40); state.devices = lights.map((x) => x.device); }
      break;
    }
    case 'setCalibration': {
      const l = lights.find((x) => x.device.id === m.id);
      if (l) { l.device.calibration = m.calibration; l.controller.updateCalibration(m.calibration); state.devices = lights.map((x) => x.device); }
      break;
    }
    case 'connectLight': lights.find((x) => x.device.id === m.id)?.connect(); return;
    case 'saveNoyau': {
      const prev = state.noyau ?? { url: 'https://noyau.unicorn-geological.ts.net', token: '', musicSync: false, colors: ['#8b5cf6', '#f97316', '#3b82f6'], target: 'all' };
      // An empty token field keeps the stored token (clients never see it).
      state.noyau = { ...prev, ...m.noyau, token: m.noyau.token ? m.noyau.token : prev.token };
      music.restart();
      break;
    }
    case 'requestOwnership': case 'releaseOwnership': return; // the hub always keeps the lights
  }
  saveState();
  publish();
}

// --- Noyau Musique: lights in rhythm with what Noyau plays ------------------------------------

const music = new NoyauMusicSync(
  () => state.noyau,
  (on) => {
    const targets = lightsFor(state.noyau?.target);
    if (on) {
      // Remember each light's scene, then let the music drive it.
      for (const l of targets) { l.savedSceneId = l.engine.activeSceneId; l.engine.halt(); }
      log('noyau: music playing → lights follow the beat');
    } else {
      for (const l of targets) if (l.savedSceneId) { l.engine.exec({ type: 'scene', sceneId: l.savedSceneId, source: 'automation' }); l.savedSceneId = null; }
      log('noyau: music stopped → scene restored');
    }
    publish();
  },
  (c) => lightsFor(state.noyau?.target).forEach((l) => l.controller.renderFrame(c)),
  log,
);

const api = new LocalApiServer({
  port: PORT,
  staticDir: WEB,
  storeFile: path.join(DATA, 'paired-clients.json'),
  role: 'hub',
  onMessage: (client: string, m: HubMessage) => void onMessage(client, m).catch((e) => log('message failed', e)),
});
api.start();
log(`GlowPilot Hub on :${PORT} · ${lights.length} light(s) · pairing code ${api.code} (also: curl http://127.0.0.1:${PORT}/api/pairing on this server)`);
setInterval(publish, 5000);
music.restart();

// A Bluetooth/D-Bus hiccup must never take the lights' master down: log it and keep serving.
process.on('uncaughtException', (e) => log('uncaught', e));
process.on('unhandledRejection', (e) => log('unhandled rejection', e));

process.on('SIGTERM', () => {
  lights.forEach((l) => l.engine.effects.stop());
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 1));
  process.exit(0);
});
