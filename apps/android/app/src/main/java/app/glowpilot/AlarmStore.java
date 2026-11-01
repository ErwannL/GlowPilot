package app.glowpilot;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Calendar;

/**
 * Light alarms the phone must be able to run on its own, even locked and with the app closed.
 * The web app hands over its config (alarms, light addresses, how to reach GlowPilot Desktop);
 * this class keeps it in SharedPreferences and arms one exact Android alarm per light alarm,
 * plus one for "N minutes before the phone's own alarm clock".
 */
public final class AlarmStore {
    static final String TAG = "GlowPilotAlarm";
    static final String PREFS = "glowpilot_alarms";
    static final String ACTION_FIRE = "app.glowpilot.ALARM_FIRE";
    static final String ACTION_SYNC = "app.glowpilot.ALARM_SYNC";
    static final String PHONE_ALARM_ID = "phone-alarm";

    private AlarmStore() {}

    static JSONObject config(Context ctx) {
        try {
            return new JSONObject(prefs(ctx).getString("config", "{}"));
        } catch (Exception e) {
            return new JSONObject();
        }
    }

    static void saveConfig(Context ctx, JSONObject cfg) {
        prefs(ctx).edit().putString("config", cfg.toString()).apply();
    }

    static SharedPreferences prefs(Context ctx) {
        return ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    /** Trigger time of the next alarm set in another app (the Clock app), or 0. Ignores our own alarms. */
    static long nextSystemAlarm(Context ctx) {
        AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
        AlarmManager.AlarmClockInfo info = am.getNextAlarmClock();
        if (info == null) return 0;
        PendingIntent show = info.getShowIntent();
        if (show != null && ctx.getPackageName().equals(show.getCreatorPackage())) return 0;
        return info.getTriggerTime();
    }

    /** Next start time (ms) of a recurring "HH:MM" on days (0 = Sunday), or of a dated one-shot. */
    static long nextOccurrence(JSONObject a, long now) {
        long onceAt = a.optLong("onceAt", 0);
        if (onceAt > 0) return onceAt > now ? onceAt : 0;
        String[] hm = a.optString("time", "").split(":");
        if (hm.length != 2) return 0;
        int h = Integer.parseInt(hm[0]), m = Integer.parseInt(hm[1]);
        JSONArray days = a.optJSONArray("days");
        for (int d = 0; d <= 7; d++) {
            Calendar c = Calendar.getInstance();
            c.setTimeInMillis(now);
            c.add(Calendar.DAY_OF_YEAR, d);
            c.set(Calendar.HOUR_OF_DAY, h);
            c.set(Calendar.MINUTE, m);
            c.set(Calendar.SECOND, 0);
            c.set(Calendar.MILLISECOND, 0);
            if (c.getTimeInMillis() <= now) continue;
            int dow = c.get(Calendar.DAY_OF_WEEK) - 1; // 0 = Sunday
            if (days == null || days.length() == 0 || contains(days, dow)) return c.getTimeInMillis();
        }
        return 0;
    }

    private static boolean contains(JSONArray arr, int v) {
        for (int i = 0; i < arr.length(); i++) if (arr.optInt(i, -1) == v) return true;
        return false;
    }

    /** All alarms to arm: the app's own + the one derived from the phone's alarm clock. */
    static JSONArray allAlarms(Context ctx, JSONObject cfg) {
        JSONArray out = new JSONArray();
        JSONArray list = cfg.optJSONArray("alarms");
        if (list != null) for (int i = 0; i < list.length(); i++) out.put(list.optJSONObject(i));
        if (cfg.optBoolean("syncPhoneAlarm", false)) {
            long ring = nextSystemAlarm(ctx);
            if (ring > 0) {
                try {
                    int before = cfg.optInt("minutesBefore", 60);
                    JSONObject a = new JSONObject();
                    a.put("id", PHONE_ALARM_ID);
                    a.put("onceAt", ring - before * 60_000L);
                    a.put("minutes", before);
                    a.put("color", cfg.optString("color", "#ff8a30"));
                    out.put(a);
                } catch (Exception ignored) { }
            }
        }
        return out;
    }

    /** (Re)arm every exact alarm. Called after config changes, on boot, after each alarm and periodically. */
    static long scheduleAll(Context ctx) {
        JSONObject cfg = config(ctx);
        AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
        long now = System.currentTimeMillis();
        long soonest = 0;

        // Cancel what was armed before (ids are remembered).
        JSONArray armed = new JSONArray();
        try { armed = new JSONArray(prefs(ctx).getString("armed", "[]")); } catch (Exception ignored) { }
        for (int i = 0; i < armed.length(); i++) am.cancel(firePending(ctx, armed.optString(i), null));

        JSONArray alarms = allAlarms(ctx, cfg);
        JSONArray nowArmed = new JSONArray();
        for (int i = 0; i < alarms.length(); i++) {
            JSONObject a = alarms.optJSONObject(i);
            if (a == null) continue;
            long at = nextOccurrence(a, now);
            if (at <= 0) continue;
            PendingIntent pi = firePending(ctx, a.optString("id"), a);
            boolean exact = Build.VERSION.SDK_INT < 31 || am.canScheduleExactAlarms();
            boolean own = !PHONE_ALARM_ID.equals(a.optString("id"));
            if (exact && own) {
                // GlowPilot's own alarm clock: highest priority (like the Clock app), ⏰ icon in the status bar.
                PendingIntent show = PendingIntent.getActivity(ctx, 7, new Intent(ctx, MainActivity.class), PendingIntent.FLAG_IMMUTABLE);
                am.setAlarmClock(new AlarmManager.AlarmClockInfo(at, show), pi);
            } else if (exact) am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi);
            else am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi);
            nowArmed.put(a.optString("id"));
            if (soonest == 0 || at < soonest) soonest = at;
        }
        prefs(ctx).edit().putString("armed", nowArmed.toString()).apply();

