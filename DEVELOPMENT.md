# Development

## Setup

```bash
npm install
```

## Common tasks

| Command | What it does |
|---|---|
| `npm test` | Core unit/integration/protocol tests (Vitest) and desktop API tests (node:test). |
| `npm run typecheck` | Type-checks all workspaces. |
| `npm run dev` | Web UI with hot reload at http://localhost:5173. |
| `npm run build` | Builds the PWA into `apps/web/dist`. |
| `npm run desktop` | Builds the UI and starts GlowPilot Desktop (Electron). |

Live-reload the desktop shell against the dev server:

```bash
npm run dev
GLOWPILOT_DEV_URL=http://localhost:5173 npm run start -w @glowpilot/desktop
```

## Testing without hardware

Settings → **Simulator** switches the whole app to `SimulatorTransport`. It decodes ELK frames,
echoes them like the real controller, and shows the resulting colour under Devices → Protocol
console. Tests use the same simulator plus fake timers to cover reconnection, backoff, effects,
scenes and schedules.

## Testing with hardware

1. Turn the strip on and close Lotus Lantern on every phone.
2. Devices → Scan for controllers → pick `ELK-BLEDDM`.
3. Devices → **Hardware test**. Answer each step and copy the report.
4. Add the result to HARDWARE_COMPATIBILITY.md. Mark a feature *physically tested* only when a human saw it.

For low-level investigation outside the app, Python `bleak` works well on Windows:

```bash
pip install bleak
python -c "import asyncio,bleak;print(asyncio.run(bleak.BleakScanner.discover(10)))"
```

## Android

Requires JDK 21 and an Android SDK (API 34). The Capacitor project lives in `apps/android`.

```bash
npm run build -w @glowpilot/web
cd apps/web && npx cap sync android
cd ../android && ./gradlew assembleDebug
# APK: apps/android/app/build/outputs/apk/debug/app-debug.apk
```

`apps/android/local.properties` must point to your SDK, for example
`sdk.dir=C:/Users/<you>/AppData/Local/Android/Sdk`.

Install with `adb install -r app-debug.apk`, or copy the APK to the phone. On first connect,
Android asks for the **Nearby devices** permission.

To control lights through the PC from the phone: Settings → *Through GlowPilot Desktop* →
enter `ws://<pc-ip>:47821` and the pairing code shown on the PC.

## Web (PWA)

`apps/web/dist` is a static site. GlowPilot Desktop serves it at `http://<pc-ip>:47821`. Web
Bluetooth needs a secure context (https or localhost), so on a phone over plain http use the
*Through GlowPilot Desktop* mode, or host `dist/` over https.

## Adding a controller protocol

Implement `ProtocolDriver` in `packages/core/src/protocol/`, add it to `DRIVERS`, and add frame
tests. UI and effects work unchanged.

## Coding conventions

- English for code, comments and docs.
- Business logic goes in `packages/core`, with tests. UI components stay thin.
- Never claim hardware behaviour without a test result in HARDWARE_COMPATIBILITY.md.
