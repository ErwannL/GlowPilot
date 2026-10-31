import { useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { desktop } from '../store';
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

type DesktopUpdate = { state: 'checking' | 'none' | 'downloading' | 'ready' | 'error'; version?: string; percent?: number; message?: string };

/**
 * Windows: electron-updater downloads in the background; we offer "Restart now".
 * Android: Android never lets an app install silently, so we download the new APK and the user taps Install.
 */
export function UpdateBanner() {
  const [desk, setDesk] = useState<DesktopUpdate | null>(null);
  const [apk, setApk] = useState<{ version: string; url: string } | null>(null);

  useEffect(() => {
    if (desktop?.onUpdate) {
      desktop.onUpdate(setDesk);
      return;
    }
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
      <Bar text={`GlowPilot ${apk.version} is available.`}>
        <Button variant="primary" onClick={() => window.open(apk.url, '_blank')}>Download & install</Button>
      </Bar>
    );
  if (desk?.state === 'ready')
    return (
      <Bar text={`GlowPilot ${desk.version} is ready. It installs automatically when you quit, or now:`}>
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
