import { useState } from 'react';
import { hexToRgb, kelvinToRgb, SOFTWARE_EFFECTS, type SoftwareEffectType } from '@glowpilot/core';
import { store, useStore, type UIState } from '../store';
import { Button, Card, inputCls, Modal } from './ui';

/**
 * "Quick actions" on Home, chosen per device (phone and PC keep their own list, in Settings).
 * An action is a short id: 'power', 'pause', 'sleep:30', 'scene:cinema', 'effect:breathe', 'bright:50',
 * 'white', 'warm', 'color:#ff2a00'. Unknown ids (a deleted scene…) are simply not shown.
 */
export const DEFAULT_QUICK_ACTIONS = ['pause', 'power', 'scene:cinema', 'sleep:30', 'white'];

interface Action { id: string; label: string; group: string; run: () => void; swatch?: string; swatches?: string[] }

const EFFECT_COLORS = ['#8b5cf6', '#3b82f6', '#f97316'];

/** Everything that can be a quick action right now (scenes come from this device's scene list). */
export function actionCatalog(s: UIState): Action[] {
  const on = s.snapshot.light.on;
  const exec: typeof store.exec = (...a) => store.exec(...a);
  const list: Action[] = [
    { id: 'power', group: 'Basics', label: on ? 'Turn off' : 'Turn on', run: () => exec({ type: 'power', on: !on }) },
    { id: 'pause', group: 'Basics', label: s.paused ? '▶ Resume GlowPilot' : '⏸ Pause (use the remote)', run: () => (s.paused ? store.resume() : store.pause()) },
    { id: 'white', group: 'Basics', label: '⚪ White', swatch: '#ffffff', run: () => exec({ type: 'color', color: { r: 255, g: 255, b: 255 } }) },
    { id: 'warm', group: 'Basics', label: '🕯 Warm white', swatch: '#ffb46b', run: () => exec({ type: 'color', color: kelvinToRgb(2700) }) },
  ];
  for (const m of [15, 30, 60, 90]) list.push({ id: `sleep:${m}`, group: 'Sleep timer', label: `💤 Sleep in ${m} min`, run: () => exec({ type: 'sleepTimer', minutes: m }) });
  for (const b of [10, 25, 50, 100]) list.push({ id: `bright:${b}`, group: 'Brightness', label: `☀ ${b} %`, run: () => exec({ type: 'brightness', level: b }) });
  for (const sc of s.scenes) list.push({ id: `scene:${sc.id}`, group: 'Scenes', label: `${sc.icon} ${sc.name}`, swatch: sc.colors[0], run: () => exec({ type: 'scene', sceneId: sc.id }) });
  for (const e of SOFTWARE_EFFECTS) {
    list.push({
      id: `effect:${e.type}`, group: 'Effects', label: `✺ ${e.name}`,
      run: () => exec({ type: 'softwareEffect', effect: { type: e.type as SoftwareEffectType, colors: EFFECT_COLORS.map((c) => hexToRgb(c)!), speed: 50 } }),
    });
  }
  return list;
}

