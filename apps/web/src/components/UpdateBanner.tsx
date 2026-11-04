import { useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { desktop, useStore } from '../store';
import { GlowAlarm } from '../phoneAlarm';
import { Button } from './ui';

declare const __APP_VERSION__: string;
export const APP_VERSION = __APP_VERSION__;
const RELEASES_API = 'https://api.github.com/repos/ErwannL/GlowPilot/releases/latest';

/** Compares dotted versions: >0 when a is newer than b. */
export function compareVersions(a: string, b: string): number {
  const pa = a.replace(/^v/, '').split('.').map(Number), pb = b.replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d;
  }
  return 0;
}

/**
 * Windows: electron-updater downloads in the background; we offer "Restart now".
 * Android: Android never lets an app install silently, so we download the new APK and the user taps Install.
 */
export function UpdateBanner() {
  const desk = useStore((s) => s.update);
  const [apk, setApk] = useState<{ version: string; url: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  // Real Android update: the app downloads the APK and opens Android's "update this app" screen,
  // so data, permissions and the icon's place are kept (never uninstall).
  const install = async () => {
    if (!apk) return;
    setBusy(true);
    setHint(null);
    try {
      await GlowAlarm.installUpdate({ url: apk.url });
    } catch (e) {
      const m = (e as Error).message;
      setHint(m === 'allow-install' ? 'Allow "Install unknown apps" for GlowPilot in the screen that just opened, come back, and tap Update again. Android asks only once.' : m);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (desktop) return;
    if (!Capacitor.isNativePlatform()) return;
    const check = () =>
      fetch(RELEASES_API, { headers: { Accept: 'application/vnd.github+json' } })
        .then((r) => (r.ok ? r.json() : null))
        .then((rel: { tag_name: string; assets: { name: string; browser_download_url: string }[] } | null) => {
          const asset = rel?.assets.find((a) => a.name.endsWith('.apk'));
          if (rel && asset && compareVersions(rel.tag_name, APP_VERSION) > 0) setApk({ version: rel.tag_name.replace(/^v/, ''), url: asset.browser_download_url });
        })
        .catch(() => {});
    void check();
    const h = setInterval(check, 6 * 60 * 60 * 1000);
    return () => clearInterval(h);
  }, []);

  if (apk)
    return (
      <Bar text={`GlowPilot ${apk.version} is available.${hint ? ' ' + hint : ' It updates in place: your settings and permissions stay.'}`}>
        <Button variant="primary" disabled={busy} onClick={() => void install()}>{busy ? 'Downloading…' : 'Update'}</Button>
      </Bar>
    );
  if (desk?.state === 'ready')
    return (
      <Bar text={`GlowPilot ${desk.version} is ready. It installs by itself when GlowPilot is in the tray, or now:`}>
        <Button variant="primary" onClick={() => desktop?.installUpdate?.()}>Restart & update</Button>
      </Bar>
    );
  if (desk?.state === 'downloading') return <Bar text={`Downloading update${desk.version ? ' ' + desk.version : ''}… ${desk.percent ?? 0}%`} />;
  return null;
}

function Bar({ text, children }: { text: string; children?: React.ReactNode }) {
  return (
    <div className="glass gp-in mb-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border-violet-400/30 px-4 py-3 text-sm">
      <span>⬆ {text}</span>
      {children}
    </div>
  );
}

/** Android Settings: check GitHub now and offer the in-place update. */
export function AndroidUpdateCheck() {
  const [msg, setMsg] = useState('');
  const [apk, setApk] = useState<string | null>(null);
  const check = async () => {
    setMsg('Checking…');
    setApk(null);
    try {
      const r = await fetch(RELEASES_API, { headers: { Accept: 'application/vnd.github+json' } });
      const rel = (await r.json()) as { tag_name: string; assets: { name: string; browser_download_url: string }[] };
      const asset = rel.assets.find((a) => a.name.endsWith('.apk'));
      if (asset && compareVersions(rel.tag_name, APP_VERSION) > 0) { setApk(asset.browser_download_url); setMsg(`${rel.tag_name} is available.`); }
      else setMsg(`You're up to date (${APP_VERSION}).`);
    } catch (e) { setMsg(`Update check failed: ${(e as Error).message}`); }
  };
  const install = async () => {
    try { await GlowAlarm.installUpdate({ url: apk! }); }
    catch (e) { const m = (e as Error).message; setMsg(m === 'allow-install' ? 'Allow "Install unknown apps" for GlowPilot, come back, and tap Update again.' : m); }
  };
  return (
    <div className="mt-2 flex flex-wrap items-center gap-3">
      <Button onClick={() => void check()}>Check for updates</Button>
      <span className="text-xs">{msg}</span>
      {apk && <Button variant="primary" onClick={() => void install()}>Update</Button>}
    </div>
  );
}
