/**
 * App-aware automation. Pure logic: the desktop process watcher feeds it snapshots,
 * it decides which scene (if any) should be active. Fully testable without Windows.
 */

export type RuleTrigger = 'running' | 'foreground';

export interface AutomationRule {
  id: string;
  name: string;
  enabled: boolean;
  /** Executable name, case-insensitive, e.g. "Timberborn.exe". Supports * wildcards and alternatives: "a.exe|b*.exe". */
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
  /** Group of lights it applies to; undefined/null = all lights. */
  targetGroupId?: string | null;
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

/** Default rules: the user's own games (exe names checked in their Steam library on 2026-10-31). */
export const EXAMPLE_RULES: Omit<AutomationRule, 'id'>[] = [
  { name: 'Satisfactory', enabled: true, process: 'FactoryGame*.exe', trigger: 'running', sceneId: 'gaming', priority: 80, cooldownSec: 10, restorePrevious: true },
  { name: 'Timberborn', enabled: true, process: 'Timberborn.exe', trigger: 'running', sceneId: 'relax', priority: 80, cooldownSec: 10, restorePrevious: true },
  { name: 'Over the Hill', enabled: true, process: 'over the hill.exe', trigger: 'running', sceneId: 'sunset', priority: 80, cooldownSec: 10, restorePrevious: true },
  { name: 'Stumble Guys', enabled: true, process: 'Stumble Guys.exe', trigger: 'running', sceneId: 'gaming', priority: 80, cooldownSec: 10, restorePrevious: true },
  // Not installed when checked: names follow the usual Unreal pattern and may need a fix (Automation → pick a running app).
  { name: 'Chained Together', enabled: true, process: 'ChainedTogether*.exe|Chained*Shipping.exe', trigger: 'running', sceneId: 'horror', priority: 80, cooldownSec: 10, restorePrevious: true },
  { name: 'RV There Yet?', enabled: true, process: 'RVThereYet*.exe|RV*Shipping.exe', trigger: 'running', sceneId: 'gaming', priority: 80, cooldownSec: 10, restorePrevious: true },
];

/** Example rules shipped in 0.0.1–0.0.3 for apps the user does not want. */
export const RETIRED_RULE_PROCESSES = ['cyberpunk2077.exe', 'fortniteclient-win64-shipping.exe', 'code.exe', 'chrome.exe'];

function globToRegex(glob: string): RegExp {
  const esc = glob.trim().toLowerCase().replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp(`^${esc}$`);
}

export function ruleMatches(rule: AutomationRule, snap: ActivitySnapshot): boolean {
  if (!rule.enabled || !rule.process.trim()) return false;
  if (rule.process.trim().toLowerCase() === 'media:playing') return snap.mediaPlaying === true;
  const res = rule.process.split('|').map((p) => p.trim()).filter(Boolean).map(globToRegex);
  const hit = (name: string) => res.some((re) => re.test(name.toLowerCase()));
  if (rule.trigger === 'foreground') return snap.foreground != null && hit(snap.foreground);
  return snap.processes.some(hit);
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
