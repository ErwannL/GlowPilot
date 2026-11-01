import { useEffect, useState } from 'react';
import { desktop, store, useStore, type Mode, type UpdateInfo } from '../store';
import { WebBluetoothTransport } from '../transports/webBluetooth';
import { discoverDesktop } from '../discovery';
import { GlowAlarm, phoneAlarmsAvailable } from '../phoneAlarm';
import { CapacitorBleTransport } from '../transports/capacitor';
import { Badge, Button, Card, Field, inputCls, PageHeader, Toggle } from '../components/ui';
import { APP_VERSION } from '../components/UpdateBanner';

export function SettingsPage() {
  const s = useStore((x) => x);
  const [code, setCode] = useState('');
  const [url, setUrl] = useState(s.settings.remoteUrl);
  const [pairing, setPairing] = useState<{ code: string; addresses: string[]; port: number; clients: string[] } | null>(null);
  useEffect(() => {
    const d = desktop;
    if (!d) return;
    const load = () => d.getPairing().then(setPairing);
    void load();
    const h = setInterval(load, 5000);
    return () => clearInterval(h);
  }, []);

  const modes: { id: Mode; title: string; desc: string; ok: boolean }[] = [
    { id: 'local', title: 'Direct Bluetooth', desc: CapacitorBleTransport.available ? 'Native Android Bluetooth' : desktop != null ? 'This PC talks to the controller' : 'Web Bluetooth (Chrome / Edge)', ok: WebBluetoothTransport.available || CapacitorBleTransport.available },
    // On GlowPilot Desktop itself this option makes no sense: it IS the desktop. Phones use it.
    ...(desktop ? [] : [{ id: 'remote' as Mode, title: 'Through GlowPilot Desktop', desc: 'Use the PC as the Bluetooth bridge over your local network', ok: true }]),
    { id: 'simulator', title: 'Simulator', desc: 'Try everything without hardware', ok: true },
  ];

  return (
    <div className="space-y-5">
      <PageHeader title="Settings" subtitle="Connection, sync and preferences." />

      <Card title="How this device controls the lights">
        {desktop && <p className="mb-3 text-sm text-white/50">This is <b>GlowPilot Desktop</b>: it talks to your lights directly. Phones and other browsers connect to it (see below).</p>}
        <div className={`grid gap-3 ${desktop ? 'md:grid-cols-2' : 'md:grid-cols-3'}`}>
          {modes.map((m) => (
            <button key={m.id} disabled={!m.ok} onClick={() => store.setupMode(m.id)}
              className={`rounded-2xl border p-4 text-left transition disabled:opacity-35 ${s.mode === m.id ? 'border-violet-400/60 bg-violet-500/10' : 'border-white/10 bg-white/5 hover:bg-white/10'}`}>
              <div className="font-semibold">{m.title}</div>
              <div className="mt-1 text-xs text-white/50">{m.ok ? m.desc : 'Not available here'}</div>
            </button>
          ))}
        </div>
      </Card>

      {s.mode === 'remote' && (
        <Card title="GlowPilot Desktop" action={<Badge tone={s.remote.state === 'connected' ? 'green' : 'orange'}>{s.remote.state}</Badge>}>
          <div className="space-y-3">
            <Field label="Desktop address" hint="Shown in GlowPilot Desktop → Settings, e.g. ws://192.168.1.20:47821">
              <div className="flex gap-2">
                <input className={inputCls} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="ws://192.168.1.20:47821" />
                <Button onClick={() => { store.updateSettings({ remoteUrl: url.trim() }); store.connectRemote(); }}>Connect</Button>
                <Button onClick={async () => { const found = await discoverDesktop(); if (found) { setUrl(found); store.updateSettings({ remoteUrl: found }); store.connectRemote(); } else alert('GlowPilot Desktop not found on this Wi-Fi.'); }}>🔎 Find</Button>
              </div>
            </Field>
            {s.remote.state === 'needsPairing' && (
              <Field label="Pairing code" hint="6 digits shown on the desktop. Pairing happens once per device.">
                <div className="flex gap-2">
                  <input className={inputCls + ' tracking-[.4em] font-mono'} maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
                  <Button variant="primary" disabled={code.length !== 6} onClick={() => store.pair(code)}>Pair</Button>
                </div>
              </Field>
            )}
            {s.remote.message && <p className="text-sm text-orange-200">{s.remote.message}</p>}
            {s.settings.remoteToken && <Button variant="danger" onClick={() => { store.updateSettings({ remoteToken: null }); store.connectRemote(); }}>Unpair</Button>}
          </div>
        </Card>
      )}

      {desktop && pairing && (
        <Card title="Phone & web access" action={<Badge tone="purple">Local network only</Badge>}>
          <p className="mb-4 text-sm text-white/55">Open one of these addresses on your phone (same Wi-Fi), choose "Through GlowPilot Desktop", and enter the code.</p>
          <div className="flex flex-wrap items-center gap-6">
            <div>
              <div className="text-xs text-white/40">Pairing code</div>
              <div className="font-mono text-4xl tracking-[.3em] brand-text">{pairing.code}</div>
            </div>
            <div className="space-y-1 text-sm">
              {sortAddresses(pairing.addresses).map((a, i) => (
                <div key={a} className={`font-mono ${i === 0 ? 'text-white' : 'text-white/40'}`}>http://{a}:{pairing.port}{i === 0 && <span className="ml-2 font-sans text-xs text-violet-300">← most likely</span>}</div>
              ))}
            </div>
          </div>
          <div className="mt-4 text-sm text-white/55">Paired devices: {pairing.clients.length ? pairing.clients.join(', ') : 'none'}</div>
          {pairing.clients.length > 0 && <Button className="mt-2" variant="danger" onClick={() => desktop!.revokeClients()}>Revoke all</Button>}
          <p className="mt-3 text-xs text-white/40">The server only accepts connections from private network addresses and requires pairing. Never forward port {pairing.port} on your router.</p>
          <p className="mt-2 text-xs text-white/40">Bluetooth owner: <b>{s.owner}</b></p>
        </Card>
      )}

      {phoneAlarmsAvailable() && <PhoneAlarmCard />}

      <Card title="Preferences">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="This device's name (shown on the desktop)"><input className={inputCls} value={s.settings.clientName} onChange={(e) => store.updateSettings({ clientName: e.target.value })} /></Field>
          <Field label="Pause automation after a manual change">
            <select className={inputCls} value={s.settings.overrideMinutes} onChange={(e) => store.updateSettings({ overrideMinutes: +e.target.value })}>
              {[5, 15, 30, 60, 120, 240].map((m) => <option key={m} value={m}>{m} minutes</option>)}
            </select>
          </Field>
        </div>
        {desktop && <AutostartToggle />}
      </Card>

      <Card title="About">
        <div className="text-sm text-white/55 space-y-1">
          <div><b className="brand-text">GlowPilot</b> {APP_VERSION}: Your lights. Your atmosphere.</div>
          <div>Works fully offline. No account, no cloud. Updates are checked on GitHub Releases.</div>
          {desktop?.checkForUpdates && (
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <Button onClick={() => desktop!.checkForUpdates!()} disabled={s.update?.state === 'checking'}>Check for updates</Button>
              <span className="text-xs">{updateText(s.update)}</span>
              {s.update?.state === 'ready' && <Button variant="primary" onClick={() => desktop!.installUpdate?.()}>Restart & update</Button>}
            </div>
          )}
          <div>Protocol research credits: Rxflex/LotusLantern (MIT), chameleonbr/LED_UNION (MIT), MikitaLeush/led-control, razibit/Lotus-Lantern-for-Windows-PC.</div>
        </div>
      </Card>
    </div>
  );
}

