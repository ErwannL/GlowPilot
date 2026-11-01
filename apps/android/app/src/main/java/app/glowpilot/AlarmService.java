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
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;
import android.util.Log;

import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

/**
 * Runs one light alarm while the phone is locked. First asks GlowPilot Desktop: if the PC answers and
 * is running the alarm, the phone stays out of the way. Otherwise the phone connects to the light over
 * Bluetooth itself and plays the same build-up as the PC (see alarmAt in packages/core/src/effects.ts).
 * A notification is shown only while it runs, with a Stop button.
 */
public class AlarmService extends Service {
    static final String ACTION_STOP = "app.glowpilot.ALARM_STOP";
    private static final String CHANNEL = "glowpilot_alarm";
    private static final UUID SERVICE = UUID.fromString("0000fff0-0000-1000-8000-00805f9b34fb");
    private static final UUID WRITE = UUID.fromString("0000fff3-0000-1000-8000-00805f9b34fb");

    private volatile boolean stopped = false;
    private Thread worker;
    private PowerManager.WakeLock wakeLock;
    private BluetoothGatt gatt;
    private BluetoothGattCharacteristic writeChar;

    @Override
    public IBinder onBind(Intent intent) { return null; }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && ACTION_STOP.equals(intent.getAction())) {
            stopAlarm();
            return START_NOT_STICKY;
        }
        if (worker != null) return START_NOT_STICKY; // already ringing
        startInForeground("Wake-up lights starting…");
        JSONObject alarm;
        try { alarm = new JSONObject(intent != null && intent.getStringExtra("alarm") != null ? intent.getStringExtra("alarm") : "{}"); }
        catch (Exception e) { alarm = new JSONObject(); }
        final JSONObject a = alarm;
        int minutes = Math.max(1, a.optInt("minutes", 60));
        PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
        wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "GlowPilot:alarm");
        wakeLock.acquire((minutes + 90) * 60_000L);
        worker = new Thread(() -> {
            try { run(a, minutes); } catch (Exception e) { Log.e(AlarmStore.TAG, "alarm failed", e); }
            finally { stopAlarm(); }
        });
        worker.start();
        return START_NOT_STICKY;
    }

    private void run(JSONObject alarm, int minutes) throws Exception {
        JSONObject cfg = AlarmStore.config(this);
        // 1. Is GlowPilot Desktop awake and on it? Then the PC drives the lights.
        String pc = pcStatus(cfg);
        if ("running".equals(pc)) { Log.i(AlarmStore.TAG, "PC is running the alarm"); return; }
        if ("connected".equals(pc)) {
            update("Waiting for your PC to start the lights…");
            sleep(75_000); // the PC wakes up to 3 minutes early and starts on time; give it a moment
            if ("running".equals(pcStatus(cfg))) return;
        }
        if (stopped) return;
        // 2. The PC is asleep, off or unreachable: do it from the phone.
        update("Wake-up lights · from your phone");
        long total = minutes * 60_000L;
        long start = System.currentTimeMillis();
        int rgb = Color.parseColor(alarm.optString("color", "#ff8a30"));
        String lastHex = "";
        int failures = 0;
        while (!stopped) {
            long el = System.currentTimeMillis() - start;
            if (el > total + 60 * 60_000L) break; // safety: stop an hour after the build-up
            if (writeChar == null) {
                if (!connect(cfg)) {
                    if (++failures > 20) break;
                    sleep(5000);
                    continue;
                }
                failures = 0;
                lastHex = "";
                write(frame(0x04, 1, 0, 1, 0xff, 0x00)); // power on
                write(frame(0x01, 100, 0xff, 0xff, 0xff, 0x00)); // brightness 100
            }
            double[] s = alarmAt(el, total);
            int r = 0, g = 0, b = 0;
            if (s[1] > 0) { r = (int) Math.round(Color.red(rgb) * s[0]); g = (int) Math.round(Color.green(rgb) * s[0]); b = (int) Math.round(Color.blue(rgb) * s[0]); }
            String hex = r + "," + g + "," + b;
            if (!hex.equals(lastHex)) {
                if (!write(new byte[]{0x7e, 0x07, 0x05, 0x03, (byte) r, (byte) g, (byte) b, 0x10, (byte) 0xef})) { writeChar = null; closeGatt(); continue; }
                lastHex = hex;
            }
            sleep(150);
        }
    }

    /** Same curve as the desktop: dim → bright, flashing from halfway, faster and faster, then keeps flashing. */
    static double[] alarmAt(long el, long total) {
        double f = total > 0 ? (double) el / total : 1;
        if (f >= 1) return new double[]{1, el % 400 < 200 ? 1 : 0};
        double level = 0.02 + 0.98 * f * f;
        if (f < 0.5) return new double[]{level, 1};
        double period = 4000 - 3400 * ((f - 0.5) / 0.5);
        return new double[]{level, (el % (long) period) < period * 0.6 ? 1 : 0};
    }

    private static byte[] frame(int cmd, int p1, int p2, int p3, int p4, int p5) {
        return new byte[]{0x7e, 0x04, (byte) cmd, (byte) p1, (byte) p2, (byte) p3, (byte) p4, (byte) p5, (byte) 0xef};
    }

    /** "running", "connected" (PC owns the lights but no alarm yet), or "away". */
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

    @SuppressLint("MissingPermission")
    private boolean connect(JSONObject cfg) throws InterruptedException {
        if (Build.VERSION.SDK_INT >= 31 && ContextCompat.checkSelfPermission(this, Manifest.permission.BLUETOOTH_CONNECT) != PackageManager.PERMISSION_GRANTED) {
            update("Bluetooth permission missing: open GlowPilot once");
            return false;
        }
        BluetoothAdapter adapter = ((BluetoothManager) getSystemService(Context.BLUETOOTH_SERVICE)).getAdapter();
        if (adapter == null || !adapter.isEnabled()) { update("Bluetooth is off"); return false; }
        BluetoothDevice device = null;
        JSONArray addrs = cfg.optJSONArray("addresses");
        if (addrs != null && addrs.length() > 0 && BluetoothAdapter.checkBluetoothAddress(addrs.optString(0).toUpperCase())) {
            device = adapter.getRemoteDevice(addrs.optString(0).toUpperCase());
        } else {
            device = scanForKnownName(adapter, cfg.optJSONArray("names"));
        }
        if (device == null) { update("Looking for your lights…"); return false; }
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
        if (writeChar == null) { closeGatt(); update("Lights busy or out of range (another device connected?)"); return false; }
        update("Wake-up lights · from your phone");
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
    }

    private void stopAlarm() {
        stopped = true;
        // Leave the light on, steady, at full colour; then free the Bluetooth link for the PC / the app.
        JSONObject cfg = AlarmStore.config(this);
        if (writeChar != null) {
            int rgb = Color.parseColor(cfg.optString("color", "#ff8a30"));
            write(new byte[]{0x7e, 0x07, 0x05, 0x03, (byte) Color.red(rgb), (byte) Color.green(rgb), (byte) Color.blue(rgb), 0x10, (byte) 0xef});
            sleep(200);
        }
        closeGatt();
        if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
        stopForeground(STOP_FOREGROUND_REMOVE);
        stopSelf();
    }

    private void startInForeground(String text) {
        NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= 26 && nm.getNotificationChannel(CHANNEL) == null)
            nm.createNotificationChannel(new NotificationChannel(CHANNEL, "Wake-up lights", NotificationManager.IMPORTANCE_DEFAULT));
        Notification n = build(text);
        if (Build.VERSION.SDK_INT >= 34) startForeground(42, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE);
        else startForeground(42, n);
    }

    private void update(String text) {
        ((NotificationManager) getSystemService(NOTIFICATION_SERVICE)).notify(42, build(text));
    }

    private Notification build(String text) {
        PendingIntent open = PendingIntent.getActivity(this, 0, new Intent(this, MainActivity.class), PendingIntent.FLAG_IMMUTABLE);
        PendingIntent stop = PendingIntent.getService(this, 1, new Intent(this, AlarmService.class).setAction(ACTION_STOP), PendingIntent.FLAG_IMMUTABLE);
        return new NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(android.R.drawable.ic_lock_idle_alarm)
            .setContentTitle("GlowPilot")
            .setContentText(text)
            .setContentIntent(open)
            .addAction(0, "Stop", stop)
            .setOngoing(true)
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .build();
    }

    private static void sleep(long ms) {
        try { Thread.sleep(ms); } catch (InterruptedException ignored) { Thread.currentThread().interrupt(); }
    }
}
