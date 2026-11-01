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
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import org.json.JSONObject;

/** Bridge for the web app: hand over light alarms, read the phone's alarm clock, stop a ringing alarm. */
@CapacitorPlugin(
    name = "GlowAlarm",
    permissions = {
        @Permission(alias = "bluetooth", strings = { Manifest.permission.BLUETOOTH_CONNECT, Manifest.permission.BLUETOOTH_SCAN }),
        @Permission(alias = "notifications", strings = { Manifest.permission.POST_NOTIFICATIONS }),
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

    private boolean canExact() {
        if (Build.VERSION.SDK_INT < 31) return true;
        return ((AlarmManager) getContext().getSystemService(Context.ALARM_SERVICE)).canScheduleExactAlarms();
    }
}
