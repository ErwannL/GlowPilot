# GlowPilot ↔ Noyau integration contract

Both run on the same always-on server ("serveur 1", 192.168.1.16):

- **GlowPilot Hub**: Docker container in `/opt/glowpilot-hub`, host network, port **47821**. It is the only device connected to the lights over Bluetooth.
- **Noyau**: Docker Compose in `/opt/noyau` (FastAPI backend + React PWA).

From inside the Noyau backend container, the hub is at `http://host.docker.internal:47821` (add `extra_hosts: ["host.docker.internal:host-gateway"]`) or the server's LAN IP. The hub only accepts private source addresses.

## 1. Noyau → GlowPilot Hub (lights: state, scenes, triggers, widget)

All JSON. Every route except `/api/info` and `/api/pair` needs `Authorization: Bearer <hub token>`.

| Route | Purpose |
|---|---|
| `GET /api/info` | `{ "app": "GlowPilot", "role": "hub" }`. Use it as a health check. |
| `POST /api/pair` `{ "code": "123456", "clientName": "Noyau" }` | → `{ "token": "…" }` (403 with `{ error }` on a wrong code). The 6-digit code is single-use. On the server, `curl http://127.0.0.1:47821/api/pairing` returns `{ code, addresses, port, clients }`; that route only answers loopback, so Noyau can pair itself from the host. Store the token on Noyau's side, tied to the user (`user_id`). |
| `GET /api/state` | Full state: `lights[] {id, name, status, snapshot{light{on,color{r,g,b},brightness}, activeSceneId, ramp}}`, `groups[] {id,name,icon,deviceIds}`, `scenes[] {id,name,icon,colors[]}`, `schedules[]`, `alarmActive`, `hub: true`. Good for the home widget. |
| `POST /api/message` `{ "t": "command", "cmd": …, "target": "all" \| "<groupId>" \| "dev:<lightId>" }` | Control the lights. `cmd` examples: `{ "type": "scene", "sceneId": "relax" }`, `{ "type": "power", "on": false }`, `{ "type": "color", "color": { "r": 255, "g": 80, "b": 0 } }`, `{ "type": "brightness", "level": 40 }` (0–100). |
| `GET /api/status` | `{ connected, alarmActive }`. |

Ideas for Noyau triggers: a calendar block starting (Work / Reading scene), a habit reminder (short flash), music starting to play (see §2), going to bed (Night scene).

## 2. GlowPilot → Noyau Musique (alarm music, lights in rhythm)

GlowPilot needs a **Noyau API token** that is accepted on these **read-only** music routes (today they only accept the session cookie):

| Route | Used by GlowPilot for |
|---|---|
| `GET /api/music/tracks` | The phone's "Choose from Noyau" list in the alarm editor. Only `source == "fichier"` tracks are offered (YouTube cannot be downloaded or analysed). |
| `GET /api/music/tracks/{id}/file` | The phone downloads the file once and keeps it, so the alarm rings even if the server or Wi-Fi is down at 6:00. The hub downloads it for rhythm analysis if `/beats` is missing. |
| `GET /api/music/playback/events` (SSE) and `GET /api/music/playback` | The hub follows what Noyau plays (`playing`, `queue`, `queue_index`, `position_seconds`, `server_time`). |
| `GET /api/music/playback/time` | Clock offset, to align beats with playback. |
| **New:** `GET /api/music/tracks/{id}/beats` | → `{ "bpm": 124.0, "beats": [0.48, 0.96, …], "energy": [[t, 0..1], …] }` (seconds from the start of the track). Compute it once per track with ffmpeg (`app/media.py`) and an onset detector, then cache it. GlowPilot falls back to a steady pulse at the BPM, or to a plain "music playing" scene. |

Noyau settings: the user creates the token for GlowPilot in Noyau (existing `api_tokens`), copies it into GlowPilot (Settings → Noyau), and pairs Noyau with the hub (§1).

## 3. What GlowPilot implements

- Hub: Noyau settings (`noyauUrl`, `noyauToken`, `musicSync: { enabled, sceneColors, groupId }`). It subscribes to the playback SSE; while a file track plays, the lights pulse on the beats with the chosen colours, and the previous scene comes back when music stops.
- Phone alarm editor: "Choose from Noyau" (track list), with the file downloaded and stored in the app.
- Everything degrades gracefully: no token, server down or YouTube track means no Noyau features, and the lights and alarms keep working.
