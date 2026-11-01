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

## Server tuning for a stable link (applied on serveur 1)

The LED controller sits at the edge of the radio range of the server's internal Qualcomm card. Two
settings cut the drops (measured: about 27 drops per 5 minutes at first).

1. **No USB power saving for the Bluetooth adapter.** Autosuspend kept dropping the link.

   ```bash
   echo "options btusb enable_autosuspend=n" | sudo tee /etc/modprobe.d/glowpilot-btusb.conf
   echo 'ACTION=="add", SUBSYSTEM=="usb", ATTR{idVendor}=="0cf3", ATTR{idProduct}=="e007", TEST=="power/control", ATTR{power/control}="on"' \
     | sudo tee /etc/udev/rules.d/50-glowpilot-bt-nosuspend.rules
   ```

2. **Longer BLE supervision timeout, per light.** BlueZ creates the connection with a 420 ms timeout,
   and `btmon` showed every drop as `Connection Timeout (0x08)`. The `[LE]` defaults in `main.conf` are
   **not** used for this connection. The per-device parameters are, so append them to the light's BlueZ
   entry and restart Bluetooth:

   ```bash
   F=/var/lib/bluetooth/<adapter-address>/<light-address>/info   # e.g. 54:13:79:68:73:58/BE:27:DA:00:7C:83
   printf '
[ConnectionParameters]
MinInterval=24
MaxInterval=40
Latency=0
Timeout=600
' | sudo tee -a $F
   sudo systemctl restart bluetooth && docker compose restart
   ```

   To check, look for `LE Create Connection … Supervision timeout: 6000 msec` in `sudo btmon`. Repeat this for each new light.

3. **Wi-Fi radio off.** On this combo card, Wi-Fi shares the antenna with Bluetooth, and the server is wired anyway:
   `for r in /sys/class/rfkill/rfkill*; do [ "$(cat $r/type)" = wlan ] && echo 1 | sudo tee $r/soft; done`.
   systemd-rfkill restores this setting at boot.

Measured on serveur 1 (BLE disconnects per 10 minutes, from `btmon`): about 54 at first, 14 after step 1,
3 after step 2, and 1 after step 3.

To diagnose: `docker compose logs` (hub steps and who sent what) and `sudo btmon` (radio events and
disconnect reasons). A USB BLE dongle on an extension cable near the lights is the hardware fix if
drops remain.
