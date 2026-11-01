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
        long at = AlarmStore.nextSystemAlarm(getContext());
        r.put("at", at > 0 ? at : null);
        call.resolve(r);
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
