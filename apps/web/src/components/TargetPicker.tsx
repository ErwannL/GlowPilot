import { store, targetLabel, useStore } from '../store';
import { cx } from './ui';

/** Chooses which lights the controls act on: all, a group, or one light. Hidden with a single light and no groups. */
export function TargetPicker({ compact }: { compact?: boolean }) {
  const s = useStore((x) => x);
  if (s.lights.length <= 1 && s.groups.length === 0) return null;
  const options = [
    { id: 'all', label: 'All lights', icon: '✦' },
    ...s.groups.map((g) => ({ id: g.id, label: g.name, icon: g.icon })),
    ...s.lights.map((l) => ({ id: `dev:${l.id}`, label: l.device.alias || l.device.name, icon: '⌁' })),
  ];
  if (compact)
    return (
      <select aria-label="Lights to control" value={s.target} onChange={(e) => store.setTarget(e.target.value)}
        className="max-w-[9rem] truncate rounded-xl border border-white/10 bg-white/5 px-2 py-1.5 text-xs text-white">
        {options.map((o) => <option key={o.id} value={o.id}>{o.icon} {o.label}</option>)}
      </select>
    );
  return (
    <div className="mb-5 flex flex-wrap items-center gap-2 gp-in">
      <span className="text-xs uppercase tracking-widest text-white/40">Controlling</span>
      {options.map((o) => (
        <button key={o.id} onClick={() => store.setTarget(o.id)}
          className={cx('rounded-full border px-3 py-1.5 text-xs transition', s.target === o.id ? 'border-violet-400/60 bg-violet-500/20 text-white' : 'border-white/10 bg-white/5 text-white/60 hover:bg-white/10')}>
          {o.icon} {o.label}
        </button>
      ))}
      <span className="sr-only">Current: {targetLabel(s, s.target)}</span>
    </div>
  );
}
