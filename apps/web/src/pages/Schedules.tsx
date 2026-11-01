import { useState } from 'react';
import { DAY_LABELS, describeSchedule, newId, nextRun, type Schedule, type ScheduleAction } from '@glowpilot/core';
import { desktop, store, useStore } from '../store';
import { Badge, Button, Card, Field, inputCls, Modal, PageHeader, Toggle } from '../components/ui';

export function Schedules() {
  const s = useStore((x) => x);
  const [edit, setEdit] = useState<Schedule | null>(null);
  const runner = s.mode === 'remote' ? 'GlowPilot Desktop' : desktop ? 'this PC' : 'this browser tab';
  const save = (sc: Schedule) => store.saveSchedules(s.schedules.some((x) => x.id === sc.id) ? s.schedules.map((x) => (x.id === sc.id ? sc : x)) : [...s.schedules, sc]);

  return (
    <div className="space-y-5">
      <PageHeader title="Schedules" subtitle="Wake up with light, fall asleep with it."
        action={<Button variant="primary" onClick={() => setEdit({ id: newId('sch'), name: 'New schedule', enabled: true, time: '07:00', days: [1, 2, 3, 4, 5], action: { type: 'on' } })}>+ New schedule</Button>} />

      <Card className="border-blue-400/20">
        <div className="flex items-start gap-3">
          <span className="text-2xl">ⓘ</span>
          <div className="text-sm text-white/60">
            <b className="text-white/85">Schedules run in GlowPilot, not in the controller.</b> They currently run on <b>{runner}</b>, which must stay on with GlowPilot running and in Bluetooth range.
            Turning the lights off (or any change) stops a ringing alarm.
            {desktop && <> On this PC, GlowPilot <b>wakes Windows from sleep</b> 3 minutes before alarms and sunrises, and keeps it awake while they run. This needs the PC plugged in (on battery Windows ignores wake timers) and does not work if it is shut down.</>}
            The controller has its own timer commands, but they are not verified on your hardware yet. See HARDWARE_COMPATIBILITY.md.
            {!desktop && s.mode !== 'remote' && ' For reliable alarms, use GlowPilot Desktop or the Android app.'}
          </div>
        </div>
      </Card>

      <Card title="Sleep timer">
        <div className="flex flex-wrap gap-2">
          {[15, 30, 60, 90].map((m) => <Button key={m} onClick={() => store.exec({ type: 'sleepTimer', minutes: m })}>{m} min</Button>)}
          {s.snapshot.sleepTimerEndsAt && <Button variant="danger" onClick={() => store.exec({ type: 'sleepTimer', minutes: null })}>Cancel ({new Date(s.snapshot.sleepTimerEndsAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })})</Button>}
        </div>
        <p className="mt-2 text-xs text-white/40">The lights fade out gently over one minute when the timer ends.</p>
      </Card>

      <div className="space-y-3">
        {s.schedules.map((sc) => {
          const n = nextRun(sc, new Date());
          return (
            <div key={sc.id} className="glass gp-in flex flex-wrap items-center gap-4 rounded-3xl p-4">
              <Toggle on={sc.enabled} onChange={(enabled) => save({ ...sc, enabled, firedAt: undefined })} />
              <div className="text-3xl font-light tabular-nums">{sc.time}</div>
              <div className="min-w-0 flex-1">
                <div className="font-semibold">{sc.name}</div>
                <div className="text-sm text-white/50">{describeSchedule(sc)}{sc.action.type === 'scene' ? ` · ${s.scenes.find((x) => x.id === (sc.action as { sceneId: string }).sceneId)?.name ?? ''}` : ''}</div>
                {n && <div className="mt-1"><Badge tone="purple">Next: {n.toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' })}</Badge></div>}
              </div>
              {sc.id === 'phone-alarm' ? <Badge tone="blue">Synced from your phone's alarm</Badge> : <Button onClick={() => setEdit(sc)}>Edit</Button>}
            </div>
          );
        })}
      </div>

      {edit && <ScheduleEditor value={edit} scenes={s.scenes} groups={s.groups} onClose={() => setEdit(null)}
        onDelete={() => { store.saveSchedules(s.schedules.filter((x) => x.id !== edit.id)); setEdit(null); }}
        onSave={(v) => { save({ ...v, firedAt: undefined }); setEdit(null); }} />}
    </div>
  );
}

function ScheduleEditor({ value, scenes, groups, onClose, onSave, onDelete }: {
  value: Schedule; scenes: { id: string; name: string; icon: string }[]; groups: { id: string; name: string; icon: string }[]; onClose: () => void; onSave: (s: Schedule) => void; onDelete: () => void;
}) {
  const [v, setV] = useState(value);
  const setAction = (type: ScheduleAction['type']) => {
    const a: ScheduleAction = type === 'scene' ? { type, sceneId: scenes[0].id } : type === 'sunrise' ? { type, minutes: 20, brightness: 90, color: '#ffa860' }
      : type === 'sunset' ? { type, minutes: 15 } : type === 'alarm' ? { type, minutes: 60, color: '#ff8a30' } : { type };
    setV({ ...v, action: a });
  };
  const a = v.action;
  return (
    <Modal open onClose={onClose} title="Schedule">
      <div className="space-y-4">
        <Field label="Name"><input className={inputCls} value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} /></Field>
        <Field label="Time" hint={a.type === 'sunrise' ? 'Full brightness is reached at this time; the sunrise starts earlier.' : undefined}>
          <input type="time" className={inputCls} value={v.time} onChange={(e) => setV({ ...v, time: e.target.value })} />
        </Field>
        <Field label="Repeat">
          <div className="flex flex-wrap gap-1.5">
            {DAY_LABELS.map((d, i) => (
              <button key={d} onClick={() => setV({ ...v, days: v.days.includes(i) ? v.days.filter((x) => x !== i) : [...v.days, i].sort() })}
                className={`h-10 w-12 rounded-xl text-sm ${v.days.includes(i) ? 'brand-gradient text-white' : 'bg-white/5 text-white/60'}`}>{d}</button>
            ))}
          </div>
          <span className="mt-1 block text-xs text-white/40">No day selected = run once.</span>
        </Field>
        <Field label="Action">
          <select className={inputCls} value={a.type} onChange={(e) => setAction(e.target.value as ScheduleAction['type'])}>
            <option value="on">Turn on</option><option value="off">Turn off</option><option value="scene">Activate a scene</option>
            <option value="alarm">Wake-up alarm (builds up, then flashes until you turn it off)</option>
            <option value="sunrise">Sunrise (gradual wake-up)</option><option value="sunset">Sunset (gradual fade-out)</option>
          </select>
        </Field>
        {a.type === 'scene' && (
          <Field label="Scene"><select className={inputCls} value={a.sceneId} onChange={(e) => setV({ ...v, action: { ...a, sceneId: e.target.value } })}>
            {scenes.map((s) => <option key={s.id} value={s.id}>{s.icon} {s.name}</option>)}</select></Field>
        )}
        {a.type === 'alarm' && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Build-up (minutes)" hint="Starts dim at the time above, gets brighter, flashes faster and faster, then keeps flashing until you turn the lights off.">
              <input type="number" min={1} max={180} className={inputCls} value={a.minutes} onChange={(e) => setV({ ...v, action: { ...a, minutes: Math.max(1, +e.target.value) } })} />
            </Field>
            <Field label="Colour"><input type="color" className="h-11 w-full rounded-xl bg-transparent" value={a.color} onChange={(e) => setV({ ...v, action: { ...a, color: e.target.value } })} /></Field>
          </div>
        )}
        {(a.type === 'sunrise' || a.type === 'sunset') && (
          <Field label="Duration (minutes)"><input type="number" min={1} max={120} className={inputCls} value={a.minutes} onChange={(e) => setV({ ...v, action: { ...a, minutes: Math.max(1, +e.target.value) } })} /></Field>
        )}
        {a.type === 'sunrise' && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Final brightness %"><input type="number" min={1} max={100} className={inputCls} value={a.brightness} onChange={(e) => setV({ ...v, action: { ...a, brightness: +e.target.value } })} /></Field>
            <Field label="Colour"><input type="color" className="h-11 w-full rounded-xl bg-transparent" value={a.color} onChange={(e) => setV({ ...v, action: { ...a, color: e.target.value } })} /></Field>
          </div>
        )}
        {groups.length > 0 && (
          <Field label="Lights">
            <select className={inputCls} value={v.targetGroupId ?? ''} onChange={(e) => setV({ ...v, targetGroupId: e.target.value || null })}>
              <option value="">All lights</option>
              {groups.map((g) => <option key={g.id} value={g.id}>{g.icon} {g.name}</option>)}
            </select>
          </Field>
        )}
        <label className="flex items-center justify-between text-sm">Enabled <Toggle on={v.enabled} onChange={(enabled) => setV({ ...v, enabled })} /></label>
        <div className="flex justify-between pt-2">
          <Button variant="danger" onClick={onDelete}>Delete</Button>
          <div className="flex gap-2"><Button onClick={() => store.testSchedule(v)}>Test now</Button><Button variant="primary" onClick={() => onSave(v)}>Save</Button></div>
        </div>
      </div>
    </Modal>
  );
}
