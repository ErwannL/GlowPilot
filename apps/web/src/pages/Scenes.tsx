import { useState } from 'react';
import { duplicateScene, effectColorAt, elkDriver, exportScenes, hexToRgb, importScenes, newId, rgbToHex, sceneRgb, SOFTWARE_EFFECTS, stepScene, type Scene, type SceneAnimation, type SceneStep } from '@glowpilot/core';
import { store, useStore } from '../store';
import { Badge, Button, Card, Field, inputCls, Modal, PageHeader, Slider, Swatch } from '../components/ui';
import { download, pickFile, useNow } from '../hooks';
import { stepLabel } from './Dashboard';

export function Scenes() {
  const scenes = useStore((s) => s.scenes);
  const active = useStore((s) => s.snapshot.activeSceneId);
  const snap = useStore((s) => s.snapshot);
  const mixStep = snap.mixStepSceneId;
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
          const look = (s.steps?.length && stepScene(s.steps[0], scenes)) || s;
          const preview = look.animation.kind === 'software' ? rgbToHex(effectColorAt({ type: look.animation.effect, colors: sceneRgb(look), speed: look.speed }, now)) : look.colors[0];
          return (
            <div key={s.id} className={`glass gp-in group relative overflow-hidden rounded-3xl p-4 transition ${active === s.id ? 'ring-2 ring-white/50' : ''}`}>
              <div className="absolute inset-x-0 top-0 h-24 opacity-70 transition-colors" style={{ background: `linear-gradient(180deg, ${preview}66, transparent)` }} />
              <button className="relative block w-full text-left" onClick={() => store.exec({ type: 'scene', sceneId: s.id })}>
                <div className="text-3xl">{s.icon}</div>
                <div className="mt-3 font-semibold">{s.name}</div>
                <div className="mt-1 flex gap-1">{s.colors.map((c, i) => <span key={i} className="h-3 w-3 rounded-full" style={{ background: c }} />)}</div>
                <div className="mt-2 text-[11px] text-white/45">
                  {s.steps?.length ? `Mix: ${s.steps.map((st) => (st.look ? effectName(st.look.animation) : scenes.find((x) => x.id === st.sceneId)?.name ?? '?')).join(' → ')}` : <>{s.animation.kind === 'controller' ? 'Controller effect' : SOFTWARE_EFFECTS.find((e) => e.type === (s.animation as { effect: string }).effect)?.name} · {s.brightness}%
                  </>}
                  {s.durationMin ? ` · ${s.durationMin} min` : ''}
                </div>
                {active === s.id && mixStep && s.steps?.length ? <div className="mt-1 text-[11px] text-violet-200">▶ now: {stepLabel(snap, scenes)}</div> : null}
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

      {editing && <SceneEditor scene={editing} scenes={scenes} onClose={() => setEditing(null)} onSave={(sc: Scene) => {
        store.saveScenes(scenes.some((x) => x.id === sc.id) ? scenes.map((x) => (x.id === sc.id ? sc : x)) : [...scenes, sc]);
        setEditing(null);
      }} />}
    </div>
  );
}

function SceneEditor({ scene, scenes, onClose, onSave }: { scene: Scene; scenes: Scene[]; onClose: () => void; onSave: (s: Scene) => void }) {
  const [s, setS] = useState<Scene>(scene);
  const isMix = !!s.steps;
  const stepChoices = scenes.filter((x) => x.id !== s.id && !x.steps?.length);
  const setSteps = (steps: SceneStep[]) => setS({ ...s, steps });
  const move = (i: number, d: number) => {
    const st = [...(s.steps ?? [])];
    const j = i + d;
    if (j < 0 || j >= st.length) return;
    [st[i], st[j]] = [st[j], st[i]];
    setSteps(st);
  };
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
        <div className="flex gap-2 rounded-2xl bg-white/5 p-1">
          <button className={`flex-1 rounded-xl px-3 py-2 text-sm ${!isMix ? 'bg-white/15' : 'text-white/50'}`} onClick={() => { const { steps: _s, ...rest } = s; setS(rest); }}>Single look</button>
          <button className={`flex-1 rounded-xl px-3 py-2 text-sm ${isMix ? 'bg-white/15' : 'text-white/50'}`} onClick={() => setS({ ...s, steps: s.steps ?? [
              { seconds: 20, look: { animation: s.animation, colors: s.colors, speed: s.speed, brightness: s.brightness } },
              { seconds: 8, sceneId: 'horror' },
            ] })}>Scene mix</button>
        </div>
        {isMix ? (
          <Field label="Steps (played in order, then repeated)" hint="Mix anything: an effect with its own colours (colour cycle orange/violet, a strobe, horror…) or a whole saved scene.">
            <div className="space-y-2">
              {(s.steps ?? []).map((st, i) => (
                <StepRow key={i} index={i} step={st} choices={stepChoices}
                  onChange={(n) => setSteps(s.steps!.map((x, j) => (j === i ? n : x)))}
                  onMove={(d) => move(i, d)} onRemove={() => setSteps(s.steps!.filter((_, j) => j !== i))} />
              ))}
              <div className="flex flex-wrap gap-2">
                <Button variant="soft" onClick={() => setSteps([...(s.steps ?? []), { seconds: 10, look: { animation: { kind: 'software', effect: 'strobe' }, colors: ['#ff3c00', '#b000ff'], speed: 80, brightness: 100 } }])}>+ Effect step</Button>
                <Button variant="soft" onClick={() => setSteps([...(s.steps ?? []), { sceneId: stepChoices[0]?.id ?? 'horror', seconds: 30 }])}>+ Scene step</Button>
              </div>
            </div>
          </Field>
        ) : (<>
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
        </>)}
        <Slider label="Transition" min={0} max={5000} step={100} suffix=" ms" value={s.transitionMs} onChange={(transitionMs) => p({ transitionMs })} />
        <Field label="Duration" hint="Temporary scene: return to the previous scene after this many minutes.">
          <select className={inputCls} value={s.durationMin ?? ''} onChange={(e) => p({ durationMin: e.target.value ? +e.target.value : null })}>
            <option value="">Until changed</option>
            {[5, 15, 30, 60, 120].map((m) => <option key={m} value={m}>{m} minutes</option>)}
          </select>
        </Field>
        <div className="flex items-center gap-2 text-xs text-white/40"><Badge>Tip</Badge> Schedule or automate this scene from the Schedules and Automation pages.</div>
        <div className="flex justify-end gap-2 pt-2">
          {isMix ? <Button onClick={() => { onSave({ ...s, name: s.name.trim() || 'Untitled' }); setTimeout(() => store.exec({ type: 'scene', sceneId: s.id }), 0); }}>Save & play</Button> : <Button onClick={() => store.exec({ type: 'softwareEffect', effect: { type: s.animation.kind === 'software' ? s.animation.effect : 'static', colors: s.colors.map((c) => hexToRgb(c)!), speed: s.speed } })}>Preview</Button>}
          <Button variant="primary" onClick={() => onSave({ ...s, name: s.name.trim() || 'Untitled' })}>Save</Button>
        </div>
      </div>
    </Modal>
  );
}

