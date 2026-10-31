import { useEffect, useState } from 'react';
import { rgbToHex } from '@glowpilot/core';
import { store, useStore } from './store';
import { cx, Modal, StatusPill } from './components/ui';
import { Dashboard } from './pages/Dashboard';
import { Devices } from './pages/Devices';
import { ColorPage } from './pages/Color';
import { Effects } from './pages/Effects';
import { Scenes } from './pages/Scenes';
import { Automation } from './pages/Automation';
import { Schedules } from './pages/Schedules';
import { SettingsPage } from './pages/Settings';
import { UpdateBanner } from './components/UpdateBanner';

export const PAGES = [
  { id: 'home', label: 'Home', icon: '◉', el: Dashboard },
  { id: 'devices', label: 'Devices', icon: '⌁', el: Devices },
  { id: 'color', label: 'Color', icon: '◐', el: ColorPage },
  { id: 'effects', label: 'Effects', icon: '✺', el: Effects },
  { id: 'scenes', label: 'Scenes', icon: '❖', el: Scenes },
  { id: 'automation', label: 'Automation', icon: '⚡', el: Automation },
  { id: 'schedules', label: 'Schedules', icon: '◷', el: Schedules },
  { id: 'settings', label: 'Settings', icon: '⚙', el: SettingsPage },
] as const;
export type PageId = (typeof PAGES)[number]['id'];

export const navigate = (p: PageId) => (location.hash = p);

function useRoute(): PageId {
  const get = () => (PAGES.some((p) => p.id === location.hash.slice(1)) ? location.hash.slice(1) : 'home') as PageId;
  const [r, setR] = useState(get);
  useEffect(() => {
    const h = () => { setR(get()); window.scrollTo({ top: 0 }); };
    window.addEventListener('hashchange', h);
    return () => window.removeEventListener('hashchange', h);
  }, []);
  return r;
}

export function App() {
  const route = useRoute();
  const status = useStore((s) => s.status);
  const light = useStore((s) => s.snapshot.light);
  const mode = useStore((s) => s.mode);
  const chooser = useStore((s) => s.btChooser);
  const Page = PAGES.find((p) => p.id === route)!.el;
  const glow = light.on ? rgbToHex(light.color) : '#2a2440';
  const mobileNav = PAGES.filter((p) => ['home', 'color', 'effects', 'scenes', 'settings'].includes(p.id));

  return (
    <div className="relative min-h-full">
      <div className="pointer-events-none fixed inset-0 -z-0 overflow-hidden">
        <div className="absolute -top-40 left-1/3 h-[520px] w-[520px] rounded-full blur-[140px] transition-colors duration-1000" style={{ background: glow, opacity: 0.18 }} />
        <div className="absolute -bottom-40 -left-20 h-[420px] w-[420px] rounded-full bg-glow-purple/15 blur-[140px]" />
        <div className="absolute top-1/3 -right-40 h-[380px] w-[380px] rounded-full bg-glow-orange/10 blur-[140px]" />
      </div>

      <aside className="fixed inset-y-0 left-0 z-20 hidden w-64 flex-col border-r border-white/5 bg-ink-950/60 p-5 backdrop-blur-xl lg:flex">
        <div className="mb-8 flex items-center gap-3 px-2">
          <img src="./icon.svg" alt="" className="h-9 w-9" />
          <div>
            <div className="text-lg font-semibold tracking-tight">GlowPilot</div>
            <div className="text-[11px] text-white/45">Your lights. Your atmosphere.</div>
          </div>
        </div>
        <nav className="flex flex-1 flex-col gap-1">
          {PAGES.map((p) => (
            <a key={p.id} href={'#' + p.id}
              className={cx('flex items-center gap-3 rounded-2xl px-3 py-2.5 text-sm transition', route === p.id ? 'bg-white/10 text-white' : 'text-white/55 hover:bg-white/5 hover:text-white/85')}>
              <span className={cx('grid h-7 w-7 place-items-center rounded-xl text-sm', route === p.id ? 'brand-gradient text-white' : 'bg-white/5')}>{p.icon}</span>
              {p.label}
            </a>
          ))}
        </nav>
        <div className="space-y-2 rounded-2xl bg-white/5 p-3 text-xs text-white/55">
          <StatusPill status={status} />
          <div>{mode === 'remote' ? 'Via GlowPilot Desktop' : mode === 'simulator' ? 'Simulator mode' : 'Direct Bluetooth'}</div>
        </div>
      </aside>

      <header className="sticky top-0 z-20 flex items-center justify-between border-b border-white/5 bg-ink-900/70 px-4 py-3 backdrop-blur-xl lg:hidden" style={{ paddingTop: 'max(12px, env(safe-area-inset-top))' }}>
        <div className="flex items-center gap-2.5">
          <img src="./icon.svg" alt="" className="h-8 w-8" />
          <span className="font-semibold">GlowPilot</span>
        </div>
        <div className="flex items-center gap-2">
          <StatusPill status={status} />
          <details className="relative">
            <summary className="list-none cursor-pointer rounded-xl bg-white/5 px-3 py-1.5 text-sm">☰</summary>
            <div className="absolute right-0 mt-2 w-48 rounded-2xl border border-white/10 bg-ink-850 p-2 shadow-2xl">
              {PAGES.map((p) => (
                <a key={p.id} href={'#' + p.id} onClick={(e) => (e.currentTarget.closest('details') as HTMLDetailsElement).removeAttribute('open')}
                  className="block rounded-xl px-3 py-2 text-sm text-white/75 hover:bg-white/10">{p.icon}  {p.label}</a>
              ))}
            </div>
          </details>
        </div>
      </header>

      <main className="relative z-10 mx-auto max-w-6xl px-4 pb-28 pt-6 lg:ml-64 lg:px-10 lg:pb-12 lg:pt-10 xl:mx-auto xl:pl-[17rem]">
        <UpdateBanner />
        <Page />
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-white/5 bg-ink-950/85 backdrop-blur-xl lg:hidden" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
        {mobileNav.map((p) => (
          <a key={p.id} href={'#' + p.id} className={cx('flex flex-col items-center gap-0.5 py-2.5 text-[11px]', route === p.id ? 'text-white' : 'text-white/45')}>
            <span className={cx('text-lg leading-none', route === p.id && 'brand-text')}>{p.icon}</span>
            {p.label}
          </a>
        ))}
      </nav>

      <Modal open={!!chooser} onClose={() => store.chooseBluetooth('')} title="Choose your controller">
        <p className="mb-4 text-sm text-white/55">GlowPilot only connects to the controller you pick. Close Lotus Lantern on your phone first; the controller accepts one connection at a time.</p>
        <div className="space-y-2">
          {chooser?.length === 0 && <div className="py-6 text-center text-sm text-white/50 gp-pulse">Scanning for nearby controllers…</div>}
          {chooser?.map((d) => (
            <button key={d.id} onClick={() => store.chooseBluetooth(d.id)} className="flex w-full items-center justify-between rounded-2xl bg-white/5 px-4 py-3 text-left hover:bg-white/10">
              <span><span className="font-medium">{d.name.trim() || 'Unnamed device'}</span><span className="block text-xs text-white/40">{d.id}</span></span>
              <span className="text-sm text-violet-300">Connect →</span>
            </button>
          ))}
        </div>
      </Modal>
    </div>
  );
}
