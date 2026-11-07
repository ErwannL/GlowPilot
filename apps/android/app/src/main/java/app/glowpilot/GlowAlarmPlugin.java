package app.glowpilot;

import android.Manifest;
import android.app.AlarmManager;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import androidx.activity.result.ActivityResult;
import android.app.Activity;
import android.app.NotificationManager;
import android.database.Cursor;
import android.provider.OpenableColumns;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import org.json.JSONObject;

/** Bridge for the web app: hand over light alarms, read the phone's alarm clock, stop a ringing alarm. */
@CapacitorPlugin(
    name = "GlowAlarm",
    permissions = {
        @Permission(alias = "bluetooth", strings = { Manifest.permission.BLUETOOTH_CONNECT, Manifest.permission.BLUETOOTH_SCAN }),
        @Permission(alias = "notifications", strings = { Manifest.permission.POST_NOTIFICATIONS }),
        @Permission(alias = "microphone", strings = { Manifest.permission.RECORD_AUDIO }),
    }
)
public class GlowAlarmPlugin extends Plugin {

    // --- "Take control" from the PC -------------------------------------------------------
    // The light accepts one connection. A phone has no other way to hear that the PC wants it, so it
    // listens on the home network (port 47822) for as long as the app process lives, even screen off.

    static final int PHONE_PORT = 47822;
    private static volatile boolean holding = false;
    private java.net.ServerSocket server;

    @Override
    public void load() {
        Thread t = new Thread(this::serve, "glowpilot-yield");
        t.setDaemon(true);
        t.start();
    }

    @Override
    protected void handleOnDestroy() {
        try { if (server != null) server.close(); } catch (Exception ignored) { }
    }

    /** The web app tells whether it holds the light (reported to the PC). */
    @PluginMethod
    public void setHolding(PluginCall call) {
        holding = Boolean.TRUE.equals(call.getBoolean("holding", false));
        call.resolve();
    }

    private void serve() {
        try {
            server = new java.net.ServerSocket(PHONE_PORT);
            while (!server.isClosed()) {
                try (java.net.Socket c = server.accept()) {
                    c.setSoTimeout(3000);
                    String peer = c.getInetAddress().getHostAddress();
                    if (!isLocal(c.getInetAddress())) continue;
                    java.io.BufferedReader in = new java.io.BufferedReader(new java.io.InputStreamReader(c.getInputStream(), java.nio.charset.StandardCharsets.UTF_8));
                    String first = in.readLine();
                    if (first == null) continue;
                    String body;
                    if (first.startsWith("POST /yield")) {
                        AlarmStore.log(getContext(), "PC " + peer + " asked for the lights (Take control): letting go");
                        JSObject ev = new JSObject();
                        ev.put("from", peer);
                        notifyListeners("yield", ev, true);
                        body = "{\"ok\":true}";
                    } else {
                        body = "{\"app\":\"GlowPilot\",\"role\":\"phone\",\"lightsConnected\":" + holding + "}";
                    }
                    byte[] b = body.getBytes(java.nio.charset.StandardCharsets.UTF_8);
                    java.io.OutputStream os = c.getOutputStream();
                    os.write(("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nAccess-Control-Allow-Origin: *\r\nContent-Length: " + b.length + "\r\nConnection: close\r\n\r\n").getBytes(java.nio.charset.StandardCharsets.UTF_8));
                    os.write(b);
                    os.flush();
                } catch (Exception ignored) { }
            }
        } catch (Exception e) {
            AlarmStore.log(getContext(), "yield listener not started: " + e.getMessage());
        }
    }

    /** Home network only (same rule as GlowPilot Desktop's API), plus Tailscale's 100.64/10. */
    private static boolean isLocal(java.net.InetAddress a) {
        byte[] b = a.getAddress();
        return a.isLoopbackAddress() || a.isSiteLocalAddress() || a.isLinkLocalAddress()
            || (b.length == 4 && (b[0] & 0xff) == 100 && (b[1] & 0xc0) == 64);
    }

    /** config: { alarms:[{id,time,days,minutes,color,onceAt?}], addresses:[], names:[], desktopUrl, token, syncPhoneAlarm, minutesBefore, color } */
    @PluginMethod
    public void configure(PluginCall call) {
        try {
            JSONObject cfg = new JSONObject(call.getData().toString());
            AlarmStore.saveConfig(getContext(), cfg);
            long next = AlarmStore.scheduleAll(getContext());
            JSObject r = new JSObject();
            r.put("nextAt", next);
            r.put("exact", canExact());
            call.resolve(r);
        } catch (Exception e) {
            call.reject(e.getMessage());
        }
    }

