import { useEffect, useState } from 'react';
import { ALARM_DEFAULTS, type AlarmOptions } from '@glowpilot/core';
import { GlowAlarm, phoneAlarmsAvailable } from '../phoneAlarm';
import { Button, Field, inputCls, Modal, Slider, Toggle } from './ui';
import { useStore } from '../store';

type AlarmAction = { type: 'alarm'; minutes: number; color: string } & AlarmOptions;

/**
 * Everything about one wake-up alarm: light build-up, then ringing (music on the phone + light rhythm).
 * Permissions are only requested here, by the user's own tap, never at alarm time.
 */
export function AlarmEditor({ a, onChange, time }: { a: AlarmAction; onChange: (a: AlarmAction) => void; time: string }) {
  const o = { ...ALARM_DEFAULTS, ...a };
  const set = (p: Partial<AlarmAction>) => onChange({ ...a, ...p });
  const phone = phoneAlarmsAvailable();
  const [micOk, setMicOk] = useState<boolean | null>(null);
  useEffect(() => { if (phone) void GlowAlarm.capabilities().then((c) => setMicOk(c.microphone)).catch(() => {}); }, [phone]);

  const ringAt = (() => {
    const m = /^(\d{1,2}):(\d{2})$/.exec(time);
    if (!m) return '';
    const t = (+m[1] * 60 + +m[2] + a.minutes) % 1440;
    return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
  })();

  const chooseRhythm = async (rhythm: AlarmAction['rhythm']) => {
    set({ rhythm });
    // Asked once, now, by your tap. If refused, the alarm simply blinks instead: nothing is ever asked in the morning.
    if (rhythm === 'music' && phone && !micOk) {
      const r = await GlowAlarm.ensureMicrophone().catch(() => ({ granted: false }));
      setMicOk(r.granted);
    }
  };

  const settings = useStore((s) => s.settings);
  const [noyau, setNoyau] = useState<null | { loading?: boolean; error?: string; tracks?: { id: number; title: string; artist?: string }[]; downloading?: number }>(null);
  const openNoyau = async () => {
    if (!settings.noyauToken) return setNoyau({ error: 'Add your Noyau address and token in Settings → Noyau first.' });
    setNoyau({ loading: true });
    try {
      const r = await GlowAlarm.noyauTracks({ url: settings.noyauUrl, token: settings.noyauToken });
      setNoyau({ tracks: r.tracks });
    } catch (e) {
      setNoyau({ error: (e as Error).message });
    }
  };
  const chooseNoyau = async (t: { id: number; title: string; artist?: string }) => {
    setNoyau((n) => ({ ...n, downloading: t.id }));
    try {
      const name = t.artist ? `${t.title} · ${t.artist}` : t.title;
      const snd = await GlowAlarm.downloadNoyauTrack({ url: settings.noyauUrl, token: settings.noyauToken, id: t.id, name });
      set({ sound: snd });
      setNoyau(null);
    } catch (e) {
      setNoyau((n) => ({ ...n, downloading: undefined, error: (e as Error).message }));
    }
  };

  return (
    <div className="space-y-4 rounded-2xl bg-white/5 p-3">
      {noyau && (
        <Modal open onClose={() => setNoyau(null)} title="Music from Noyau">
          {noyau.loading && <p className="text-sm text-white/50 gp-pulse">Loading your library…</p>}
          {noyau.error && <p className="text-sm text-orange-200">{noyau.error}</p>}
          <div className="max-h-[60vh] space-y-1.5 overflow-y-auto">
            {noyau.tracks?.map((t) => (
              <button key={t.id} disabled={noyau.downloading != null} onClick={() => void chooseNoyau(t)}
                className="flex w-full items-center justify-between rounded-xl bg-white/5 px-3 py-2 text-left text-sm hover:bg-white/10 disabled:opacity-50">
                <span className="min-w-0 truncate">{t.title}{t.artist ? <span className="text-white/45"> · {t.artist}</span> : null}</span>
                <span className="text-xs text-violet-300">{noyau.downloading === t.id ? 'Downloading…' : 'Choose'}</span>
              </button>
            ))}
            {noyau.tracks?.length === 0 && <p className="text-sm text-white/50">No uploaded songs in Noyau (YouTube songs can't be used for alarms).</p>}
          </div>
          <p className="mt-3 text-xs text-white/40">The song is downloaded once and kept on the phone: the alarm rings even if Noyau or the Wi-Fi is down.</p>
        </Modal>
      )}
      <div className="text-sm font-semibold">1 · Lights wake you gently</div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Build-up (minutes)" hint={ringAt ? `Lights from ${time}, ringing at ${ringAt}.` : undefined}>
          <input type="number" min={0} max={180} className={inputCls} value={a.minutes} onChange={(e) => set({ minutes: Math.max(0, +e.target.value) })} />
        </Field>
        <Field label="Colour"><input type="color" className="h-11 w-full rounded-xl bg-transparent" value={a.color} onChange={(e) => set({ color: e.target.value })} /></Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Slider label="Start brightness" value={o.startBrightness} onChange={(startBrightness) => set({ startBrightness: Math.min(startBrightness, o.endBrightness) })} />
        <Slider label="Final brightness" value={o.endBrightness} onChange={(endBrightness) => set({ endBrightness: Math.max(endBrightness, o.startBrightness) })} />
      </div>
      <label className="flex items-center justify-between text-sm">Start flashing during the second half <Toggle on={o.flashDuringBuildup} onChange={(flashDuringBuildup) => set({ flashDuringBuildup })} /></label>

      <div className="border-t border-white/10 pt-3 text-sm font-semibold">2 · Then it rings, until you press Stop</div>
      <Field label="Light rhythm while ringing">
        <div className="grid grid-cols-3 gap-2">
          {([['flash', '⚡ Fast flashing'], ['blink', '💡 My rhythm'], ['music', '🎵 With the music']] as const).map(([id, label]) => (
            <button key={id} onClick={() => void chooseRhythm(id)}
              className={`rounded-xl border px-2 py-2 text-xs ${o.rhythm === id ? 'border-violet-400/60 bg-violet-500/20' : 'border-white/10 bg-white/5'}`}>{label}</button>
          ))}
        </div>
      </Field>
      {o.rhythm === 'blink' && (
        <div className="space-y-2">
          <Slider label="Blink speed" value={o.blinkSpeed} onChange={(blinkSpeed) => set({ blinkSpeed })} />
          <label className="flex items-center justify-between text-sm">Faster and faster (over 5 min) <Toggle on={o.accelerate} onChange={(accelerate) => set({ accelerate })} /></label>
        </div>
      )}
      {o.rhythm === 'music' && (
        <p className="text-xs text-white/50">
          The phone listens to the music it plays and the lights pulse with it.
          {phone && micOk === false && <> <b className="text-orange-200">Microphone permission refused</b>: the lights will blink instead. <button className="underline" onClick={() => void chooseRhythm('music')}>Ask again</button></>}
          {!phone && ' Only when the phone rings; the PC blinks instead.'}
        </p>
      )}

      <Field label="Sound (played by the phone)">
        {phone ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-sm">{a.sound === null ? '🔇 Silent (lights only)' : a.sound ? `🎵 ${a.sound.name}` : '🔔 Default alarm sound'}</span>
            <Button onClick={async () => { const s = await GlowAlarm.pickSound().catch(() => null); if (s) set({ sound: s }); }}>Choose music…</Button>
            <Button onClick={() => void openNoyau()}>From Noyau…</Button>
            <Button onClick={() => { const { sound: _s, ...rest } = a; onChange(rest); }}>Default</Button>
            <Button onClick={() => set({ sound: null })}>Silent</Button>
          </div>
        ) : (
          <p className="text-xs text-white/50">Choose the music in GlowPilot on your phone: the phone plays it (PCs may be asleep). Here: {a.sound === null ? 'silent' : a.sound ? a.sound.name : 'default alarm sound'}.</p>
        )}
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Slider label="Max volume" value={o.volume} onChange={(volume) => set({ volume })} />
        <Slider label="Volume rises in" min={0} max={300} step={10} suffix=" s" value={o.soundRampSec} onChange={(soundRampSec) => set({ soundRampSec })} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <label className="flex items-center justify-between rounded-xl bg-white/5 px-3 text-sm">Vibrate <Toggle on={o.vibrate} onChange={(vibrate) => set({ vibrate })} /></label>
        <Field label="Snooze">
          <select className={inputCls} value={o.snoozeMin} onChange={(e) => set({ snoozeMin: +e.target.value })}>
            {[5, 9, 10, 15, 20].map((m) => <option key={m} value={m}>{m} min</option>)}
          </select>
        </Field>
      </div>
    </div>
  );
}
