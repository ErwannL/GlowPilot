/** A command frame plus a coalescing key: queued frames with the same key replace each other. */
export interface Frame {
  key: string;
  bytes: Uint8Array;
}

export interface ControllerEffect {
  id: number;
  name: string;
}

export interface DriverCaps {
  rgb: boolean;
  brightness: boolean;
  speed: boolean;
  controllerEffects: boolean;
  colorTemperature: boolean;
  microphone: boolean;
  /** Controller echoes written frames on a notify characteristic. */
  echoAck: boolean;
}

/** A protocol driver turns high-level intents into wire frames. It never touches Bluetooth. */
export interface ProtocolDriver {
  id: string;
  label: string;
  service: string;
  writeCharacteristic: string;
  notifyCharacteristic?: string;
  /** Name prefixes used as scan filters (Web Bluetooth `namePrefix`). */
  namePrefixes: string[];
  matches(name: string): boolean;
  caps(name: string): DriverCaps;
  effects: ControllerEffect[];
  power(on: boolean): Frame;
  rgb(r: number, g: number, b: number): Frame;
  /** 0–100 */
  brightness(level: number): Frame;
  /** 0–100 */
  speed(level: number): Frame;
  effect(id: number): Frame;
  /** warm/cold 0–100 */
  colorTemperature(warm: number, cold: number): Frame;
  microphone(on: boolean): Frame;
  micSensitivity(level: number): Frame;
}