/** Home Wi-Fi addresses (192.168.x) first; VPN, WSL/Hyper-V and link-local ones last. */
function sortAddresses(list: string[]): string[] {
  const rank = (a: string) => (a.startsWith('192.168.') ? 0 : a.startsWith('10.') ? 1 : a.startsWith('172.') ? 2 : 3);
  return [...list].sort((a, b) => rank(a) - rank(b));
}

function updateText(u: UIStateUpdate): string {
  if (!u) return '';
  switch (u.state) {
    case 'checking': return 'Checking…';
    case 'none': return `You're up to date (${u.current}).`;
    case 'downloading': return `Downloading ${u.version ?? 'update'}… ${u.percent ?? 0}%`;
    case 'ready': return `Version ${u.version} is downloaded.`;
    case 'error': return `Update check failed: ${u.message}`;
    default: return '';
  }
}
type UIStateUpdate = UpdateInfo | null;

/** GlowPilot keeps lights, automations and the alarm running only while it runs: start it with Windows, hidden in the tray. */
function AutostartToggle() {
  const [on, setOn] = useState<boolean | null>(null);
  useEffect(() => { void desktop?.launchAtLogin?.().then(setOn); }, []);
  return (
    <label className="mt-4 flex items-center justify-between gap-4 rounded-2xl bg-white/5 p-3 text-sm">
      <span>
        <b>Start with Windows</b> (hidden in the tray)
        <span className="block text-xs text-white/45">Animations, scene mixes, game rules and the alarm need GlowPilot running. Closing the window keeps it running in the tray; Quit stops it and leaves your lights on a steady colour.</span>
      </span>
      <Toggle on={!!on} onChange={(v) => { desktop?.setLaunchAtLogin(v); setOn(v); }} />
    </label>
  );
}

