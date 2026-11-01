import { useState } from 'react';
import { elkDriver, newId, rgbToHex, CALIBRATION_SWATCHES } from '@glowpilot/core';
import { store, useStore, type LightGroup, type LightView } from '../store';
import { Badge, Button, Card, Field, inputCls, Modal, PageHeader, StatusPill } from '../components/ui';
import { FindDesktopCard } from '../components/FindDesktop';

/** Guided hardware test: each step sends one frame and asks the user what they see. */
const TEST_STEPS: { label: string; expect: string; run: () => void }[] = [
  { label: 'Power on', expect: 'The strip turns on', run: () => store.exec({ type: 'power', on: true }) },
  ...CALIBRATION_SWATCHES.map((s) => ({ label: s.name, expect: `The strip shows ${s.name.toLowerCase()}`, run: () => store.exec({ type: 'color', color: s.rgb }) })),
  { label: 'Brightness 20 %', expect: 'The strip dims clearly', run: () => store.exec({ type: 'brightness', level: 20 }) },
  { label: 'Brightness 100 %', expect: 'Full brightness again', run: () => store.exec({ type: 'brightness', level: 100 }) },
  { label: 'Controller effect: 7-colour jump', expect: 'Colours jump by themselves', run: () => store.exec({ type: 'controllerEffect', id: 0x88 }) },
  { label: 'Effect speed 90 %', expect: 'The jumping gets faster', run: () => store.exec({ type: 'speed', level: 90 }) },
  { label: 'Warm white (colour temperature)', expect: 'Warm white (no effect = no white channel)', run: () => store.exec({ type: 'colorTemperature', warm: 100 }) },
  { label: 'Power off', expect: 'The strip turns off', run: () => store.exec({ type: 'power', on: false }) },
];

type Result = 'pass' | 'fail' | 'skip';
const GROUP_ICONS = ['🛋️', '🛏️', '🖥️', '🍳', '🎮', '📺', '🌙', '✨'];

