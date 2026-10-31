# GlowPilot

**Your lights. Your atmosphere.**

GlowPilot is a local-first, cross-platform controller for Bluetooth LED strips that use the
Lotus Lantern app (ELK-BLEDOM / ELK-BLEDDM controllers). It runs on Windows, Android and in
the browser. It needs no account and no cloud.

## Features

- **Direct Bluetooth control:** power, any RGB colour, brightness, built-in controller effects and effect speed.
- **Colour engine:** colour wheel, RGB/HSV sliders, hex, colour temperature, per-device calibration (gains, gamma, warm-green correction, channel order) so orange stays orange.
- **Effects:** GlowPilot-computed animations (fade, breathe, rainbow, strobe, flash, cycle, custom sequence, candle) with any colours, the controller's 29 built-in effects, and microphone music mode.
- **Several lights and groups:** put the desk strip on Gaming while the bed strip stays on Relax. Automations and schedules can target a group.
- **Scene mixes:** chain scenes in order with a duration each, e.g. Halloween for 55 s then Horror for 8 s, on a loop.
- **Scenes:** Halloween, Christmas, Cinema, Gaming, Work, Relax, Sunset, Night, Reading, Cyberpunk, Horror, Custom. Create, edit, duplicate, delete, import and export them as JSON.
- **Windows automation:** rules such as *IF Cyberpunk2077.exe is running THEN Cyberpunk scene*, with foreground-window rules, priorities, cooldowns, manual override and restore-previous. Windows media playback can also trigger a rule (`media:playing`).
- **Wake-up alarm:** starts dim, brightens and flashes faster and faster over an hour, then keeps flashing until you turn it off.
- **Schedules:** on/off, scenes, sunrise wake-up, sunset fade-out, weekly repetition, one-shot schedules, sleep timer.
- **Phone ↔ PC:** GlowPilot Desktop exposes a paired, LAN-only API. Your phone can control the strip through the PC, or take over the Bluetooth link.
- **Simulator and hardware test mode:** try everything without hardware, then verify each command on the real strip.

## Quick start

Requirements: Node.js 20+, Windows 10/11 with Bluetooth.

```bash
npm install
npm test               # core + desktop API tests, no hardware needed
npm run desktop        # build the UI and start GlowPilot Desktop
```

In GlowPilot Desktop, go to **Devices → Scan for controllers** and pick `ELK-BLEDDM`.
Close Lotus Lantern on your phone first: the controller accepts only one connection at a time.

Web only:

```bash
npm run dev            # http://localhost:5173 (Chrome/Edge for Web Bluetooth)
```

Android: see [DEVELOPMENT.md](DEVELOPMENT.md#android).

## Hardware status

See [HARDWARE_COMPATIBILITY.md](HARDWARE_COMPATIBILITY.md). In short, the user's `ELK-BLEDDM`
(`BE:27:DA:00:7C:83`) was found from Windows and its GATT layout confirmed. Power, colour,
brightness, effect and speed frames were all acknowledged by the controller (**protocol
verified**). A human has not yet confirmed the visual output; run **Devices → Hardware test**
to do that.

## Documentation

- [ARCHITECTURE.md](ARCHITECTURE.md): how the pieces fit together
- [HARDWARE_COMPATIBILITY.md](HARDWARE_COMPATIBILITY.md): protocol, verification levels, investigated projects
- [DEVELOPMENT.md](DEVELOPMENT.md): building, testing, Android, packaging
- [TODO.md](TODO.md): what is left

## Credits

The protocol research builds on public work by
[Rxflex/LotusLantern](https://github.com/Rxflex/LotusLantern) (MIT),
[chameleonbr/LED_UNION](https://github.com/chameleonbr/LED_UNION) (MIT),
[MikitaLeush/led-control](https://github.com/MikitaLeush/led-control) and
[razibit/Lotus-Lantern-for-Windows-PC](https://github.com/razibit/Lotus-Lantern-for-Windows-PC).
No source code was copied from these projects. GlowPilot is not affiliated with the controller
manufacturer or the Lotus Lantern app.
