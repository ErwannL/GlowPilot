export interface RGB { r: number; g: number; b: number }
export interface HSV { h: number; s: number; v: number } // h 0–360, s/v 0–1

const clamp = (v: number, lo = 0, hi = 255) => Math.max(lo, Math.min(hi, v));
const round = (c: RGB): RGB => ({ r: Math.round(clamp(c.r)), g: Math.round(clamp(c.g)), b: Math.round(clamp(c.b)) });

export function rgbToHsv({ r, g, b }: RGB): HSV {
  const R = r / 255, G = g / 255, B = b / 255;
  const max = Math.max(R, G, B), min = Math.min(R, G, B), d = max - min;
  let h = 0;
  if (d) {
    if (max === R) h = 60 * (((G - B) / d) % 6);
    else if (max === G) h = 60 * ((B - R) / d + 2);
    else h = 60 * ((R - G) / d + 4);
  }
  if (h < 0) h += 360;
  return { h, s: max ? d / max : 0, v: max };
}

export function hsvToRgb({ h, s, v }: HSV): RGB {
  h = ((h % 360) + 360) % 360;
  const c = v * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = v - c;
  const [r, g, b] =
    h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return round({ r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255 });
}

export function hexToRgb(hex: string): RGB | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  let s = m[1];
  if (s.length === 3) s = s.split('').map((c) => c + c).join('');
  const n = parseInt(s, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export const rgbToHex = ({ r, g, b }: RGB) =>
  '#' + [r, g, b].map((v) => Math.round(clamp(v)).toString(16).padStart(2, '0')).join('');

/** Approximate black-body colour for 1000–12000 K (Tanner Helland's fit). */
export function kelvinToRgb(k: number): RGB {
  const t = clamp(k, 1000, 12000) / 100;
  const r = t <= 66 ? 255 : 329.698727446 * Math.pow(t - 60, -0.1332047592);
  const g = t <= 66 ? 99.4708025861 * Math.log(t) - 161.1195681661 : 288.1221695283 * Math.pow(t - 60, -0.0755148492);
  const b = t >= 66 ? 255 : t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  return round({ r, g, b });
}

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const mixRgb = (a: RGB, b: RGB, t: number): RGB => round({ r: lerp(a.r, b.r, t), g: lerp(a.g, b.g, t), b: lerp(a.b, b.b, t) });
export const scaleRgb = (c: RGB, f: number): RGB => round({ r: c.r * f, g: c.g * f, b: c.b * f });

/**
 * Per-device calibration. Cheap RGB strips have a very strong green diode, which turns
 * orange into yellow and yellow into lime. The calibration corrects that before sending.
 */
export interface Calibration {
  /** Channel gains 0–1.5 (white balance). */
  gain: RGB;
  /** Gamma applied per channel (1 = linear). LEDs look more natural around 1.8–2.2. */
  gamma: number;
  /** Extra green reduction for warm hues (0–1), applied in the red→yellow band. */
  warmGreenCut: number;
  /** Channel order of the physical strip, e.g. 'rgb', 'grb', 'brg'. */
  order: 'rgb' | 'rbg' | 'grb' | 'gbr' | 'brg' | 'bgr';
  /** Minimum non-zero output; some controllers turn a channel fully off below this. */
  floor: number;
}

export const DEFAULT_CALIBRATION: Calibration = {
  // Tuned on a real ELK-BLEDDM: a strong gamma turned purple into blue, so stay close to linear.
  gain: { r: 1, g: 0.8, b: 0.85 },
  gamma: 1.15,
  warmGreenCut: 0.35,
  order: 'rgb',
  floor: 0,
};

export const IDENTITY_CALIBRATION: Calibration = { gain: { r: 1, g: 1, b: 1 }, gamma: 1, warmGreenCut: 0, order: 'rgb', floor: 0 };

/** Map the colour the user intends to the RGB values the strip must receive. */
export function applyCalibration(c: RGB, cal: Calibration): RGB {
  const hsv = rgbToHsv(c);
  let { r, g, b } = c;
  // Warm band 0–70°: pull green down more strongly as saturation rises.
  if (cal.warmGreenCut > 0 && hsv.s > 0.2 && (hsv.h < 70 || hsv.h > 345)) {
    const band = hsv.h > 345 ? 0 : hsv.h / 70; // 0 at red, 1 at yellow
    const cut = cal.warmGreenCut * hsv.s * (1 - band * 0.5);
    g = g * (1 - cut);
  }
  const ch = (v: number, gain: number) => {
    if (v <= 0) return 0;
    const out = Math.pow(v / 255, cal.gamma) * 255 * gain;
    return out > 0 && out < cal.floor ? cal.floor : out;
  };
  const out = round({ r: ch(r, cal.gain.r), g: ch(g, cal.gain.g), b: ch(b, cal.gain.b) });
  return reorder(out, cal.order);
}

function reorder(c: RGB, order: Calibration['order']): RGB {
  const src: Record<string, number> = { r: c.r, g: c.g, b: c.b };
  // `order` describes which logical channel each physical pin shows: pin1, pin2, pin3.
  // To show logical colour c we must place channel order[i] value on pin i.
  const pins = order.split('');
  const out: Record<string, number> = { r: 0, g: 0, b: 0 };
  (['r', 'g', 'b'] as const).forEach((pin, i) => (out[pin] = src[pins[i]]));
  return { r: out.r, g: out.g, b: out.b };
}

/** Human colour name, used to show users what they picked and to validate calibration. */
export function colorName(c: RGB): string {
  const { h, s, v } = rgbToHsv(c);
  if (v < 0.08) return 'Off / black';
  if (s < 0.12) return v > 0.85 ? 'White' : 'Grey';
  if (s < 0.35 && h >= 20 && h < 60) return 'Warm white';
  if (h < 12 || h >= 345) return 'Red';
  if (h < 40) return 'Orange';
  if (h < 66) return 'Yellow';
  if (h < 90) return 'Lime';
  if (h < 155) return 'Green';
  if (h < 190) return 'Cyan';
  if (h < 250) return 'Blue';
  if (h < 285) return 'Purple';
  if (h < 330) return 'Magenta';
  return 'Pink';
}

/** Reference swatches the calibration wizard asks the user to judge. */
export const CALIBRATION_SWATCHES: { name: string; rgb: RGB }[] = [
  { name: 'Red', rgb: { r: 255, g: 0, b: 0 } },
  { name: 'Orange', rgb: { r: 255, g: 110, b: 0 } },
  { name: 'Yellow', rgb: { r: 255, g: 210, b: 0 } },
  { name: 'Green', rgb: { r: 0, g: 255, b: 0 } },
  { name: 'Blue', rgb: { r: 0, g: 0, b: 255 } },
  { name: 'Purple', rgb: { r: 140, g: 0, b: 255 } },
  { name: 'White', rgb: { r: 255, g: 255, b: 255 } },
];
