package app.glowpilot;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothGatt;
import android.bluetooth.BluetoothGattCallback;
import android.bluetooth.BluetoothGattCharacteristic;
import android.bluetooth.BluetoothGattService;
import android.bluetooth.BluetoothManager;
import android.bluetooth.BluetoothProfile;
import android.bluetooth.le.BluetoothLeScanner;
import android.bluetooth.le.ScanCallback;
import android.bluetooth.le.ScanResult;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.graphics.Color;
import android.media.AudioAttributes;
import android.media.MediaPlayer;
import android.media.RingtoneManager;
import android.media.audiofx.Visualizer;
import android.net.Uri;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.util.Log;

import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

/**
 * GlowPilot's own alarm clock. Two phases:
 *  1. Build-up (`minutes`): lights go from dim to bright. If GlowPilot Desktop answers and runs the
 *     alarm, the PC drives the lights and the phone only rings; otherwise the phone drives them over BLE.
 *  2. Ring: music (file or default alarm sound, volume rising), vibration, full-screen alarm screen with
 *     Snooze / Stop, and the light rhythm the user chose (flash, blink, or pulsing with the music).
 * Nothing is asked at alarm time: missing permissions just fall back (no mic → blink instead of music).
 */
public class AlarmService extends Service {
    static final String ACTION_STOP = "app.glowpilot.ALARM_STOP";
    static final String ACTION_SNOOZE = "app.glowpilot.ALARM_SNOOZE";
    static volatile boolean ringing = false;
    static volatile String ringTitle = "";
    private static final String CHANNEL = "glowpilot_alarm_ring";
    private static final int NOTIF = 42;
    private static final UUID SERVICE = UUID.fromString("0000fff0-0000-1000-8000-00805f9b34fb");
    private static final UUID WRITE = UUID.fromString("0000fff3-0000-1000-8000-00805f9b34fb");

    private volatile boolean stopped = false;
    private volatile long snoozeUntil = 0;
    private Thread worker;
    private PowerManager.WakeLock wakeLock;
    private BluetoothGatt gatt;
    private BluetoothGattCharacteristic writeChar;
    private MediaPlayer player;
    private Visualizer visualizer;
    private volatile float musicLevel = 0;
    private boolean pcDrivesLights = false;
    private JSONObject alarm = new JSONObject();

