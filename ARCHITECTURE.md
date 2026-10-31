# Architecture

```
packages/core        Shared TypeScript engine. No UI, no platform APIs, fully unit-tested.
apps/web             React + Vite + Tailwind PWA. The single UI for every platform.
apps/desktop         Electron shell for Windows: chooser, app detection, local API, tray.
apps/android         Capacitor Android project wrapping apps/web with native BLE.
```

## Why one UI everywhere

Bluetooth logic is the risky part. The protocol driver, command queue, reconnection and effects
are written once in `packages/core`. Each platform only provides a `BleTransport`:

| Platform | Transport | Notes |
|---|---|---|
| Chrome / Edge (desktop, Android) | `WebBluetoothTransport` | The browser chooser guarantees an explicit user pick. |
| Windows desktop | `WebBluetoothTransport` inside Electron | Uses the WinRT stack through Chromium. Main answers the chooser itself, but only for the device the user picked before. |
| Android app | `CapacitorBleTransport` (`@capacitor-community/bluetooth-le`) | Native BLE; reconnects to a remembered id without a chooser. |
| Anywhere | `SimulatorTransport` | Decodes frames like the controller and echoes them. |

**Electron over Tauri.** Tauri would need a Rust BLE crate (btleplug) and a second protocol
implementation. Electron reuses Chromium's Web Bluetooth, which other projects have measured
working with these controllers on Windows. It also keeps the protocol code in one language.

## Core modules (`packages/core/src`)

| Module | Responsibility |
|---|---|
| `protocol/elk.ts` | ELK-BLEDOM/BLEDDM driver: frame builders, name matching (trimmed), controller effect list. |
| `queue.ts` | `CommandQueue`: serial writes with a minimum gap (25 ms). Frames with the same key are coalesced and repeats are suppressed. |
| `controller.ts` | `DeviceController`: one link to one *selected* device. Status, exponential-backoff reconnection, state replay after reconnect, FFF4 echo acks, calibration applied on send. |
| `color.ts` | RGB/HSV/hex/kelvin conversions, calibration, colour naming. |
| `effects.ts` | Pure `effectColorAt(effect, t)` plus `EffectRunner`, which streams frames only when the colour changes. |
| `scenes.ts` | Scene model, 12 built-ins, JSON import (validated) and export. |
| `automation.ts` | Rule matching (wildcards, foreground/running, `media:playing`), priority, cooldown, override, restore-previous, conflict detection. |
| `schedule.ts` | Next-run calculation (weekly or one-shot, sunrise lead time) and perceptual ramps. |
| `engine.ts` | `GlowEngine`: the single entry point (`exec(Command)`) for UI, API, automation and schedules. Scenes, transitions, sleep timer, ramps, scheduler loop. |
| `api.ts` | Message types for the desktop local API. |

## Effects: two kinds

- **Controller effects** (`0x80`–`0x9C`) run inside the controller. After one write there is no traffic, and they keep running when GlowPilot closes.
- **GlowPilot effects** are computed in the app and streamed as colour frames, with any palette. The tick interval matches how fast the colour actually changes. Unchanged colours are never re-sent, and the queue merges bursts.

## Desktop process model

```
Electron main ── activity.ps1 (foreground exe, process list, media session) ──► renderer
     │                                                                            │
     ├─ select-bluetooth-device ─► renderer chooser modal ─► user pick ───────────┤
     │                                                                            │
     └─ LocalApiServer (HTTP + WebSocket :47821) ◄── state ── renderer (store + GlowEngine + BLE)
              ▲
        phones / browsers on the LAN (paired)
```

The renderer owns the engine and the BLE link. Main is a thin bridge. Closing the window hides
it to the tray, so automations and schedules keep running.

## Local API security

- Listens on port 47821 but **drops any non-private source address** (loopback, RFC1918, link-local, ULA only).
- Clients pair once with a 6-digit, single-use code shown on the desktop and get a 192-bit random token. Five wrong codes from an address block further attempts.
- Every command requires an authenticated socket. **Revoke all** invalidates tokens and closes sockets.
- Never port-forward 47821. There is no cloud relay by design.

## Connection ownership

The controller accepts one central. The desktop is the default owner. A paired phone can send
`requestOwnership`: the desktop disconnects and records the phone as owner, then the phone
switches to direct Bluetooth. `releaseOwnership` hands the link back.

## Schedules

Schedules run in the app (desktop tray or Android) because the controller's timer commands
(`0x82`, `0x83`, `0x76`) are not verified on hardware. The UI states where schedules run and
what must stay on.

## Persistence

`localStorage` (per platform) holds the device, calibration, scenes, rules, schedules and
settings. The desktop main process stores only the trusted device id and the paired-client
tokens, in `%APPDATA%/GlowPilot`.
