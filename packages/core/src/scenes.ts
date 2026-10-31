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
  builtin?: boolean;
}

const sw = (effect: SoftwareEffectType): SceneAnimation => ({ kind: 'software', effect });

const s = (id: string, name: string, icon: string, colors: string[], brightness: number, animation: SceneAnimation, speed = 40): Scene => ({
  id, name, icon, colors, brightness, animation, speed, transitionMs: 800, durationMin: null, builtin: true,
});

export const BUILTIN_SCENES: Scene[] = [
  s('halloween', 'Halloween', '🎃', ['#ff2800', '#c000ff', '#ff2800', '#40ff00'], 100, sw('cycle'), 30),
  s('christmas', 'Christmas', '🎄', ['#ff0010', '#00ff30', '#ffd27a'], 85, sw('cycle'), 30),
  s('cinema', 'Cinema', '🎬', ['#1a0a40'], 18, sw('static')),
  s('gaming', 'Gaming', '🎮', ['#7a00ff', '#0040ff', '#ff0090'], 100, sw('fade'), 55),
  s('work', 'Work', '💼', ['#fff1dc'], 100, sw('static')),
  s('relax', 'Relax', '🌿', ['#ff7a30', '#ff4a60'], 45, sw('breathe'), 15),
  s('sunset', 'Sunset', '🌅', ['#ff3a00', '#ff7a10', '#c0204a'], 70, sw('fade'), 12),
  s('night', 'Night', '🌙', ['#ff2a00'], 8, sw('static')),
  s('reading', 'Reading', '📖', ['#ffd9a8'], 90, sw('static')),
  s('cyberpunk', 'Cyberpunk', '🌆', ['#ff00c8', '#00f0ff', '#fff200'], 100, sw('flash'), 45),
  s('horror', 'Horror', '👻', ['#ff0000'], 60, sw('candle'), 60),
  s('custom', 'Custom', '✨', ['#ff7a00', '#5a3cff'], 80, sw('fade'), 40),
];

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
    });
  });
  return { scenes, errors };
}