    @PluginMethod
    public void nextSystemAlarm(PluginCall call) {
        JSObject r = new JSObject();
        String[] next = AlarmStore.nextClockAlarm(getContext());
        r.put("at", next != null ? Long.parseLong(next[0]) : null);
        String app = null;
        if (next != null) {
            try {
                android.content.pm.PackageManager pm = getContext().getPackageManager();
                app = pm.getApplicationLabel(pm.getApplicationInfo(next[1], 0)).toString();
            } catch (Exception e) { app = next[1]; }
        }
        r.put("app", app);
        call.resolve(r);
    }

    @PluginMethod
    public void readLog(PluginCall call) {
        JSObject r = new JSObject();
        r.put("text", AlarmStore.readLog(getContext()));
        call.resolve(r);
    }

    @PluginMethod
    public void appendLog(PluginCall call) {
        AlarmStore.log(getContext(), "app: " + call.getString("line", ""));
        call.resolve();
    }

    @PluginMethod
    public void stop(PluginCall call) {
        getContext().startService(new Intent(getContext(), AlarmService.class).setAction(AlarmService.ACTION_STOP));
        call.resolve();
    }

    /** Permissions an alarm needs while the app is closed: Bluetooth and the alarm notification. */
    @PluginMethod
    public void ensurePermissions(PluginCall call) {
        if (Build.VERSION.SDK_INT < 31 || (getPermissionState("bluetooth") == PermissionState.GRANTED
            && (Build.VERSION.SDK_INT < 33 || getPermissionState("notifications") == PermissionState.GRANTED))) {
            permsDone(call);
            return;
        }
        requestPermissionForAliases(Build.VERSION.SDK_INT >= 33 ? new String[]{"bluetooth", "notifications"} : new String[]{"bluetooth"}, call, "permsDone");
    }

    @PermissionCallback
    private void permsDone(PluginCall call) {
        JSObject r = new JSObject();
        r.put("bluetooth", Build.VERSION.SDK_INT < 31 || getPermissionState("bluetooth") == PermissionState.GRANTED);
        r.put("notifications", Build.VERSION.SDK_INT < 33 || getPermissionState("notifications") == PermissionState.GRANTED);
        r.put("exact", canExact());
        call.resolve(r);
    }