/** Turns one saved id into an action (custom colours are not in the catalog). */
export function resolveAction(id: string, catalog: Action[]): Action | null {
  const hit = catalog.find((a) => a.id === id);
  if (hit) return hit;
  // Any value the user typed, not only the presets.
  let m = /^color:(#[0-9a-f]{6})$/i.exec(id);
  if (m) { const hex = m[1]; return { id, group: 'Colours', label: hex.toUpperCase(), swatch: hex, run: () => store.exec({ type: 'color', color: hexToRgb(hex)! }) }; }
  m = /^sleep:(\d{1,3})$/.exec(id);
  if (m) { const min = clampInt(m[1], 1, 600); return { id, group: 'Sleep timer', label: `💤 Sleep in ${min} min`, run: () => store.exec({ type: 'sleepTimer', minutes: min }) }; }
  m = /^bright:(\d{1,3})$/.exec(id);
  if (m) { const lvl = clampInt(m[1], 1, 100); return { id, group: 'Brightness', label: `☀ ${lvl} %`, run: () => store.exec({ type: 'brightness', level: lvl }) }; }
  // effect:<type>:<#hex,#hex,…>:<speed>
  m = /^effect:([a-z]+):((?:#[0-9a-f]{6},?){1,6}):(\d{1,3})$/i.exec(id);
  if (m) {
    const fx = SOFTWARE_EFFECTS.find((e) => e.type === m![1]);
    const colors = m[2].split(',').filter(Boolean);
    const speed = clampInt(m[3], 1, 100);
    if (fx) return {
      id, group: 'Effects', label: `✺ ${fx.name} · speed ${speed}`, swatches: colors,
      run: () => store.exec({ type: 'softwareEffect', effect: { type: fx.type, colors: colors.map((c) => hexToRgb(c)!), speed } }),
    };
  }
  return null;
}

const clampInt = (v: string | number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(Number(v) || lo)));

export function QuickActionsCard() {
  const s = useStore((x) => x);
  const [editing, setEditing] = useState(false);
  const ids = s.settings.quickActions ?? DEFAULT_QUICK_ACTIONS;
  const catalog = actionCatalog(s);
  const shown = ids.map((id) => resolveAction(id, catalog)).filter((a): a is Action => !!a)
    // Pause makes no sense when a hub/PC drives the lights.
    .filter((a) => !(a.id === 'pause' && s.mode === 'remote'));
  const sleepEnds = s.snapshot.sleepTimerEndsAt;

  return (
    <Card title="Quick actions" action={<button className="text-sm text-violet-300" onClick={() => setEditing(true)}>Edit</button>}>
      <div className="flex flex-wrap gap-2" data-testid="quick-actions">
        {shown.map((a) => (
          <Button key={a.id} onClick={a.run}>
            <Swatches a={a} />
            {a.label}
          </Button>
        ))}
        {sleepEnds && <Button onClick={() => store.exec({ type: 'sleepTimer', minutes: null })}>Cancel sleep timer</Button>}
        {shown.length === 0 && <p className="text-sm text-white/50">No quick action on this device. Tap Edit to add some.</p>}
      </div>
      <QuickActionsEditor open={editing} onClose={() => setEditing(false)} ids={ids} catalog={catalog} />
    </Card>
  );
}

/** Colour dots for actions the user built (own colour, own effect colours); presets have their icon. */
function Swatches({ a }: { a: Action }) {
  const list = a.swatches ?? (a.id.startsWith('color:') && a.swatch ? [a.swatch] : []);
  if (!list.length) return null;
  return <span className="flex shrink-0 -space-x-1">{list.map((c, i) => <span key={i} className="h-3 w-3 rounded-full border border-white/30" style={{ background: c }} />)}</span>;
}

function QuickActionsEditor({ open, onClose, ids, catalog }: { open: boolean; onClose: () => void; ids: string[]; catalog: Action[] }) {
  const [pick, setPick] = useState('#ff2a00');
  const [sleepMin, setSleepMin] = useState('4');
  const [bright, setBright] = useState('8');
  const [fxType, setFxType] = useState<string>('breathe');
  const [fxColors, setFxColors] = useState(['#ff2a00', '#5b21b6']);
  const [fxSpeed, setFxSpeed] = useState('50');
  // Read the saved list at click time: two quick taps must both be kept.
  const add = (id: string) => { const cur = store.state.settings.quickActions ?? DEFAULT_QUICK_ACTIONS; if (!cur.includes(id)) save([...cur, id]); };
  const save = (quickActions: string[] | undefined) => store.updateSettings({ quickActions });
  const move = (i: number, d: number) => {
    const next = [...ids];
    const j = i + d;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    save(next);
  };
  const groups = [...new Set(catalog.map((a) => a.group))];
  return (
    <Modal open={open} onClose={onClose} title="Quick actions on this device">
      <p className="mb-3 text-sm text-white/55">Only this device changes: your phone and your PC each keep their own buttons.</p>

      <div className="mb-4 space-y-1.5" data-testid="quick-actions-chosen">
        {ids.length === 0 && <p className="text-sm text-white/45">Nothing yet: add actions below.</p>}
        {ids.map((id, i) => {
          const a = resolveAction(id, catalog);
          return (
            <div key={id} className="flex items-center gap-2 rounded-2xl bg-white/5 px-3 py-2 text-sm">
              {a && <Swatches a={a} />}
              <span className="min-w-0 flex-1 truncate">{a?.label ?? `${id} (not available)`}</span>
              <button aria-label="Move up" className="rounded-lg px-2 py-1 text-white/60 hover:bg-white/10 disabled:opacity-30" disabled={i === 0} onClick={() => move(i, -1)}>↑</button>
              <button aria-label="Move down" className="rounded-lg px-2 py-1 text-white/60 hover:bg-white/10 disabled:opacity-30" disabled={i === ids.length - 1} onClick={() => move(i, 1)}>↓</button>
              <button aria-label={`Remove ${a?.label ?? id}`} className="rounded-lg px-2 py-1 text-red-300 hover:bg-red-500/15" onClick={() => save(ids.filter((x) => x !== id))}>✕</button>
            </div>
          );
        })}
      </div>

      <div className="max-h-[45vh] space-y-3 overflow-y-auto pr-1">
        {groups.map((g) => (
          <div key={g}>
            <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-white/40">{g}</div>
            <div className="flex flex-wrap gap-1.5">
              {catalog.filter((a) => a.group === g).map((a) => {
                const chosen = ids.includes(a.id);
                return (
                  <button key={a.id} data-testid={`qa-${a.id}`} onClick={() => save(chosen ? ids.filter((x) => x !== a.id) : [...ids, a.id])}
                    className={`rounded-xl border px-2.5 py-1.5 text-xs ${chosen ? 'border-violet-400/60 bg-violet-500/20 text-white' : 'border-white/10 bg-white/5 text-white/75'}`}>
                    {a.id === 'power' ? '⏻ On / off' : a.label}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
        <div className="space-y-2 rounded-2xl border border-white/10 p-3" data-testid="qa-custom">
          <div className="text-xs font-semibold uppercase tracking-wide text-white/40">Your own</div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="w-24 text-sm text-white/70">Colour</span>
            <input aria-label="Colour" type="color" value={pick} onChange={(e) => setPick(e.target.value)} className="h-9 w-12 rounded-lg bg-transparent" />
            <Button onClick={() => add(`color:${pick.toLowerCase()}`)}>Add this colour</Button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="w-24 text-sm text-white/70">Sleep timer</span>
            <input aria-label="Sleep minutes" type="number" min={1} max={600} value={sleepMin} onChange={(e) => setSleepMin(e.target.value)} className={inputCls.replace('w-full', 'w-20') + ' py-1.5'} />
            <span className="text-sm text-white/50">min</span>
            <Button onClick={() => add(`sleep:${clampInt(sleepMin, 1, 600)}`)}>Add</Button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="w-24 text-sm text-white/70">Brightness</span>
            <input aria-label="Brightness percent" type="number" min={1} max={100} value={bright} onChange={(e) => setBright(e.target.value)} className={inputCls.replace('w-full', 'w-20') + ' py-1.5'} />
            <span className="text-sm text-white/50">%</span>
            <Button onClick={() => add(`bright:${clampInt(bright, 1, 100)}`)}>Add</Button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="w-24 text-sm text-white/70">Effect</span>
            <select aria-label="Effect" value={fxType} onChange={(e) => setFxType(e.target.value)} className={inputCls.replace('w-full', 'w-40') + ' py-1.5'}>
              {SOFTWARE_EFFECTS.map((e) => <option key={e.type} value={e.type}>{e.name}</option>)}
            </select>
            {fxColors.map((c, i) => (
              <input key={i} aria-label={`Effect colour ${i + 1}`} type="color" value={c} onChange={(e) => setFxColors(fxColors.map((x, j) => (j === i ? e.target.value : x)))} className="h-9 w-10 rounded-lg bg-transparent" />
            ))}
            {fxColors.length < 6 && <button aria-label="Add an effect colour" className="rounded-lg px-2 py-1 text-white/60 hover:bg-white/10" onClick={() => setFxColors([...fxColors, '#3b82f6'])}>＋</button>}
            {fxColors.length > 1 && <button aria-label="Remove an effect colour" className="rounded-lg px-2 py-1 text-white/60 hover:bg-white/10" onClick={() => setFxColors(fxColors.slice(0, -1))}>－</button>}
            <span className="text-sm text-white/50">speed</span>
            <input aria-label="Effect speed" type="number" min={1} max={100} value={fxSpeed} onChange={(e) => setFxSpeed(e.target.value)} className={inputCls.replace('w-full', 'w-20') + ' py-1.5'} />
            <Button onClick={() => add(`effect:${fxType}:${fxColors.map((c) => c.toLowerCase()).join(',')}:${clampInt(fxSpeed, 1, 100)}`)}>Add</Button>
          </div>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap justify-between gap-2">
        <Button onClick={() => save(undefined)}>Reset</Button>
        <Button variant="primary" onClick={onClose}>Done</Button>
      </div>
    </Modal>
  );
}