    @Override
    public IBinder onBind(Intent intent) { return null; }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent != null ? intent.getAction() : null;
        if (ACTION_STOP.equals(action)) { finish(); return START_NOT_STICKY; }
        if (ACTION_SNOOZE.equals(action)) { snooze(); return START_NOT_STICKY; }
        if (worker != null) return START_NOT_STICKY;
        try { alarm = new JSONObject(intent != null && intent.getStringExtra("alarm") != null ? intent.getStringExtra("alarm") : "{}"); }
        catch (Exception e) { alarm = new JSONObject(); }
        startForegroundCompat(build("Wake-up lights starting…", false));
        int minutes = Math.max(0, alarm.optInt("minutes", 60));
        PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
        wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "GlowPilot:alarm");
        wakeLock.acquire((minutes + 120) * 60_000L);
        worker = new Thread(() -> {
            try { run(minutes); } catch (Exception e) { Log.e(AlarmStore.TAG, "alarm failed", e); }
            finally { finish(); }
        });
        worker.start();
        return START_NOT_STICKY;
    }

    private void run(int minutes) throws Exception {
        JSONObject cfg = AlarmStore.config(this);
        long total = minutes * 60_000L;
        long start = System.currentTimeMillis();
        boolean phoneSync = AlarmStore.PHONE_ALARM_ID.equals(alarm.optString("id"));
        // Who drives the lights? Ask the PC first.
        String pc = pcStatus(cfg);
        if ("connected".equals(pc) && !"running".equals(pc)) {
            update("Waiting for your PC to start the lights…", false);
            for (int i = 0; i < 15 && !stopped && !"running".equals(pc); i++) { sleep(5000); pc = pcStatus(cfg); }
        }
        pcDrivesLights = "running".equals(pc);
        update(pcDrivesLights ? "Wake-up lights · your PC drives them" : "Wake-up lights · from your phone", false);

        int rgb = Color.parseColor(alarm.optString("color", "#ff8a30"));
        String lastHex = "";
        int failures = 0;
        boolean rang = false;
        long safetyEnd = start + total + 60 * 60_000L;
        while (!stopped && System.currentTimeMillis() < safetyEnd) {
            long now = System.currentTimeMillis();
            long el = now - start;
            // Ring when the build-up ends (the Clock app rings by itself for the synced phone alarm).
            if (!rang && el >= total) {
                rang = true;
                if (!phoneSync) startRinging();
            }
            if (snoozeUntil > now) {
                if (!pcDrivesLights && writeChar != null) lastHex = send(rgb, 0.3, lastHex);
                sleep(250);
                continue;
            }
            if (snoozeUntil != 0 && snoozeUntil <= now) { snoozeUntil = 0; if (!phoneSync) startRinging(); }
            if (pcDrivesLights) { sleep(500); continue; }
            if (writeChar == null) {
                if (!connect(cfg)) { if (++failures > 30) { pcDrivesLights = true; update("Lights not reachable · ringing only", true); } sleep(4000); continue; }
                failures = 0;
                lastHex = "";
                write(frame(0x04, 1, 0, 1, 0xff, 0x00));
                write(frame(0x01, 100, 0xff, 0xff, 0xff, 0x00));
            }
            double[] s = curve(el, total);
            lastHex = send(rgb, s[1] > 0 ? s[0] : 0, lastHex);
            if (lastHex == null) { writeChar = null; closeGatt(); lastHex = ""; }
            sleep(120);
        }
    }

    /** Level/on for now: same as alarmAt() in packages/core/src/effects.ts, plus the music rhythm. */
    private double[] curve(long el, long total) {
        double lo = alarm.optInt("startBrightness", 2) / 100.0, hi = alarm.optInt("endBrightness", 100) / 100.0;
        double f = total > 0 ? (double) el / total : 1;
        if (f >= 1) {
            String rhythm = alarm.optString("rhythm", "flash");
            if ("music".equals(rhythm) && visualizer != null) return new double[]{Math.max(0.12, hi * musicLevel), 1};
            if ("flash".equals(rhythm)) return new double[]{hi, el % 400 < 200 ? 1 : 0};
            double half = 1000 - 880 * Math.max(0, Math.min(100, alarm.optInt("blinkSpeed", 50))) / 100.0;
            if (alarm.optBoolean("accelerate", true)) half = Math.max(80, half * (1 - 0.7 * Math.min(1, (el - total) / 300_000.0)));
            return new double[]{hi, ((el - total) % (long) (half * 2)) < half ? 1 : 0};
        }
        double level = lo + (hi - lo) * f * f;
        if (f < 0.5 || !alarm.optBoolean("flashDuringBuildup", true)) return new double[]{level, 1};
        double period = 4000 - 3400 * ((f - 0.5) / 0.5);
        return new double[]{level, (el % (long) period) < period * 0.6 ? 1 : 0};
    }

    private String send(int rgb, double level, String lastHex) {
        int r = (int) Math.round(Color.red(rgb) * level), g = (int) Math.round(Color.green(rgb) * level), b = (int) Math.round(Color.blue(rgb) * level);
        String hex = r + "," + g + "," + b;
        if (hex.equals(lastHex)) return lastHex;
        return write(new byte[]{0x7e, 0x07, 0x05, 0x03, (byte) r, (byte) g, (byte) b, 0x10, (byte) 0xef}) ? hex : null;
    }

    // --- ringing ---------------------------------------------------------------------------

    private void startRinging() {
        ringing = true;
        ringTitle = alarm.optString("name", "Wake up");
        update("⏰ " + ringTitle, true);
        startMusic();
        if (alarm.optBoolean("vibrate", true)) {
            Vibrator v = (Vibrator) getSystemService(VIBRATOR_SERVICE);
            if (v != null && Build.VERSION.SDK_INT >= 26) v.vibrate(VibrationEffect.createWaveform(new long[]{0, 600, 900}, 0));
        }
        try { startActivity(new Intent(this, AlarmActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); } catch (Exception ignored) { /* full-screen intent shows it */ }
    }

    private void startMusic() {
        stopMusic();
        JSONObject sound = alarm.optJSONObject("sound");
        if (alarm.has("sound") && sound == null) return; // silent alarm
        Uri uri = null;
        String u = sound != null ? sound.optString("uri", "") : "";
        if (!u.isEmpty() && !"null".equals(u)) uri = Uri.parse(u);
        if (uri == null) uri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM);
        try {
            player = new MediaPlayer();
            player.setAudioAttributes(new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM).setContentType(AudioAttributes.CONTENT_TYPE_MUSIC).build());
            player.setDataSource(this, uri);
            player.setLooping(true);
            player.setVolume(0.02f, 0.02f);
            player.prepare();
            player.start();
        } catch (Exception e) {
            Log.w(AlarmStore.TAG, "cannot play " + uri + ", using default alarm sound", e);
            try {
                player = MediaPlayer.create(this, RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM));
                if (player != null) { player.setLooping(true); player.start(); }
            } catch (Exception ignored) { }
        }
        if (player == null) return;
        // Volume rises over soundRampSec up to the chosen maximum.
        final float max = Math.max(0.05f, alarm.optInt("volume", 80) / 100f);
        final long rampMs = Math.max(1, alarm.optInt("soundRampSec", 60)) * 1000L;
        final MediaPlayer p = player;
        new Thread(() -> {
            long t0 = System.currentTimeMillis();
            while (p == player && ringing) {
                float f = Math.min(1f, (System.currentTimeMillis() - t0) / (float) rampMs);
                try { p.setVolume(max * f, max * f); } catch (Exception e) { break; }
                if (f >= 1f) break;
                sleep(250);
            }
        }).start();
        // Lights pulsing with the music: only if the microphone permission was granted earlier (never asked now).
        if ("music".equals(alarm.optString("rhythm")) && ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
            try {
                visualizer = new Visualizer(player.getAudioSessionId());
                visualizer.setCaptureSize(Visualizer.getCaptureSizeRange()[0]);
                visualizer.setDataCaptureListener(new Visualizer.OnDataCaptureListener() {
                    float avg = 0;
                    @Override public void onWaveFormDataCapture(Visualizer v, byte[] wave, int rate) {
                        double sum = 0;
                        for (byte b : wave) { double x = ((b & 0xff) - 128) / 128.0; sum += x * x; }
                        float rms = (float) Math.sqrt(sum / wave.length);
                        avg = avg * 0.92f + rms * 0.08f;
                        musicLevel = Math.max(0f, Math.min(1f, (rms - avg * 0.6f) * 4f));
                    }
                    @Override public void onFftDataCapture(Visualizer v, byte[] fft, int rate) { }
                }, Visualizer.getMaxCaptureRate() / 2, true, false);
                visualizer.setEnabled(true);
            } catch (Exception e) {
                Log.w(AlarmStore.TAG, "visualizer unavailable, blinking instead", e);
                visualizer = null;
            }
        }
    }

    private void stopMusic() {
        try { if (visualizer != null) { visualizer.setEnabled(false); visualizer.release(); } } catch (Exception ignored) { }
        visualizer = null;
        try { if (player != null) { player.stop(); player.release(); } } catch (Exception ignored) { }
        player = null;
        Vibrator v = (Vibrator) getSystemService(VIBRATOR_SERVICE);
        if (v != null) v.cancel();
    }

    private void snooze() {
        if (!ringing) return;
        ringing = false;
        stopMusic();
        snoozeUntil = System.currentTimeMillis() + Math.max(1, alarm.optInt("snoozeMin", 9)) * 60_000L;
        update("Snoozed until " + android.text.format.DateFormat.getTimeFormat(this).format(new java.util.Date(snoozeUntil)), false);
        AlarmActivity.closeIfOpen();
    }

    private void finish() {
        if (stopped) return;
        stopped = true;
        ringing = false;
        stopMusic();
        AlarmActivity.closeIfOpen();
        if (pcDrivesLights) pcStopAlarm(AlarmStore.config(this));
        else if (writeChar != null) {
            // Leave the light on, steady, in the alarm colour; then free Bluetooth for the PC / the app.
            int rgb = Color.parseColor(alarm.optString("color", "#ff8a30"));
            send(rgb, alarm.optInt("endBrightness", 100) / 100.0, "");
            sleep(200);
        }
        closeGatt();
        if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
        stopForeground(STOP_FOREGROUND_REMOVE);
        stopSelf();
    }

    // --- PC -------------------------------------------------------------------------------

    /** "running" (PC runs an alarm), "connected" (PC owns the lights), or "away". */
    private String pcStatus(JSONObject cfg) {
        String base = cfg.optString("desktopUrl", ""), token = cfg.optString("token", "");
        if (base.isEmpty() || token.isEmpty()) return "away";
        try {
            HttpURLConnection c = (HttpURLConnection) new URL(base + "/api/status").openConnection();
            c.setConnectTimeout(3000);
            c.setReadTimeout(3000);
            c.setRequestProperty("Authorization", "Bearer " + token);
            if (c.getResponseCode() != 200) return "away";
            StringBuilder sb = new StringBuilder();
            try (BufferedReader br = new BufferedReader(new InputStreamReader(c.getInputStream()))) { String l; while ((l = br.readLine()) != null) sb.append(l); }
            JSONObject st = new JSONObject(sb.toString());
            if (st.optBoolean("alarmActive")) return "running";
            return st.optBoolean("connected") ? "connected" : "away";
        } catch (Exception e) {
            return "away";
        }
    }

    private void pcStopAlarm(JSONObject cfg) {
        String base = cfg.optString("desktopUrl", ""), token = cfg.optString("token", "");
        if (base.isEmpty() || token.isEmpty()) return;
        new Thread(() -> {
            try {
                HttpURLConnection c = (HttpURLConnection) new URL(base + "/api/alarm-stop").openConnection();
                c.setConnectTimeout(3000);
                c.setRequestMethod("POST");
                c.setDoOutput(true);
                c.setRequestProperty("Authorization", "Bearer " + token);
                try (OutputStream os = c.getOutputStream()) { os.write("{}".getBytes()); }
                c.getResponseCode();
                c.disconnect();
            } catch (Exception ignored) { }
        }).start();
    }

    // --- Bluetooth ------------------------------------------------------------------------

    private static byte[] frame(int cmd, int p1, int p2, int p3, int p4, int p5) {
        return new byte[]{0x7e, 0x04, (byte) cmd, (byte) p1, (byte) p2, (byte) p3, (byte) p4, (byte) p5, (byte) 0xef};
    }

    @SuppressLint("MissingPermission")
    private boolean connect(JSONObject cfg) throws InterruptedException {
        if (Build.VERSION.SDK_INT >= 31 && ContextCompat.checkSelfPermission(this, Manifest.permission.BLUETOOTH_CONNECT) != PackageManager.PERMISSION_GRANTED) {
            update("Bluetooth permission missing: open GlowPilot once", ringing);
            return false;
        }
        BluetoothAdapter adapter = ((BluetoothManager) getSystemService(Context.BLUETOOTH_SERVICE)).getAdapter();
        if (adapter == null || !adapter.isEnabled()) return false;
        BluetoothDevice device;
        JSONArray addrs = cfg.optJSONArray("addresses");
        if (addrs != null && addrs.length() > 0 && BluetoothAdapter.checkBluetoothAddress(addrs.optString(0).toUpperCase())) device = adapter.getRemoteDevice(addrs.optString(0).toUpperCase());
        else device = scanForKnownName(adapter, cfg.optJSONArray("names"));
        if (device == null) return false;
        CountDownLatch ready = new CountDownLatch(1);
        gatt = device.connectGatt(this, false, new BluetoothGattCallback() {
            @Override public void onConnectionStateChange(BluetoothGatt g, int status, int state) {
                if (state == BluetoothProfile.STATE_CONNECTED) g.discoverServices();
                else if (state == BluetoothProfile.STATE_DISCONNECTED) { writeChar = null; ready.countDown(); }
            }
            @Override public void onServicesDiscovered(BluetoothGatt g, int status) {
                BluetoothGattService s = g.getService(SERVICE);
                if (s != null) {
                    writeChar = s.getCharacteristic(WRITE);
                    if (writeChar != null) writeChar.setWriteType(BluetoothGattCharacteristic.WRITE_TYPE_NO_RESPONSE);
                }
                ready.countDown();
            }
        }, BluetoothDevice.TRANSPORT_LE);
        ready.await(15, TimeUnit.SECONDS);
        if (writeChar == null) { closeGatt(); return false; }
        return true;
    }

    /** Only lights the user picked before (names known to GlowPilot), never any nearby controller. */
    @SuppressLint("MissingPermission")
    private BluetoothDevice scanForKnownName(BluetoothAdapter adapter, JSONArray names) throws InterruptedException {
        if (names == null || names.length() == 0) return null;
        if (Build.VERSION.SDK_INT >= 31 && ContextCompat.checkSelfPermission(this, Manifest.permission.BLUETOOTH_SCAN) != PackageManager.PERMISSION_GRANTED) return null;
        BluetoothLeScanner scanner = adapter.getBluetoothLeScanner();
        if (scanner == null) return null;
        final BluetoothDevice[] found = {null};
        CountDownLatch latch = new CountDownLatch(1);
        ScanCallback cb = new ScanCallback() {
            @Override public void onScanResult(int type, ScanResult r) {
                String n = r.getScanRecord() != null ? r.getScanRecord().getDeviceName() : null;
                if (n == null) return;
                for (int i = 0; i < names.length(); i++) if (n.trim().equalsIgnoreCase(names.optString(i).trim())) { found[0] = r.getDevice(); latch.countDown(); }
            }
        };
        scanner.startScan(cb);
        latch.await(12, TimeUnit.SECONDS);
        scanner.stopScan(cb);
        return found[0];
    }

    @SuppressLint("MissingPermission")
    @SuppressWarnings("deprecation")
    private boolean write(byte[] b) {
        BluetoothGattCharacteristic c = writeChar;
        if (gatt == null || c == null) return false;
        try {
            if (Build.VERSION.SDK_INT >= 33) return gatt.writeCharacteristic(c, b, BluetoothGattCharacteristic.WRITE_TYPE_NO_RESPONSE) == 0;
            c.setValue(b);
            return gatt.writeCharacteristic(c);
        } catch (Exception e) {
            return false;
        }
    }

    @SuppressLint("MissingPermission")
    private void closeGatt() {
        try { if (gatt != null) { gatt.disconnect(); gatt.close(); } } catch (Exception ignored) { }
        gatt = null;
        writeChar = null;
    }

    // --- notification ---------------------------------------------------------------------

    private void startForegroundCompat(Notification n) {
        if (Build.VERSION.SDK_INT >= 34) startForeground(NOTIF, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE | ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
        else startForeground(NOTIF, n);
    }

    private void update(String text, boolean ring) {
        ((NotificationManager) getSystemService(NOTIFICATION_SERVICE)).notify(NOTIF, build(text, ring));
    }

    private Notification build(String text, boolean ring) {
        NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= 26 && nm.getNotificationChannel(CHANNEL) == null) {
            NotificationChannel ch = new NotificationChannel(CHANNEL, "Wake-up alarm", NotificationManager.IMPORTANCE_HIGH);
            ch.setSound(null, null); // GlowPilot plays the music itself
            nm.createNotificationChannel(ch);
        }
        PendingIntent screen = PendingIntent.getActivity(this, 0, new Intent(this, AlarmActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK), PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        PendingIntent stop = PendingIntent.getService(this, 1, new Intent(this, AlarmService.class).setAction(ACTION_STOP), PendingIntent.FLAG_IMMUTABLE);
        PendingIntent snooze = PendingIntent.getService(this, 2, new Intent(this, AlarmService.class).setAction(ACTION_SNOOZE), PendingIntent.FLAG_IMMUTABLE);
        NotificationCompat.Builder b = new NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(android.R.drawable.ic_lock_idle_alarm)
            .setContentTitle("GlowPilot")
            .setContentText(text)
            .setContentIntent(screen)
            .setOngoing(true)
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .addAction(0, "Stop", stop);
        if (ring) b.addAction(0, "Snooze", snooze).setFullScreenIntent(screen, true);
        return b.build();
    }

    private static void sleep(long ms) {
        try { Thread.sleep(ms); } catch (InterruptedException ignored) { Thread.currentThread().interrupt(); }
    }
}
