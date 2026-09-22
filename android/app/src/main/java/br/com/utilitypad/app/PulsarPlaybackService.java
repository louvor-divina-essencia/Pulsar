package br.com.utilitypad.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.media.MediaMetadata;
import android.media.MediaPlayer;
import android.media.PlaybackParams;
import android.media.audiofx.BassBoost;
import android.media.audiofx.Equalizer;
import android.media.audiofx.PresetReverb;
import android.media.audiofx.Virtualizer;
import android.media.session.MediaSession;
import android.media.session.PlaybackState;
import android.net.Uri;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;
import java.util.Random;

/**
 * Foreground playback service for PULSAR.
 *
 * The WebView is only the controller/UI. Music playback, queue progression,
 * audio focus, lock-screen controls and Android notification live here so the
 * song continues when the screen is locked or the Activity is backgrounded.
 */
public class PulsarPlaybackService extends Service {
    public static final String CHANNEL_ID = "pulsar_playback";
    private static final int NOTIFICATION_ID = 2206;
    private static final String ACTION_REFRESH = "br.com.utilitypad.app.PULSAR_REFRESH";
    private static final String ACTION_TOGGLE = "br.com.utilitypad.app.PULSAR_TOGGLE";
    private static final String ACTION_PREVIOUS = "br.com.utilitypad.app.PULSAR_PREVIOUS";
    private static final String ACTION_NEXT = "br.com.utilitypad.app.PULSAR_NEXT";
    private static final String ACTION_STOP = "br.com.utilitypad.app.PULSAR_STOP";

    private static Engine engine;
    private MediaSession mediaSession;

    public interface EngineListener {
        void onStateChanged();
    }

    public static synchronized Engine getEngine(Context context) {
        if (engine == null) engine = new Engine(context.getApplicationContext());
        return engine;
    }

