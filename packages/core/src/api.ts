import type { AutomationRule } from './automation';
import type { ConnectionStatus } from './controller';
import type { Command, EngineSnapshot } from './engine';
import type { Scene } from './scenes';
import type { Schedule } from './schedule';

/**
 * GlowPilot Desktop local API (WebSocket, JSON). Default port 47821, LAN only.
 * Pairing: the desktop shows a 6-digit code; the client sends it once and gets a long-lived token.
 */
export const API_PORT = 47821;

export type ClientMessage =
  | { t: 'pair'; code: string; clientName: string }
  | { t: 'auth'; token: string }
  /** `target`: 'all', a group id or 'dev:<id>' (defaults to all lights). */
  | { t: 'command'; cmd: Command; target?: string }
  | { t: 'saveScenes'; scenes: Scene[] }
  | { t: 'saveRules'; rules: AutomationRule[] }
  | { t: 'saveSchedules'; schedules: Schedule[] }
  | { t: 'requestOwnership' }
  | { t: 'releaseOwnership' };

export interface RemoteState {
  snapshot: EngineSnapshot;
  status: ConnectionStatus;
  deviceName: string | null;
  scenes: Scene[];
  rules: AutomationRule[];
  schedules: Schedule[];
  foreground: string | null;
  /** Name of the client that currently owns the BLE link, 'desktop' when the desktop does. */
  owner: string;
  lights?: { id: string; name: string; status: ConnectionStatus }[];
  groups?: { id: string; name: string; icon: string; deviceIds: string[] }[];
}

export type ServerMessage =
  | { t: 'paired'; token: string }
  | { t: 'authed' }
  | { t: 'denied'; reason: string }
  | { t: 'state'; state: RemoteState }
  | { t: 'ownership'; granted: boolean; owner: string };

export function isClientMessage(v: unknown): v is ClientMessage {
  const t = (v as { t?: unknown })?.t;
  return typeof t === 'string' && ['pair', 'auth', 'command', 'saveScenes', 'saveRules', 'saveSchedules', 'requestOwnership', 'releaseOwnership'].includes(t);
}