const effectName = (a: SceneAnimation) =>
  a.kind === 'controller' ? elkDriver.effects.find((e) => e.id === a.effectId)?.name ?? 'Controller effect' : SOFTWARE_EFFECTS.find((e) => e.type === a.effect)?.name ?? a.effect;

/** One mix step: pick a saved scene, or "Effect" to define colours + animation right here. */
function StepRow({ index, step, choices, onChange, onMove, onRemove }: {
  index: number; step: SceneStep; choices: Scene[]; onChange: (s: SceneStep) => void; onMove: (d: number) => void; onRemove: () => void;
}) {
  const [pick, setPick] = useState('#ff3c00');
  const look = step.look;
  const animValue = look ? (look.animation.kind === 'controller' ? `c:${look.animation.effectId}` : `s:${look.animation.effect}`) : '';
  return (
    <div className="space-y-2 rounded-xl bg-white/5 p-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="w-5 text-center text-xs text-white/40">{index + 1}</span>
        <select className={inputCls + ' min-w-[11rem] flex-1 basis-40 py-2'} value={look ? '__look' : step.sceneId}
          onChange={(e) => onChange(e.target.value === '__look'
            ? { seconds: step.seconds, look: { animation: { kind: 'software', effect: 'cycle' }, colors: ['#ff3c00', '#b000ff'], speed: 50, brightness: 100 } }
            : { seconds: step.seconds, sceneId: e.target.value })}>
          <option value="__look">🎨 Effect with my colours</option>
          <optgroup label="Saved scenes">{choices.map((c) => <option key={c.id} value={c.id}>{c.icon} {c.name}</option>)}</optgroup>
        </select>
        <input type="number" min={1} max={3600} className={inputCls.replace('w-full', 'w-20 shrink-0') + ' py-2'} value={step.seconds}
          onChange={(e) => onChange({ ...step, seconds: Math.max(1, +e.target.value) })} />
        <span className="text-xs text-white/40">s</span>
        <button className="rounded-lg bg-white/10 px-2 py-1 text-xs" onClick={() => onMove(-1)} aria-label="Move up">↑</button>
        <button className="rounded-lg bg-white/10 px-2 py-1 text-xs" onClick={() => onMove(1)} aria-label="Move down">↓</button>
        <button className="rounded-lg bg-red-500/20 px-2 py-1 text-xs" onClick={onRemove} aria-label="Remove">✕</button>
      </div>
      {look && (
        <div className="space-y-2 pl-7">
          <select className={inputCls + ' py-2'} value={animValue} onChange={(e) => {
            const [k, v] = e.target.value.split(':');
            onChange({ ...step, look: { ...look, animation: k === 'c' ? { kind: 'controller', effectId: +v } : { kind: 'software', effect: v as never } } });
          }}>
            <optgroup label="GlowPilot (uses these colours)">{SOFTWARE_EFFECTS.map((e) => <option key={e.type} value={`s:${e.type}`}>{e.name}</option>)}</optgroup>
            <optgroup label="Controller built-in">{elkDriver.effects.map((e) => <option key={e.id} value={`c:${e.id}`}>{e.name}</option>)}</optgroup>
          </select>
          <div className="flex flex-wrap items-center gap-2">
            {look.colors.map((c, j) => <Swatch key={j} size="sm" color={c} onClick={() => look.colors.length > 1 && onChange({ ...step, look: { ...look, colors: look.colors.filter((_, k) => k !== j) } })} />)}
            <input type="color" value={pick} onChange={(e) => setPick(e.target.value)} className="h-7 w-7 rounded-full bg-transparent" />
            <button className="rounded-lg bg-white/10 px-2 py-1 text-xs" onClick={() => look.colors.length < 8 && onChange({ ...step, look: { ...look, colors: [...look.colors, pick] } })}>+ colour</button>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Slider label="Speed" value={look.speed} onChange={(speed) => onChange({ ...step, look: { ...look, speed } })} />
            <Slider label="Brightness" value={look.brightness} onChange={(brightness) => onChange({ ...step, look: { ...look, brightness } })} />
          </div>
        </div>
      )}
    </div>
  );
}
