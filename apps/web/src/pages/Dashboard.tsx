import { colorName, rgbToHex, SOFTWARE_EFFECTS, elkDriver } from '@glowpilot/core';
import { store, useStore } from '../store';
import { navigate } from '../App';
import { Badge, Button, Card, Slider, StatusPill, Toggle } from '../components/ui';

export function Dashboard() {
  const s = useStore((x) => x);
  const { light, activeSceneId, softwareEffect, sleepTimerEndsAt, ramp, activeRule } = s.snapshot;
  const scene = s.scenes.find((x) => x.id === activeSceneId);
  const rule = s.rules.find((r) => r.id === activeRule);
  const hex = rgbToHex(light.color);
  const connected = s.status === 'connected';
  const mode = light.controllerEffect != null
    ? elkDriver.effects.find((e) => e.id === light.controllerEffect)?.name ?? 'Controller effect'
    : softwareEffect ? SOFTWARE_EFFECTS.find((e) => e.type === softwareEffect.type)?.name : 'Static colour';
  const quick = ['work', 'relax', 'cinema', 'gaming', 'night', 'reading'].map((id) => s.scenes.find((x) => x.id === id)!).filter(Boolean);

  return (
    <div className="space-y-5">
      <div className="gp-in">
        <p className="text-sm text-white/50">{greeting()}</p>
        <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">Your <span className="brand-text">atmosphere</span></h1>
      </div>

      {!s.device && s.mode !== 'remote' && (
        <Card className="border-glow-purple/30">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <div className="font-semibold">Connect your LED controller</div>
              <p className="text-sm text-white/55">Turn the strip on, close Lotus Lantern on other devices, then pick your controller.</p>
            </div>
            <Button variant="primary" onClick={() => store.pickDevice()}>Find my lights</Button>
          </div>
        </Card>
      )}

      <div className="grid gap-5 lg:grid-cols-[1.3fr_1fr]">
        <Card className="relative overflow-hidden">
          <div className="pointer-events-none absolute -right-16 -top-16 h-64 w-64 rounded-full blur-3xl transition-colors duration-700" style={{ background: light.on ? hex : 'transparent', opacity: 0.45 }} />
          <div className="relative flex items-start justify-between gap-4">
            <div>
              <div className="text-xs uppercase tracking-widest text-white/40">Current device</div>
              <div className="mt-1 text-xl font-semibold">{s.device ? s.device.alias || s.device.name : 'No device'}</div>
              <div className="mt-2 flex flex-wrap gap-2">
                <StatusPill status={s.status} />
                {s.mode === 'simulator' && <Badge tone="orange">Simulator</Badge>}
                {s.mode === 'remote' && <Badge tone="blue">Via Desktop</Badge>}
              </div>
            </div>
            <Toggle on={light.on} onChange={(on) => store.exec({ type: 'power', on })} label="Power" />
          </div>

          <div className="relative mt-6 flex items-center gap-5">
            <button onClick={() => navigate('color')} className="h-24 w-24 shrink-0 rounded-[28px] border border-white/15 transition hover:scale-105"
              style={{ background: light.on ? hex : '#1a1730', boxShadow: light.on ? `0 0 50px ${hex}88` : 'none' }} aria-label="Change colour" />
            <div className="min-w-0">
              <div className="text-2xl font-semibold">{light.on ? colorName(light.color) : 'Off'}</div>
              <div className="text-sm text-white/50">{hex.toUpperCase()} · {mode}</div>
              {s.error && <div className="mt-2 text-sm text-red-300">{s.error}</div>}
            </div>
          </div>

          <div className="relative mt-6">
            <Slider label="Brightness" value={light.brightness} onChange={(level) => store.exec({ type: 'brightness', level })} />
          </div>
          {!connected && s.device && s.mode !== 'remote' && (
            <div className="relative mt-4"><Button variant="soft" onClick={() => store.reconnect()}>Reconnect</Button></div>
          )}
        </Card>

        <div className="grid gap-5">
          <Card title="Active scene">
            <div className="flex items-center gap-3">
              <span className="text-3xl">{scene?.icon ?? '—'}</span>
              <div>
                <div className="font-semibold">{scene?.name ?? 'None'}</div>
                <div className="flex gap-1 mt-1">{scene?.colors.map((c) => <span key={c} className="h-3 w-3 rounded-full" style={{ background: c }} />)}</div>
              </div>
            </div>
          </Card>
          <Card title="Automation">
            {rule ? (
              <div><div className="font-semibold">⚡ {rule.name}</div><div className="text-sm text-white/50">Triggered by {rule.process}</div></div>
            ) : (
              <div className="text-sm text-white/50">{s.foreground ? `Watching · focused: ${s.foreground}` : 'No rule active'}</div>
            )}
            {sleepTimerEndsAt && <div className="mt-3 text-sm text-violet-200">💤 Sleep timer · off at {new Date(sleepTimerEndsAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>}
            {ramp && <div className="mt-3 text-sm text-orange-200">{ramp.kind === 'sunrise' ? '🌅 Sunrise' : '🌇 Fading out'} until {new Date(ramp.endsAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>}
          </Card>
        </div>
      </div>

      <Card title="Quick scenes" action={<button className="text-sm text-violet-300" onClick={() => navigate('scenes')}>All scenes →</button>}>
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
          {quick.map((q) => (
            <button key={q.id} onClick={() => store.exec({ type: 'scene', sceneId: q.id })}
              className={`group rounded-2xl border p-3 text-center transition hover:-translate-y-0.5 ${activeSceneId === q.id ? 'border-white/40 bg-white/10' : 'border-white/5 bg-white/[.03] hover:bg-white/[.07]'}`}>
              <div className="mx-auto mb-2 grid h-11 w-11 place-items-center rounded-2xl text-xl" style={{ background: `linear-gradient(135deg, ${q.colors[0]}, ${q.colors[1] ?? q.colors[0]})` }}>{q.icon}</div>
              <div className="text-xs font-medium">{q.name}</div>
            </button>
          ))}
        </div>
      </Card>

      <Card title="Quick actions">
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => store.exec({ type: 'power', on: !light.on })}>{light.on ? 'Turn off' : 'Turn on'}</Button>
          <Button onClick={() => store.exec({ type: 'scene', sceneId: 'cinema' })}>🎬 Cinema mode</Button>
          <Button onClick={() => store.exec({ type: 'sleepTimer', minutes: 30 })}>💤 Sleep in 30 min</Button>
          {sleepTimerEndsAt && <Button onClick={() => store.exec({ type: 'sleepTimer', minutes: null })}>Cancel sleep timer</Button>}
          <Button onClick={() => store.exec({ type: 'color', color: { r: 255, g: 255, b: 255 } })}>⚪ White</Button>
        </div>
      </Card>
    </div>
  );
}

function greeting() {
  const h = new Date().getHours();
  return h < 5 ? 'Good night' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}
