import { Capacitor, registerPlugin } from '@capacitor/core';
import type { Schedule } from '@glowpilot/core';

/** Native Android module (apps/android/.../GlowAlarmPlugin.java). */
interface GlowAlarmPlugin {
  configure(cfg: PhoneAlarmConfig): Promise<{ nextAt: number; exact: boolean }>;
  nextSystemAlarm(): Promise<{ at: number | null }>;
  stop(): Promise<void>;
  ensurePermissions(): Promise<{ bluetooth: boolean; notifications: boolean; exact: boolean }>;
  openExactAlarmSettings(): Promise<void>;
}

export interface PhoneAlarmConfig {
  alarms: { id: string; time: string; days: number[]; minutes: number; color: string; onceAt?: number }[];
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
      const a = s.action as { type: 'alarm' | 'sunrise'; minutes: number; color: string };
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
      return { id: s.id, time, days, minutes: a.minutes, color: a.color, ...(s.onceAt ? { onceAt: s.onceAt } : {}) };
    });
}

let lastSig = '';
let permsAsked = false;
/** Hand the current alarms to Android (idempotent; only calls native when something changed). */
export async function syncPhoneAlarms(cfg: PhoneAlarmConfig): Promise<{ nextAt: number; exact: boolean } | null> {
  if (!phoneAlarmsAvailable()) return null;
  const sig = JSON.stringify(cfg);
  if (sig === lastSig) return null;
  lastSig = sig;
  if (!permsAsked && (cfg.alarms.length || cfg.syncPhoneAlarm)) {
    permsAsked = true;
    await GlowAlarm.ensurePermissions().catch(() => null);
  }
  return GlowAlarm.configure(cfg).catch(() => null);
}
