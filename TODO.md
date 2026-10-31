# TODO

## Needs the user / hardware

- [ ] Run **Devices → Hardware test** on the real ELK-BLEDDM and record which commands are physically confirmed.
- [ ] Confirm whether the strip has white channels (colour-temperature command `7E 06 05 02 …`).
- [ ] Calibrate orange/yellow on the real strip; consider shipping the measured values as the default for ELK-BLEDDM.
- [ ] First connection from GlowPilot Desktop (Electron chooser) and auto-reconnect after an app restart.
- [ ] Install the Android APK on the phone and test direct BLE and *Take over Bluetooth*.
- [ ] Test the phone → desktop LAN pairing on the real network (Windows Firewall will prompt on first start).

## Protocol

- [ ] Verify on-controller timers (`0x82` timing, `0x83` clock sync, `0x76` countdown) so schedules can run without GlowPilot.
- [ ] Measure the safe maximum write rate (the current 25 ms gap is conservative).
- [ ] Optional ELK-* encryption path (only for names containing the literal `ELK-*`).
- [ ] Additional families (MELK, FFE0 LEDBLE) behind the existing `ProtocolDriver` interface.

## Product

- [ ] Packaged Windows installer (electron-builder, NSIS) with code signing.
- [ ] Android foreground service so schedules run with the screen off.
- [ ] Browser extension for streaming-site playback detection (beyond the Windows media session).
- [ ] UI tests (Playwright) for the main flows against the simulator.
- [ ] Multiple devices / groups.
- [ ] Localisation (French).
