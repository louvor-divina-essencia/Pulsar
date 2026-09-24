package br.com.utilitypad.app;

import android.Manifest;
import android.content.ContentResolver;
import android.content.ContentUris;
import android.database.Cursor;
import android.media.AudioAttributes;
import android.media.MediaPlayer;
import android.net.Uri;
import android.os.Build;
import android.provider.MediaStore;
import android.provider.OpenableColumns;
import android.webkit.MimeTypeMap;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.List;
import java.util.Random;

@CapacitorPlugin(
    name = "SampleLibrary",
    permissions = {
        @Permission(alias = "audio33", strings = { Manifest.permission.READ_MEDIA_AUDIO }),
        @Permission(alias = "audioLegacy", strings = { Manifest.permission.READ_EXTERNAL_STORAGE })
    }
)
public class SampleLibraryPlugin extends Plugin {
    private final Random random = new Random();
    private MediaPlayer previewPlayer;

    private String permissionAlias() {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU ? "audio33" : "audioLegacy";
    }

    @PluginMethod
    public void getAudioFiles(PluginCall call) {
        String alias = permissionAlias();
        if (getPermissionState(alias) != PermissionState.GRANTED) {
            requestPermissionForAlias(alias, call, "audioPermissionCallback");
            return;
        }
        queryAudioFiles(call);
    }

    @PermissionCallback
    private void audioPermissionCallback(PluginCall call) {
        if (getPermissionState(permissionAlias()) == PermissionState.GRANTED) queryAudioFiles(call);
        else call.reject("Audio permission denied");
    }

