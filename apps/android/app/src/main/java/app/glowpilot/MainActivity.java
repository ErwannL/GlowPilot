package app.glowpilot;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(GlowAlarmPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
