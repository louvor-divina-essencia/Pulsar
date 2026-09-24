package br.com.utilitypad.app;

import android.content.Context;
import android.content.SharedPreferences;
import android.media.AudioAttributes;
import android.media.MediaPlayer;
import android.net.Uri;
import android.provider.DocumentsContract;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;

@CapacitorPlugin(name = "PulsarDriveAudio")
public class PulsarDriveAudioPlugin extends Plugin {
    private static final String PREFS = "nexo_drive";
    private static final String KEY_TREE_URI = "tree_uri";
    private MediaPlayer previewPlayer;

    private Uri treeUri() {
        SharedPreferences prefs = getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String value = prefs.getString(KEY_TREE_URI, null);
        return value == null || value.trim().isEmpty() ? null : Uri.parse(value);
    }

    private Uri documentUri(String sourceId) {
        Uri tree = treeUri();
        if (tree == null) throw new IllegalStateException("Nenhuma pasta PULSAR conectada");
        if (sourceId == null || sourceId.trim().isEmpty()) throw new IllegalArgumentException("Arquivo do Drive inválido");
        return DocumentsContract.buildDocumentUriUsingTree(tree, sourceId);
    }

    private synchronized void stopPreviewInternal() {
        if (previewPlayer != null) {
            try { previewPlayer.stop(); } catch (Exception ignored) {}
            try { previewPlayer.reset(); } catch (Exception ignored) {}
            try { previewPlayer.release(); } catch (Exception ignored) {}
            previewPlayer = null;
        }
    }

    @PluginMethod
    public void preview(PluginCall call) {
        final String sourceId = call.getString("sourceId");
        final float volume = Math.max(0f, Math.min(1f, call.getFloat("volume", 1f)));
        try {
            stopPreviewInternal();
            MediaPlayer player = new MediaPlayer();
            previewPlayer = player;
            player.setAudioAttributes(new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_MEDIA)
                .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                .build());
            player.setDataSource(getContext(), documentUri(sourceId));
            player.setVolume(volume, volume);
            player.setOnPreparedListener(mp -> {
                try { mp.start(); } catch (Exception ignored) {}
            });
            player.setOnCompletionListener(mp -> stopPreviewInternal());
            player.setOnErrorListener((mp, what, extra) -> {
                stopPreviewInternal();
                notifyListeners("previewError", new JSObject().put("what", what).put("extra", extra));
                return true;
            });
            player.prepareAsync();
            call.resolve(new JSObject().put("started", true));
        } catch (Exception error) {
            stopPreviewInternal();
            call.reject("Não foi possível testar este áudio do Drive: " + friendly(error), error);
        }
    }

    @PluginMethod
    public void stopPreview(PluginCall call) {
        stopPreviewInternal();
        call.resolve(new JSObject().put("stopped", true));
    }

    @PluginMethod
    public void cacheAsset(PluginCall call) {
        final String sourceId = call.getString("sourceId");
        final String name = call.getString("name", "audio");
        final String kind = call.getString("kind", "drum");
        final String bankName = call.getString("bankName", "Drive");
        new Thread(() -> {
            try {
                Uri source = documentUri(sourceId);
                File root = new File(getContext().getFilesDir(), "pulsar_drive_offline");
                File bank = new File(new File(root, safe(kind)), safe(bankName));
                if (!bank.exists() && !bank.mkdirs()) throw new IllegalStateException("Não foi possível criar o armazenamento offline");
                String filename = Integer.toHexString(sourceId.hashCode()) + "-" + safeFile(name);
                File target = new File(bank, filename);
                File temp = new File(bank, filename + ".download");
                if (temp.exists()) temp.delete();
                long copied = 0;
                try (InputStream input = getContext().getContentResolver().openInputStream(source);
                     FileOutputStream output = new FileOutputStream(temp, false)) {
                    if (input == null) throw new IllegalStateException("Arquivo indisponível no Drive");
                    byte[] buffer = new byte[256 * 1024];
                    int read;
                    while ((read = input.read(buffer)) != -1) {
                        output.write(buffer, 0, read);
                        copied += read;
                    }
                    output.flush();
                }
                if (copied <= 0) throw new IllegalStateException("O Drive retornou um arquivo vazio");
                if (target.exists() && !target.delete()) throw new IllegalStateException("Não foi possível atualizar a cópia offline");
                if (!temp.renameTo(target)) throw new IllegalStateException("Não foi possível finalizar a cópia offline");
                JSObject out = new JSObject();
                out.put("cached", true);
                out.put("fileUri", Uri.fromFile(target).toString());
                out.put("bytes", target.length());
                out.put("sourceId", sourceId);
                out.put("name", name);
                call.resolve(out);
            } catch (Exception error) {
                call.reject("Não foi possível deixar este áudio offline: " + friendly(error), error);
            }
        }, "PULSAR-Drive-Cache").start();
    }

    @PluginMethod
    public void removeCached(PluginCall call) {
        String fileUri = call.getString("fileUri");
        boolean removed = false;
        try {
            if (fileUri != null && fileUri.startsWith("file:")) {
                File file = new File(Uri.parse(fileUri).getPath());
                File root = new File(getContext().getFilesDir(), "pulsar_drive_offline");
                if (file.getCanonicalPath().startsWith(root.getCanonicalPath())) removed = !file.exists() || file.delete();
            }
        } catch (Exception ignored) {}
        call.resolve(new JSObject().put("removed", removed));
    }

    @Override
    protected void handleOnDestroy() {
        stopPreviewInternal();
        super.handleOnDestroy();
    }

    private String safe(String value) {
        String out = value == null ? "drive" : value.replaceAll("[^a-zA-Z0-9._-]+", "-").replaceAll("-+", "-");
        return out.isEmpty() ? "drive" : out;
    }

    private String safeFile(String value) {
        String out = value == null ? "audio" : value.replaceAll("[\\\\/:*?\"<>|]+", "-").trim();
        return out.isEmpty() ? "audio" : out;
    }

    private String friendly(Exception error) {
        String message = error == null ? null : error.getMessage();
        return message == null || message.trim().isEmpty() ? "erro desconhecido" : message;
    }
}
