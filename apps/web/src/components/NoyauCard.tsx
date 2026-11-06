import { useState } from 'react';
import { store, useStore } from '../store';
import { GlowAlarm, phoneAlarmsAvailable } from '../phoneAlarm';
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
  const [name, setName] = useState(s.settings.noyauUser ?? '');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pick, setPick] = useState('#8b5cf6');
  const phone = phoneAlarmsAvailable();
  if (!s.hub && !phone) return null;
  const colors = n?.colors ?? ['#8b5cf6', '#f97316', '#3b82f6'];
  const linked = !!(n?.hasToken || s.settings.noyauToken);

  /** Name + password → a Noyau API token. Only the token is kept, never the password. */
  const signIn = async () => {
    const clean = url.trim().replace(/\/$/, '');
    setBusy(true);
    setMsg(null);
    try {
      let r: { token: string; user: string };
      if (phone) r = await GlowAlarm.noyauLogin({ url: clean, name: name.trim(), password });
      else {
        const res = await fetch(`${clean}/api/auth/token`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: name.trim(), password, app: 'GlowPilot' }) });
        const j = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(j?.error?.message ?? `Noyau answered ${res.status}`);
        r = { token: j.token, user: j.user ?? name.trim() };
      }
      if (s.hub) store.saveHubNoyau({ url: clean, token: r.token });
      store.updateSettings({ noyauUrl: clean, noyauToken: r.token, noyauUser: r.user });
      setMsg({ ok: true, text: `Signed in as ${r.user}.` });
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setPassword('');
      setBusy(false);
    }
  };

  return (
    <Card title="Noyau" action={n?.playing ? <Badge tone="green">♪ Music playing</Badge> : linked ? <Badge tone="blue">Linked</Badge> : <Badge>Not linked</Badge>}>
      <div className="space-y-4 text-sm text-white/60">
        <p>Sign in with your Noyau account: the lights pulse in rhythm with Noyau Musique, and your alarm can ring with a song from your library. Your password is only used once to get a music-only key; GlowPilot never keeps it (revoke the key in Noyau › Settings › Tokens).</p>
        {linked && s.settings.noyauUser && <p className="text-white/80">Signed in as <b>{s.settings.noyauUser}</b>.</p>}
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Noyau address"><input className={inputCls} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://noyau.example.ts.net" /></Field>
          <Field label="Name"><input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} autoComplete="username" /></Field>
          <Field label="Password"><input className={inputCls} type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" onKeyDown={(e) => e.key === 'Enter' && void signIn()} /></Field>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="primary" disabled={busy || !name.trim() || !password} onClick={() => void signIn()}>{busy ? 'Signing in…' : linked ? 'Sign in again' : 'Sign in'}</Button>
          {linked && <Button variant="soft" onClick={() => { if (s.hub) store.saveHubNoyau({ token: '' }); store.updateSettings({ noyauToken: '', noyauUser: '' }); setMsg(null); }}>Sign out</Button>}
        </div>
        {msg && <p className={msg.ok ? 'text-emerald-300' : 'text-orange-200'}>{msg.text}</p>}

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
