package app.glowpilot;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;
import static org.robolectric.Shadows.shadowOf;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.annotation.Config;

import java.util.Calendar;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 34)
public class AlarmStoreTest {
    private Context ctx;
    private AlarmManager am;

    @Before
    public void setUp() {
        ctx = RuntimeEnvironment.getApplication();
        am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
        AlarmStore.prefs(ctx).edit().clear().commit();
    }

    /** Saturday 7 Nov 2026, 20:41 local time. */
    private static long now() {
        Calendar c = Calendar.getInstance();
        c.set(2026, Calendar.NOVEMBER, 7, 20, 41, 0);
        c.set(Calendar.MILLISECOND, 0);
        return c.getTimeInMillis();
    }

    private static long at(int dayOfMonth, int h, int m) {
        Calendar c = Calendar.getInstance();
        c.set(2026, Calendar.NOVEMBER, dayOfMonth, h, m, 0);
        c.set(Calendar.MILLISECOND, 0);
        return c.getTimeInMillis();
    }

    /** Make Android report `pkg`'s alarm at `t` as the next alarm clock (null pkg = none). */
    private void nextAlarm(String pkg, long t) {
        PendingIntent op = PendingIntent.getBroadcast(ctx, 1, new Intent("test.ALARM"), PendingIntent.FLAG_IMMUTABLE);
        am.cancel(op);
        if (pkg == null) return;
        PendingIntent show = PendingIntent.getActivity(ctx, 0, new Intent(pkg), PendingIntent.FLAG_IMMUTABLE);
        shadowOf(show).setCreatorPackage(pkg);
        am.setAlarmClock(new AlarmManager.AlarmClockInfo(t, show), op);
    }

    private static JSONObject alarm(String time, int... days) throws Exception {
        JSONArray d = new JSONArray();
        for (int x : days) d.put(x);
        return new JSONObject().put("time", time).put("days", d);
    }

    @Test
    public void nextOccurrence_recurringOneShotAndInvalid() throws Exception {
        long now = now();
        assertEquals(at(8, 7, 0), AlarmStore.nextOccurrence(alarm("07:00"), now));          // no days: next 07:00 (tomorrow)
        assertEquals(at(9, 7, 0), AlarmStore.nextOccurrence(alarm("07:00", 1, 2), now));    // Monday
        assertEquals(at(7, 21, 0), AlarmStore.nextOccurrence(alarm("21:00", 6), now));      // later today (Saturday)
        assertEquals(at(14, 20, 0), AlarmStore.nextOccurrence(alarm("20:00", 6), now));     // today already passed: next week
        assertEquals(0, AlarmStore.nextOccurrence(alarm("7h00"), now));
        assertEquals(now + 1000, AlarmStore.nextOccurrence(new JSONObject().put("onceAt", now + 1000), now));
        assertEquals(0, AlarmStore.nextOccurrence(new JSONObject().put("onceAt", now - 1000), now));
    }

    @Test
    public void clockAlarmStillSet_onlyTrustsWhatAndroidShowsNow() {
        long ring = now() + 3_600_000L;
        nextAlarm(null, 0);
        assertFalse("no alarm at all: it was switched off", AlarmStore.clockAlarmStillSet(ctx, ring));
        nextAlarm("com.google.android.deskclock", ring + 30_000L);
        assertTrue(AlarmStore.clockAlarmStillSet(ctx, ring));
        nextAlarm("com.google.android.deskclock", ring + 3_600_000L);
        assertFalse("the clock's next alarm is somewhere else", AlarmStore.clockAlarmStillSet(ctx, ring));
        nextAlarm("com.example.calendar", ring - 600_000L);
        assertTrue("another app's earlier alarm hides it: keep going", AlarmStore.clockAlarmStillSet(ctx, ring));
        nextAlarm("com.example.calendar", ring + 600_000L);
        assertFalse(AlarmStore.clockAlarmStillSet(ctx, ring));
    }

    @Test
    public void isClockApp() {
        assertTrue(AlarmStore.isClockApp("com.sec.android.app.clockpackage"));
        assertTrue(AlarmStore.isClockApp("com.example.AlarmApp"));
        assertTrue(AlarmStore.isClockApp("com.android.bbkclock"));
        assertFalse(AlarmStore.isClockApp("com.google.android.calendar"));
    }

    @Test
    public void allAlarms_ownAlarmsSleepTimerAndSyncedClockAlarm() throws Exception {
        long ring = System.currentTimeMillis() + 8 * 3_600_000L;
        nextAlarm("com.google.android.deskclock", ring);
        JSONObject cfg = new JSONObject()
                .put("alarms", new JSONArray().put(alarm("07:00", 1).put("id", "a1")))
                .put("sleep", new JSONObject().put("at", System.currentTimeMillis() + 600_000L).put("brightness", 40))
                .put("syncPhoneAlarm", true).put("minutesBefore", 20).put("color", "#ff0000").put("endBrightness", 60);
        JSONArray out = AlarmStore.allAlarms(ctx, cfg);
        assertEquals(3, out.length());
        assertEquals("a1", out.getJSONObject(0).getString("id"));
        JSONObject sleep = out.getJSONObject(1);
        assertEquals("sleep", sleep.getString("kind"));
        assertEquals(40, sleep.getInt("brightness"));
        JSONObject phone = out.getJSONObject(2);
        assertEquals(AlarmStore.PHONE_ALARM_ID, phone.getString("id"));
        assertEquals(ring - 20 * 60_000L, phone.getLong("onceAt"));
        assertEquals(ring, phone.getLong("ring"));
        assertEquals("com.google.android.deskclock", phone.getString("clockPkg"));
        assertEquals("steady", phone.getString("rhythm"));
        assertFalse(phone.getBoolean("flashDuringBuildup"));
        assertEquals(60, phone.getInt("endBrightness"));
    }

    @Test
    public void allAlarms_noClockAlarm_noPastSleep_flashWhenAsked() throws Exception {
        nextAlarm("com.example.calendar", System.currentTimeMillis() + 3_600_000L); // not a clock app
        JSONObject cfg = new JSONObject()
                .put("sleep", new JSONObject().put("at", System.currentTimeMillis() - 1000))
                .put("syncPhoneAlarm", true);
        assertEquals(0, AlarmStore.allAlarms(ctx, cfg).length());

        long ring = System.currentTimeMillis() + 3_600_000L;
        nextAlarm("com.google.android.deskclock", ring);
        JSONObject phone = AlarmStore.allAlarms(ctx, cfg.put("flash", true)).getJSONObject(0);
        assertEquals("flash", phone.getString("rhythm"));
        assertEquals(60, phone.getInt("minutes"));
    }

    @Test
    public void nextClockAlarm_remembersAHiddenClockAlarmOnlyWhileBelievable() {
        long clock = System.currentTimeMillis() + 8 * 3_600_000L;
        nextAlarm("com.google.android.deskclock", clock);
        assertEquals(clock, AlarmStore.nextSystemAlarm(ctx));
        // A calendar reminder now comes first and hides it: the remembered clock alarm still counts.
        nextAlarm("com.example.calendar", clock - 3_600_000L);
        assertEquals(clock, AlarmStore.nextSystemAlarm(ctx));
        // Something later than the remembered one is shown: the clock alarm was switched off.
        nextAlarm("com.example.calendar", clock + 3_600_000L);
        assertEquals(0, AlarmStore.nextSystemAlarm(ctx));
        assertEquals(0, AlarmStore.prefs(ctx).getLong("clockAlarmAt", 0));
    }
}
