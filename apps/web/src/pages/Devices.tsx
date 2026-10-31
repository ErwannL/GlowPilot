import { useState } from 'react';
import { elkDriver, hexToRgb, rgbToHex, CALIBRATION_SWATCHES } from '@glowpilot/core';
import { store, useStore } from '../store';
import { Badge, Button, Card, Field, inputCls, PageHeader, StatusPill } from '../components/ui';

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

export function Devices() {
  const s = useStore((x) => x);
  const [alias, setAlias] = useState(s.device?.alias ?? '');
  const [step, setStep] = useState(-1);
  const [results, setResults] = useState<Result[]>([]);
  const [raw, setRaw] = useState('7e 07 05 03 ff 00 00 10 ef');
  const connected = s.status === 'connected';
  const remote = s.mode === 'remote';

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
      <PageHeader title="Devices" subtitle="Find, name and test your LED controller." />

      <Card title="Controller" action={<StatusPill status={s.status} />}>
        {s.device ? (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <div className="grid h-12 w-12 place-items-center rounded-2xl brand-gradient text-xl">⌁</div>
              <div>
                <div className="font-semibold">{s.device.alias || s.device.name}</div>
                <div className="text-xs text-white/45">{s.device.name} · {s.device.id}</div>
              </div>
              <div className="ml-auto flex gap-2">
                <Badge tone="purple">{elkDriver.label}</Badge>
                <Badge tone={s.mode === 'simulator' ? 'orange' : 'green'}>{s.mode === 'simulator' ? 'Simulated' : s.transportKind}</Badge>
              </div>
            </div>
            {!remote && (
              <>
                <div className="flex flex-wrap items-end gap-2">
                  <div className="min-w-[200px] flex-1"><Field label="Name"><input className={inputCls} value={alias} placeholder="Living room strip" onChange={(e) => setAlias(e.target.value)} /></Field></div>
                  <Button onClick={() => store.renameDevice(alias)}>Save name</Button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {connected ? <Button onClick={() => store.disconnect()}>Disconnect</Button> : <Button variant="primary" onClick={() => store.reconnect()}>Connect</Button>}
                  <Button onClick={() => store.pickDevice()}>Choose another controller</Button>
                  <Button variant="danger" onClick={() => store.forgetDevice()}>Forget</Button>
                </div>
                {s.lastAckAt > 0 && <p className="text-xs text-emerald-300/80">Controller acknowledged a command {Math.round((Date.now() - s.lastAckAt) / 1000)} s ago (FFF4 echo).</p>}
              </>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-white/60">No controller selected yet. GlowPilot never connects to a nearby controller on its own; you pick it from the list.</p>
            {s.mode === 'local' && <Button variant="primary" onClick={() => store.pickDevice()}>Scan for controllers</Button>}
            {s.mode === 'remote' && <p className="text-sm text-white/50">GlowPilot Desktop has no controller connected.</p>}
          </div>
        )}
        {s.error && <p className="mt-3 text-sm text-red-300">{s.error}</p>}
        <ul className="mt-5 space-y-1 text-xs text-white/40">
          <li>• The controller accepts <b>one connection at a time</b>. Close Lotus Lantern on your phone first.</li>
          <li>• The controller does not report its colour. GlowPilot remembers what it last sent.</li>
        </ul>
      </Card>

      {remote && s.owner === 'desktop' && (
        <Card title="Connection ownership">
          <p className="mb-3 text-sm text-white/60">GlowPilot Desktop currently owns the Bluetooth link. Take it over to control the strip directly from this device, e.g. when you leave the PC.</p>
          <Button onClick={() => store.takeOverFromDesktop()}>Take over Bluetooth</Button>
        </Card>
      )}

      {!remote && (
        <Card title="Hardware test" action={<Badge tone="orange">Physical verification</Badge>}>
          {step < 0 && (
            <div className="space-y-3">
              <p className="text-sm text-white/60">Sends each command once and asks what the strip actually does. This is how features become <b>physically tested</b> instead of only protocol-verified.</p>
              <Button variant="primary" disabled={!connected} onClick={startTest}>Start test</Button>
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

      {!remote && (
        <Card title="Protocol console" action={<Badge>Advanced</Badge>}>
          <div className="flex flex-wrap gap-2">
            <input className={inputCls + ' flex-1 font-mono'} value={raw} onChange={(e) => setRaw(e.target.value)} />
            <Button disabled={!connected} onClick={() => {
              const bytes = raw.replace(/[^0-9a-f]/gi, '').match(/.{2}/g)?.map((h) => parseInt(h, 16)) ?? [];
              if (bytes.length) store.sendRaw(Uint8Array.from(bytes));
            }}>Send frame</Button>
          </div>
          <div className="mt-4 max-h-64 overflow-y-auto rounded-2xl bg-ink-950/70 p-3 font-mono text-xs">
            {s.log.length === 0 && <div className="text-white/30">No traffic yet.</div>}
            {s.log.map((l, i) => (
              <div key={i} className={l.dir === 'tx' ? 'text-sky-300' : 'text-emerald-300'}>
                {new Date(l.at).toLocaleTimeString()} {l.dir === 'tx' ? '→' : '←'} {l.hex}
              </div>
            ))}
          </div>
          {s.sim && (
            <div className="mt-4 flex items-center gap-3 text-sm text-white/60">
              Simulated strip:
              <span className="h-6 w-24 rounded-full border border-white/20" style={{ background: s.sim.on ? rgbToHex(hexToRgb(rgbToHex({ r: s.sim.r, g: s.sim.g, b: s.sim.b }))!) : '#000', opacity: s.sim.on ? 0.3 + s.sim.brightness / 140 : 1 }} />
              {s.sim.effect != null && <span>effect 0x{s.sim.effect.toString(16)}</span>}
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
