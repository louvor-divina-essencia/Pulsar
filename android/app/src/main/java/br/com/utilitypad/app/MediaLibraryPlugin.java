package br.com.utilitypad.app;

import android.Manifest;
import android.app.Activity;
import android.content.ClipData;
import android.content.ContentResolver;
import android.content.Intent;
import android.content.ContentUris;
import android.database.Cursor;
import android.media.AudioAttributes;
import android.media.MediaPlayer;
import android.media.audiofx.Equalizer;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.provider.MediaStore;
import android.provider.OpenableColumns;
import android.webkit.MimeTypeMap;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.List;
import java.util.Random;
import org.json.JSONObject;

@CapacitorPlugin(
    name = "MediaLibrary",
    permissions = {
        @Permission(alias = "audio33", strings = { Manifest.permission.READ_MEDIA_AUDIO }),
        @Permission(alias = "audioLegacy", strings = { Manifest.permission.READ_EXTERNAL_STORAGE })
    }
)
public class MediaLibraryPlugin extends Plugin {
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Random random = new Random();

    // Ambient pads use a dedicated native streaming player so large pad files
    // are not decoded entirely inside the WebView/JavaScript heap.
    private final MediaPlayer[] ambientPlayers = new MediaPlayer[2];
    private final Equalizer[] ambientEqualizers = new Equalizer[2];
    private float ambientVolume = 0.7f;
    private int ambientCutoff = 100;
    private final int[] ambientGenerations = new int[]{0, 0};


    private final Runnable progressTicker = new Runnable() {
        @Override
        public void run() {
            notifyPlayerState();
            handler.postDelayed(this, 500);
        }
    };

    @Override
    public void load() {
        handler.post(progressTicker);
    }

    private String permissionAlias() {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU ? "audio33" : "audioLegacy";
    }

