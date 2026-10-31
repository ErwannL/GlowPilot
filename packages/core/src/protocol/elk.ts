import type { ControllerEffect, Frame, ProtocolDriver } from './types';

/**
 * Lotus Lantern / ELK-BLEDOM / ELK-BLEDDM protocol.
 * 9-byte frames: 7E LEN CMD P1 P2 P3 P4 P5 EF on service FFF0, characteristic FFF3.
 * See HARDWARE_COMPATIBILITY.md for sources and verification level of each command.
 */

const u8 = (v: number) => Math.max(0, Math.min(255, Math.round(v))) & 0xff;
const pct = (v: number) => Math.max(0, Math.min(100, Math.round(v)));
const frame = (key: string, ...b: number[]): Frame => ({ key, bytes: Uint8Array.from(b) });

export const ELK_SERVICE = '0000fff0-0000-1000-8000-00805f9b34fb';
export const ELK_WRITE = '0000fff3-0000-1000-8000-00805f9b34fb';
export const ELK_NOTIFY = '0000fff4-0000-1000-8000-00805f9b34fb';

const EFFECT_NAMES = [
  'Static red', 'Static blue', 'Static green', 'Static cyan', 'Static yellow', 'Static purple', 'Static white',
  'Three-colour jump', 'Seven-colour jump', 'Three-colour cross fade', 'Seven-colour cross fade',
  'Red pulse', 'Green pulse', 'Blue pulse', 'Yellow pulse', 'Cyan pulse', 'Purple pulse', 'White pulse',
  'Red/green cross fade', 'Red/blue cross fade', 'Green/blue cross fade',
  'Seven-colour strobe', 'Red strobe', 'Green strobe', 'Blue strobe', 'Yellow strobe', 'Cyan strobe',
  'Purple strobe', 'White strobe',
];

export const ELK_EFFECTS: ControllerEffect[] = EFFECT_NAMES.map((name, i) => ({ id: 0x80 + i, name }));

/** Advertised names may be padded with spaces ("ELK-BLEDDM    "), so always trim. */
export const normalizeName = (name: string | undefined | null) => (name ?? '').trim();

export const elkDriver: ProtocolDriver = {
  id: 'elk',
  label: 'Lotus Lantern (ELK-BLEDOM / BLEDDM)',
  service: ELK_SERVICE,
  writeCharacteristic: ELK_WRITE,
  notifyCharacteristic: ELK_NOTIFY,
  namePrefixes: ['ELK-', 'ELK~', 'BLEDOM', 'BLEDDM', 'XSL-', 'CLK-', 'LED LIGHT STRIP'],
  matches: (name) => /^(ELK[-~_]|BLEDOM|BLEDDM|XSL-|CLK-|LED LIGHT STRIP)/i.test(normalizeName(name)),
  caps: () => ({
    rgb: true,
    brightness: true,
    speed: true,
    controllerEffects: true,
    colorTemperature: true,
    microphone: false,
    echoAck: true,
  }),
  effects: ELK_EFFECTS,
  power: (on) => frame('power', 0x7e, 0x04, 0x04, on ? 1 : 0, 0x00, on ? 1 : 0, 0xff, 0x00, 0xef),
  rgb: (r, g, b) => frame('color', 0x7e, 0x07, 0x05, 0x03, u8(r), u8(g), u8(b), 0x10, 0xef),
  brightness: (v) => frame('brightness', 0x7e, 0x04, 0x01, pct(v), 0xff, 0xff, 0xff, 0x00, 0xef),
  speed: (v) => frame('speed', 0x7e, 0x04, 0x02, pct(v), 0xff, 0xff, 0xff, 0x00, 0xef),
  effect: (id) => frame('color', 0x7e, 0x05, 0x03, u8(id), 0x03, 0xff, 0xff, 0x00, 0xef),
  colorTemperature: (warm, cold) => frame('color', 0x7e, 0x06, 0x05, 0x02, pct(warm), pct(cold), 0xff, 0x08, 0xef),
  microphone: (on) => frame('mic', 0x7e, 0x04, 0x07, on ? 1 : 0, 0xff, 0xff, 0xff, 0x00, 0xef),
  micSensitivity: (v) => frame('micsens', 0x7e, 0x04, 0x06, pct(v), 0xff, 0xff, 0xff, 0x00, 0xef),
};

export const DRIVERS: ProtocolDriver[] = [elkDriver];

export function driverFor(name: string): ProtocolDriver | undefined {
  return DRIVERS.find((d) => d.matches(name));
}

export const toHex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join(' ');
