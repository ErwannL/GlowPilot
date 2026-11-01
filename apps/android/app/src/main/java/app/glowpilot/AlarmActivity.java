package app.glowpilot;

import android.app.Activity;
import android.app.KeyguardManager;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.os.Bundle;
import android.view.Gravity;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;

import java.lang.ref.WeakReference;
import java.text.DateFormat;
import java.util.Date;

/** Full-screen alarm screen over the lock screen, like the Clock app: big time, Snooze and Stop. */
public class AlarmActivity extends Activity {
    private static WeakReference<AlarmActivity> current = new WeakReference<>(null);

    static void closeIfOpen() {
        AlarmActivity a = current.get();
        if (a != null) a.runOnUiThread(a::finish);
    }

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        current = new WeakReference<>(this);
        if (Build.VERSION.SDK_INT >= 27) {
            setShowWhenLocked(true);
            setTurnScreenOn(true);
            KeyguardManager km = getSystemService(KeyguardManager.class);
            if (km != null) km.requestDismissKeyguard(this, null);
        } else {
            getWindow().addFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON);
        }
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setGravity(Gravity.CENTER);
        root.setPadding(48, 48, 48, 48);
        root.setBackground(new GradientDrawable(GradientDrawable.Orientation.TOP_BOTTOM, new int[]{0xFF2A1240, 0xFF0B0A14, 0xFF3A1A08}));

        TextView time = new TextView(this);
        time.setText(DateFormat.getTimeInstance(DateFormat.SHORT).format(new Date()));
        time.setTextColor(Color.WHITE);
        time.setTextSize(72);
        time.setTypeface(Typeface.DEFAULT_BOLD);
        time.setGravity(Gravity.CENTER);
        root.addView(time);

        TextView title = new TextView(this);
        title.setText(AlarmService.ringTitle == null || AlarmService.ringTitle.isEmpty() ? "Wake up" : AlarmService.ringTitle);
        title.setTextColor(0xCCFFFFFF);
        title.setTextSize(22);
        title.setGravity(Gravity.CENTER);
        title.setPadding(0, 8, 0, 96);
        root.addView(title);

        root.addView(button("Snooze", 0xFF5A3CFF, AlarmService.ACTION_SNOOZE));
        root.addView(button("Stop", 0xFFF97316, AlarmService.ACTION_STOP));
        setContentView(root);
    }

    private Button button(String label, int color, String action) {
        Button b = new Button(this);
        b.setText(label);
        b.setTextSize(22);
        b.setTextColor(Color.WHITE);
        b.setAllCaps(false);
        GradientDrawable bg = new GradientDrawable();
        bg.setColor(color);
        bg.setCornerRadius(64);
        b.setBackground(bg);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 180);
        lp.setMargins(0, 24, 0, 0);
        b.setLayoutParams(lp);
        b.setOnClickListener(v -> {
            startService(new Intent(this, AlarmService.class).setAction(action));
            finish();
        });
        return b;
    }

    @Override
    public void onBackPressed() {
        // Back does not dismiss the alarm: Snooze or Stop.
    }
}