        // Re-read the Clock app's alarm every 3 h even if the app is never opened.
        PendingIntent sync = PendingIntent.getBroadcast(ctx, 9001, new Intent(ctx, AlarmReceiver.class).setAction(ACTION_SYNC),
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        am.setInexactRepeating(AlarmManager.RTC_WAKEUP, now + AlarmManager.INTERVAL_HOUR * 3, AlarmManager.INTERVAL_HOUR * 3, sync);

        reportPhoneAlarm(ctx, cfg);
        Log.i(TAG, "armed " + nowArmed.length() + " alarm(s), next at " + soonest);
        return soonest;
    }

    private static PendingIntent firePending(Context ctx, String id, JSONObject alarm) {
        Intent i = new Intent(ctx, AlarmReceiver.class).setAction(ACTION_FIRE).setData(android.net.Uri.parse("glowpilot://alarm/" + id));
        if (alarm != null) i.putExtra("alarm", alarm.toString());
        return PendingIntent.getBroadcast(ctx, id.hashCode(), i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    /** Tell GlowPilot Desktop when the lights should start for the phone's alarm, so the PC can do it too (and wake for it). */
    private static void reportPhoneAlarm(Context ctx, JSONObject cfg) {
        String base = cfg.optString("desktopUrl", "");
        String token = cfg.optString("token", "");
        if (base.isEmpty() || token.isEmpty()) return;
        long ring = cfg.optBoolean("syncPhoneAlarm", false) ? nextSystemAlarm(ctx) : 0;
        long start = ring > 0 ? ring - cfg.optInt("minutesBefore", 60) * 60_000L : 0;
        String sig = start + "|" + cfg.optInt("minutesBefore", 60) + "|" + cfg.optString("color");
        if (sig.equals(prefs(ctx).getString("reported", ""))) return;
        new Thread(() -> {
            try {
                JSONObject body = new JSONObject();
                body.put("at", start > 0 ? start : JSONObject.NULL);
                body.put("minutes", cfg.optInt("minutesBefore", 60));
                body.put("color", cfg.optString("color", "#ff8a30"));
                HttpURLConnection c = (HttpURLConnection) new URL(base + "/api/phone-alarm").openConnection();
                c.setConnectTimeout(4000);
                c.setReadTimeout(4000);
                c.setRequestMethod("POST");
                c.setDoOutput(true);
                c.setRequestProperty("Authorization", "Bearer " + token);
                c.setRequestProperty("Content-Type", "application/json");
                try (OutputStream os = c.getOutputStream()) { os.write(body.toString().getBytes(StandardCharsets.UTF_8)); }
                if (c.getResponseCode() == 200) prefs(ctx).edit().putString("reported", sig).apply();
                c.disconnect();
            } catch (Exception e) {
                Log.i(TAG, "PC not reachable for phone alarm sync: " + e.getMessage());
            }
        }).start();
    }
}