    @PluginMethod
    public void pickAudioFiles(PluginCall call) {
        boolean multiple = call.getBoolean("multiple", false);
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("audio/*");
        intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, multiple);
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
        startActivityForResult(call, intent, "audioFilesPicked");
    }

    @ActivityCallback
    private void audioFilesPicked(PluginCall call, ActivityResult result) {
        if (call == null) return;
        Intent data = result.getData();
        if (result.getResultCode() != Activity.RESULT_OK || data == null) {
            call.reject("cancelled");
            return;
        }

        new Thread(() -> {
            try {
                List<Uri> selected = new ArrayList<>();
                ClipData clip = data.getClipData();
                if (clip != null) {
                    for (int i = 0; i < clip.getItemCount(); i++) {
                        Uri uri = clip.getItemAt(i).getUri();
                        if (uri != null) selected.add(uri);
                    }
                } else if (data.getData() != null) {
                    selected.add(data.getData());
                }

                JSArray files = new JSArray();
                for (Uri uri : selected) {
                    try {
                        files.put(copyPadFile(uri));
                    } catch (Exception itemError) {
                        itemError.printStackTrace();
                    }
                }
                JSObject payload = new JSObject();
                payload.put("files", files);
                payload.put("total", files.length());
                call.resolve(payload);
            } catch (Exception error) {
                call.reject("Could not import audio files", error);
            }
        }).start();
    }

    private JSObject copyPadFile(Uri source) throws Exception {
        ContentResolver resolver = getContext().getContentResolver();
        String displayName = getDisplayName(source);
        String extension = MimeTypeMap.getSingleton().getExtensionFromMimeType(resolver.getType(source));
        if (extension == null || extension.trim().isEmpty()) {
            int dot = displayName.lastIndexOf('.');
            extension = dot >= 0 && dot < displayName.length() - 1 ? displayName.substring(dot + 1) : "audio";
        }
        extension = safePart(extension.toLowerCase());
        String baseName = displayName;
        int dot = baseName.lastIndexOf('.');
        if (dot > 0) baseName = baseName.substring(0, dot);
        baseName = safePart(baseName);
        if (baseName.isEmpty()) baseName = "pad";

        File directory = new File(getContext().getFilesDir(), "nexo_pads");
        if (!directory.exists() && !directory.mkdirs()) throw new IllegalStateException("Pad storage unavailable");
        File output = new File(directory, System.currentTimeMillis() + "-" + Math.abs(random.nextInt()) + "-" + baseName + "." + extension);

        try (InputStream input = resolver.openInputStream(source); FileOutputStream stream = new FileOutputStream(output)) {
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

    private String getDisplayName(Uri uri) {
        String fallback = "audio";
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
        return last == null || last.trim().isEmpty() ? fallback : last;
    }

    @PluginMethod
    public void deletePadFile(PluginCall call) {
        String uriValue = call.getString("fileUri");
        if (uriValue == null || uriValue.trim().isEmpty()) {
            call.resolve();
            return;
        }
        try {
            File directory = new File(getContext().getFilesDir(), "nexo_pads");
            File target = new File(Uri.parse(uriValue).getPath());
            String root = directory.getCanonicalPath() + File.separator;
            String candidate = target.getCanonicalPath();
            if (!candidate.startsWith(root)) {
                call.reject("Invalid pad file");
                return;
            }
            boolean deleted = !target.exists() || target.delete();
            JSObject result = new JSObject();
            result.put("deleted", deleted);
            call.resolve(result);
        } catch (Exception error) {
            call.reject("Could not delete pad file", error);
        }
    }


    private int ambientSlot(Integer requested) {
        return Math.max(0, Math.min(1, requested == null ? 0 : requested));
    }

    private void releaseAmbientEqualizer(int slot) {
        if (ambientEqualizers[slot] != null) {
            try { ambientEqualizers[slot].release(); } catch (Exception ignored) {}
            ambientEqualizers[slot] = null;
        }
    }

    private void applyAmbientCutoff(int slot) {
        releaseAmbientEqualizer(slot);
        MediaPlayer player = ambientPlayers[slot];
        if (player == null || ambientCutoff >= 99) return;
        try {
            Equalizer eq = new Equalizer(0, player.getAudioSessionId());
            short bands = eq.getNumberOfBands();
            short[] range = eq.getBandLevelRange();
            short minLevel = range[0];
            double t = Math.max(0, Math.min(100, ambientCutoff)) / 100.0;
            double cutoffHz = 220.0 * Math.pow(20000.0 / 220.0, t);
            for (short band = 0; band < bands; band++) {
                double centerHz = eq.getCenterFreq(band) / 1000.0;
                short level = 0;
                if (centerHz > cutoffHz) {
                    double ratio = Math.min(1.0, Math.log(centerHz / cutoffHz + 1.0) / Math.log(5.0));
                    level = (short) Math.round(minLevel * ratio);
                }
                eq.setBandLevel(band, level);
            }
            eq.setEnabled(true);
            ambientEqualizers[slot] = eq;
        } catch (Exception ignored) {
            releaseAmbientEqualizer(slot);
        }
    }

    private void rampAmbient(MediaPlayer target, float from, float to, long durationMs, Runnable done) {
        if (target == null) { if (done != null) done.run(); return; }
        final int steps = durationMs <= 40 ? 1 : Math.max(2, (int) Math.min(24, durationMs / 35));
        for (int i = 0; i <= steps; i++) {
            final int step = i;
            handler.postDelayed(() -> {
                try {
                    float value = from + (to - from) * (step / (float) steps);
                    target.setVolume(value, value);
                } catch (Exception ignored) {}
                if (step == steps && done != null) done.run();
            }, Math.round(durationMs * (i / (double) steps)));
        }
    }

    private void fadeAndReleaseAmbient(MediaPlayer target, float from, long durationMs) {
        if (target == null) return;
        rampAmbient(target, from, 0f, durationMs, () -> {
            try { target.stop(); } catch (Exception ignored) {}
            try { target.release(); } catch (Exception ignored) {}
        });
    }

    @PluginMethod
    public void playAmbientPad(PluginCall call) {
        final int slot = ambientSlot(call.getInt("slot", 0));
        String fileUri = call.getString("fileUri");
        Float requestedVolume = call.getFloat("volume", 0.7f);
        Integer requestedCutoff = call.getInt("cutoff", 100);
        Integer fadeMsValue = call.getInt("fadeMs", 500);
        if (fileUri == null || fileUri.trim().isEmpty()) { call.reject("Missing pad file"); return; }

        ambientVolume = Math.max(0f, Math.min(1f, requestedVolume == null ? 0.7f : requestedVolume));
        ambientCutoff = Math.max(0, Math.min(100, requestedCutoff == null ? 100 : requestedCutoff));
        long fadeMs = Math.max(20, Math.min(5000, fadeMsValue == null ? 500 : fadeMsValue));
        final int generation = ++ambientGenerations[slot];
        final MediaPlayer previous = ambientPlayers[slot];
        releaseAmbientEqualizer(slot);

        try {
            MediaPlayer next = new MediaPlayer();
            next.setAudioAttributes(new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_MUSIC).build());
            Uri uri = Uri.parse(fileUri);
            if ("file".equalsIgnoreCase(uri.getScheme())) next.setDataSource(uri.getPath());
            else next.setDataSource(getContext(), uri);
            next.setLooping(true);
            next.setVolume(0f, 0f);
            next.setOnPreparedListener(mp -> {
                if (generation != ambientGenerations[slot]) { try { mp.release(); } catch (Exception ignored) {} call.reject("cancelled"); return; }
                ambientPlayers[slot] = mp;
                try {
                    mp.start();
                    applyAmbientCutoff(slot);
                    rampAmbient(mp, 0f, ambientVolume, fadeMs, null);
                    if (previous != null) fadeAndReleaseAmbient(previous, ambientVolume, fadeMs);
                    JSObject result = new JSObject(); result.put("playing", true); call.resolve(result);
                } catch (Exception error) {
                    try { mp.release(); } catch (Exception ignored) {}
                    if (ambientPlayers[slot] == mp) ambientPlayers[slot] = previous;
                    call.reject("Could not start pad", error);
                }
            });
            next.setOnErrorListener((mp, what, extra) -> {
                try { mp.release(); } catch (Exception ignored) {}
                if (ambientPlayers[slot] == mp) ambientPlayers[slot] = previous;
                if (generation == ambientGenerations[slot]) call.reject("Could not play pad (" + what + "/" + extra + ")");
                return true;
            });
            next.prepareAsync();
        } catch (Exception error) {
            ambientPlayers[slot] = previous;
            call.reject("Could not open pad", error);
        }
    }

    @PluginMethod
    public void stopAmbientPad(PluginCall call) {
        Integer fadeMsValue = call.getInt("fadeMs", 250);
        long fadeMs = Math.max(20, Math.min(5000, fadeMsValue == null ? 250 : fadeMsValue));
        Integer requestedSlot = call.getInt("slot");
        int first = requestedSlot == null ? 0 : ambientSlot(requestedSlot);
        int last = requestedSlot == null ? 1 : first;
        for (int slot = first; slot <= last; slot++) {
            ++ambientGenerations[slot];
            MediaPlayer old = ambientPlayers[slot];
            ambientPlayers[slot] = null;
            releaseAmbientEqualizer(slot);
            if (old != null) fadeAndReleaseAmbient(old, ambientVolume, fadeMs);
        }
        call.resolve();
    }

    @PluginMethod
    public void setAmbientPadVolume(PluginCall call) {
        Float value = call.getFloat("volume", ambientVolume);
        ambientVolume = Math.max(0f, Math.min(1f, value == null ? ambientVolume : value));
        for (MediaPlayer player : ambientPlayers) if (player != null) { try { player.setVolume(ambientVolume, ambientVolume); } catch (Exception ignored) {} }
        call.resolve();
    }

    @PluginMethod
    public void setAmbientPadCutoff(PluginCall call) {
        Integer value = call.getInt("cutoff", ambientCutoff);
        ambientCutoff = Math.max(0, Math.min(100, value == null ? ambientCutoff : value));
        for (int slot = 0; slot < ambientPlayers.length; slot++) if (ambientPlayers[slot] != null) applyAmbientCutoff(slot);
        call.resolve();
    }

    @PluginMethod
    public void getSongs(PluginCall call) {
        String alias = permissionAlias();
        if (getPermissionState(alias) != PermissionState.GRANTED) {
            requestPermissionForAlias(alias, call, "audioPermissionCallback");
            return;
        }
        querySongs(call);
    }

    @PermissionCallback
    private void audioPermissionCallback(PluginCall call) {
        if (getPermissionState(permissionAlias()) == PermissionState.GRANTED) querySongs(call);
        else call.reject("Audio permission denied");
    }

    private void querySongs(PluginCall call) {
        new Thread(() -> {
            JSArray songs = new JSArray();
            Uri collection = MediaStore.Audio.Media.EXTERNAL_CONTENT_URI;
            List<String> columns = new ArrayList<>();
            columns.add(MediaStore.Audio.Media._ID);
            columns.add(MediaStore.Audio.Media.TITLE);
            columns.add(MediaStore.Audio.Media.ARTIST);
            columns.add(MediaStore.Audio.Media.ALBUM);
            columns.add(MediaStore.Audio.Media.ALBUM_ID);
            columns.add(MediaStore.Audio.Media.DURATION);
            columns.add(MediaStore.Audio.Media.DISPLAY_NAME);
            columns.add(MediaStore.Audio.Media.MIME_TYPE);
            columns.add(MediaStore.Audio.Media.DATE_ADDED);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) columns.add(MediaStore.Audio.Media.RELATIVE_PATH);
            try (Cursor cursor = getContext().getContentResolver().query(
                collection,
                columns.toArray(new String[0]),
                MediaStore.Audio.Media.IS_MUSIC + " != 0 AND " + MediaStore.Audio.Media.DURATION + " >= 10000",
                null,
                MediaStore.Audio.Media.TITLE + " COLLATE NOCASE ASC"
            )) {
                if (cursor != null) {
                    int idColumn = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media._ID);
                    int titleColumn = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.TITLE);
                    int artistColumn = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.ARTIST);
                    int albumColumn = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.ALBUM);
                    int albumIdColumn = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.ALBUM_ID);
                    int durationColumn = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.DURATION);
                    int fileColumn = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.DISPLAY_NAME);
                    int mimeColumn = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.MIME_TYPE);
                    int dateColumn = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.DATE_ADDED);
                    int folderColumn = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q ? cursor.getColumnIndex(MediaStore.Audio.Media.RELATIVE_PATH) : -1;
                    while (cursor.moveToNext()) {
                        long id = cursor.getLong(idColumn);
                        long albumId = cursor.getLong(albumIdColumn);
                        String folder = folderColumn >= 0 ? cursor.getString(folderColumn) : "Músicas";
                        JSObject item = new JSObject();
                        item.put("id", String.valueOf(id));
                        item.put("title", cleanMetadata(cursor.getString(titleColumn), cursor.getString(fileColumn)));
                        item.put("artist", cleanMetadata(cursor.getString(artistColumn), "Artista desconhecido"));
                        item.put("album", cleanMetadata(cursor.getString(albumColumn), "Álbum desconhecido"));
                        item.put("albumId", String.valueOf(albumId));
                        item.put("albumArtUri", "content://media/external/audio/albumart/" + albumId);
                        item.put("folder", cleanFolder(folder));
                        item.put("duration", cursor.getLong(durationColumn));
                        item.put("dateAdded", cursor.getLong(dateColumn));
                        item.put("fileName", cursor.getString(fileColumn));
                        item.put("mimeType", cursor.getString(mimeColumn));
                        item.put("uri", ContentUris.withAppendedId(collection, id).toString());
                        songs.put(item);
                    }
                }
                JSObject result = new JSObject();
                result.put("songs", songs);
                result.put("total", songs.length());
                call.resolve(result);
            } catch (Exception error) {
                call.reject("Could not read the media library", error);
            }
        }).start();
    }

    private String cleanMetadata(String value, String fallback) {
        if (value == null || value.trim().isEmpty() || "<unknown>".equalsIgnoreCase(value.trim())) return fallback;
        return value.trim();
    }

    private String cleanFolder(String value) {
        if (value == null || value.trim().isEmpty()) return "Músicas";
        String path = value.replace('\\', '/');
        String[] pieces = path.split("/");
        for (int i = pieces.length - 1; i >= 0; i--) if (!pieces[i].trim().isEmpty()) return pieces[i];
        return "Músicas";
    }

    // ---------------------------------------------------------------------
    // PULSAR 2.0 PLAYER
    // The plugin is now only a bridge. Playback itself lives in
    // PulsarPlaybackService/Engine so it survives screen lock/background.
    // ---------------------------------------------------------------------
    private long lastPlaybackErrorSerial = 0L;

    private PulsarPlaybackService.Engine playbackEngine() {
        return PulsarPlaybackService.getEngine(getContext());
    }

    private JSObject asJSObject(JSONObject source) {
        JSObject result = new JSObject();
        if (source == null) return result;
        java.util.Iterator<String> keys = source.keys();
        while (keys.hasNext()) {
            String key = keys.next();
            try { result.put(key, source.get(key)); } catch (Exception ignored) {}
        }
        return result;
    }

    @PluginMethod
    public void setQueue(PluginCall call) {
        JSArray songs = call.getArray("songs");
        if (songs == null) {
            call.reject("Missing songs");
            return;
        }
        try {
            int total = playbackEngine().setQueue(songs);
            JSObject result = new JSObject();
            result.put("total", total);
            call.resolve(result);
            notifyPlayerState();
        } catch (Exception error) {
            call.reject("Invalid queue", error);
        }
    }

    @PluginMethod
    public void playIndex(PluginCall call) {
        int index = call.getInt("index", -1);
        boolean autoplay = call.getBoolean("autoplay", true);
        if (index < 0) {
            call.reject("Invalid track index");
            return;
        }
        if (autoplay) PulsarPlaybackService.ensureRunning(getContext());
        playbackEngine().playIndex(index, autoplay);
        call.resolve();
        notifyPlayerState();
    }

    @PluginMethod
    public void play(PluginCall call) {
        PulsarPlaybackService.ensureRunning(getContext());
        playbackEngine().play();
        call.resolve();
        notifyPlayerState();
    }

    @PluginMethod
    public void pause(PluginCall call) {
        playbackEngine().pause();
        call.resolve();
        notifyPlayerState();
    }

    @PluginMethod
    public void stop(PluginCall call) {
        playbackEngine().stop();
        PulsarPlaybackService.stopRunning(getContext());
        call.resolve();
        notifyPlayerState();
    }

    @PluginMethod
    public void seek(PluginCall call) {
        Double positionValue = call.getDouble("position", 0.0);
        long position = positionValue == null ? 0L : positionValue.longValue();
        playbackEngine().seek(Math.max(0, position));
        call.resolve();
        notifyPlayerState();
    }

    @PluginMethod
    public void skip(PluginCall call) {
        int direction = call.getInt("direction", 1);
        PulsarPlaybackService.ensureRunning(getContext());
        playbackEngine().skip(direction >= 0 ? 1 : -1);
        call.resolve();
        notifyPlayerState();
    }

    @PluginMethod
    public void setRepeat(PluginCall call) {
        playbackEngine().setRepeat(call.getInt("mode", 0));
        call.resolve();
    }

    @PluginMethod
    public void setShuffle(PluginCall call) {
        playbackEngine().setShuffle(call.getBoolean("enabled", false));
        call.resolve();
    }

    @PluginMethod
    public void setVolume(PluginCall call) {
        playbackEngine().setVolume(Math.max(0f, Math.min(1f, call.getFloat("volume", 0.9f))));
        call.resolve();
    }

    @PluginMethod
    public void setPlayback(PluginCall call) {
        float semitones = call.getFloat("pitch", 0f);
        float playbackSpeed = call.getFloat("speed", 1f);
        boolean applied = playbackEngine().setPlayback(semitones, playbackSpeed);
        JSObject result = new JSObject();
        result.put("pitch", semitones);
        result.put("speed", playbackSpeed);
        result.put("applied", applied);
        call.resolve(result);
    }

    @PluginMethod
    public void getEqualizerInfo(PluginCall call) {
        call.resolve(asJSObject(playbackEngine().getEqualizerInfo()));
    }

    @PluginMethod
    public void setEqualizerEnabled(PluginCall call) {
        boolean available = playbackEngine().setEqualizerEnabled(call.getBoolean("enabled", false));
        JSObject result = new JSObject();
        result.put("available", available);
        call.resolve(result);
    }

    @PluginMethod
    public void setEqBand(PluginCall call) {
        int band = call.getInt("band", -1);
        float decibels = call.getFloat("level", 0f);
        boolean applied = playbackEngine().setEqBand(band, decibels);
        JSObject result = new JSObject();
        result.put("applied", applied);
        call.resolve(result);
    }

    @PluginMethod
    public void setBassBoost(PluginCall call) {
        playbackEngine().setBassBoost(call.getInt("strength", 0));
        call.resolve();
    }

    @PluginMethod
    public void setVirtualizer(PluginCall call) {
        playbackEngine().setVirtualizer(call.getInt("strength", 0));
        call.resolve();
    }

    @PluginMethod
    public void setReverb(PluginCall call) {
        playbackEngine().setReverb(call.getInt("strength", 0));
        call.resolve();
    }

    @PluginMethod
    public void getState(PluginCall call) {
        call.resolve(asJSObject(playbackEngine().getState()));
    }

    private JSObject buildPlayerState() {
        return asJSObject(playbackEngine().getState());
    }

    private void notifyPlayerState() {
        final JSObject state = buildPlayerState();
        final long serial = playbackEngine().getErrorSerial();
        final String message = playbackEngine().getLastError();
        handler.post(() -> {
            notifyListeners("playerState", state);
            if (serial > lastPlaybackErrorSerial) {
                lastPlaybackErrorSerial = serial;
                JSObject data = new JSObject();
                data.put("message", message);
                notifyListeners("playerError", data);
            }
        });
    }

    private void notifyError(String message) {
        JSObject data = new JSObject();
        data.put("message", message);
        handler.post(() -> notifyListeners("playerError", data));
    }

    @PluginMethod
    public void prepareSong(PluginCall call) {
        String uriValue = call.getString("uri");
        String id = safePart(call.getString("id", "audio"));
        String fileName = call.getString("fileName", "audio");
        if (uriValue == null) { call.reject("Missing song URI"); return; }
        new Thread(() -> {
            try {
                Uri source = Uri.parse(uriValue);
                ContentResolver resolver = getContext().getContentResolver();
                String extension = MimeTypeMap.getSingleton().getExtensionFromMimeType(resolver.getType(source));
                if (extension == null) {
                    int dot = fileName.lastIndexOf('.');
                    extension = dot >= 0 ? safePart(fileName.substring(dot + 1)) : "audio";
                }
                File directory = new File(getContext().getCacheDir(), "utility_pad_music");
                if (!directory.exists() && !directory.mkdirs()) throw new IllegalStateException("Cache unavailable");
                File output = new File(directory, id + "." + extension);
                if (!output.exists() || output.length() == 0) {
                    try (InputStream input = resolver.openInputStream(source); FileOutputStream stream = new FileOutputStream(output)) {
                        if (input == null) throw new IllegalStateException("Audio unavailable");
                        byte[] buffer = new byte[65536];
                        int read;
                        while ((read = input.read(buffer)) != -1) stream.write(buffer, 0, read);
                    }
                }
                JSObject result = new JSObject();
                result.put("fileUri", Uri.fromFile(output).toString());
                call.resolve(result);
            } catch (Exception error) { call.reject("Could not prepare the song", error); }
        }).start();
    }

    private String safePart(String value) {
        return value == null ? "audio" : value.replaceAll("[^a-zA-Z0-9_-]", "_");
    }

    @Override
    protected void handleOnDestroy() {
        for (int slot = 0; slot < ambientPlayers.length; slot++) {
            ++ambientGenerations[slot];
            releaseAmbientEqualizer(slot);
            if (ambientPlayers[slot] != null) {
                try { ambientPlayers[slot].release(); } catch (Exception ignored) {}
                ambientPlayers[slot] = null;
            }
        }
        handler.removeCallbacks(progressTicker);
        super.handleOnDestroy();
    }
}
