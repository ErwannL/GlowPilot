import { useState } from 'react';
import { effectColorAt, elkDriver, hexToRgb, rgbToHex, SOFTWARE_EFFECTS, type SoftwareEffectType } from '@glowpilot/core';
import { store, useStore } from '../store';
import { Badge, Button, Card, PageHeader, Slider, Swatch } from '../components/ui';
import { useNow } from '../hooks';

export function Effects() {
  const snap = useStore((s) => s.snapshot);
  const [colors, setColors] = useState<string[]>(snap.softwareEffect?.colors.map(rgbToHex) ?? ['#8b5cf6', '#3b82f6', '#f97316']);
  const [speed, setSpeed] = useState(snap.light.speed);
  const [newColor, setNewColor] = useState('#ff0080');
  const now = useNow(80);

  const runSoftware = (type: SoftwareEffectType) =>
    store.exec({ type: 'softwareEffect', effect: { type, colors: colors.map((c) => hexToRgb(c)!), speed } });

  return (
    <div className="space-y-5">
      <PageHeader title="Effects" subtitle="Animations computed by GlowPilot, or built into the controller." />

      <Card title="Speed">
        <Slider label="Animation speed" value={speed} onChange={(v) => { setSpeed(v); store.exec({ type: 'speed', level: v }); }} />
      </Card>

      <Card title="GlowPilot effects" action={<Badge tone="purple">Any colours · needs app running</Badge>}>
        <div className="mb-4 flex flex-wrap items-center gap-2">
          {colors.map((c, i) => (
            <div key={i} className="group relative">
              <Swatch color={c} />
              {colors.length > 1 && <button onClick={() => setColors(colors.filter((_, j) => j !== i))}
                className="absolute -right-1 -top-1 hidden h-4 w-4 rounded-full bg-black text-[10px] group-hover:block">✕</button>}
            </div>
          ))}
          <input type="color" value={newColor} onChange={(e) => setNewColor(e.target.value)} className="h-9 w-9 cursor-pointer rounded-full border-0 bg-transparent" />
          <Button variant="soft" onClick={() => colors.length < 8 && setColors([...colors, newColor])}>+ Add colour</Button>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {SOFTWARE_EFFECTS.filter((e) => e.type !== 'static').map((e) => {
            const preview = rgbToHex(effectColorAt({ type: e.type, colors: colors.map((c) => hexToRgb(c)!), speed }, now));
            const active = snap.softwareEffect?.type === e.type;
            return (
              <button key={e.type} onClick={() => runSoftware(e.type)}
                className={`rounded-2xl border p-3 text-left transition hover:-translate-y-0.5 ${active ? 'border-white/40 bg-white/10' : 'border-white/5 bg-white/[.03]'}`}>
                <div className="mb-2 h-12 rounded-xl transition-colors" style={{ background: preview, boxShadow: `0 0 24px ${preview}66` }} />
                <div className="text-sm font-medium">{e.name}</div>
                <div className="text-[11px] text-white/45">{e.description}</div>
              </button>
            );
          })}
        </div>
        <p className="mt-4 text-xs text-white/40">GlowPilot only writes when the colour changes and merges rapid updates, so the controller is never flooded.</p>
      </Card>

      <Card title="Controller effects" action={<Badge tone="blue">Runs on the controller · zero traffic</Badge>}>
        <p className="mb-3 text-xs text-white/45">Built into the controller firmware. They keep running even after GlowPilot closes. Exact colours depend on the controller model.</p>
        <div className="flex flex-wrap gap-2">
          {elkDriver.effects.map((e) => (
            <button key={e.id} onClick={() => store.exec({ type: 'controllerEffect', id: e.id })}
              className={`rounded-xl border px-3 py-2 text-xs transition ${snap.light.controllerEffect === e.id ? 'border-white/50 bg-white/15' : 'border-white/10 bg-white/5 hover:bg-white/10'}`}>
              {e.name}
            </button>
          ))}
        </div>
      </Card>

      <Card title="Music-reactive lighting" action={<Badge tone="orange">Desktop</Badge>}>
        <MusicReactive />
      </Card>
    </div>
  );
}

/** Microphone-driven brightness. Runs in the store, so it keeps going (and can be stopped) from any page. */
function MusicReactive() {
  const music = useStore((s) => s.music);
  const color = useStore((s) => s.snapshot.light.color);
  return (
    <div className="flex flex-wrap items-center gap-4">
      <p className="flex-1 text-sm text-white/55">Listens through the microphone and pulses the brightness on the beat. The colour is kept, and brightness is restored when you stop.</p>
      <div className="h-3 w-40 overflow-hidden rounded-full bg-white/10"><div className="h-full transition-all duration-75" style={{ width: `${music.level * 100}%`, background: rgbToHex(color) }} /></div>
      {music.running ? <Button onClick={() => store.stopMusic()}>Stop</Button> : <Button variant="primary" onClick={() => void store.startMusic()}>Start</Button>}
    </div>
  );
}