    private void queryAudioFiles(PluginCall call) {
        new Thread(() -> {
            JSArray files = new JSArray();
            Uri collection = MediaStore.Audio.Media.EXTERNAL_CONTENT_URI;
            List<String> columns = new ArrayList<>();
            columns.add(MediaStore.Audio.Media._ID);
            columns.add(MediaStore.Audio.Media.DISPLAY_NAME);
            columns.add(MediaStore.Audio.Media.DURATION);
            columns.add(MediaStore.Audio.Media.MIME_TYPE);
            columns.add(MediaStore.Audio.Media.DATE_ADDED);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) columns.add(MediaStore.Audio.Media.RELATIVE_PATH);

            try (Cursor cursor = getContext().getContentResolver().query(
                collection,
                columns.toArray(new String[0]),
                MediaStore.Audio.Media.DURATION + " > 0",
                null,
                (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q ? MediaStore.Audio.Media.RELATIVE_PATH + " COLLATE NOCASE ASC, " : "") + MediaStore.Audio.Media.DISPLAY_NAME + " COLLATE NOCASE ASC"
            )) {
                if (cursor != null) {
                    int idColumn = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media._ID);
                    int nameColumn = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.DISPLAY_NAME);
                    int durationColumn = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.DURATION);
                    int mimeColumn = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.MIME_TYPE);
                    int dateColumn = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.DATE_ADDED);
                    int folderColumn = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q ? cursor.getColumnIndex(MediaStore.Audio.Media.RELATIVE_PATH) : -1;
                    while (cursor.moveToNext()) {
                        long id = cursor.getLong(idColumn);
                        String name = cursor.getString(nameColumn);
                        String folder = folderColumn >= 0 ? cursor.getString(folderColumn) : "Armazenamento";
                        if (folder == null || folder.trim().isEmpty()) folder = "Armazenamento";
                        JSObject item = new JSObject();
                        item.put("id", String.valueOf(id));
                        item.put("name", name == null || name.trim().isEmpty() ? "Áudio" : name.trim());
                        item.put("duration", cursor.getLong(durationColumn));
                        item.put("mimeType", cursor.getString(mimeColumn));
                        item.put("dateAdded", cursor.getLong(dateColumn));
                        item.put("folder", folder.replaceAll("/+$", ""));
                        item.put("uri", ContentUris.withAppendedId(collection, id).toString());
                        files.put(item);
                    }
                }
                JSObject result = new JSObject();
                result.put("files", files);
                result.put("total", files.length());
                call.resolve(result);
            } catch (Exception error) {
                call.reject("Could not read audio files", error);
            }
        }).start();
    }

    @PluginMethod
    public void importAudioUris(PluginCall call) {
        JSArray uris = call.getArray("uris");
        if (uris == null || uris.length() == 0) {
            call.reject("No audio selected");
            return;
        }
        new Thread(() -> {
            try {
                JSArray files = new JSArray();
                for (int i = 0; i < uris.length(); i++) {
                    try {
                        String value = uris.getString(i);
                        if (value == null || value.trim().isEmpty()) continue;
                        files.put(copyAudio(Uri.parse(value)));
                    } catch (Exception itemError) {
                        itemError.printStackTrace();
                    }
                }
                JSObject result = new JSObject();
                result.put("files", files);
                result.put("total", files.length());
                call.resolve(result);
            } catch (Exception error) {
                call.reject("Could not import selected audio", error);
            }
        }).start();
    }

    private JSObject copyAudio(Uri source) throws Exception {
        ContentResolver resolver = getContext().getContentResolver();
        String displayName = getDisplayName(source);
        String mime = null;
        try { mime = resolver.getType(source); } catch (Exception ignored) {}
        String extension = mime == null ? null : MimeTypeMap.getSingleton().getExtensionFromMimeType(mime);
        if (extension == null || extension.trim().isEmpty()) {
            int dot = displayName.lastIndexOf('.');
            extension = dot >= 0 && dot < displayName.length() - 1 ? displayName.substring(dot + 1) : "audio";
        }
        extension = safePart(extension.toLowerCase());
        String baseName = displayName;
        int dot = baseName.lastIndexOf('.');
        if (dot > 0) baseName = baseName.substring(0, dot);
        baseName = safePart(baseName);
        if (baseName.isEmpty()) baseName = "sample";

        File directory = new File(getContext().getFilesDir(), "pulsar_samples");
        if (!directory.exists() && !directory.mkdirs()) throw new IllegalStateException("Sample storage unavailable");
        File output = new File(directory, System.currentTimeMillis() + "-" + Math.abs(random.nextInt()) + "-" + baseName + "." + extension);

        try (InputStream input = openInput(source); FileOutputStream stream = new FileOutputStream(output)) {
            if (input == null) throw new IllegalStateException("Audio unavailable");
            byte[] buffer = new byte[65536];
            int read;
            while ((read = input.read(buffer)) != -1) stream.write(buffer, 0, read);
        }

        JSObject file = new JSObject();
        file.put("name", displayName);
        file.put("fileUri", Uri.fromFile(output).toString());
        file.put("size", output.length());
        return file;
    }

    private InputStream openInput(Uri uri) throws Exception {
        if ("file".equalsIgnoreCase(uri.getScheme())) {
            String path = uri.getPath();
            if (path == null) throw new IllegalArgumentException("Invalid file URI");
            return new FileInputStream(new File(path));
        }
        return getContext().getContentResolver().openInputStream(uri);
    }

    private String getDisplayName(Uri uri) {
        if ("file".equalsIgnoreCase(uri.getScheme())) {
            String path = uri.getPath();
            if (path != null) return new File(path).getName();
        }
        try (Cursor cursor = getContext().getContentResolver().query(uri, new String[]{OpenableColumns.DISPLAY_NAME}, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) {
                int index = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                if (index >= 0) {
                    String value = cursor.getString(index);
                    if (value != null && !value.trim().isEmpty()) return value.trim();
                }
            }
        } catch (Exception ignored) {}
        String last = uri.getLastPathSegment();
        return last == null || last.trim().isEmpty() ? "audio" : last;
    }

    private String safePart(String value) {
        return String.valueOf(value == null ? "" : value).replaceAll("[^a-zA-Z0-9._-]+", "_").replaceAll("^_+|_+$", "");
    }

    @PluginMethod
    public void preview(PluginCall call) {
        String uriValue = call.getString("uri");
        if (uriValue == null || uriValue.trim().isEmpty()) {
            call.reject("Missing audio URI");
            return;
        }
        try {
            stopPreviewInternal();
            MediaPlayer player = new MediaPlayer();
            previewPlayer = player;
            player.setAudioAttributes(new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_MUSIC).build());
            Uri uri = Uri.parse(uriValue);
            if ("file".equalsIgnoreCase(uri.getScheme())) player.setDataSource(uri.getPath());
            else player.setDataSource(getContext(), uri);
            player.setOnPreparedListener(mp -> {
                try {
                    mp.start();
                    JSObject result = new JSObject();
                    result.put("playing", true);
                    result.put("duration", mp.getDuration());
                    call.resolve(result);
                } catch (Exception error) {
                    stopPreviewInternal();
                    call.reject("Could not start preview", error);
                }
            });
            player.setOnCompletionListener(mp -> stopPreviewInternal());
            player.setOnErrorListener((mp, what, extra) -> {
                stopPreviewInternal();
                call.reject("Could not preview audio (" + what + "/" + extra + ")");
                return true;
            });
            player.prepareAsync();
        } catch (Exception error) {
            stopPreviewInternal();
            call.reject("Could not open preview", error);
        }
    }

    @PluginMethod
    public void stopPreview(PluginCall call) {
        stopPreviewInternal();
        call.resolve();
    }

    private void stopPreviewInternal() {
        MediaPlayer player = previewPlayer;
        previewPlayer = null;
        if (player != null) {
            try { player.stop(); } catch (Exception ignored) {}
            try { player.reset(); } catch (Exception ignored) {}
            try { player.release(); } catch (Exception ignored) {}
        }
    }

    @PluginMethod
    public void deleteManagedFile(PluginCall call) {
        String uriValue = call.getString("fileUri");
        if (uriValue == null || uriValue.trim().isEmpty()) { call.resolve(); return; }
        try {
            Uri uri = Uri.parse(uriValue);
            if (!"file".equalsIgnoreCase(uri.getScheme())) { call.reject("Invalid managed file"); return; }
            File directory = new File(getContext().getFilesDir(), "pulsar_samples");
            File target = new File(uri.getPath());
            String root = directory.getCanonicalPath() + File.separator;
            String candidate = target.getCanonicalPath();
            if (!candidate.startsWith(root)) { call.reject("Invalid managed file"); return; }
            JSObject result = new JSObject();
            result.put("deleted", !target.exists() || target.delete());
            call.resolve(result);
        } catch (Exception error) {
            call.reject("Could not delete managed file", error);
        }
    }

    @Override
    protected void handleOnDestroy() {
        stopPreviewInternal();
        super.handleOnDestroy();
    }
}
