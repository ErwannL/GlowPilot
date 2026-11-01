import { useState } from 'react';
import { store, useStore } from '../store';
import { phoneAlarmsAvailable } from '../phoneAlarm';
import { Badge, Button, Card, Field, inputCls, Swatch, Toggle } from './ui';

/**
 * Noyau (the user's personal server app). Two independent links:
 * - Hub: follow Noyau Musique playback and pulse the lights on the beats (token stays on the hub).
 * - Phone: pick alarm music from the Noyau library (downloaded once, kept on the phone).
 */
export function NoyauCard() {
  const s = useStore((x) => x);
  const n = s.hubNoyau;
  const [url, setUrl] = useState(n?.url ?? s.settings.noyauUrl);
  const [token, setToken] = useState('');
  const [pick, setPick] = useState('#8b5cf6');
  const phone = phoneAlarmsAvailable();
  if (!s.hub && !phone) return null;
  const colors = n?.colors ?? ['#8b5cf6', '#f97316', '#3b82f6'];

  return (
    <Card title="Noyau" action={n?.playing ? <Badge tone="green">♪ Music playing</Badge> : n?.hasToken ? <Badge tone="blue">Linked</Badge> : <Badge>Not linked</Badge>}>
      <div className="space-y-4 text-sm text-white/60">
        <p>Connect GlowPilot to your Noyau server: the lights pulse in rhythm with Noyau Musique, and your alarm can ring with a song from your Noyau library. Create the token in Noyau (API tokens) and paste it here.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Noyau address"><input className={inputCls} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://noyau.example.ts.net" /></Field>
          <Field label="Noyau API token" hint={n?.hasToken || s.settings.noyauToken ? 'Saved. Leave empty to keep it.' : undefined}>
            <input className={inputCls} type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="••••••••" />
          </Field>
        </div>
        <Button variant="primary" onClick={() => {
          const clean = url.trim().replace(/\/$/, '');
          if (s.hub) store.saveHubNoyau({ url: clean, ...(token ? { token: token.trim() } : {}) });
          store.updateSettings({ noyauUrl: clean, ...(token ? { noyauToken: token.trim() } : {}) });
          setToken('');
        }}>Save</Button>

        {s.hub && (
          <div className="space-y-3 rounded-2xl bg-white/5 p-3">
            <label className="flex items-center justify-between gap-3">
              <span><b className="text-white/85">Lights follow Noyau Musique</b><span className="block text-xs text-white/45">While a song plays in Noyau, the lights pulse on its beats; your scene comes back when it stops. YouTube songs: no rhythm (Noyau can't analyse them).</span></span>
              <Toggle on={!!n?.musicSync} onChange={(musicSync) => store.saveHubNoyau({ musicSync })} />
            </label>
            <Field label="Colours (one per beat, in turn)">
              <div className="flex flex-wrap items-center gap-2">
                {colors.map((c, i) => <Swatch key={i} color={c} onClick={() => colors.length > 1 && store.saveHubNoyau({ colors: colors.filter((_, j) => j !== i) })} />)}
                <input type="color" value={pick} onChange={(e) => setPick(e.target.value)} className="h-9 w-9 rounded-full bg-transparent" />
                <Button variant="soft" onClick={() => colors.length < 8 && store.saveHubNoyau({ colors: [...colors, pick] })}>Add</Button>
              </div>
            </Field>
            {s.groups.length > 0 && (
              <Field label="Lights">
                <select className={inputCls} value={n?.target ?? 'all'} onChange={(e) => store.saveHubNoyau({ target: e.target.value })}>
                  <option value="all">All lights</option>
                  {s.groups.map((g) => <option key={g.id} value={g.id}>{g.icon} {g.name}</option>)}
                </select>
              </Field>
            )}
            {n && <p className="text-xs text-white/40">Hub ↔ Noyau: {n.status}</p>}
          </div>
        )}
      </div>
    </Card>
  );
}
