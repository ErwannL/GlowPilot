/**
 * Schedules run inside GlowPilot (desktop or Android), not on the controller: the controller's
 * on-board timer commands are not verified on hardware yet. The UI states this clearly.
 */

export type ScheduleAction =
  | { type: 'on' }
  | { type: 'off' }
  | { type: 'scene'; sceneId: string }
  /** Gradually brighten from 1% to `brightness` over `minutes`, ending at the trigger time. */
  | { type: 'sunrise'; minutes: number; brightness: number; color: string }
  /** Gradually dim to off over `minutes`, starting at the trigger time. */
  | { type: 'sunset'; minutes: number }
  /** Wake-up alarm: starts at the trigger time, builds up for `minutes`, then keeps flashing until turned off. */
  | { type: 'alarm'; minutes: number; color: string };

export interface Schedule {
  id: string;
  name: string;
  enabled: boolean;
  /** "HH:MM", local time. */
  time: string;
  /** 0 = Sunday … 6 = Saturday. Empty = one-shot on the next occurrence. */
  days: number[];
  action: ScheduleAction;
  /** For one-shot schedules: set after firing so it does not fire again. */
  firedAt?: number;
  /** Group of lights it applies to; undefined/null = all lights. */
  targetGroupId?: string | null;
}

export const parseTime = (t: string): { h: number; m: number } | null => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(t);
  if (!m) return null;
  const h = +m[1], mi = +m[2];
  return h < 24 && mi < 60 ? { h, m: mi } : null;
};

/** For sunrise the action starts `minutes` before the alarm time. */
export const leadMinutes = (a: ScheduleAction) => (a.type === 'sunrise' ? a.minutes : 0);

/** Next instant the schedule starts its action, strictly after `from`. */
export function nextRun(s: Schedule, from: Date): Date | null {
  const t = parseTime(s.time);
  if (!t || !s.enabled) return null;
  const lead = leadMinutes(s.action);
  for (let d = 0; d <= 8; d++) {
    const c = new Date(from.getFullYear(), from.getMonth(), from.getDate() + d, t.h, t.m - lead, 0, 0);
    const alarmDay = new Date(c.getTime() + lead * 60_000).getDay();
    if (c.getTime() <= from.getTime()) continue;
    if (s.days.length && !s.days.includes(alarmDay)) continue;
    if (!s.days.length && s.firedAt) return null;
    return c;
  }
  return null;
}

/** Schedules whose start time falls in (prev, now]. Called every ~15 s by the runtime. */
export function dueSchedules(list: Schedule[], prev: Date, now: Date): Schedule[] {
  return list.filter((s) => {
    const n = nextRun(s, prev);
    return n != null && n.getTime() <= now.getTime();
  });
}

/** Brightness 0–100 at `elapsedMs` into a ramp. Perceptual (quadratic) so the start is gentle. */
export function rampLevel(elapsedMs: number, totalMs: number, from: number, to: number): number {
  const f = Math.max(0, Math.min(1, totalMs ? elapsedMs / totalMs : 1));
  const eased = from < to ? f * f : 1 - (1 - f) * (1 - f);
  return Math.round(from + (to - from) * eased);
}

export const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function describeSchedule(s: Schedule): string {
  const days = !s.days.length ? 'Once' : s.days.length === 7 ? 'Every day'
    : s.days.join() === '1,2,3,4,5' ? 'Weekdays' : s.days.join() === '0,6' ? 'Weekends'
    : s.days.map((d) => DAY_LABELS[d]).join(', ');
  const a = s.action;
  const what = a.type === 'on' ? 'Turn on' : a.type === 'off' ? 'Turn off' : a.type === 'scene' ? 'Activate scene'
    : a.type === 'sunrise' ? `Sunrise (${a.minutes} min)` : a.type === 'alarm' ? `Wake-up alarm (${a.minutes} min build-up)` : `Fade out (${a.minutes} min)`;
  return `${what} · ${s.time} · ${days}`;
}