    /** Android 12: exact alarms may need the user's OK in system settings. */
    @PluginMethod
    public void openExactAlarmSettings(PluginCall call) {
        if (Build.VERSION.SDK_INT >= 31) {
            Intent i = new Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, Uri.parse("package:" + getContext().getPackageName()));
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(i);
        }
        call.resolve();
    }

    /** Let the user pick any audio file on the phone; the permission to read it is kept across reboots. */
    @PluginMethod
    public void pickSound(PluginCall call) {
        Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("audio/*");
        startActivityForResult(call, i, "soundPicked");
    }

    @ActivityCallback
    private void soundPicked(PluginCall call, ActivityResult result) {
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null || result.getData().getData() == null) { call.reject("cancelled"); return; }
        Uri uri = result.getData().getData();
        try { getContext().getContentResolver().takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION); } catch (Exception ignored) { }
        String name = "Music";
        try (Cursor c = getContext().getContentResolver().query(uri, new String[]{OpenableColumns.DISPLAY_NAME}, null, null, null)) {
            if (c != null && c.moveToFirst()) name = c.getString(0);
        } catch (Exception ignored) { }
        JSObject r = new JSObject();
        r.put("uri", uri.toString());
        r.put("name", name);
        call.resolve(r);
    }

    /** Sign in to Noyau once: name + password → a long-lived API token (the password is never stored). */
    @PluginMethod
    public void noyauLogin(PluginCall call) {
        String base = call.getString("url", "");
        try {
            JSONObject body = new JSONObject();
            body.put("name", call.getString("name", ""));
            body.put("password", call.getString("password", ""));
            body.put("app", "GlowPilot Android");
            java.net.HttpURLConnection c = (java.net.HttpURLConnection) new java.net.URL(base.replaceAll("/$", "") + "/api/auth/token").openConnection();
            c.setConnectTimeout(6000);
            c.setReadTimeout(10000);
            c.setRequestMethod("POST");
            c.setDoOutput(true);
            c.setRequestProperty("Content-Type", "application/json");
            try (java.io.OutputStream os = c.getOutputStream()) { os.write(body.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8)); }
            int code = c.getResponseCode();
            java.io.InputStream in = code < 400 ? c.getInputStream() : c.getErrorStream();
            StringBuilder sb = new StringBuilder();
            if (in != null) try (java.io.BufferedReader br = new java.io.BufferedReader(new java.io.InputStreamReader(in, java.nio.charset.StandardCharsets.UTF_8))) { String l; while ((l = br.readLine()) != null) sb.append(l); }
            if (code == 201 || code == 200) {
                JSONObject r = new JSONObject(sb.toString());
                JSObject out = new JSObject();
                out.put("token", r.optString("token"));
                out.put("user", r.optString("user", call.getString("name", "")));
                call.resolve(out);
                return;
            }
            String msg = code == 401 ? "Wrong name or password"
                : code == 403 ? "Your Noyau password is temporary: change it in Noyau first"
                : code == 429 ? "Too many attempts: wait a few minutes"
                : code == 422 ? "Fill in the name and password"
                : code >= 500 ? "Noyau server error: it may need its database update (alembic upgrade head)"
                : code == 404 ? "This Noyau does not support sign-in yet (update Noyau)"
                : "Noyau answered " + code;
            call.reject(msg);
        } catch (Exception e) {
            call.reject("Noyau not reachable: " + e.getMessage());
        }
    }

    /** Noyau Musique library (file tracks only), fetched natively: no CORS, works with the HTTPS address. */
    @PluginMethod
    public void noyauTracks(PluginCall call) {
        String base = call.getString("url", ""), token = call.getString("token", "");
        try {
            java.net.HttpURLConnection c = (java.net.HttpURLConnection) new java.net.URL(base.replaceAll("/$", "") + "/api/music/tracks").openConnection();
            c.setConnectTimeout(6000);
            c.setReadTimeout(10000);
            c.setRequestProperty("Authorization", "Bearer " + token);
            int code = c.getResponseCode();
            if (code != 200) { call.reject("Noyau answered " + code + (code == 401 ? " (sign-in expired or revoked: sign in again in Settings → Noyau)" : "")); return; }
            StringBuilder sb = new StringBuilder();
            try (java.io.BufferedReader br = new java.io.BufferedReader(new java.io.InputStreamReader(c.getInputStream(), java.nio.charset.StandardCharsets.UTF_8))) { String l; while ((l = br.readLine()) != null) sb.append(l); }
            org.json.JSONArray all = new org.json.JSONArray(sb.toString()), files = new org.json.JSONArray();
            for (int i = 0; i < all.length(); i++) { org.json.JSONObject t = all.getJSONObject(i); if ("fichier".equals(t.optString("source"))) files.put(t); }
            JSObject r = new JSObject();
            r.put("tracks", files);
            call.resolve(r);
        } catch (Exception e) {
            call.reject("Noyau not reachable: " + e.getMessage());
        }
    }

    /** Download a Noyau track into the app once, so the alarm rings even if the server or Wi-Fi is down. */
    @PluginMethod
    public void downloadNoyauTrack(PluginCall call) {
        String base = call.getString("url", ""), token = call.getString("token", ""), name = call.getString("name", "Noyau");
        Integer id = call.getInt("id");
        if (id == null) { call.reject("no track id"); return; }
        try {
            java.io.File dir = new java.io.File(getContext().getFilesDir(), "alarm-sounds");
            if (!dir.exists() && !dir.mkdirs()) throw new Exception("cannot create folder");
            java.io.File out = new java.io.File(dir, "noyau-" + id);
            java.net.HttpURLConnection c = (java.net.HttpURLConnection) new java.net.URL(base.replaceAll("/$", "") + "/api/music/tracks/" + id + "/file").openConnection();
            c.setConnectTimeout(6000);
            c.setReadTimeout(60000);
            c.setRequestProperty("Authorization", "Bearer " + token);
            if (c.getResponseCode() != 200) { call.reject("Noyau answered " + c.getResponseCode()); return; }
            java.io.File tmp = new java.io.File(dir, "noyau-" + id + ".part");
            try (java.io.InputStream in = c.getInputStream(); java.io.OutputStream os = new java.io.FileOutputStream(tmp)) {
                byte[] buf = new byte[64 * 1024];
                int n;
                while ((n = in.read(buf)) > 0) os.write(buf, 0, n);
            }
            if (!tmp.renameTo(out)) throw new Exception("cannot save file");
            JSObject r = new JSObject();
            r.put("uri", Uri.fromFile(out).toString());
            r.put("name", name);
            call.resolve(r);
        } catch (Exception e) {
            call.reject("Download failed: " + e.getMessage());
        }
    }

    /**
     * In-app update: download the new APK from GitHub and hand it to Android's installer. Same package and
     * same signing key, so Android shows "update this app" and keeps data, permissions and the home-screen
     * icon. The first time, Android asks to allow GlowPilot to install updates (kept afterwards).
     */
    @PluginMethod
    public void installUpdate(PluginCall call) {
        String url = call.getString("url", "");
        if (!url.startsWith("https://github.com/ErwannL/GlowPilot/releases/download/")) { call.reject("unexpected update URL"); return; }
        if (Build.VERSION.SDK_INT >= 26 && !getContext().getPackageManager().canRequestPackageInstalls()) {
            Intent i = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + getContext().getPackageName()));
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(i);
            call.reject("allow-install");
            return;
        }
        try {
            java.io.File dir = new java.io.File(getContext().getCacheDir(), "updates");
            if (!dir.exists() && !dir.mkdirs()) throw new Exception("cannot create folder");
            java.io.File apk = new java.io.File(dir, "GlowPilot-update.apk");
            java.net.HttpURLConnection c = (java.net.HttpURLConnection) new java.net.URL(url).openConnection();
            c.setInstanceFollowRedirects(true);
            c.setConnectTimeout(10000);
            c.setReadTimeout(60000);
            int code = c.getResponseCode();
            // GitHub redirects release downloads to its CDN (another host): follow it by hand.
            for (int hops = 0; (code == 301 || code == 302 || code == 307 || code == 308) && hops < 5; hops++) {
                String next = c.getHeaderField("Location");
                c.disconnect();
                c = (java.net.HttpURLConnection) new java.net.URL(next).openConnection();
                c.setConnectTimeout(10000);
                c.setReadTimeout(60000);
                code = c.getResponseCode();
            }
            if (code != 200) throw new Exception("download answered " + code);
            try (java.io.InputStream in = c.getInputStream(); java.io.OutputStream os = new java.io.FileOutputStream(apk)) {
                byte[] buf = new byte[64 * 1024];
                int n;
                while ((n = in.read(buf)) > 0) os.write(buf, 0, n);
            }
            Uri uri = androidx.core.content.FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", apk);
            Intent install = new Intent(Intent.ACTION_VIEW).setDataAndType(uri, "application/vnd.android.package-archive")
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(install);
            call.resolve();
        } catch (Exception e) {
            call.reject("Update failed: " + e.getMessage());
        }
    }

    /** Asked once, from the alarm editor, when the user chooses "lights pulse with the music". */
    @PluginMethod
    public void ensureMicrophone(PluginCall call) {
        if (getPermissionState("microphone") == PermissionState.GRANTED) { micDone(call); return; }
        requestPermissionForAlias("microphone", call, "micDone");
    }

    @PermissionCallback
    private void micDone(PluginCall call) {
        JSObject r = new JSObject();
        r.put("granted", getPermissionState("microphone") == PermissionState.GRANTED);
        call.resolve(r);
    }

    /** What the alarm can do right now, without asking anything. */
    @PluginMethod
    public void capabilities(PluginCall call) {
        JSObject r = new JSObject();
        r.put("exact", canExact());
        r.put("microphone", getPermissionState("microphone") == PermissionState.GRANTED);
        r.put("bluetooth", Build.VERSION.SDK_INT < 31 || getPermissionState("bluetooth") == PermissionState.GRANTED);
        r.put("notifications", Build.VERSION.SDK_INT < 33 || getPermissionState("notifications") == PermissionState.GRANTED);
        boolean fullScreen = true;
        if (Build.VERSION.SDK_INT >= 34) fullScreen = ((NotificationManager) getContext().getSystemService(Context.NOTIFICATION_SERVICE)).canUseFullScreenIntent();
        r.put("fullScreen", fullScreen);
        call.resolve(r);
    }

    /** Android 14+: showing the alarm over the lock screen needs the user's OK once. */
    @PluginMethod
    public void openFullScreenSettings(PluginCall call) {
        if (Build.VERSION.SDK_INT >= 34) {
            Intent i = new Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT, Uri.parse("package:" + getContext().getPackageName()));
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(i);
        }
        call.resolve();
    }

    private boolean canExact() {
        if (Build.VERSION.SDK_INT < 31) return true;
        return ((AlarmManager) getContext().getSystemService(Context.ALARM_SERVICE)).canScheduleExactAlarms();
    }
}
