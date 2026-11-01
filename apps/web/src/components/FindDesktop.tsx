import { useState } from 'react';
import { desktop, store } from '../store';
import { discoverDesktop } from '../discovery';
import { Button, Card } from './ui';

/**
 * Phone / browser: the controller accepts a single Bluetooth connection, so while GlowPilot Desktop is
 * connected the phone cannot even see it. The fix is to control the lights through the PC.
 */
export function FindDesktopCard({ scanFailed }: { scanFailed?: boolean }) {
  const [state, setState] = useState<'idle' | 'searching' | 'notfound'>('idle');
  const [progress, setProgress] = useState(0);
  if (desktop) return null;

  const find = async () => {
    setState('searching');
    const url = await discoverDesktop((d, t) => setProgress(Math.round((d / t) * 100)));
    if (!url) return setState('notfound');
    store.updateSettings({ remoteUrl: url });
    store.setupMode('remote');
    location.hash = 'settings';
  };

  return (
    <Card className="border-blue-400/25">
      <div className="space-y-3">
        <div className="font-semibold">{scanFailed ? 'Lights not found?' : 'Lights connected to your PC?'}</div>
        <p className="text-sm text-white/60">
          The controller accepts <b>one Bluetooth connection at a time</b>. While GlowPilot Desktop (or Lotus Lantern) is connected to it,
          your phone cannot see it at all. Control the lights <b>through your PC</b> instead: same features, and the PC keeps running your games rules and alarm.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary" disabled={state === 'searching'} onClick={() => void find()}>
            {state === 'searching' ? `Searching your Wi-Fi… ${progress}%` : '🔎 Find GlowPilot Desktop on my Wi-Fi'}
          </Button>
          <Button onClick={() => { store.setupMode('remote'); location.hash = 'settings'; }}>Enter the PC address</Button>
        </div>
        {state === 'notfound' && (
          <p className="text-sm text-orange-200">Not found. Check that the PC is on, GlowPilot Desktop is running, and both are on the same Wi-Fi. Windows may also block it: allow GlowPilot in the Windows Firewall prompt (private networks).</p>
        )}
        <p className="text-xs text-white/40">Direct Bluetooth from the phone works when the PC is off or GlowPilot Desktop is closed (tray → Quit), or after "Take over Bluetooth".</p>
      </div>
    </Card>
  );
}