/** Android: wake-up lights tied to the phone's own alarm clock, run by the PC or, if it's asleep, by the phone. */
function PhoneAlarmCard() {
  const s = useStore((x) => x);
  const st = s.settings;
  const pa = s.phoneAlarm;
  const fmt = (t: number | null | undefined) => (t ? new Date(t).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' }) : '—');
  return (
    <Card title="Wake-up lights with my phone alarm" action={<Toggle on={st.phoneAlarmSync} onChange={(phoneAlarmSync) => store.updateSettings({ phoneAlarmSync })} />}>
      <div className="space-y-3 text-sm text-white/60">
        <p>The lights start before the alarm of your Clock app, build up, and flash when it rings. <b>No need to keep GlowPilot open</b>: Android wakes it at the right time, even locked, like the Clock app.</p>
        <p>At that moment the phone first asks your PC. If the PC is on and connected to the lights, the PC does it. If the PC is asleep, off or unreachable, the phone connects to the lights and does it itself.</p>
        {st.phoneAlarmSync && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Start the lights before the alarm">
              <select className={inputCls} value={st.phoneAlarmMinutes} onChange={(e) => store.updateSettings({ phoneAlarmMinutes: +e.target.value })}>
                {[10, 20, 30, 45, 60, 90].map((m) => <option key={m} value={m}>{m} minutes</option>)}
              </select>
            </Field>
            <Field label="Colour"><input type="color" className="h-11 w-full rounded-xl bg-transparent" value={st.phoneAlarmColor} onChange={(e) => store.updateSettings({ phoneAlarmColor: e.target.value })} /></Field>
          </div>
        )}
        <div className="rounded-xl bg-white/5 p-3 text-xs">
          <div>Next phone alarm: <b className="text-white/85">{fmt(pa?.systemAt)}</b></div>
          <div>Next light alarm handled by this phone: <b className="text-white/85">{fmt(pa?.nextAt)}</b></div>
          <div>PC link for the alarm: <b className="text-white/85">{st.remoteToken ? 'paired ✓' : 'not paired (the phone will always do it alone)'}</b></div>
        </div>
        {pa && !pa.exact && (
          <div className="flex flex-wrap items-center gap-2 text-orange-200">Android needs your OK for exact alarms.<Button onClick={() => void GlowAlarm.openExactAlarmSettings()}>Allow</Button></div>
        )}
        <Button onClick={() => void GlowAlarm.stop()}>Stop a ringing light alarm</Button>
      </div>
    </Card>
  );
}
