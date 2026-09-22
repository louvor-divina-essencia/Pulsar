package br.com.utilitypad.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(MediaLibraryPlugin.class);
        registerPlugin(NexoSyncPlugin.class);
        registerPlugin(NexoDrivePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
