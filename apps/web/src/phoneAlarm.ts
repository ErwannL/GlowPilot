import { Capacitor, registerPlugin } from '@capacitor/core';
import type { AlarmOptions, Schedule } from '@glowpilot/core';

/** Native Android module (apps/android/.../GlowAlarmPlugin.java). */
interface GlowAlarmPlugin {
  configure(cfg: PhoneAlarmConfig): Promise<{ nextAt: number; exact: boolean }>;
  nextSystemAlarm(): Promise<{ at: number | null }>;
  stop(): Promise<void>;
  ensurePermissions(): Promise<{ bluetooth: boolean; notifications: boolean; exact: boolean }>;
  openExactAlarmSettings(): Promise<void>;
  pickSound(): Promise<{ uri: string; name: string }>;
  ensureMicrophone(): Promise<{ granted: boolean }>;
  capabilities(): Promise<{ exact: boolean; microphone: boolean; bluetooth: boolean; notifications: boolean; fullScreen: boolean }>;
  openFullScreenSettings(): Promise<void>;
  noyauTracks(o: { url: string; token: string }): Promise<{ tracks: { id: number; title: string; artist?: string; duration_seconds?: number }[] }>;
  downloadNoyauTrack(o: { url: string; token: string; id: number; name: string }): Promise<{ uri: string; name: string }>;
}

export interface PhoneAlarmConfig {
  alarms: ({ id: string; name: string; time: string; days: number[]; minutes: number; color: string; onceAt?: number } & AlarmOptions)[];
  /** Bluetooth addresses of the lights (phone's own + those the PC uses). */
  addresses: string[];
  /** Bluetooth names, to find the lights by scanning when no address is known. */
  names: string[];
  /** http://<pc>:47821 and the pairing token, to ask the PC first. */
  desktopUrl: string;
  token: string;
  syncPhoneAlarm: boolean;
  minutesBefore: number;
  color: string;
}

export const GlowAlarm = registerPlugin<GlowAlarmPlugin>('GlowAlarm');
export const phoneAlarmsAvailable = () => Capacitor.getPlatform() === 'android';

/** Light alarms the phone should be ready to run itself (not the synced phone alarm: native handles that one). */
export function alarmsForPhone(schedules: Schedule[]): PhoneAlarmConfig['alarms'] {
  return schedules
    .filter((s) => s.enabled && s.id !== 'phone-alarm' && (s.action.type === 'alarm' || s.action.type === 'sunrise'))
    .map((s) => {
      const a = s.action as { type: 'alarm' | 'sunrise'; minutes: number; color: string } & AlarmOptions;
      // A sunrise ends at its time: start `minutes` earlier. An alarm starts at its time.
      let time = s.time;
      let days = s.days;
      if (a.type === 'sunrise' && /^\d{1,2}:\d{2}$/.test(s.time)) {
        const [h, m] = s.time.split(':').map(Number);
        let mins = h * 60 + m - a.minutes;
        let shift = 0;
        while (mins < 0) { mins += 1440; shift--; }
        time = `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
        days = s.days.map((d) => (d + shift + 7) % 7);
      }
      const { type: _t, ...opts } = a;
      // A sunrise has no ringing phase: keep it silent with a steady end.
      const extra: AlarmOptions = a.type === 'sunrise' ? { sound: null, rhythm: 'blink', blinkSpeed: 0, accelerate: false, flashDuringBuildup: false } : {};
      return { ...opts, ...extra, id: s.id, name: s.name, time, days, ...(s.onceAt ? { onceAt: s.onceAt } : {}) };
    });
}

let lastSig = '';
/** Asked once in the app's whole life, never again on later launches (Android remembers the answer anyway). */
const permsAskedKey = 'gp.alarmPermsAsked';
/** Hand the current alarms to Android (idempotent; only calls native when something changed). */
export async function syncPhoneAlarms(cfg: PhoneAlarmConfig): Promise<{ nextAt: number; exact: boolean } | null> {
  if (!phoneAlarmsAvailable()) return null;
  const sig = JSON.stringify(cfg);
  if (sig === lastSig) return null;
  lastSig = sig;
  let asked = true;
  try { asked = localStorage.getItem(permsAskedKey) === '1'; } catch { /* storage unavailable: don't nag */ }
  if (!asked && (cfg.alarms.length || cfg.syncPhoneAlarm)) {
    try { localStorage.setItem(permsAskedKey, '1'); } catch { /* ignore */ }
    await GlowAlarm.ensurePermissions().catch(() => null);
  }
  return GlowAlarm.configure(cfg).catch(() => null);
}
