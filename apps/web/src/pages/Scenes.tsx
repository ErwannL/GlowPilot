import { useState } from 'react';
import { duplicateScene, effectColorAt, elkDriver, exportScenes, hexToRgb, importScenes, newId, rgbToHex, sceneRgb, SOFTWARE_EFFECTS, type Scene } from '@glowpilot/core';
import { store, useStore } from '../store';
import { Badge, Button, Card, Field, inputCls, Modal, PageHeader, Slider, Swatch } from '../components/ui';
import { download, pickFile, useNow } from '../hooks';

export function Scenes() {
  const scenes = useStore((s) => s.scenes);
  const active = useStore((s) => s.snapshot.activeSceneId);
  const [editing, setEditing] = useState<Scene | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const now = useNow(100);

  const doImport = async () => {
    try {
      const { scenes: imported, errors } = importScenes(await pickFile());
      store.saveScenes([...scenes, ...imported]);
      setMsg(`Imported ${imported.length} scene(s)${errors.length ? ` · ${errors.length} skipped: ${errors.join('; ')}` : ''}`);
    } catch {
      /* cancelled */
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader title="Scenes" subtitle="Complete moods: colours, animation, brightness and timing."
        action={<div className="flex flex-wrap gap-2">
          <Button onClick={doImport}>Import</Button>
          <Button onClick={() => download('glowpilot-scenes.json', exportScenes(scenes.filter((s) => !s.builtin)))}>Export mine</Button>
          <Button variant="primary" onClick={() => setEditing({ id: newId('scene'), name: 'New scene', icon: '✨', colors: ['#8b5cf6', '#f97316'], brightness: 80, animation: { kind: 'software', effect: 'fade' }, speed: 40, transitionMs: 800, durationMin: null })}>+ New scene</Button>
        </div>} />
      {msg && <div className="rounded-2xl bg-white/5 px-4 py-3 text-sm text-white/70">{msg}</div>}

      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
        {scenes.map((s) => {
          const preview = s.animation.kind === 'software' ? rgbToHex(effectColorAt({ type: s.animation.effect, colors: sceneRgb(s), speed: s.speed }, now)) : s.colors[0];
          return (
            <div key={s.id} className={`glass gp-in group relative overflow-hidden rounded-3xl p-4 transition ${active === s.id ? 'ring-2 ring-white/50' : ''}`}>
              <div className="absolute inset-x-0 top-0 h-24 opacity-70 transition-colors" style={{ background: `linear-gradient(180deg, ${preview}66, transparent)` }} />
              <button className="relative block w-full text-left" onClick={() => store.exec({ type: 'scene', sceneId: s.id })}>
                <div className="text-3xl">{s.icon}</div>
                <div className="mt-3 font-semibold">{s.name}</div>
                <div className="mt-1 flex gap-1">{s.colors.map((c, i) => <span key={i} className="h-3 w-3 rounded-full" style={{ background: c }} />)}</div>
                <div className="mt-2 text-[11px] text-white/45">
                  {s.animation.kind === 'controller' ? 'Controller effect' : SOFTWARE_EFFECTS.find((e) => e.type === (s.animation as { effect: string }).effect)?.name} · {s.brightness}%
                  {s.durationMin ? ` · ${s.durationMin} min` : ''}
                </div>
              </button>
              <div className="relative mt-3 flex gap-1 opacity-100 transition sm:opacity-0 sm:group-hover:opacity-100">
                <button className="rounded-lg bg-white/10 px-2 py-1 text-[11px]" onClick={() => setEditing(s)}>Edit</button>
                <button className="rounded-lg bg-white/10 px-2 py-1 text-[11px]" onClick={() => store.saveScenes([...scenes, duplicateScene(s)])}>Duplicate</button>
                {s.builtin ? (
                  <button className="rounded-lg bg-white/10 px-2 py-1 text-[11px]" onClick={() => store.resetScene(s.id)}>Reset</button>
                ) : (
                  <button className="rounded-lg bg-red-500/20 px-2 py-1 text-[11px] text-red-200" onClick={() => confirm(`Delete "${s.name}"?`) && store.saveScenes(scenes.filter((x) => x.id !== s.id))}>Delete</button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {editing && <SceneEditor scene={editing} onClose={() => setEditing(null)} onSave={(sc) => {
        store.saveScenes(scenes.some((x) => x.id === sc.id) ? scenes.map((x) => (x.id === sc.id ? sc : x)) : [...scenes, sc]);
        setEditing(null);
      }} />}
    </div>
  );
}

function SceneEditor({ scene, onClose, onSave }: { scene: Scene; onClose: () => void; onSave: (s: Scene) => void }) {
  const [s, setS] = useState<Scene>(scene);
  const [pick, setPick] = useState('#ff0000');
  const p = (x: Partial<Scene>) => setS({ ...s, ...x });
  const animValue = s.animation.kind === 'controller' ? `c:${s.animation.effectId}` : `s:${s.animation.effect}`;
  return (
    <Modal open onClose={onClose} title={scene.builtin ? `Edit ${scene.name}` : 'Scene'}>
      <div className="space-y-4">
        <div className="grid grid-cols-[80px_1fr] gap-3">
          <Field label="Icon"><input className={inputCls + ' text-center text-xl'} value={s.icon} maxLength={4} onChange={(e) => p({ icon: e.target.value })} /></Field>
          <Field label="Name"><input className={inputCls} value={s.name} onChange={(e) => p({ name: e.target.value })} /></Field>
        </div>
        <Field label="Colours">
          <div className="flex flex-wrap items-center gap-2">
            {s.colors.map((c, i) => (
              <span key={i} className="relative">
                <Swatch color={c} onClick={() => s.colors.length > 1 && p({ colors: s.colors.filter((_, j) => j !== i) })} />
              </span>
            ))}
            <input type="color" value={pick} onChange={(e) => setPick(e.target.value)} className="h-9 w-9 rounded-full bg-transparent" />
            <Button variant="soft" onClick={() => s.colors.length < 16 && p({ colors: [...s.colors, pick] })}>Add</Button>
          </div>
          <span className="mt-1 block text-xs text-white/40">Tap a colour to remove it.</span>
        </Field>
        <Field label="Animation">
          <select className={inputCls} value={animValue} onChange={(e) => {
            const [k, v] = e.target.value.split(':');
            p({ animation: k === 'c' ? { kind: 'controller', effectId: +v } : { kind: 'software', effect: v as never } });
          }}>
            <optgroup label="GlowPilot (uses your colours)">{SOFTWARE_EFFECTS.map((e) => <option key={e.type} value={`s:${e.type}`}>{e.name}</option>)}</optgroup>
            <optgroup label="Controller built-in">{elkDriver.effects.map((e) => <option key={e.id} value={`c:${e.id}`}>{e.name}</option>)}</optgroup>
          </select>
        </Field>
        <Slider label="Brightness" value={s.brightness} onChange={(brightness) => p({ brightness })} />
        <Slider label="Speed" value={s.speed} onChange={(speed) => p({ speed })} />
        <Slider label="Transition" min={0} max={5000} step={100} suffix=" ms" value={s.transitionMs} onChange={(transitionMs) => p({ transitionMs })} />
        <Field label="Duration" hint="Temporary scene: return to the previous scene after this many minutes.">
          <select className={inputCls} value={s.durationMin ?? ''} onChange={(e) => p({ durationMin: e.target.value ? +e.target.value : null })}>
            <option value="">Until changed</option>
            {[5, 15, 30, 60, 120].map((m) => <option key={m} value={m}>{m} minutes</option>)}
          </select>
        </Field>
        <div className="flex items-center gap-2 text-xs text-white/40"><Badge>Tip</Badge> Schedule or automate this scene from the Schedules and Automation pages.</div>
        <div className="flex justify-end gap-2 pt-2">
          <Button onClick={() => store.exec({ type: 'softwareEffect', effect: { type: s.animation.kind === 'software' ? s.animation.effect : 'static', colors: s.colors.map((c) => hexToRgb(c)!), speed: s.speed } })}>Preview</Button>
          <Button variant="primary" onClick={() => onSave({ ...s, name: s.name.trim() || 'Untitled' })}>Save</Button>
        </div>
      </div>
    </Modal>
  );
}