export function Devices() {
  const s = useStore((x) => x);
  const [step, setStep] = useState(-1);
  const [results, setResults] = useState<Result[]>([]);
  const [raw, setRaw] = useState('7e 07 05 03 ff 00 00 10 ef');
  const [editGroup, setEditGroup] = useState<LightGroup | null>(null);
  const remote = s.mode === 'remote';
  const anyConnected = s.lights.some((l) => l.status === 'connected');

  const startTest = () => { setResults([]); setStep(0); TEST_STEPS[0].run(); };
  const answer = (r: Result) => {
    const res = [...results, r];
    setResults(res);
    const next = step + 1;
    if (next < TEST_STEPS.length) { setStep(next); TEST_STEPS[next].run(); } else setStep(TEST_STEPS.length);
  };
  const report = () => {
    const lines = [
      `GlowPilot hardware test — ${new Date().toISOString()}`,
      `Device: ${s.device?.name} (${s.device?.id}) via ${s.transportKind}`,
      ...TEST_STEPS.map((t, i) => `${results[i] ?? 'not run'}\t${t.label}`),
    ];
    void navigator.clipboard?.writeText(lines.join('\n'));
  };

  return (
    <div className="space-y-5">
      <PageHeader title="Devices" subtitle="Your controllers, and the groups you control together."
        action={!remote && <div className="flex gap-2">
          {s.mode === 'simulator' && <Button onClick={() => store.addSimulatedLight()}>+ Simulated light</Button>}
          {s.mode === 'local' && <Button variant="primary" onClick={() => store.addLight()}>+ Add a light</Button>}
        </div>} />

      {s.error && <div className="rounded-2xl bg-red-500/10 px-4 py-3 text-sm text-red-200">{s.error}</div>}

      {s.lights.length === 0 && s.mode === 'local' && <FindDesktopCard scanFailed={!!s.error} />}

      {s.lights.length === 0 ? (
        <Card>
          <p className="text-sm text-white/60">No controller yet. GlowPilot never connects to a nearby controller on its own: you pick it from the list.</p>
          {s.mode === 'local' && <Button className="mt-3" variant="primary" onClick={() => store.addLight()}>Scan for controllers</Button>}
          {remote && <p className="mt-2 text-sm text-white/50">GlowPilot Desktop has no controller connected.</p>}
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {s.lights.map((l) => <LightCard key={l.id} light={l} remote={remote} groups={s.groups.filter((g) => g.deviceIds.includes(l.id)).map((g) => g.name)} />)}
        </div>
      )}
      <p className="text-xs text-white/40">Each controller accepts <b>one connection at a time</b>: close Lotus Lantern on your phone first. Controllers don't report their colour, so GlowPilot remembers what it last sent.</p>

      {!remote && (
        <Card title="Groups" action={<Button variant="soft" disabled={s.lights.length === 0} onClick={() => setEditGroup({ id: newId('grp'), name: 'Living room', icon: '🛋️', deviceIds: s.lights.map((l) => l.id) })}>+ New group</Button>}>
          {s.groups.length === 0 ? (
            <p className="text-sm text-white/50">Groups let you put some lights on one theme and others on another, e.g. "Desk" on Gaming while "Bed" stays on Relax. Pick the group at the top of Home, Color, Effects or Scenes; automations and schedules can target a group too.</p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {s.groups.map((g) => (
                <div key={g.id} className="flex items-center gap-3 rounded-2xl bg-white/5 p-3">
                  <span className="text-2xl">{g.icon}</span>
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">{g.name}</div>
                    <div className="truncate text-xs text-white/45">{g.deviceIds.map((id) => s.lights.find((l) => l.id === id)).filter(Boolean).map((l) => l!.device.alias || l!.device.name).join(', ') || 'No lights'}</div>
                  </div>
                  <Button onClick={() => setEditGroup(g)}>Edit</Button>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {remote && s.owner === 'desktop' && (
        <Card title="Connection ownership">
          <p className="mb-3 text-sm text-white/60">GlowPilot Desktop currently owns the Bluetooth link. Take it over to control the strip directly from this device, e.g. when you leave the PC.</p>
          <Button onClick={() => store.takeOverFromDesktop()}>Take over Bluetooth</Button>
        </Card>
      )}

      {!remote && s.lights.length > 0 && (
        <Card title="Hardware test" action={<Badge tone="orange">Physical verification</Badge>}>
          {step < 0 && (
            <div className="space-y-3">
              <p className="text-sm text-white/60">Sends each command to the lights selected at the top (currently: <b>{s.device?.alias || s.device?.name}</b>{s.lights.length > 1 ? ' and the rest of the target' : ''}) and asks what they actually do.</p>
              <Button variant="primary" disabled={!anyConnected} onClick={startTest}>Start test</Button>
            </div>
          )}
          {step >= 0 && step < TEST_STEPS.length && (
            <div className="space-y-4">
              <div className="text-xs text-white/40">Step {step + 1} / {TEST_STEPS.length}</div>
              <div className="text-lg font-semibold">{TEST_STEPS[step].label}</div>
              <p className="text-sm text-white/60">Expected: {TEST_STEPS[step].expect}. Does it?</p>
              <div className="flex gap-2">
                <Button variant="primary" onClick={() => answer('pass')}>Yes</Button>
                <Button variant="danger" onClick={() => answer('fail')}>No</Button>
                <Button onClick={() => answer('skip')}>Skip</Button>
                <Button onClick={() => TEST_STEPS[step].run()}>Resend</Button>
              </div>
            </div>
          )}
          {step >= TEST_STEPS.length && (
            <div className="space-y-3">
              <div className="grid gap-1 text-sm">
                {TEST_STEPS.map((t, i) => (
                  <div key={t.label} className="flex justify-between rounded-xl bg-white/5 px-3 py-1.5">
                    <span>{t.label}</span>
                    <span className={results[i] === 'pass' ? 'text-emerald-300' : results[i] === 'fail' ? 'text-red-300' : 'text-white/40'}>{results[i]}</span>
                  </div>
                ))}
              </div>
              <div className="flex gap-2"><Button onClick={report}>Copy report</Button><Button onClick={() => setStep(-1)}>Done</Button></div>
            </div>
          )}
        </Card>
      )}

      {!remote && s.lights.length > 0 && (
        <Card title="Protocol console" action={<Badge>Advanced</Badge>}>
          <div className="flex flex-wrap gap-2">
            <input className={inputCls + ' flex-1 font-mono'} value={raw} onChange={(e) => setRaw(e.target.value)} />
            <Button disabled={!anyConnected} onClick={() => {
              const bytes = raw.replace(/[^0-9a-f]/gi, '').match(/.{2}/g)?.map((h) => parseInt(h, 16)) ?? [];
              if (bytes.length) store.sendRaw(Uint8Array.from(bytes));
            }}>Send frame</Button>
          </div>
          <div className="mt-4 max-h-64 overflow-y-auto rounded-2xl bg-ink-950/70 p-3 font-mono text-xs">
            {s.log.length === 0 && <div className="text-white/30">No traffic yet.</div>}
            {s.log.map((l, i) => (
              <div key={i} className={l.dir === 'tx' ? 'text-sky-300' : 'text-emerald-300'}>
                {new Date(l.at).toLocaleTimeString()} {s.lights.length > 1 ? `[${l.light}] ` : ''}{l.dir === 'tx' ? '→' : '←'} {l.hex}
              </div>
            ))}
          </div>
        </Card>
      )}

      {editGroup && (
        <Modal open onClose={() => setEditGroup(null)} title="Group">
          <div className="space-y-4">
            <div className="grid grid-cols-[1fr_auto] gap-3">
              <Field label="Name"><input className={inputCls} value={editGroup.name} onChange={(e) => setEditGroup({ ...editGroup, name: e.target.value })} /></Field>
              <Field label="Icon">
                <select className={inputCls} value={editGroup.icon} onChange={(e) => setEditGroup({ ...editGroup, icon: e.target.value })}>
                  {GROUP_ICONS.map((i) => <option key={i}>{i}</option>)}
                </select>
              </Field>
            </div>
            <Field label="Lights in this group">
              <div className="space-y-2">
                {s.lights.map((l) => (
                  <label key={l.id} className="flex items-center gap-3 rounded-xl bg-white/5 px-3 py-2 text-sm">
                    <input type="checkbox" checked={editGroup.deviceIds.includes(l.id)}
                      onChange={(e) => setEditGroup({ ...editGroup, deviceIds: e.target.checked ? [...editGroup.deviceIds, l.id] : editGroup.deviceIds.filter((x) => x !== l.id) })} />
                    {l.device.alias || l.device.name}
                  </label>
                ))}
              </div>
            </Field>
            <div className="flex justify-between pt-2">
              <Button variant="danger" onClick={() => { store.saveGroups(s.groups.filter((g) => g.id !== editGroup.id)); setEditGroup(null); }}>Delete</Button>
              <Button variant="primary" disabled={!editGroup.name.trim()} onClick={() => {
                const g = { ...editGroup, name: editGroup.name.trim() };
                store.saveGroups(s.groups.some((x) => x.id === g.id) ? s.groups.map((x) => (x.id === g.id ? g : x)) : [...s.groups, g]);
                setEditGroup(null);
              }}>Save group</Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function LightCard({ light, remote, groups }: { light: LightView; remote: boolean; groups: string[] }) {
  const [alias, setAlias] = useState(light.device.alias ?? '');
  const [editing, setEditing] = useState(false);
  const connected = light.status === 'connected';
  const c = light.sim ?? (light.snapshot.light.on ? light.snapshot.light.color : null);
  const swatch = c && (!light.sim || light.sim.on) ? rgbToHex({ r: c.r, g: c.g, b: c.b }) : '#15121f';
  return (
    <div className="glass gp-in rounded-3xl p-4">
      <div className="flex items-center gap-3">
        <div className="h-12 w-12 shrink-0 rounded-2xl border border-white/10 transition-colors" style={{ background: swatch, boxShadow: swatch !== '#15121f' ? `0 0 22px ${swatch}77` : 'none' }} />
        <div className="min-w-0 flex-1">
          {editing ? (
            <div className="flex gap-2">
              <input autoFocus className={inputCls + ' py-1.5'} value={alias} placeholder={light.device.name} onChange={(e) => setAlias(e.target.value)} />
              <Button onClick={() => { store.renameLight(light.id, alias.trim()); setEditing(false); }}>Save</Button>
            </div>
          ) : (
            <button className="block max-w-full truncate text-left font-semibold hover:underline" onClick={() => !remote && setEditing(true)} title="Rename">
              {light.device.alias || light.device.name}
            </button>
          )}
          <div className="truncate text-xs text-white/40">{light.device.name} · {light.id}</div>
        </div>
        <StatusPill status={light.status} />
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        <Badge tone="purple">{elkDriver.label}</Badge>
        {light.sim && <Badge tone="orange">Simulated</Badge>}
        {groups.map((g) => <Badge key={g} tone="blue">{g}</Badge>)}
      </div>
      {light.error && <p className="mt-2 text-xs text-red-300">{light.error}</p>}
      {!remote && (
        <div className="mt-3 flex flex-wrap gap-2">
          {connected ? <Button onClick={() => store.disconnect(light.id)}>Disconnect</Button> : <Button variant="primary" onClick={() => store.connectLight(light.id)}>Connect</Button>}
          <Button onClick={() => { store.setTarget(`dev:${light.id}`); location.hash = 'color'; }}>Control / calibrate</Button>
          <Button variant="danger" onClick={() => confirm(`Remove ${light.device.alias || light.device.name}?`) && store.removeLight(light.id)}>Remove</Button>
        </div>
      )}
    </div>
  );
}
