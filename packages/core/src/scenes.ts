import { hexToRgb, rgbToHex, type RGB } from './color';
import type { SoftwareEffectType } from './effects';

export type SceneAnimation =
  | { kind: 'software'; effect: SoftwareEffectType }
  | { kind: 'controller'; effectId: number };

export interface Scene {
  id: string;
  name: string;
  icon: string;
  /** Hex colours, portable in JSON. */
  colors: string[];
  /** 0–100 */
  brightness: number;
  animation: SceneAnimation;
  /** 0–100 */
  speed: number;
  /** Crossfade from the previous colour, ms. */
  transitionMs: number;
  /** Auto-revert after N minutes (temporary scene); null = indefinite. */
  durationMin: number | null;
  /**
   * Scene mix: when set, the scene plays these other scenes in order, each for `seconds`,
   * then loops. Its own colours/animation are ignored. Nested mixes are not allowed.
   */
  steps?: SceneStep[];
  builtin?: boolean;
}

/** One step of a mix: either another scene, or an inline look (effect + colours) defined right in the step. */
export interface SceneStep {
  seconds: number;
  sceneId?: string;
  look?: SceneLook;
}

export interface SceneLook {
  animation: SceneAnimation;
  colors: string[];
  /** 0–100 */
  speed: number;
  /** 0–100 */
  brightness: number;
}

const sw = (effect: SoftwareEffectType): SceneAnimation => ({ kind: 'software', effect });

const s = (id: string, name: string, icon: string, colors: string[], brightness: number, animation: SceneAnimation, speed = 40): Scene => ({
  id, name, icon, colors, brightness, animation, speed, transitionMs: 800, durationMin: null, builtin: true,
});

export const BUILTIN_SCENES: Scene[] = [
  {
    ...s('halloween', 'Halloween', '🎃', ['#ff3c00', '#ff0000', '#b000ff'], 100, sw('cycle'), 35),
    // Haunted-house loop: smouldering orange/red/violet, a strobe burst, a blackout-and-lightning
    // scare, a violet glow, a blood-red pulse, then again.
    steps: [
      { seconds: 18, look: { animation: sw('cycle'), colors: ['#ff3c00', '#ff0000', '#b000ff'], speed: 35, brightness: 100 } },
      { seconds: 4, look: { animation: sw('strobe'), colors: ['#ff3c00', '#b000ff'], speed: 90, brightness: 100 } },
      { seconds: 9, look: { animation: sw('horror'), colors: ['#ff1000', '#ffffff'], speed: 70, brightness: 100 } },
      { seconds: 12, look: { animation: sw('fade'), colors: ['#b000ff', '#ff3c00'], speed: 55, brightness: 90 } },
      { seconds: 6, look: { animation: sw('breathe'), colors: ['#ff0000'], speed: 70, brightness: 100 } },
      { seconds: 3, look: { animation: sw('strobe'), colors: ['#ffffff', '#ff0000'], speed: 100, brightness: 100 } },
    ],
  },
  s('christmas', 'Christmas', '🎄', ['#ff0010', '#00ff30', '#ffd27a'], 85, sw('cycle'), 30),
  s('cinema', 'Cinema', '🎬', ['#1a0a40'], 18, sw('static')),
  s('gaming', 'Gaming', '🎮', ['#7a00ff', '#0040ff', '#ff0090'], 100, sw('fade'), 55),
  s('work', 'Work', '💼', ['#fff1dc'], 100, sw('static')),
  s('relax', 'Relax', '🌿', ['#ff7a30', '#ff4a60'], 45, sw('breathe'), 15),
  s('sunset', 'Sunset', '🌅', ['#ff3a00', '#ff7a10', '#c0204a'], 70, sw('fade'), 12),
  s('night', 'Night', '🌙', ['#ff2a00'], 8, sw('static')),
  s('reading', 'Reading', '📖', ['#ffd9a8'], 90, sw('static')),
  s('cyberpunk', 'Cyberpunk', '🌆', ['#ff00c8', '#00f0ff', '#fff200'], 100, sw('flash'), 45),
  s('horror', 'Horror', '👻', ['#ff0000', '#ffffff'], 100, sw('horror'), 55),
  s('custom', 'Custom', '✨', ['#ff7a00', '#5a3cff'], 80, sw('fade'), 40),
];

/** Steps that can actually play: inline looks with colours, or existing non-mix scenes. */
export function playableSteps(scene: Scene, all: Scene[]): SceneStep[] {
  return (scene.steps ?? []).filter((st) => {
    if (!(st.seconds > 0)) return false;
    if (st.look) return st.look.colors.length > 0;
    const target = all.find((x) => x.id === st.sceneId);
    return !!target && target.id !== scene.id && !target.steps?.length;
  });
}

