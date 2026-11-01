import { useEffect, useState } from 'react';
import {
  applyCalibration, CALIBRATION_SWATCHES, colorName, DEFAULT_CALIBRATION, hexToRgb, hsvToRgb, IDENTITY_CALIBRATION,
  kelvinToRgb, rgbToHex, rgbToHsv, type Calibration, type RGB,
} from '@glowpilot/core';
import { store, useStore } from '../store';
import { Button, Card, ColorWheel, inputCls, PageHeader, Slider, Swatch } from '../components/ui';

const PRESETS = ['#ff0000', '#ff6a00', '#ffc400', '#00ff40', '#00e5ff', '#0040ff', '#8000ff', '#ff00aa', '#ffffff', '#ffb070'];

export function ColorPage() {
  const light = useStore((s) => s.snapshot.light);
  const device = useStore((s) => s.device);
  const remote = useStore((s) => s.mode === 'remote' && !s.hub);
  const [color, setColor] = useState<RGB>(light.color);
  const [hex, setHex] = useState(rgbToHex(light.color));
  const [kelvin, setKelvin] = useState(3200);
  useEffect(() => setHex(rgbToHex(color)), [color]);

  const send = (c: RGB) => { setColor(c); store.exec({ type: 'color', color: c }); };
  const hsv = rgbToHsv(color);

  return (
    <div className="space-y-5">
      <PageHeader title="Color" subtitle="Pick exactly the colour you want. Calibration makes the strip match it." />
      <div className="grid gap-5 lg:grid-cols-[1fr_1fr]">
        <Card>
          <ColorWheel color={hsvToRgb({ ...hsv, v: 1 })} onChange={(c) => send(hsvToRgb({ ...rgbToHsv(c), v: Math.max(hsv.v, 0.05) }))} size={280} />
          <div className="mt-5 flex items-center justify-between">
            <div>
              <div className="text-xl font-semibold">{colorName(color)}</div>
              <div className="text-sm text-white/50">RGB {color.r}, {color.g}, {color.b}</div>
            </div>
            <input className={inputCls + ' w-32 text-center font-mono uppercase'} value={hex}
              onChange={(e) => { setHex(e.target.value); const c = hexToRgb(e.target.value); if (c && /^#?[0-9a-f]{6}$/i.test(e.target.value)) send(c); }} />
          </div>
          <div className="mt-4 flex flex-wrap gap-2">{PRESETS.map((p) => <Swatch key={p} color={p} active={p === rgbToHex(color)} onClick={() => send(hexToRgb(p)!)} />)}</div>
        </Card>

        <div className="space-y-5">
          <Card title="Channels">
            <div className="space-y-3">
              <Slider label="Red" max={255} suffix="" value={color.r} track="linear-gradient(90deg,#200,#f00)" onChange={(r) => send({ ...color, r })} />
              <Slider label="Green" max={255} suffix="" value={color.g} track="linear-gradient(90deg,#020,#0f0)" onChange={(g) => send({ ...color, g })} />
              <Slider label="Blue" max={255} suffix="" value={color.b} track="linear-gradient(90deg,#002,#00f)" onChange={(b) => send({ ...color, b })} />
              <Slider label="Hue" max={359} suffix="°" value={hsv.h} track="linear-gradient(90deg,#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00)" onChange={(h) => send(hsvToRgb({ ...hsv, h }))} />
              <Slider label="Saturation" value={hsv.s * 100} track={`linear-gradient(90deg,#fff,${rgbToHex(hsvToRgb({ ...hsv, s: 1, v: 1 }))})`} onChange={(s) => send(hsvToRgb({ ...hsv, s: s / 100 }))} />
              <Slider label="Brightness" value={light.brightness} onChange={(level) => store.exec({ type: 'brightness', level })} />
            </div>
          </Card>
          <Card title="White temperature">
            <Slider label="Temperature" min={1800} max={6500} step={50} suffix=" K" value={kelvin}
              track={`linear-gradient(90deg,${rgbToHex(kelvinToRgb(1800))},${rgbToHex(kelvinToRgb(4000))},${rgbToHex(kelvinToRgb(6500))})`}
              onChange={(k) => { setKelvin(k); send(kelvinToRgb(k)); }} />
            <p className="mt-2 text-xs text-white/40">Mixed from RGB. Strips with dedicated white LEDs can also use the controller's warm/cold mode:</p>
            <Button className="mt-2" onClick={() => store.exec({ type: 'colorTemperature', warm: Math.round(((6500 - kelvin) / 4700) * 100) })}>Use controller white mode</Button>
          </Card>
        </div>
      </div>
      {!remote && device && <CalibrationCard cal={device.calibration} />}
    </div>
  );
}

function CalibrationCard({ cal }: { cal: Calibration }) {
  const [active, setActive] = useState<number | null>(null);
  const set = (p: Partial<Calibration>) => {
    store.setCalibration({ ...cal, ...p, gain: { ...cal.gain, ...(p.gain ?? {}) } });
    if (active != null) store.exec({ type: 'color', color: CALIBRATION_SWATCHES[active].rgb });
  };
  return (
    <Card title="Calibration for this device" action={<div className="flex gap-2">
      <Button onClick={() => store.setCalibration({ ...DEFAULT_CALIBRATION })}>Recommended</Button>
      <Button onClick={() => store.setCalibration({ ...IDENTITY_CALIBRATION })}>Raw</Button>
    </div>}>
      <p className="mb-4 text-sm text-white/55">Tap a reference colour, look at the strip, and adjust until it matches the swatch. Cheap strips usually show too much green, so orange looks yellow. Increase <b>Warm green cut</b> to fix that.</p>
      <div className="mb-5 flex flex-wrap gap-2">
        {CALIBRATION_SWATCHES.map((sw, i) => {
          const sent = applyCalibration(sw.rgb, cal);
          return (
            <button key={sw.name} onClick={() => { setActive(i); store.exec({ type: 'color', color: sw.rgb }); }}
              className={`rounded-2xl border p-2 text-left text-xs ${active === i ? 'border-white/50 bg-white/10' : 'border-white/10 bg-white/5'}`}>
              <span className="mb-1 block h-8 w-20 rounded-xl" style={{ background: rgbToHex(sw.rgb) }} />
              {sw.name}
              <span className="block font-mono text-[10px] text-white/40">→ {sent.r},{sent.g},{sent.b}</span>
            </button>
          );
        })}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Slider label="Red gain" max={150} value={cal.gain.r * 100} onChange={(v) => set({ gain: { ...cal.gain, r: v / 100 } })} />
        <Slider label="Green gain" max={150} value={cal.gain.g * 100} onChange={(v) => set({ gain: { ...cal.gain, g: v / 100 } })} />
        <Slider label="Blue gain" max={150} value={cal.gain.b * 100} onChange={(v) => set({ gain: { ...cal.gain, b: v / 100 } })} />
        <Slider label="Warm green cut" value={cal.warmGreenCut * 100} onChange={(v) => set({ warmGreenCut: v / 100 })} />
        <Slider label="Gamma" min={100} max={280} suffix="" value={cal.gamma * 100} onChange={(v) => set({ gamma: v / 100 })} />
        <label className="block text-xs text-white/60">Channel order (if red shows as green, change this)
          <select className={inputCls + ' mt-1'} value={cal.order} onChange={(e) => set({ order: e.target.value as Calibration['order'] })}>
            {['rgb', 'rbg', 'grb', 'gbr', 'brg', 'bgr'].map((o) => <option key={o} value={o}>{o.toUpperCase()}</option>)}
          </select>
        </label>
      </div>
    </Card>
  );
}