    public static void ensureRunning(Context context) {
        Intent intent = new Intent(context, PulsarPlaybackService.class).setAction(ACTION_REFRESH);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) context.startForegroundService(intent);
        else context.startService(intent);
    }

    public static void stopRunning(Context context) {
        try { context.stopService(new Intent(context, PulsarPlaybackService.class)); } catch (Exception ignored) {}
    }

    @Override
    public void onCreate() {
        super.onCreate();
        createNotificationChannel();
        Engine playback = getEngine(this);
        playback.setListener(this::refreshSessionAndNotification);
        createMediaSession();
        startForeground(NOTIFICATION_ID, buildNotification());
        refreshSessionAndNotification();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        // startForeground must happen immediately when started with
        // startForegroundService, even before the requested transport action.
        startForeground(NOTIFICATION_ID, buildNotification());
        String action = intent == null ? ACTION_REFRESH : intent.getAction();
        Engine playback = getEngine(this);
        if (ACTION_TOGGLE.equals(action)) playback.toggle();
        else if (ACTION_PREVIOUS.equals(action)) playback.skip(-1);
        else if (ACTION_NEXT.equals(action)) playback.skip(1);
        else if (ACTION_STOP.equals(action)) {
            playback.stop();
            stopForeground(true);
            stopSelf();
            return START_NOT_STICKY;
        }
        refreshSessionAndNotification();
        return START_STICKY;
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public void onDestroy() {
        Engine playback = getEngine(this);
        playback.setListener(null);
        if (mediaSession != null) {
            mediaSession.setActive(false);
            mediaSession.release();
            mediaSession = null;
        }
        super.onDestroy();
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationChannel channel = new NotificationChannel(
            CHANNEL_ID,
            "Reprodução do Pulsar",
            NotificationManager.IMPORTANCE_LOW
        );
        channel.setDescription("Controles do Player do Pulsar");
        channel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        channel.setSound(null, null);
        NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        manager.createNotificationChannel(channel);
    }

    private void createMediaSession() {
        mediaSession = new MediaSession(this, "PulsarPlayer");
        mediaSession.setFlags(MediaSession.FLAG_HANDLES_MEDIA_BUTTONS | MediaSession.FLAG_HANDLES_TRANSPORT_CONTROLS);
        mediaSession.setPlaybackToLocal(new AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_MEDIA)
            .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
            .build());
        mediaSession.setCallback(new MediaSession.Callback() {
            @Override public void onPlay() { getEngine(PulsarPlaybackService.this).play(); }
            @Override public void onPause() { getEngine(PulsarPlaybackService.this).pause(); }
            @Override public void onSkipToNext() { getEngine(PulsarPlaybackService.this).skip(1); }
            @Override public void onSkipToPrevious() { getEngine(PulsarPlaybackService.this).skip(-1); }
            @Override public void onSeekTo(long pos) { getEngine(PulsarPlaybackService.this).seek(pos); }
            @Override public void onStop() {
                getEngine(PulsarPlaybackService.this).stop();
                stopForeground(true);
                stopSelf();
            }
        });
        Intent openApp = new Intent(this, MainActivity.class)
            .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent sessionActivity = PendingIntent.getActivity(
            this, 0, openApp,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
        mediaSession.setSessionActivity(sessionActivity);
        mediaSession.setActive(true);
    }

    private PendingIntent serviceAction(String action, int requestCode) {
        Intent intent = new Intent(this, PulsarPlaybackService.class).setAction(action);
        return PendingIntent.getService(
            this, requestCode, intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
    }

    private Notification buildNotification() {
        Engine playback = getEngine(this);
        JSONObject state = playback.getState();
        boolean playing = state.optBoolean("playing", false);
        String title = state.optString("title", "Pulsar");
        String artist = state.optString("artist", "Escolha uma música no Player");

        Intent openApp = new Intent(this, MainActivity.class)
            .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent contentIntent = PendingIntent.getActivity(
            this, 1, openApp,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        Notification.Action previous = new Notification.Action.Builder(
            android.R.drawable.ic_media_previous, "Anterior", serviceAction(ACTION_PREVIOUS, 2)
        ).build();
        Notification.Action toggle = new Notification.Action.Builder(
            playing ? android.R.drawable.ic_media_pause : android.R.drawable.ic_media_play,
            playing ? "Pausar" : "Tocar",
            serviceAction(ACTION_TOGGLE, 3)
        ).build();
        Notification.Action next = new Notification.Action.Builder(
            android.R.drawable.ic_media_next, "Próxima", serviceAction(ACTION_NEXT, 4)
        ).build();
        Notification.Action stop = new Notification.Action.Builder(
            android.R.drawable.ic_menu_close_clear_cancel, "Parar", serviceAction(ACTION_STOP, 5)
        ).build();

        Notification.Builder builder = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
            ? new Notification.Builder(this, CHANNEL_ID)
            : new Notification.Builder(this);

        builder.setSmallIcon(android.R.drawable.ic_media_play)
            .setContentTitle(title)
            .setContentText(artist)
            .setContentIntent(contentIntent)
            .setVisibility(Notification.VISIBILITY_PUBLIC)
            .setCategory(Notification.CATEGORY_TRANSPORT)
            .setOnlyAlertOnce(true)
            .setOngoing(playing)
            .setShowWhen(false)
            .addAction(previous)
            .addAction(toggle)
            .addAction(next)
            .addAction(stop);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP && mediaSession != null) {
            builder.setStyle(new Notification.MediaStyle()
                .setMediaSession(mediaSession.getSessionToken())
                .setShowActionsInCompactView(0, 1, 2));
        }
        return builder.build();
    }

    private void refreshSessionAndNotification() {
        if (mediaSession == null) return;
        Engine playback = getEngine(this);
        JSONObject state = playback.getState();
        boolean playing = state.optBoolean("playing", false);
        long position = state.optLong("position", 0);
        float speed = (float) state.optDouble("speed", 1.0);

        long actions = PlaybackState.ACTION_PLAY
            | PlaybackState.ACTION_PAUSE
            | PlaybackState.ACTION_PLAY_PAUSE
            | PlaybackState.ACTION_SKIP_TO_NEXT
            | PlaybackState.ACTION_SKIP_TO_PREVIOUS
            | PlaybackState.ACTION_SEEK_TO
            | PlaybackState.ACTION_STOP;

        PlaybackState playbackState = new PlaybackState.Builder()
            .setActions(actions)
            .setState(
                playing ? PlaybackState.STATE_PLAYING : PlaybackState.STATE_PAUSED,
                position,
                playing ? speed : 0f,
                android.os.SystemClock.elapsedRealtime()
            )
            .build();
        mediaSession.setPlaybackState(playbackState);

        MediaMetadata metadata = new MediaMetadata.Builder()
            .putString(MediaMetadata.METADATA_KEY_TITLE, state.optString("title", "Pulsar"))
            .putString(MediaMetadata.METADATA_KEY_ARTIST, state.optString("artist", ""))
            .putString(MediaMetadata.METADATA_KEY_ALBUM, state.optString("album", ""))
            .putLong(MediaMetadata.METADATA_KEY_DURATION, state.optLong("duration", 0))
            .build();
        mediaSession.setMetadata(metadata);
        mediaSession.setActive(true);

        NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        manager.notify(NOTIFICATION_ID, buildNotification());
    }

    public static final class Engine {
        private static final String PREFS = "pulsar_player_service";
        private static final String PREF_QUEUE = "queue";
        private static final String PREF_INDEX = "index";

        private static final class Track {
            String id;
            String uri;
            String title;
            String artist;
            String album;
            long duration;
        }

        private final Context context;
        private final SharedPreferences prefs;
        private final List<Track> queue = new ArrayList<>();
        private final Random random = new Random();
        private final AudioManager audioManager;
        private AudioFocusRequest focusRequest;
        private EngineListener listener;
        private MediaPlayer player;
        private Equalizer equalizer;
        private BassBoost bassBoost;
        private Virtualizer virtualizer;
        private PresetReverb reverb;
        private int currentIndex = -1;
        private int repeatMode = 0;
        private boolean shuffle = false;
        private boolean prepared = false;
        private boolean playWhenPrepared = false;
        private boolean resumeAfterFocusGain = false;
        private float volume = 0.9f;
        private float pitchSemitones = 0f;
        private float pitchFactor = 1f;
        private float speed = 1f;
        private boolean pitchSupported = true;
        private boolean eqEnabled = false;
        private final List<Float> eqLevels = new ArrayList<>();
        private int bassStrength = 0;
        private int virtualizerStrength = 0;
        private int reverbStrength = 0;
        private long errorSerial = 0;
        private String lastError = "";

        private final AudioManager.OnAudioFocusChangeListener focusChangeListener = focusChange -> {
            synchronized (Engine.this) {
                if (focusChange == AudioManager.AUDIOFOCUS_LOSS) {
                    resumeAfterFocusGain = false;
                    pauseInternal(false);
                } else if (focusChange == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT) {
                    resumeAfterFocusGain = isPlaying();
                    pauseInternal(false);
                } else if (focusChange == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK) {
                    if (player != null) {
                        try { player.setVolume(volume * 0.22f, volume * 0.22f); } catch (Exception ignored) {}
                    }
                } else if (focusChange == AudioManager.AUDIOFOCUS_GAIN) {
                    if (player != null) {
                        try { player.setVolume(volume, volume); } catch (Exception ignored) {}
                    }
                    if (resumeAfterFocusGain) {
                        resumeAfterFocusGain = false;
                        playInternal();
                    }
                }
            }
        };

        Engine(Context context) {
            this.context = context;
            this.prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
            this.audioManager = (AudioManager) context.getSystemService(Context.AUDIO_SERVICE);
            restoreQueue();
        }

        synchronized void setListener(EngineListener listener) {
            this.listener = listener;
        }

        private void changed() {
            EngineListener current = listener;
            if (current != null) {
                try { current.onStateChanged(); } catch (Exception ignored) {}
            }
        }

        private void error(String message) {
            lastError = message == null ? "Erro de reprodução" : message;
            errorSerial++;
            changed();
        }

        public synchronized long getErrorSerial() { return errorSerial; }
        public synchronized String getLastError() { return lastError; }

        public synchronized int setQueue(JSONArray songs) throws Exception {
            String activeId = getCurrentTrackId();
            List<Track> replacement = new ArrayList<>();
            for (int i = 0; i < songs.length(); i++) {
                JSONObject source = songs.getJSONObject(i);
                Track track = new Track();
                track.id = source.optString("id", String.valueOf(i));
                track.uri = source.optString("uri", "");
                track.title = source.optString("title", "Sem título");
                track.artist = source.optString("artist", "Artista desconhecido");
                track.album = source.optString("album", "Álbum desconhecido");
                track.duration = source.optLong("duration", 0);
                if (!track.uri.isEmpty()) replacement.add(track);
            }
            queue.clear();
            queue.addAll(replacement);
            currentIndex = indexForId(activeId);
            persistQueue();
            changed();
            return queue.size();
        }

        public synchronized void playIndex(int index, boolean autoplay) {
            if (index < 0 || index >= queue.size()) {
                error("Música inválida na fila");
                return;
            }
            currentIndex = index;
            persistIndex();
            loadCurrent(autoplay);
        }

        public synchronized void play() {
            playInternal();
        }

        private void playInternal() {
            if (player == null && !queue.isEmpty()) {
                if (currentIndex < 0 || currentIndex >= queue.size()) currentIndex = 0;
                persistIndex();
                loadCurrent(true);
                return;
            }
            if (!prepared) {
                playWhenPrepared = true;
                return;
            }
            if (!requestAudioFocus()) {
                error("Outro aplicativo está usando o áudio");
                return;
            }
            try {
                player.setVolume(volume, volume);
                player.start();
                changed();
            } catch (Exception e) {
                error("Não foi possível continuar esta música");
            }
        }

        public synchronized void toggle() {
            if (isPlaying()) pause(); else play();
        }

        public synchronized void pause() {
            resumeAfterFocusGain = false;
            pauseInternal(true);
        }

        private void pauseInternal(boolean abandonFocus) {
            playWhenPrepared = false;
            if (prepared && player != null) {
                try { if (player.isPlaying()) player.pause(); } catch (Exception ignored) {}
            }
            if (abandonFocus) abandonAudioFocus();
            changed();
        }

        public synchronized void stop() {
            playWhenPrepared = false;
            resumeAfterFocusGain = false;
            releasePlayer();
            abandonAudioFocus();
            changed();
        }

        public synchronized void seek(long positionMs) {
            if (!prepared || player == null) return;
            try {
                long duration = player.getDuration();
                player.seekTo((int) Math.max(0, Math.min(positionMs, duration)));
                changed();
            } catch (Exception ignored) {}
        }

        public synchronized void skip(int direction) {
            int next = nextIndex(direction >= 0 ? 1 : -1);
            if (next < 0) return;
            currentIndex = next;
            persistIndex();
            loadCurrent(true);
        }

        public synchronized void setRepeat(int mode) {
            repeatMode = Math.max(0, Math.min(2, mode));
            changed();
        }

        public synchronized void setShuffle(boolean enabled) {
            shuffle = enabled;
            changed();
        }

        public synchronized void setVolume(float value) {
            volume = Math.max(0f, Math.min(1f, value));
            if (player != null) {
                try { player.setVolume(volume, volume); } catch (Exception ignored) {}
            }
            changed();
        }

        public synchronized boolean setPlayback(float semitones, float playbackSpeed) {
            pitchSemitones = Math.max(-12f, Math.min(12f, semitones));
            speed = Math.max(0.5f, Math.min(1.5f, playbackSpeed));
            pitchFactor = (float) Math.pow(2.0, pitchSemitones / 12.0);
            boolean ok = applyPlaybackParameters();
            changed();
            return ok;
        }

        public synchronized JSONObject getEqualizerInfo() {
            JSONObject result = new JSONObject();
            JSONArray bands = new JSONArray();
            try {
                if (equalizer == null && prepared && player != null) createAudioEffects();
                if (equalizer == null) {
                    result.put("available", false);
                    result.put("reason", prepared ? "Equalizador indisponível neste aparelho" : "Inicie uma música primeiro");
                    result.put("bands", bands);
                    return result;
                }
                short[] range = equalizer.getBandLevelRange();
                for (short i = 0; i < equalizer.getNumberOfBands(); i++) {
                    JSONObject band = new JSONObject();
                    band.put("index", i);
                    band.put("frequency", equalizer.getCenterFreq(i) / 1000.0);
                    band.put("level", equalizer.getBandLevel(i) / 100.0);
                    bands.put(band);
                }
                result.put("available", true);
                result.put("bands", bands);
                result.put("minimum", range[0] / 100.0);
                result.put("maximum", range[1] / 100.0);
            } catch (Exception e) {
                try {
                    result.put("available", false);
                    result.put("reason", "Equalizador indisponível neste aparelho");
                    result.put("bands", bands);
                } catch (Exception ignored) {}
            }
            return result;
        }

        public synchronized boolean setEqualizerEnabled(boolean enabled) {
            eqEnabled = enabled;
            if (equalizer == null && prepared && player != null) createAudioEffects();
            if (equalizer == null) return false;
            try { equalizer.setEnabled(eqEnabled); return true; }
            catch (Exception e) { return false; }
            finally { changed(); }
        }

        public synchronized boolean setEqBand(int band, float decibels) {
            if (equalizer == null && prepared && player != null) createAudioEffects();
            if (equalizer == null || band < 0 || band >= equalizer.getNumberOfBands()) return false;
            try {
                short[] range = equalizer.getBandLevelRange();
                short level = (short) Math.max(range[0], Math.min(range[1], Math.round(decibels * 100f)));
                equalizer.setBandLevel((short) band, level);
                while (eqLevels.size() <= band) eqLevels.add(null);
                eqLevels.set(band, decibels);
                eqEnabled = true;
                equalizer.setEnabled(true);
                changed();
                return true;
            } catch (Exception e) {
                return false;
            }
        }

        public synchronized void setBassBoost(int strength) {
            bassStrength = Math.max(0, Math.min(100, strength));
            if (bassBoost == null && prepared && player != null) createAudioEffects();
            if (bassBoost != null) {
                try {
                    bassBoost.setStrength((short) (bassStrength * 10));
                    bassBoost.setEnabled(bassStrength > 0);
                } catch (Exception ignored) {}
            }
            changed();
        }

        public synchronized void setVirtualizer(int strength) {
            virtualizerStrength = Math.max(0, Math.min(100, strength));
            if (virtualizer == null && prepared && player != null) createAudioEffects();
            if (virtualizer != null) {
                try {
                    virtualizer.setStrength((short) (virtualizerStrength * 10));
                    virtualizer.setEnabled(virtualizerStrength > 0);
                } catch (Exception ignored) {}
            }
            changed();
        }

        public synchronized void setReverb(int strength) {
            reverbStrength = Math.max(0, Math.min(100, strength));
            if (reverb == null && prepared && player != null) createAudioEffects();
            if (reverb != null && player != null) {
                try {
                    short preset = reverbStrength < 34 ? PresetReverb.PRESET_SMALLROOM
                        : reverbStrength < 67 ? PresetReverb.PRESET_LARGEROOM
                        : PresetReverb.PRESET_LARGEHALL;
                    reverb.setPreset(preset);
                    reverb.setEnabled(reverbStrength > 0);
                    player.setAuxEffectSendLevel(reverbStrength / 100f);
                } catch (Exception ignored) {}
            }
            changed();
        }

        public synchronized JSONObject getState() {
            JSONObject data = new JSONObject();
            boolean playing = isPlaying();
            long position = 0;
            long duration = 0;
            try {
                if (prepared && player != null) {
                    position = player.getCurrentPosition();
                    duration = player.getDuration();
                }
                data.put("index", currentIndex);
                data.put("playing", playing);
                data.put("position", position);
                data.put("duration", duration);
                data.put("repeat", repeatMode);
                data.put("shuffle", shuffle);
                data.put("volume", volume);
                data.put("pitch", pitchSemitones);
                data.put("speed", speed);
                data.put("pitchSupported", pitchSupported);
                data.put("eqEnabled", eqEnabled);
                data.put("queueSize", queue.size());
                JSONArray queueIds = new JSONArray();
                for (Track queued : queue) queueIds.put(queued.id);
                data.put("queueIds", queueIds);
                if (currentIndex >= 0 && currentIndex < queue.size()) {
                    Track track = queue.get(currentIndex);
                    data.put("id", track.id);
                    data.put("title", track.title);
                    data.put("artist", track.artist);
                    data.put("album", track.album);
                    data.put("uri", track.uri);
                }
            } catch (Exception ignored) {}
            return data;
        }

        public synchronized boolean isPlaying() {
            try { return prepared && player != null && player.isPlaying(); }
            catch (Exception ignored) { return false; }
        }

        private void loadCurrent(boolean autoplay) {
            releasePlayer();
            if (currentIndex < 0 || currentIndex >= queue.size()) return;
            playWhenPrepared = autoplay;
            prepared = false;
            pitchSupported = true;
            Track track = queue.get(currentIndex);
            try {
                MediaPlayer next = new MediaPlayer();
                player = next;
                next.setAudioAttributes(new AudioAttributes.Builder()
                    .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                    .setUsage(AudioAttributes.USAGE_MEDIA)
                    .build());
                next.setWakeMode(context, PowerManager.PARTIAL_WAKE_LOCK);
                Uri uri = Uri.parse(track.uri);
                if ("file".equalsIgnoreCase(uri.getScheme())) next.setDataSource(uri.getPath());
                else next.setDataSource(context, uri);
                next.setOnPreparedListener(mp -> {
                    synchronized (Engine.this) {
                        if (player != mp) return;
                        prepared = true;
                        try { mp.setVolume(volume, volume); } catch (Exception ignored) {}
                        applyPlaybackParameters();
                        createAudioEffects();
                        if (playWhenPrepared && requestAudioFocus()) {
                            try { mp.start(); } catch (Exception e) { error("Não foi possível iniciar esta música"); }
                        }
                        changed();
                    }
                });
                next.setOnCompletionListener(mp -> {
                    synchronized (Engine.this) { handleCompletion(); }
                });
                next.setOnErrorListener((mp, what, extra) -> {
                    synchronized (Engine.this) {
                        if (player != mp) return true;
                        prepared = false;
                        playWhenPrepared = false;
                        error("Falha ao reproduzir esta música (" + what + "/" + extra + ")");
                        releasePlayer();
                        changed();
                        return true;
                    }
                });
                next.prepareAsync();
                changed();
            } catch (Exception e) {
                releasePlayer();
                error("Não foi possível abrir esta música");
            }
        }

        private void handleCompletion() {
            if (repeatMode == 1 && player != null) {
                try {
                    player.seekTo(0);
                    player.start();
                    changed();
                    return;
                } catch (Exception ignored) {}
            }
            int next = nextIndex(1);
            if (next >= 0) {
                currentIndex = next;
                persistIndex();
                loadCurrent(true);
            } else {
                playWhenPrepared = false;
                abandonAudioFocus();
                changed();
            }
        }

        private int nextIndex(int direction) {
            if (queue.isEmpty()) return -1;
            if (shuffle && queue.size() > 1) {
                int candidate;
                do candidate = random.nextInt(queue.size()); while (candidate == currentIndex);
                return candidate;
            }
            int next = currentIndex + direction;
            if (next >= 0 && next < queue.size()) return next;
            return repeatMode == 2 ? (direction > 0 ? 0 : queue.size() - 1) : -1;
        }

        private boolean applyPlaybackParameters() {
            if (!prepared || player == null || Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return false;
            try {
                PlaybackParams params = player.getPlaybackParams();
                params.allowDefaults();
                params.setAudioFallbackMode(PlaybackParams.AUDIO_FALLBACK_MODE_DEFAULT);
                params.setPitch(pitchFactor);
                params.setSpeed(speed);
                player.setPlaybackParams(params);
                pitchSupported = true;
                return true;
            } catch (Exception e) {
                pitchSupported = false;
                return false;
            }
        }

        private void createAudioEffects() {
            releaseEffects();
            if (!prepared || player == null) return;
            int session = player.getAudioSessionId();
            try {
                equalizer = new Equalizer(0, session);
                short[] range = equalizer.getBandLevelRange();
                for (int i = 0; i < Math.min(eqLevels.size(), equalizer.getNumberOfBands()); i++) {
                    Float db = eqLevels.get(i);
                    if (db == null) continue;
                    short level = (short) Math.max(range[0], Math.min(range[1], Math.round(db * 100f)));
                    equalizer.setBandLevel((short) i, level);
                }
                equalizer.setEnabled(eqEnabled);
            } catch (Exception e) {
                equalizer = null;
            }
            try {
                bassBoost = new BassBoost(0, session);
                bassBoost.setStrength((short) (bassStrength * 10));
                bassBoost.setEnabled(bassStrength > 0);
            } catch (Exception e) { bassBoost = null; }
            try {
                virtualizer = new Virtualizer(0, session);
                virtualizer.setStrength((short) (virtualizerStrength * 10));
                virtualizer.setEnabled(virtualizerStrength > 0);
            } catch (Exception e) { virtualizer = null; }
            try {
                reverb = new PresetReverb(0, session);
                player.attachAuxEffect(reverb.getId());
                short preset = reverbStrength < 34 ? PresetReverb.PRESET_SMALLROOM
                    : reverbStrength < 67 ? PresetReverb.PRESET_LARGEROOM
                    : PresetReverb.PRESET_LARGEHALL;
                reverb.setPreset(preset);
                reverb.setEnabled(reverbStrength > 0);
                player.setAuxEffectSendLevel(reverbStrength / 100f);
            } catch (Exception e) { reverb = null; }
        }

        private void releaseEffects() {
            if (equalizer != null) { try { equalizer.release(); } catch (Exception ignored) {} equalizer = null; }
            if (bassBoost != null) { try { bassBoost.release(); } catch (Exception ignored) {} bassBoost = null; }
            if (virtualizer != null) { try { virtualizer.release(); } catch (Exception ignored) {} virtualizer = null; }
            if (reverb != null) { try { reverb.release(); } catch (Exception ignored) {} reverb = null; }
        }

        private void releasePlayer() {
            releaseEffects();
            if (player != null) {
                try { player.reset(); } catch (Exception ignored) {}
                try { player.release(); } catch (Exception ignored) {}
                player = null;
            }
            prepared = false;
        }

        private boolean requestAudioFocus() {
            if (audioManager == null) return true;
            int result;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                if (focusRequest == null) {
                    AudioAttributes attributes = new AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_MEDIA)
                        .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                        .build();
                    focusRequest = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
                        .setAudioAttributes(attributes)
                        .setOnAudioFocusChangeListener(focusChangeListener)
                        .setWillPauseWhenDucked(false)
                        .build();
                }
                result = audioManager.requestAudioFocus(focusRequest);
            } else {
                result = audioManager.requestAudioFocus(
                    focusChangeListener,
                    AudioManager.STREAM_MUSIC,
                    AudioManager.AUDIOFOCUS_GAIN
                );
            }
            return result == AudioManager.AUDIOFOCUS_REQUEST_GRANTED;
        }

        private void abandonAudioFocus() {
            if (audioManager == null) return;
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && focusRequest != null)
                    audioManager.abandonAudioFocusRequest(focusRequest);
                else audioManager.abandonAudioFocus(focusChangeListener);
            } catch (Exception ignored) {}
        }

        private String getCurrentTrackId() {
            return currentIndex >= 0 && currentIndex < queue.size() ? queue.get(currentIndex).id : "";
        }

        private int indexForId(String id) {
            if (id == null || id.isEmpty()) return -1;
            for (int i = 0; i < queue.size(); i++) if (id.equals(queue.get(i).id)) return i;
            return -1;
        }

        private void persistQueue() {
            try {
                JSONArray stored = new JSONArray();
                for (Track track : queue) {
                    JSONObject item = new JSONObject();
                    item.put("id", track.id);
                    item.put("uri", track.uri);
                    item.put("title", track.title);
                    item.put("artist", track.artist);
                    item.put("album", track.album);
                    item.put("duration", track.duration);
                    stored.put(item);
                }
                prefs.edit().putString(PREF_QUEUE, stored.toString()).putInt(PREF_INDEX, currentIndex).apply();
            } catch (Exception ignored) {}
        }

        private void persistIndex() {
            prefs.edit().putInt(PREF_INDEX, currentIndex).apply();
        }

        private void restoreQueue() {
            try {
                JSONArray stored = new JSONArray(prefs.getString(PREF_QUEUE, "[]"));
                for (int i = 0; i < stored.length(); i++) {
                    JSONObject source = stored.getJSONObject(i);
                    Track track = new Track();
                    track.id = source.optString("id", String.valueOf(i));
                    track.uri = source.optString("uri", "");
                    track.title = source.optString("title", "Sem título");
                    track.artist = source.optString("artist", "Artista desconhecido");
                    track.album = source.optString("album", "Álbum desconhecido");
                    track.duration = source.optLong("duration", 0);
                    if (!track.uri.isEmpty()) queue.add(track);
                }
                currentIndex = prefs.getInt(PREF_INDEX, -1);
                if (currentIndex >= queue.size()) currentIndex = -1;
            } catch (Exception ignored) {
                queue.clear();
                currentIndex = -1;
            }
        }
    }
}