/** The scene a step shows (inline looks become a throwaway scene). */
export function stepScene(step: SceneStep, all: Scene[]): Scene | undefined {
  if (step.look) return { id: 'step', name: 'Step', icon: '', transitionMs: 0, durationMin: null, ...step.look };
  return all.find((x) => x.id === step.sceneId);
}

function validLook(raw: unknown): SceneLook | undefined {
  const l = raw as Partial<SceneLook> | undefined;
  if (!l || !Array.isArray(l.colors)) return undefined;
  const colors = l.colors.map((c) => hexToRgb(String(c))).filter(Boolean).map((c) => rgbToHex(c!)).slice(0, 16);
  if (!colors.length) return undefined;
  const a = l.animation as SceneAnimation | undefined;
  const animation: SceneAnimation = a?.kind === 'controller' && typeof a.effectId === 'number' ? { kind: 'controller', effectId: a.effectId }
    : a?.kind === 'software' && typeof a.effect === 'string' ? { kind: 'software', effect: a.effect } : { kind: 'software', effect: 'static' };
  return { animation, colors, speed: clampN(l.speed, 0, 100, 50), brightness: clampN(l.brightness, 0, 100, 100) };
}

export const sceneRgb = (scene: Scene): RGB[] => scene.colors.map((h) => hexToRgb(h) ?? { r: 255, g: 255, b: 255 });

let counter = 0;
export const newId = (prefix = 'id') => `${prefix}-${Date.now().toString(36)}-${(counter++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export function duplicateScene(scene: Scene): Scene {
  return { ...scene, id: newId('scene'), name: `${scene.name} copy`, builtin: false, colors: [...scene.colors] };
}

export interface SceneFile {
  format: 'glowpilot.scenes';
  version: 1;
  scenes: Scene[];
}

export function exportScenes(scenes: Scene[]): string {
  const file: SceneFile = { format: 'glowpilot.scenes', version: 1, scenes: scenes.map(({ builtin: _b, ...rest }) => rest) };
  return JSON.stringify(file, null, 2);
}

const clampN = (v: unknown, lo: number, hi: number, d: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d);

/** Validates untrusted JSON. Invalid scenes are reported, never silently half-imported. */
export function importScenes(json: string): { scenes: Scene[]; errors: string[] } {
  const errors: string[] = [];
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    return { scenes: [], errors: ['File is not valid JSON'] };
  }
  const list = Array.isArray(data) ? data : (data as SceneFile)?.scenes;
  if (!Array.isArray(list)) return { scenes: [], errors: ['No "scenes" array found'] };
  const scenes: Scene[] = [];
  list.forEach((raw, i) => {
    const r = raw as Partial<Scene>;
    if (!r || typeof r.name !== 'string' || !r.name.trim()) return errors.push(`Scene ${i + 1}: missing name`);
    const colors = Array.isArray(r.colors) ? r.colors.map((c) => hexToRgb(String(c))).filter(Boolean) as RGB[] : [];
    if (!colors.length) return errors.push(`Scene "${r.name}": no valid colours`);
    let animation: SceneAnimation = { kind: 'software', effect: 'static' };
    const a = r.animation as SceneAnimation | undefined;
    if (a?.kind === 'controller' && typeof a.effectId === 'number') animation = { kind: 'controller', effectId: a.effectId };
    else if (a?.kind === 'software' && typeof a.effect === 'string') animation = a;
    scenes.push({
      id: newId('scene'),
      name: r.name.trim().slice(0, 60),
      icon: typeof r.icon === 'string' ? r.icon.slice(0, 4) : '✨',
      colors: colors.slice(0, 16).map(rgbToHex),
      brightness: clampN(r.brightness, 0, 100, 80),
      animation,
      speed: clampN(r.speed, 0, 100, 50),
      transitionMs: clampN(r.transitionMs, 0, 60_000, 800),
      durationMin: r.durationMin == null ? null : clampN(r.durationMin, 1, 24 * 60, 60),
      ...(Array.isArray(r.steps) && r.steps.length
        ? {
            steps: r.steps.slice(0, 32).flatMap((st): SceneStep[] => {
              const seconds = clampN(st?.seconds, 1, 3600, 30);
              const look = validLook(st?.look);
              if (look) return [{ seconds, look }];
              return typeof st?.sceneId === 'string' ? [{ seconds, sceneId: st.sceneId }] : [];
            }),
          }
        : {}),
    });
  });
  return { scenes, errors };
}
