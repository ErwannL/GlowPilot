# GlowPilot Hub

An always-on light master for a Linux server with Bluetooth, such as the server that runs Noyau.
It alone holds the Bluetooth link to the lights, and it runs scenes, scene mixes, schedules and alarms 24/7.
GlowPilot Desktop and the Android app become clients:

- **PC:** Settings → *Through GlowPilot Hub*. The PC still sends your foreground game or app, so automation keeps working.
- **Phone:** Settings → *Find* (the hub is preferred over a PC). The phone alarm checks the hub first, and drives the lights itself only if the hub is unreachable.
- **Noyau:** see `docs/NOYAU_INTEGRATION.md`.

## Install (Ubuntu)

```bash
sudo apt install bluez && sudo systemctl enable --now bluetooth
npm run build -w @glowpilot/web && npm run build -w @glowpilot/hub
cp -r apps/web/dist packages/hub/web
# copy Dockerfile, docker-compose.yml, dist/hub.cjs and web/ to /opt/glowpilot-hub, then:
docker compose up -d --build
sudo ufw allow from 192.168.1.0/24 to any port 47821 proto tcp   # LAN only
```

`docker-compose.yml` uses host networking and the D-Bus socket to reach BlueZ, with AppArmor unconfined for this container only. Ubuntu's default profile blocks D-Bus.

## Pairing

The hub has no screen. Get a pairing code on the server:

```bash
curl http://127.0.0.1:47821/api/pairing
```

The code is also printed in `docker compose logs`. Then add lights from any client: Devices → *Add a light* scans around the server.
