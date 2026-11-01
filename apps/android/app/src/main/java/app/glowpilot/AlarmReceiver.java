package app.glowpilot;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.util.Log;

import androidx.core.content.ContextCompat;

/** Exact alarm fired, phone rebooted, the Clock alarm changed, or the periodic re-sync: act and re-arm. */
public class AlarmReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context ctx, Intent intent) {
        String action = intent.getAction();
        if (AlarmStore.ACTION_FIRE.equals(action)) {
            Intent svc = new Intent(ctx, AlarmService.class).putExtra("alarm", intent.getStringExtra("alarm"));
            try {
                ContextCompat.startForegroundService(ctx, svc);
            } catch (Exception e) {
                Log.e(AlarmStore.TAG, "could not start the alarm service", e);
            }
        }
        // Every event is a good moment to re-arm (next occurrence, new Clock alarm, after reboot).
        AlarmStore.scheduleAll(ctx);
    }
}
