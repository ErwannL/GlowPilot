# Hardware Compatibility

Every claim below is labelled with one of three verification levels:

| Level | Meaning |
|---|---|
| **Simulated** | Exercised only against GlowPilot's simulator / mock BLE adapter. |
| **Protocol verified** | Bytes written to the real controller over BLE and acknowledged by it (FFF4 echo), but the visual LED output was not confirmed by a human. |
| **Physically tested** | A human looked at the strip and confirmed the expected output. |

## 1. The user's controller (ELK-BLEDDM)

Investigated on 2026-10-31 from the Windows 11 development PC using Python `bleak` (WinRT backend).

| Item | Finding | Level |
|---|---|---|
| Advertised name | `"ELK-BLEDDM    "` — **padded with 4 trailing spaces**. Names must be trimmed before matching. | Protocol verified |
| Address | `BE:27:DA:00:7C:83`. The suspected `BE:27:DA:00:07:83` was **wrong**. GlowPilot never hardcodes it. | Protocol verified |
| Advertised service UUIDs | None in the advertisement. Scanning must filter on name, not service. | Protocol verified |
| GATT service | `0000fff0-0000-1000-8000-00805f9b34fb` | Protocol verified |
| Write characteristic | `0000fff3-…` — properties `write-without-response`, `read` | Protocol verified |
| Notify characteristic | `0000fff4-…` — `notify`. **The controller echoes every frame it receives verbatim.** GlowPilot uses this echo as a delivery acknowledgement. | Protocol verified |
| Pairing | Not required; Windows connects without OS-level pairing. | Protocol verified |
| Encryption | Not required. Plain frames were accepted and echoed. | Protocol verified |
| Visual output | Pending: the user must confirm the colours with the in-app **Hardware test** wizard. | — |

Frames sent during the investigation (all echoed):

```
power on    7e 04 04 01 00 01 ff 00 ef
red         7e 07 05 03 ff 00 00 10 ef
green       7e 07 05 03 00 ff 00 10 ef
blue        7e 07 05 03 00 00 ff 10 ef
orange      7e 07 05 03 ff 50 00 10 ef
bright 20   7e 04 01 14 ff ff ff 00 ef
bright 100  7e 04 01 64 ff ff ff 00 ef
effect 0x87 7e 05 03 87 03 ff ff 00 ef
speed 80    7e 04 02 50 ff ff ff 00 ef
```

## 2. Protocol (Lotus Lantern / ELK-BLEDOM family)

Each command is a 9-byte frame: `7E LEN CMD P1 P2 P3 P4 P5 EF`.

| Function | Frame | Range | Source agreement |
|---|---|---|---|
| Power | `7E 04 04 v 00 v FF 00 EF` (v = 01/00) | — | all 4 projects |
| RGB colour | `7E 07 05 03 R G B 10 EF` | 0–255 | all 4 projects |
| Brightness | `7E 04 01 b FF FF FF 00 EF` | 0–100 | razibit, led-control, LED_UNION (LotusLantern says 0–255, treated as wrong) |
| Effect speed | `7E 04 02 s FF FF FF 00 EF` | 0–100 | LED_UNION, LotusLantern |
| Built-in effect | `7E 05 03 m 03 FF FF 00 EF` | m = 0x80–0x9C | LotusLantern, LED_UNION |
| Colour temperature | `7E 06 05 02 warm cold FF 08 EF` | 0–100 | LotusLantern, LED_UNION. Not every strip has white channels. |
| Mic on/off, sensitivity | `7E 04 07 v …`, `7E 04 06 lvl …` | — | Only controllers with a microphone. |
| Clock / timers | cmd `0x83` (system time), `0x82` (timing), `0x76` (countdown) | — | LotusLantern (ported from APK). **Not verified on hardware.** |

**Encryption:** the vendor APK encrypts cmds 1/3/4 only on names containing the literal `ELK-*`. Stock `ELK-BLEDOM` / `ELK-BLEDDM` units do not match. GlowPilot does not implement encryption until a device needs it.

**Built-in effects 0x80–0x9C:** static colours, 3/7-colour jump, cross fades, gradual changes, strobes. GlowPilot labels them "controller effects". They run on the controller and need no ongoing BLE traffic.

**On-device schedules:** the APK can push the clock and timers to the controller. This is unverified, so GlowPilot's schedules run in the app (desktop or Android) by default. The UI says so.

## 3. Investigated projects

| Project | License | Protocols | BLE implementation | Verdict |
|---|---|---|---|---|
| [Rxflex/LotusLantern](https://github.com/Rxflex/LotusLantern) | MIT | ELK/BLEDOM, full command set, ELK-* cipher | Go, tinygo bluetooth | Best protocol reference. Its Windows notes (single central, drop after writes, retry service discovery) informed the reconnection design. |
| [chameleonbr/LED_UNION](https://github.com/chameleonbr/LED_UNION) | MIT | ELK/MELK, FFE0 LEDBLE family, BLEDIM | Web Bluetooth, Svelte PWA | Good effect-name table and multi-driver model. GlowPilot's driver interface is similar but written independently. |
| [MikitaLeush/led-control](https://github.com/MikitaLeush/led-control) | **No license file** (all rights reserved) | Lotus Lantern + iStrip+ (AES) | Web Bluetooth in Electron + Capacitor BLE | Used only as evidence that Electron Web Bluetooth and Capacitor BLE work with this hardware. **No code reused.** |
| [razibit/Lotus-Lantern-for-Windows-PC](https://github.com/razibit/Lotus-Lantern-for-Windows-PC) | No license file; derives from homebridge-ledstrip-bledom | Power, RGB, brightness only | Node `noble-winrt` | Confirms the ELK-BLEDDM command set on Windows. **No code reused.** |

No source code was copied. The protocol constants are facts confirmed by several sources and by our own hardware test. Credits are listed in README.md.

## 4. Known limitations

- **One central only.** The controller accepts one BLE connection. Close Lotus Lantern on the phone before connecting from the PC, and the other way round. GlowPilot's connection manager and the desktop "ownership" API handle this between GlowPilot clients.
- **No state readback.** The controller only echoes commands. It does not report its current colour, so GlowPilot tracks state itself.
- **Link drops.** These clones are known to drop idle links. GlowPilot reconnects automatically with backoff, but only to a device you selected before.
- **Write rate.** The command queue sends at most one frame every 25 ms and merges pending colour frames, so only the newest one is sent.
