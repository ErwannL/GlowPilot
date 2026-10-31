import { useEffect, useRef, useState, type ReactNode } from 'react';
import { hsvToRgb, rgbToHex, rgbToHsv, type RGB } from '@glowpilot/core';
import type { ConnectionStatus } from '@glowpilot/core';

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

export function Card({ children, className, title, action }: { children: ReactNode; className?: string; title?: ReactNode; action?: ReactNode }) {
  return (
    <section className={cx('glass rounded-3xl p-5 gp-in', className)}>
      {(title || action) && (
        <div className="mb-4 flex items-center justify-between gap-3">
          {title && <h3 className="text-sm font-semibold tracking-wide text-white/70">{title}</h3>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function Button({ children, onClick, variant = 'ghost', className, disabled, title }: {
  children: ReactNode; onClick?: () => void; variant?: 'primary' | 'ghost' | 'danger' | 'soft'; className?: string; disabled?: boolean; title?: string;
}) {
  const v = {
    primary: 'brand-gradient text-white shadow-lg shadow-purple-900/30 hover:brightness-110',
    ghost: 'bg-white/5 text-white/85 hover:bg-white/10 border border-white/10',
    soft: 'bg-glow-purple/15 text-violet-200 hover:bg-glow-purple/25',
    danger: 'bg-red-500/10 text-red-300 hover:bg-red-500/20 border border-red-500/20',
  }[variant];
  return (
    <button title={title} disabled={disabled} onClick={onClick}
      className={cx('inline-flex items-center justify-center gap-2 rounded-2xl px-4 py-2.5 text-sm font-medium transition active:scale-[.97] disabled:opacity-40 disabled:pointer-events-none', v, className)}>
      {children}
    </button>
  );
}

export function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <button role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)}
      className={cx('relative h-7 w-12 shrink-0 rounded-full transition', on ? 'brand-gradient' : 'bg-white/15')}>
      <span className={cx('absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-all', on ? 'left-6' : 'left-1')} />
    </button>
  );
}

/** Slider that updates live while dragging. Throttling happens in the BLE queue, not here. */
export function Slider({ value, onChange, min = 0, max = 100, label, track, suffix = '%', step = 1 }: {
  value: number; onChange: (v: number) => void; min?: number; max?: number; label?: string; track?: string; suffix?: string; step?: number;
}) {
  return (
    <label className="block">
      {label && (
        <div className="mb-1 flex justify-between text-xs text-white/60">
          <span>{label}</span>
          <span className="tabular-nums text-white/80">{Math.round(value)}{suffix}</span>
        </div>
      )}
      <input type="range" className="gp-range" min={min} max={max} step={step} value={value}
        style={{ ['--track' as string]: track ?? `linear-gradient(90deg, #8b5cf6 ${((value - min) / (max - min)) * 100}%, #2f2850 0)` }}
        onChange={(e) => onChange(+e.target.value)} />
    </label>
  );
}

const STATUS: Record<ConnectionStatus, { label: string; dot: string }> = {
  connected: { label: 'Connected', dot: 'bg-emerald-400' },
  connecting: { label: 'Connecting…', dot: 'bg-amber-400 gp-pulse' },
  reconnecting: { label: 'Reconnecting…', dot: 'bg-amber-400 gp-pulse' },
  disconnected: { label: 'Not connected', dot: 'bg-white/30' },
  error: { label: 'Connection error', dot: 'bg-red-400' },
};

export function StatusPill({ status }: { status: ConnectionStatus }) {
  const s = STATUS[status];
  return (
    <span className="inline-flex items-center gap-2 rounded-full bg-white/5 px-3 py-1 text-xs text-white/75 border border-white/10">
      <span className={cx('h-2 w-2 rounded-full', s.dot)} /> {s.label}
    </span>
  );
}

/** HSV colour wheel drawn on canvas. Hue = angle, saturation = radius. */
export function ColorWheel({ color, onChange, size = 260 }: { color: RGB; onChange: (c: RGB) => void; size?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [drag, setDrag] = useState(false);
  const hsv = rgbToHsv(color);

  useEffect(() => {
    const cv = ref.current!;
    const dpr = window.devicePixelRatio || 1;
    cv.width = size * dpr;
    cv.height = size * dpr;
    const ctx = cv.getContext('2d')!;
    const r = (size * dpr) / 2;
    const img = ctx.createImageData(size * dpr, size * dpr);
    for (let y = 0; y < size * dpr; y++)
      for (let x = 0; x < size * dpr; x++) {
        const dx = x - r, dy = y - r, d = Math.hypot(dx, dy);
        if (d > r) continue;
        const h = ((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360;
        const c = hsvToRgb({ h, s: d / r, v: 1 });
        const i = (y * size * dpr + x) * 4;
        const edge = Math.min(1, r - d);
        img.data.set([c.r, c.g, c.b, 255 * edge], i);
      }
    ctx.putImageData(img, 0, 0);
  }, [size]);

  const pick = (e: React.PointerEvent) => {
    const rect = ref.current!.getBoundingClientRect();
    const dx = e.clientX - rect.left - rect.width / 2, dy = e.clientY - rect.top - rect.height / 2;
    const s = Math.min(1, Math.hypot(dx, dy) / (rect.width / 2));
    const h = ((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360;
    onChange(hsvToRgb({ h, s, v: 1 }));
  };

  const a = (hsv.h * Math.PI) / 180;
  const px = 50 + Math.cos(a) * hsv.s * 50, py = 50 + Math.sin(a) * hsv.s * 50;

  return (
    <div className="relative mx-auto touch-none select-none" style={{ width: size, height: size, maxWidth: '100%', aspectRatio: '1' }}>
      <div className="absolute inset-0 rounded-full blur-2xl opacity-40" style={{ background: rgbToHex(color) }} />
      <canvas ref={ref} className="relative h-full w-full rounded-full cursor-crosshair"
        onPointerDown={(e) => { (e.target as HTMLElement).setPointerCapture(e.pointerId); setDrag(true); pick(e); }}
        onPointerMove={(e) => drag && pick(e)} onPointerUp={() => setDrag(false)} />
      <div className="pointer-events-none absolute h-7 w-7 -translate-x-1/2 -translate-y-1/2 rounded-full border-[3px] border-white shadow-xl"
        style={{ left: `${px}%`, top: `${py}%`, background: rgbToHex(color) }} />
    </div>
  );
}

export function Swatch({ color, size = 'md', active, onClick }: { color: string; size?: 'sm' | 'md'; active?: boolean; onClick?: () => void }) {
  return (
    <button onClick={onClick} aria-label={color}
      className={cx('rounded-full border-2 transition hover:scale-110', size === 'sm' ? 'h-6 w-6' : 'h-9 w-9', active ? 'border-white' : 'border-white/10')}
      style={{ background: color, boxShadow: `0 0 16px ${color}55` }} />
  );
}

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-white/55">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-white/60">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-white/40">{hint}</span>}
    </label>
  );
}

export const inputCls = 'w-full rounded-xl border border-white/10 bg-ink-950/60 px-3 py-2.5 text-sm text-white outline-none focus:border-glow-purple/60';

export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'purple' | 'orange' | 'blue' | 'green' }) {
  const t = { neutral: 'bg-white/8 text-white/70', purple: 'bg-violet-500/15 text-violet-200', orange: 'bg-orange-500/15 text-orange-200', blue: 'bg-blue-500/15 text-blue-200', green: 'bg-emerald-500/15 text-emerald-200' }[tone];
  return <span className={cx('inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium', t)}>{children}</span>;
}

export function Modal({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 backdrop-blur-sm sm:items-center sm:p-6" onClick={onClose}>
      <div className="gp-in max-h-[92vh] w-full max-w-xl overflow-y-auto rounded-t-3xl border border-white/10 bg-ink-850 p-6 sm:rounded-3xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button onClick={onClose} className="rounded-full p-2 text-white/50 hover:bg-white/10" aria-label="Close">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}
