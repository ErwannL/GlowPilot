import { store, useStore } from '../store';
import { Button } from './ui';

/** Another GlowPilot holds the lights and this device isn't paired with it: offer to pair once. */
export function MasterHint() {
  const hint = useStore((s) => s.masterHint);
  if (!hint) return null;
  const ip = /\/\/([^:/]+)/.exec(hint.url)?.[1] ?? hint.url;
  return (
    <div className="glass gp-in mb-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border-blue-400/30 px-4 py-3 text-sm">
      <span>💡 Your lights are held by {hint.role === 'hub' ? 'the GlowPilot Hub' : 'GlowPilot on your PC'} ({ip}). Pair with it once to control them from here.</span>
      <Button variant="primary" onClick={() => { store.updateSettings({ remoteUrl: hint.url }); store.connectRemote(); location.hash = 'settings'; }}>Pair</Button>
    </div>
  );
}
