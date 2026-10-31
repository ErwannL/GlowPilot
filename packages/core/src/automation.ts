/**
 * App-aware automation. Pure logic: the desktop process watcher feeds it snapshots,
 * it decides which scene (if any) should be active. Fully testable without Windows.
 */

export type RuleTrigger = 'running' | 'foreground';

export interface AutomationRule {
  id: string;
  name: string;
  enabled: boolean;
  /** Executable name, case-insensitive, e.g. "Cyberpunk2077.exe". Supports * wildcards. */
  process: string;
  /** 'running' = any time the process exists; 'foreground' = only while its window is focused. */
  trigger: RuleTrigger;
  sceneId: string;
  /** Higher wins when several rules match. */
  priority: number;
  /** Minimum seconds between two activations of this rule (avoids flapping on alt-tab). */
  cooldownSec: number;
  /** Restore the scene that was active before, when the rule stops matching. */
  restorePrevious: boolean;
}

export interface ActivitySnapshot {
  /** Lower-case executable names of running processes. */
  processes: string[];
  /** Lower-case executable of the focused window, if known. */
  foreground: string | null;
  /** Media playing (from Windows media session), if known. */
  mediaPlaying?: boolean;
}

export type AutomationDecision =
  | { type: 'activate'; ruleId: string; sceneId: string }
  | { type: 'restore'; sceneId: string | null }
  | { type: 'none' };

export const EXAMPLE_RULES: Omit<AutomationRule, 'id'>[] = [
  { name: 'Cyberpunk 2077', enabled: true, process: 'Cyberpunk2077.exe', trigger: 'running', sceneId: 'cyberpunk', priority: 90, cooldownSec: 10, restorePrevious: true },
  { name: 'Fortnite', enabled: true, process: 'FortniteClient-Win64-Shipping.exe', trigger: 'running', sceneId: 'gaming', priority: 80, cooldownSec: 10, restorePrevious: true },
  { name: 'VS Code', enabled: true, process: 'Code.exe', trigger: 'foreground', sceneId: 'work', priority: 20, cooldownSec: 30, restorePrevious: true },
  { name: 'Chrome', enabled: false, process: 'chrome.exe', trigger: 'foreground', sceneId: 'relax', priority: 10, cooldownSec: 30, restorePrevious: true },
];

function globToRegex(glob: string): RegExp {
  const esc = glob.trim().toLowerCase().replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp(`^${esc}$`);
}

export function ruleMatches(rule: AutomationRule, snap: ActivitySnapshot): boolean {
  if (!rule.enabled || !rule.process.trim()) return false;
  if (rule.process.trim().toLowerCase() === 'media:playing') return snap.mediaPlaying === true;
  const re = globToRegex(rule.process);
  if (rule.trigger === 'foreground') return snap.foreground != null && re.test(snap.foreground.toLowerCase());
  return snap.processes.some((p) => re.test(p.toLowerCase()));
}

/** Of several matching rules, the highest priority wins; ties go to foreground rules, then to list order. */
export function pickRule(rules: AutomationRule[], snap: ActivitySnapshot): AutomationRule | null {
  let best: AutomationRule | null = null;
  for (const r of rules) {
    if (!ruleMatches(r, snap)) continue;
    if (!best || r.priority > best.priority || (r.priority === best.priority && r.trigger === 'foreground' && best.trigger !== 'foreground')) best = r;
  }
  return best;
}

/** Finds rules that can never win because an equal-or-higher rule always matches whenever they do. */
export function findConflicts(rules: AutomationRule[]): { ruleId: string; shadowedBy: string }[] {
  const out: { ruleId: string; shadowedBy: string }[] = [];
  for (const a of rules) for (const b of rules) {
    if (a === b || !a.enabled || !b.enabled) continue;
    if (a.process.toLowerCase() === b.process.toLowerCase() && a.sceneId !== b.sceneId && b.priority === a.priority && rules.indexOf(b) < rules.indexOf(a))
      out.push({ ruleId: a.id, shadowedBy: b.id });
  }
  return out;
}

export class AutomationEngine {
  activeRuleId: string | null = null;
  /** Scene that was active before automation took over. */
  private savedSceneId: string | null = null;
  private lastFired = new Map<string, number>();
  /** Manual override: automation pauses until this timestamp (or forever if Infinity). */
  overrideUntil = 0;

  constructor(public rules: AutomationRule[] = []) {}

  /** Call when the user picks a scene manually: automation backs off for `minutes`. */
  manualOverride(minutes: number, now = Date.now()): void {
    this.overrideUntil = minutes === Infinity ? Infinity : now + minutes * 60_000;
  }

  clearOverride(): void {
    this.overrideUntil = 0;
  }

  evaluate(snap: ActivitySnapshot, currentSceneId: string | null, now = Date.now()): AutomationDecision {
    if (now < this.overrideUntil) return { type: 'none' };
    const rule = pickRule(this.rules, snap);

    if (!rule) {
      if (!this.activeRuleId) return { type: 'none' };
      const prev = this.rules.find((r) => r.id === this.activeRuleId);
      this.activeRuleId = null;
      const restore = prev?.restorePrevious ?? true;
      const sceneId = this.savedSceneId;
      this.savedSceneId = null;
      return restore ? { type: 'restore', sceneId } : { type: 'none' };
    }

    if (rule.id === this.activeRuleId) return { type: 'none' };
    const last = this.lastFired.get(rule.id) ?? -Infinity;
    if (now - last < rule.cooldownSec * 1000) return { type: 'none' };

    if (!this.activeRuleId) this.savedSceneId = currentSceneId;
    this.activeRuleId = rule.id;
    this.lastFired.set(rule.id, now);
    return { type: 'activate', ruleId: rule.id, sceneId: rule.sceneId };
  }
}
