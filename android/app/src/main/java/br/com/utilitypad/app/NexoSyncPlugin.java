package br.com.utilitypad.app;

import android.app.Activity;
import android.content.ContentResolver;
import android.content.Intent;
import android.net.Uri;
import android.net.nsd.NsdManager;
import android.net.nsd.NsdServiceInfo;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.Inet4Address;
import java.net.NetworkInterface;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.URLDecoder;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Date;
import java.util.Enumeration;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Random;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;
import java.util.zip.ZipOutputStream;

@CapacitorPlugin(name = "NexoSync")
public class NexoSyncPlugin extends Plugin {
    private static final String SERVICE_TYPE = "_nexo._tcp.";
    private static final String PLACEHOLDER_PREFIX = "nexo://asset/";
    private static final long MAX_BACKUP_BYTES = 4L * 1024L * 1024L * 1024L; // 4 GB safety ceiling
    private static final long MIN_CACHE_RESERVE_BYTES = 96L * 1024L * 1024L; // keep Android breathing room

    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private final Random random = new Random();
    private final Object serverLock = new Object();
    private final AtomicBoolean discovering = new AtomicBoolean(false);

    private NsdManager nsdManager;
    private WifiManager.MulticastLock shareMulticastLock;
    private WifiManager.MulticastLock discoveryMulticastLock;
    private NsdManager.RegistrationListener registrationListener;
    private NsdManager.DiscoveryListener discoveryListener;
    private ServerSocket serverSocket;
    private Thread serverThread;
    private String shareStateJson;
    private final LinkedHashMap<String, File> shareFiles = new LinkedHashMap<>();
    private String shareCode;
    private String shareName;
    private volatile boolean sharePreparing;
    private volatile String shareError;
    private volatile int shareAudioFiles;
    private volatile int shareSkippedFiles;
    private volatile String shareWarning;
    private volatile long shareBytes;
    private volatile long shareSessionId;
    private Thread prepareThread;
    private File pendingExportFile;
    private int pendingExportAudioFiles;
    private long pendingExportBytes;

    private static class Peer {
        String name;
        String host;
        int port;
    }

    private static class BackupResult {
        File file;
        int audioFiles;
        int skippedFiles;
        String warning;
        long totalBytes;
    }

    private static class ImportResult {
        String stateJson;
        int audioFiles;
        long totalBytes;
    }

    private static class StreamShare {
        String stateJson;
        LinkedHashMap<String, File> files = new LinkedHashMap<>();
        int audioFiles;
        int skippedFiles;
        String warning;
        long totalBytes;
    }

    @Override
    public void load() {
        nsdManager = (NsdManager) getContext().getSystemService(android.content.Context.NSD_SERVICE);
    }

    @Override
    protected void handleOnDestroy() {
        stopShareInternal();
        stopDiscoveryInternal();
        super.handleOnDestroy();
    }

    @PluginMethod
    public void startShare(PluginCall call) {
        String requestedName = call.getString("deviceName", "");
        try {
            stopShareInternal();
            final int port;
            synchronized (serverLock) {
                shareSessionId++;
                shareStateJson = null;
                shareFiles.clear();
                sharePreparing = false;
                shareError = null;
                shareAudioFiles = 0;
                shareSkippedFiles = 0;
                shareWarning = null;
                shareBytes = 0;
                shareCode = String.format(Locale.US, "%04d", 1000 + random.nextInt(9000));
                shareName = safeServiceName(requestedName == null || requestedName.trim().isEmpty() ? defaultDeviceName() : requestedName.trim());
                serverSocket = new ServerSocket(0);
                port = serverSocket.getLocalPort();
                serverThread = new Thread(this::serveLoop, "NEXO-Sync-Server");
                serverThread.setDaemon(true);
                serverThread.start();
                acquireShareMulticastLock();
                registerService(port);
            }
            JSObject out = new JSObject();
            out.put("deviceName", shareName);
            out.put("code", shareCode);
            out.put("port", port);
            out.put("host", localIpv4Address());
            out.put("ready", false);
            call.resolve(out);
        } catch (Exception error) {
            stopShareInternal();
            call.reject("Não foi possível iniciar o compartilhamento local", error);
        }
    }

    @PluginMethod
    public void prepareShare(PluginCall call) {
        String stateJson = call.getString("stateJson", "{}");
        final long session;
        synchronized (serverLock) {
            if (serverSocket == null || serverSocket.isClosed() || shareCode == null) {
                call.reject("O compartilhamento não está ativo");
                return;
            }
            session = shareSessionId;
            sharePreparing = true;
            shareError = null;
            shareStateJson = null;
            shareFiles.clear();
            shareAudioFiles = 0;
            shareSkippedFiles = 0;
            shareWarning = null;
            shareBytes = 0;
        }

        prepareThread = new Thread(() -> {
            try {
                StreamShare prepared = prepareStreamShare(stateJson);
                synchronized (serverLock) {
                    if (session != shareSessionId || serverSocket == null || serverSocket.isClosed()) return;
                    shareStateJson = prepared.stateJson;
                    shareFiles.clear();
                    shareFiles.putAll(prepared.files);
                    shareAudioFiles = prepared.audioFiles;
                    shareSkippedFiles = prepared.skippedFiles;
                    shareWarning = prepared.warning;
                    shareBytes = prepared.totalBytes;
                    sharePreparing = false;
                    shareError = null;
                }
                JSObject out = new JSObject();
                out.put("ready", true);
                out.put("audioFiles", prepared.audioFiles);
                out.put("skippedFiles", prepared.skippedFiles);
                out.put("warning", prepared.warning == null ? "" : prepared.warning);
                out.put("bytes", prepared.totalBytes);
                call.resolve(out);
            } catch (Exception error) {
                synchronized (serverLock) {
                    if (session == shareSessionId) {
                        sharePreparing = false;
                        shareError = error.getMessage() == null ? "Falha ao preparar arquivos" : error.getMessage();
                    }
                }
                call.reject("Não foi possível preparar os arquivos do PULSAR", error);
            }
        }, "NEXO-Sync-Prepare");
        prepareThread.setDaemon(true);
        prepareThread.start();
    }

    @PluginMethod
    public void getShareStatus(PluginCall call) {
        JSObject out = new JSObject();
        synchronized (serverLock) {
            boolean active = serverSocket != null && !serverSocket.isClosed() && shareCode != null;
            out.put("active", active);
            out.put("ready", active && shareStateJson != null && !sharePreparing && shareError == null);
            out.put("preparing", sharePreparing);
            out.put("error", shareError == null ? "" : shareError);
            out.put("code", shareCode == null ? "" : shareCode);
            out.put("deviceName", shareName == null ? defaultDeviceName() : shareName);
            out.put("port", active ? serverSocket.getLocalPort() : 0);
            out.put("host", localIpv4Address());
            out.put("audioFiles", shareAudioFiles);
            out.put("skippedFiles", shareSkippedFiles);
            out.put("warning", shareWarning == null ? "" : shareWarning);
            out.put("bytes", shareBytes);
        }
        call.resolve(out);
    }

    @PluginMethod
    public void stopShare(PluginCall call) {
        stopShareInternal();
        call.resolve();
    }

    @PluginMethod
    public void discoverPeers(PluginCall call) {
        int durationMs = Math.max(1200, Math.min(7000, call.getInt("durationMs", 2600)));
        if (nsdManager == null) {
            call.reject("Descoberta de rede indisponível neste aparelho");
            return;
        }
        if (!discovering.compareAndSet(false, true)) {
            call.reject("Já existe uma busca em andamento");
            return;
        }

        List<Peer> peers = Collections.synchronizedList(new ArrayList<>());
        discoveryListener = new NsdManager.DiscoveryListener() {
            @Override public void onDiscoveryStarted(String regType) {}
            @Override public void onStartDiscoveryFailed(String serviceType, int errorCode) {
                finishDiscovery(call, peers, "Falha ao procurar PULSARs na rede (" + errorCode + ")");
            }
            @Override public void onStopDiscoveryFailed(String serviceType, int errorCode) {}
            @Override public void onDiscoveryStopped(String serviceType) {}
            @Override public void onServiceLost(NsdServiceInfo serviceInfo) {}
            @Override public void onServiceFound(NsdServiceInfo serviceInfo) {
                if (!serviceInfo.getServiceType().equals(SERVICE_TYPE)) return;
                resolveService(serviceInfo, peers);
            }
        };

        try {
            acquireDiscoveryMulticastLock();
            nsdManager.discoverServices(SERVICE_TYPE, NsdManager.PROTOCOL_DNS_SD, discoveryListener);
            mainHandler.postDelayed(() -> finishDiscovery(call, peers, null), durationMs);
        } catch (Exception error) {
            discovering.set(false);
            call.reject("Não foi possível iniciar a busca local", error);
        }
    }

    @PluginMethod
    public void receiveFromPeer(PluginCall call) {
        String host = call.getString("host");
        int port = call.getInt("port", -1);
        String code = call.getString("code", "");
        if (host == null || host.trim().isEmpty() || port <= 0 || code == null || code.trim().isEmpty()) {
            call.reject("Dispositivo ou código inválido");
            return;
        }

        new Thread(() -> {
            try {
                ImportResult imported = receiveStreamFromPeer(host.trim(), port, code.trim());
                JSObject out = new JSObject();
                out.put("stateJson", imported.stateJson);
                out.put("audioFiles", imported.audioFiles);
                out.put("bytes", imported.totalBytes);
                call.resolve(out);
            } catch (SecurityException error) {
                call.reject("Código incorreto ou transferência recusada", error);
            } catch (Exception error) {
                String detail = error.getMessage() == null ? "erro desconhecido" : error.getMessage();
                call.reject("Falha ao receber: " + detail, error);
            }
        }, "NEXO-Sync-Receive").start();
    }

    @PluginMethod
    public void exportBackup(PluginCall call) {
        String stateJson = call.getString("stateJson", "{}");
        new Thread(() -> {
            try {
                BackupResult backup = createBackupArchive(stateJson);
                String name = "PULSAR-Backup-" + new SimpleDateFormat("yyyy-MM-dd-HHmm", Locale.US).format(new Date()) + ".nexo";
                Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                intent.setType("application/zip");
                intent.putExtra(Intent.EXTRA_TITLE, name);
                pendingExportFile = backup.file;
                pendingExportAudioFiles = backup.audioFiles;
                pendingExportBytes = backup.totalBytes;
                mainHandler.post(() -> startActivityForResult(call, intent, "backupDestinationChosen"));
            } catch (Exception error) {
                call.reject("Não foi possível gerar o backup", error);
            }
        }).start();
    }

    @ActivityCallback
    private void backupDestinationChosen(PluginCall call, ActivityResult result) {
        if (call == null) return;
        Intent data = result.getData();
        if (result.getResultCode() != Activity.RESULT_OK || data == null || data.getData() == null) {
            call.reject("cancelled");
            return;
        }
        File source = pendingExportFile;
        if (source == null || !source.exists()) {
            call.reject("Backup temporário não encontrado");
            return;
        }
        try (InputStream input = new FileInputStream(source); OutputStream output = getContext().getContentResolver().openOutputStream(data.getData(), "w")) {
            if (output == null) throw new IllegalStateException("Destino indisponível");
            copy(input, output, MAX_BACKUP_BYTES);
            JSObject out = new JSObject();
            out.put("audioFiles", pendingExportAudioFiles);
            out.put("bytes", pendingExportBytes);
            out.put("uri", data.getData().toString());
            call.resolve(out);
        } catch (Exception error) {
            call.reject("Não foi possível salvar o backup", error);
        } finally {
            source.delete();
            pendingExportFile = null;
            pendingExportAudioFiles = 0;
            pendingExportBytes = 0;
        }
    }

    @PluginMethod
    public void importBackup(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("*/*");
        startActivityForResult(call, intent, "backupFileChosen");
    }

    @ActivityCallback
    private void backupFileChosen(PluginCall call, ActivityResult result) {
        if (call == null) return;
        Intent data = result.getData();
        if (result.getResultCode() != Activity.RESULT_OK || data == null || data.getData() == null) {
            call.reject("cancelled");
            return;
        }
        Uri uri = data.getData();
        new Thread(() -> {
            File temp = null;
            try {
                temp = new File(getContext().getCacheDir(), "nexo-import-" + System.currentTimeMillis() + ".nexo");
                try (InputStream input = getContext().getContentResolver().openInputStream(uri); OutputStream output = new FileOutputStream(temp)) {
                    if (input == null) throw new IllegalStateException("Arquivo indisponível");
                    copy(input, output, MAX_BACKUP_BYTES);
                }
                ImportResult imported = importBackupArchive(temp);
                JSObject out = new JSObject();
                out.put("stateJson", imported.stateJson);
                out.put("audioFiles", imported.audioFiles);
                out.put("bytes", imported.totalBytes);
                call.resolve(out);
            } catch (Exception error) {
                call.reject("Este arquivo não é um backup PULSAR válido", error);
            } finally {
                if (temp != null) temp.delete();
            }
        }).start();
    }

    private void registerService(int port) {
        if (nsdManager == null) return;
        NsdServiceInfo serviceInfo = new NsdServiceInfo();
        serviceInfo.setServiceName(shareName);
        serviceInfo.setServiceType(SERVICE_TYPE);
        serviceInfo.setPort(port);
        registrationListener = new NsdManager.RegistrationListener() {
            @Override public void onServiceRegistered(NsdServiceInfo info) { shareName = info.getServiceName(); }
            @Override public void onRegistrationFailed(NsdServiceInfo info, int errorCode) {}
            @Override public void onServiceUnregistered(NsdServiceInfo info) {}
            @Override public void onUnregistrationFailed(NsdServiceInfo info, int errorCode) {}
        };
        mainHandler.post(() -> {
            try { nsdManager.registerService(serviceInfo, NsdManager.PROTOCOL_DNS_SD, registrationListener); }
            catch (Exception ignored) {}
        });
    }

    private void serveLoop() {
        while (true) {
            ServerSocket local;
            synchronized (serverLock) { local = serverSocket; }
            if (local == null || local.isClosed()) return;
            try {
                Socket socket = local.accept();
                handleClient(socket);
            } catch (Exception error) {
                if (local.isClosed()) return;
            }
        }
    }

    private void handleClient(Socket socket) {
        try (Socket client = socket) {
            client.setSoTimeout(120000);
            InputStream input = client.getInputStream();
            OutputStream output = client.getOutputStream();
            String requestLine = readAsciiLine(input);
            if (requestLine == null || !requestLine.startsWith("GET ")) {
                writeHttpError(output, 400, "Bad Request");
                return;
            }
            String path = requestLine.split(" ")[1];
            String line;
            while ((line = readAsciiLine(input)) != null && !line.isEmpty()) {}

            if (path.startsWith("/info")) {
                boolean ready;
                synchronized (serverLock) {
                    ready = shareStateJson != null && !sharePreparing && shareError == null;
                }
                byte[] body = ("{\"name\":\"" + jsonEscape(shareName) + "\",\"codeRequired\":true,\"ready\":" + ready + "}").getBytes(StandardCharsets.UTF_8);
                writeHttpHeaders(output, 200, "application/json", body.length);
                output.write(body);
                output.flush();
                return;
            }

            String suppliedCode = queryParam(path, "code");
            String expected;
            synchronized (serverLock) { expected = shareCode; }
            if (expected == null || !expected.equals(suppliedCode)) {
                writeHttpError(output, 403, "Forbidden");
                return;
            }

            if (path.startsWith("/manifest")) {
                String stateJson;
                LinkedHashMap<String, File> files;
                boolean preparing;
                String error;
                synchronized (serverLock) {
                    stateJson = shareStateJson;
                    files = new LinkedHashMap<>(shareFiles);
                    preparing = sharePreparing;
                    error = shareError;
                }
                if (stateJson == null) {
                    if (preparing) writeHttpError(output, 503, "Preparing");
                    else if (error != null) writeHttpError(output, 500, "Preparation Failed");
                    else writeHttpError(output, 410, "Gone");
                    return;
                }
                JSONObject manifest = new JSONObject();
                manifest.put("schema", 3);
                manifest.put("app", "PULSAR");
                manifest.put("version", "1.7.4");
                manifest.put("stateJson", stateJson);
                JSONArray list = new JSONArray();
                long total = 0;
                for (Map.Entry<String, File> entry : files.entrySet()) {
                    File file = entry.getValue();
                    if (file == null || !file.exists() || !file.isFile()) continue;
                    JSONObject item = new JSONObject();
                    item.put("name", entry.getKey());
                    item.put("size", file.length());
                    list.put(item);
                    total += Math.max(0, file.length());
                }
                manifest.put("files", list);
                manifest.put("totalBytes", total);
                byte[] body = manifest.toString().getBytes(StandardCharsets.UTF_8);
                writeHttpHeaders(output, 200, "application/json", body.length);
                output.write(body);
                output.flush();
                return;
            }

            if (path.startsWith("/file")) {
                String name = queryParam(path, "name");
                File file;
                synchronized (serverLock) { file = shareFiles.get(name); }
                if (file == null || !file.exists() || !file.isFile() || !file.canRead()) {
                    writeHttpError(output, 404, "File Not Found");
                    return;
                }
                writeHttpHeaders(output, 200, "application/octet-stream", file.length());
                try (InputStream source = new FileInputStream(file)) {
                    copy(source, output, file.length() + 1L);
                }
                return;
            }

            writeHttpError(output, 404, "Not Found");
        } catch (Exception error) {
            error.printStackTrace();
        }
    }

    private File downloadBackup(String host, int port, String code) throws Exception {
        InetAddress address = InetAddress.getByName(host);
        File temp = new File(getContext().getCacheDir(), "nexo-received-" + System.currentTimeMillis() + ".nexo");
        Exception lastError = null;
        for (int attempt = 0; attempt < 30; attempt++) {
            try (Socket socket = new Socket(address, port)) {
                socket.setSoTimeout(15000);
                OutputStream output = socket.getOutputStream();
                InputStream input = socket.getInputStream();
                String request = "GET /backup?code=" + URLEncoder.encode(code, "UTF-8") + " HTTP/1.1\r\nHost: nexo\r\nConnection: close\r\n\r\n";
                output.write(request.getBytes(StandardCharsets.US_ASCII));
                output.flush();
                String status = readAsciiLine(input);
                if (status != null && status.contains(" 503 ")) {
                    try { Thread.sleep(700); } catch (InterruptedException interrupted) { Thread.currentThread().interrupt(); throw interrupted; }
                    continue;
                }
                if (status == null || !status.contains(" 200 ")) {
                    if (status != null && status.contains(" 403 ")) throw new SecurityException("Forbidden");
                    throw new IllegalStateException("Resposta inválida do outro PULSAR" + (status == null ? "" : ": " + status));
                }
                long contentLength = -1;
                String line;
                while ((line = readAsciiLine(input)) != null && !line.isEmpty()) {
                    int colon = line.indexOf(':');
                    if (colon > 0 && line.substring(0, colon).trim().equalsIgnoreCase("Content-Length")) {
                        contentLength = Long.parseLong(line.substring(colon + 1).trim());
                    }
                }
                if (contentLength < 0 || contentLength > MAX_BACKUP_BYTES) throw new IllegalStateException("Tamanho de backup inválido");
                try (OutputStream file = new FileOutputStream(temp)) { copyExact(input, file, contentLength); }
                return temp;
            } catch (SecurityException error) {
                temp.delete();
                throw error;
            } catch (Exception error) {
                lastError = error;
                if (attempt < 29) {
                    try { Thread.sleep(500); } catch (InterruptedException interrupted) { Thread.currentThread().interrupt(); throw interrupted; }
                }
            }
        }
        temp.delete();
        throw lastError == null ? new IllegalStateException("Não foi possível conectar ao outro PULSAR") : lastError;
    }

    private StreamShare prepareStreamShare(String stateJson) throws Exception {
        JSONObject state = new JSONObject(stateJson == null || stateJson.trim().isEmpty() ? "{}" : stateJson);
        Map<File, String> collected = new LinkedHashMap<>();
        collectAndReplaceNativeUris(state, collected);

        StreamShare result = new StreamShare();
        List<String> successfulArchiveNames = new ArrayList<>();
        List<String> skippedNames = new ArrayList<>();
        long total = 0;

        for (Map.Entry<File, String> entry : collected.entrySet()) {
            File file = entry.getKey();
            String name = entry.getValue();
            if (file == null || !file.exists() || !file.isFile() || !file.canRead() || file.length() <= 0) {
                result.skippedFiles++;
                skippedNames.add(file == null ? name : file.getName());
                continue;
            }
            result.files.put(name, file);
            successfulArchiveNames.add(name);
            result.audioFiles++;
            total += Math.max(0, file.length());
        }

        removeUnavailablePlaceholders(state, successfulArchiveNames);
        result.stateJson = state.toString();
        result.totalBytes = total;
        result.warning = result.skippedFiles > 0
            ? (result.skippedFiles + " arquivo(s) de áudio foram ignorados" + (skippedNames.isEmpty() ? "" : ": " + joinPreview(skippedNames)))
            : null;
        return result;
    }

    private ImportResult receiveStreamFromPeer(String host, int port, String code) throws Exception {
        notifySyncProgress("connecting", 0, 0, 0, 0, "");
        JSONObject manifest = fetchManifest(host, port, code);
        String stateJson = manifest.optString("stateJson", "");
        if (stateJson.trim().isEmpty()) throw new IllegalStateException("Configuração do PULSAR não veio na resposta");

        JSONArray files = manifest.optJSONArray("files");
        if (files == null) files = new JSONArray();
        long totalBytes = manifest.optLong("totalBytes", 0);

        File padDirectory = new File(getContext().getFilesDir(), "nexo_pads");
        if (!padDirectory.exists() && !padDirectory.mkdirs()) throw new IllegalStateException("Pasta de Pads indisponível");
        long usable = padDirectory.getUsableSpace();
        if (usable > 0 && totalBytes + MIN_CACHE_RESERVE_BYTES > usable) {
            throw new IllegalStateException("O tablet não tem espaço livre suficiente para " + formatBytes(totalBytes) + " de Pads/Drums");
        }

        List<File> previousSyncFiles = new ArrayList<>();
        File[] existingFiles = padDirectory.listFiles();
        if (existingFiles != null) {
            for (File existing : existingFiles) {
                if (existing.isFile() && existing.getName().startsWith("sync-")) previousSyncFiles.add(existing);
            }
        }

        Map<String, String> importedUris = new HashMap<>();
        List<File> newSyncFiles = new ArrayList<>();
        long receivedBytes = 0;
        int completed = 0;

        try {
            notifySyncProgress("manifest", 0, files.length(), 0, totalBytes, "");
            for (int i = 0; i < files.length(); i++) {
                JSONObject item = files.getJSONObject(i);
                String name = item.optString("name", "");
                long expectedSize = item.optLong("size", -1);
                if (name.trim().isEmpty() || expectedSize < 0) throw new IllegalStateException("Lista de arquivos inválida");

                File target = uniqueFile(padDirectory, "sync-" + safePart(name));
                notifySyncProgress("file", completed + 1, files.length(), receivedBytes, totalBytes, name);
                long copied = downloadSharedFile(host, port, code, name, expectedSize, target, completed, files.length(), receivedBytes, totalBytes);
                receivedBytes += copied;
                completed++;
                importedUris.put(name, Uri.fromFile(target).toString());
                newSyncFiles.add(target);
                notifySyncProgress("file", completed, files.length(), receivedBytes, totalBytes, name);
            }

            JSONObject state = new JSONObject(stateJson);
            restoreNativeUris(state, importedUris);
            for (File previous : previousSyncFiles) {
                if (!newSyncFiles.contains(previous)) {
                    try { previous.delete(); } catch (Exception ignored) {}
                }
            }

            ImportResult result = new ImportResult();
            result.stateJson = state.toString();
            result.audioFiles = completed;
            result.totalBytes = receivedBytes;
            notifySyncProgress("done", completed, files.length(), receivedBytes, totalBytes, "");
            return result;
        } catch (Exception error) {
            for (File created : newSyncFiles) {
                try { created.delete(); } catch (Exception ignored) {}
            }
            throw error;
        }
    }

    private JSONObject fetchManifest(String host, int port, String code) throws Exception {
        Exception last = null;
        for (int attempt = 0; attempt < 120; attempt++) {
            try {
                byte[] body = httpGetBytes(host, port, "/manifest?code=" + URLEncoder.encode(code, "UTF-8"), 16 * 1024 * 1024);
                return new JSONObject(new String(body, StandardCharsets.UTF_8));
            } catch (PreparingException preparing) {
                notifySyncProgress("preparing", 0, 0, 0, 0, "");
                try { Thread.sleep(500); } catch (InterruptedException interrupted) { Thread.currentThread().interrupt(); throw interrupted; }
            } catch (SecurityException error) {
                throw error;
            } catch (Exception error) {
                last = error;
                if (attempt < 4) {
                    try { Thread.sleep(350); } catch (InterruptedException interrupted) { Thread.currentThread().interrupt(); throw interrupted; }
                } else break;
            }
        }
        throw last == null ? new IllegalStateException("O outro PULSAR não respondeu") : last;
    }

    private long downloadSharedFile(
        String host, int port, String code, String name, long expectedSize, File target,
        int completedBefore, int totalFiles, long bytesBefore, long totalBytes
    ) throws Exception {
        InetAddress address = InetAddress.getByName(host);
        try (Socket socket = new Socket(address, port)) {
            socket.setSoTimeout(120000);
            OutputStream requestOut = socket.getOutputStream();
            InputStream input = socket.getInputStream();
            String path = "/file?code=" + URLEncoder.encode(code, "UTF-8") + "&name=" + URLEncoder.encode(name, "UTF-8");
            String request = "GET " + path + " HTTP/1.1\r\nHost: nexo\r\nConnection: close\r\n\r\n";
            requestOut.write(request.getBytes(StandardCharsets.US_ASCII));
            requestOut.flush();

            HttpHeader header = readHttpHeader(input);
            if (header.status == 403) throw new SecurityException("Código incorreto");
            if (header.status != 200) throw new IllegalStateException("Falha ao baixar " + name + " (HTTP " + header.status + ")");
            long length = header.contentLength;
            if (length < 0) throw new IllegalStateException("Tamanho ausente para " + name);
            if (expectedSize >= 0 && length != expectedSize) throw new IllegalStateException("Tamanho mudou durante a transferência de " + name);

            byte[] buffer = new byte[65536];
            long remaining = length;
            long copied = 0;
            try (OutputStream file = new FileOutputStream(target)) {
                long lastProgressAt = 0;
                while (remaining > 0) {
                    int read = input.read(buffer, 0, (int) Math.min(buffer.length, remaining));
                    if (read < 0) throw new IllegalStateException("Transferência interrompida em " + name);
                    file.write(buffer, 0, read);
                    remaining -= read;
                    copied += read;
                    long now = System.currentTimeMillis();
                    if (now - lastProgressAt > 250) {
                        notifySyncProgress("file", completedBefore + 1, totalFiles, bytesBefore + copied, totalBytes, name);
                        lastProgressAt = now;
                    }
                }
                file.flush();
            } catch (Exception error) {
                try { target.delete(); } catch (Exception ignored) {}
                throw error;
            }
            return copied;
        }
    }

    private static class HttpHeader {
        int status;
        long contentLength = -1;
    }

    private static class PreparingException extends Exception {}

    private byte[] httpGetBytes(String host, int port, String path, int maxBytes) throws Exception {
        InetAddress address = InetAddress.getByName(host);
        try (Socket socket = new Socket(address, port)) {
            socket.setSoTimeout(30000);
            OutputStream output = socket.getOutputStream();
            InputStream input = socket.getInputStream();
            String request = "GET " + path + " HTTP/1.1\r\nHost: nexo\r\nConnection: close\r\n\r\n";
            output.write(request.getBytes(StandardCharsets.US_ASCII));
            output.flush();

            HttpHeader header = readHttpHeader(input);
            if (header.status == 503) throw new PreparingException();
            if (header.status == 403) throw new SecurityException("Código incorreto");
            if (header.status != 200) throw new IllegalStateException("Outro PULSAR respondeu HTTP " + header.status);
            if (header.contentLength < 0 || header.contentLength > maxBytes) throw new IllegalStateException("Resposta de configuração inválida");
            ByteArrayOutputStream body = new ByteArrayOutputStream((int) Math.min(header.contentLength, 1024 * 1024));
            copyExact(input, body, header.contentLength);
            return body.toByteArray();
        }
    }

    private HttpHeader readHttpHeader(InputStream input) throws Exception {
        String statusLine = readAsciiLine(input);
        if (statusLine == null || !statusLine.startsWith("HTTP/")) throw new IllegalStateException("Resposta HTTP inválida");
        String[] parts = statusLine.split(" ");
        if (parts.length < 2) throw new IllegalStateException("Status HTTP inválido");
        HttpHeader header = new HttpHeader();
        header.status = Integer.parseInt(parts[1]);
        String line;
        while ((line = readAsciiLine(input)) != null && !line.isEmpty()) {
            int colon = line.indexOf(':');
            if (colon > 0 && line.substring(0, colon).trim().equalsIgnoreCase("Content-Length")) {
                header.contentLength = Long.parseLong(line.substring(colon + 1).trim());
            }
        }
        return header;
    }

    private void notifySyncProgress(String stage, int current, int total, long bytes, long totalBytes, String fileName) {
        JSObject progress = new JSObject();
        progress.put("stage", stage);
        progress.put("current", current);
        progress.put("total", total);
        progress.put("bytes", bytes);
        progress.put("totalBytes", totalBytes);
        progress.put("fileName", fileName == null ? "" : fileName);
        notifyListeners("syncProgress", progress);
    }

    private BackupResult createBackupArchive(String stateJson) throws Exception {
        JSONObject state = new JSONObject(stateJson == null || stateJson.trim().isEmpty() ? "{}" : stateJson);
        Map<File, String> files = new LinkedHashMap<>();
        collectAndReplaceNativeUris(state, files);

        File directory = new File(getContext().getCacheDir(), "nexo_sync");
        if (!directory.exists() && !directory.mkdirs()) throw new IllegalStateException("Armazenamento temporário indisponível");

        // Remove stale archives from interrupted/older sharing sessions before checking free space.
        File[] stale = directory.listFiles();
        if (stale != null) for (File old : stale) {
            if (old.isFile() && old.getName().startsWith("nexo-") && old.getName().endsWith(".nexo")) {
                try { old.delete(); } catch (Exception ignored) {}
            }
        }

        long estimatedAudioBytes = 0;
        for (File file : files.keySet()) if (file != null && file.exists() && file.isFile()) estimatedAudioBytes += Math.max(0, file.length());
        if (estimatedAudioBytes > MAX_BACKUP_BYTES) {
            throw new IllegalStateException("Pads/Drums somam " + formatBytes(estimatedAudioBytes) + ", acima do limite de 4 GB do PULSAR Connect");
        }
        long usable = directory.getUsableSpace();
        if (usable > 0 && estimatedAudioBytes + MIN_CACHE_RESERVE_BYTES > usable) {
            throw new IllegalStateException("Espaço livre insuficiente para preparar " + formatBytes(estimatedAudioBytes) + " de Pads/Drums. Libere espaço no celular e tente novamente");
        }

        File archive = new File(directory, "nexo-" + System.currentTimeMillis() + ".nexo");
        long copiedAudioBytes = 0;
        int successfulFiles = 0;
        int skippedFiles = 0;
        List<String> successfulArchiveNames = new ArrayList<>();
        List<String> skippedNames = new ArrayList<>();

        try (ZipOutputStream zip = new ZipOutputStream(new FileOutputStream(archive))) {
            // MP3/WAV are already large/compressed. Level 0 avoids burning CPU/RAM trying to recompress them.
            zip.setLevel(0);

            for (Map.Entry<File, String> entry : files.entrySet()) {
                File file = entry.getKey();
                String archiveName = entry.getValue();
                if (file == null || !file.exists() || !file.isFile() || !file.canRead() || file.length() <= 0) {
                    skippedFiles++;
                    skippedNames.add(file == null ? archiveName : file.getName());
                    continue;
                }
                if (copiedAudioBytes + file.length() > MAX_BACKUP_BYTES) {
                    skippedFiles++;
                    skippedNames.add(file.getName());
                    continue;
                }

                boolean opened = false;
                try (InputStream input = new FileInputStream(file)) {
                    ZipEntry zipEntry = new ZipEntry("files/" + archiveName);
                    zip.putNextEntry(zipEntry);
                    opened = true;
                    long written = copy(input, zip, MAX_BACKUP_BYTES - copiedAudioBytes);
                    copiedAudioBytes += written;
                    successfulFiles++;
                    successfulArchiveNames.add(archiveName);
                } catch (Exception fileError) {
                    skippedFiles++;
                    skippedNames.add(file.getName());
                } finally {
                    if (opened) {
                        try { zip.closeEntry(); } catch (Exception ignored) {}
                    }
                }
            }

            // Any placeholder whose file could not be packed is removed from the receiving snapshot.
            removeUnavailablePlaceholders(state, successfulArchiveNames);

            byte[] stateBytes = state.toString().getBytes(StandardCharsets.UTF_8);
            putZipBytes(zip, "state.json", stateBytes);
            JSONObject meta = new JSONObject();
            meta.put("schema", 2);
            meta.put("app", "PULSAR");
            meta.put("version", "1.7.4");
            meta.put("createdAt", System.currentTimeMillis());
            meta.put("device", defaultDeviceName());
            meta.put("audioFiles", successfulFiles);
            meta.put("skippedFiles", skippedFiles);
            putZipBytes(zip, "meta.json", meta.toString().getBytes(StandardCharsets.UTF_8));
        } catch (Exception error) {
            archive.delete();
            throw error;
        }

        if (!archive.exists() || archive.length() <= 0) throw new IllegalStateException("O pacote de transferência ficou vazio");
        BackupResult result = new BackupResult();
        result.file = archive;
        result.audioFiles = successfulFiles;
        result.skippedFiles = skippedFiles;
        result.warning = skippedFiles > 0 ? (skippedFiles + " arquivo(s) de áudio foram ignorados" + (skippedNames.isEmpty() ? "" : ": " + joinPreview(skippedNames))) : null;
        result.totalBytes = archive.length();
        return result;
    }

    private ImportResult importBackupArchive(File archive) throws Exception {
        File padDirectory = new File(getContext().getFilesDir(), "nexo_pads");
        if (!padDirectory.exists() && !padDirectory.mkdirs()) throw new IllegalStateException("Pasta de Pads indisponível");
        String stateText = null;
        Map<String, String> importedUris = new HashMap<>();
        List<File> previousSyncFiles = new ArrayList<>();
        File[] existingFiles = padDirectory.listFiles();
        if (existingFiles != null) for (File existing : existingFiles) if (existing.isFile() && existing.getName().startsWith("sync-")) previousSyncFiles.add(existing);
        List<File> newSyncFiles = new ArrayList<>();
        int audioCount = 0;
        long extracted = 0;
        try (ZipInputStream zip = new ZipInputStream(new FileInputStream(archive))) {
            ZipEntry entry;
            while ((entry = zip.getNextEntry()) != null) {
                String name = entry.getName();
                if (name == null || name.contains("..") || name.startsWith("/") || name.startsWith("\\")) throw new IllegalStateException("Entrada inválida");
                if ("state.json".equals(name)) {
                    stateText = new String(readLimited(zip, 4 * 1024 * 1024), StandardCharsets.UTF_8);
                } else if (name.startsWith("files/") && !entry.isDirectory()) {
                    String assetName = safePart(name.substring("files/".length()));
                    if (assetName.isEmpty()) assetName = "audio";
                    File target = uniqueFile(padDirectory, "sync-" + assetName);
                    try (OutputStream out = new FileOutputStream(target)) {
                        long copied = copy(zip, out, MAX_BACKUP_BYTES - extracted);
                        extracted += copied;
                    }
                    if (extracted > MAX_BACKUP_BYTES) throw new IllegalStateException("Backup excede o limite");
                    importedUris.put(name.substring("files/".length()), Uri.fromFile(target).toString());
                    newSyncFiles.add(target);
                    audioCount++;
                }
                zip.closeEntry();
            }
        }
        if (stateText == null) throw new IllegalStateException("state.json ausente");
        JSONObject state = new JSONObject(stateText);
        restoreNativeUris(state, importedUris);
        for (File previous : previousSyncFiles) if (!newSyncFiles.contains(previous)) {
            try { previous.delete(); } catch (Exception ignored) {}
        }
        ImportResult result = new ImportResult();
        result.stateJson = state.toString();
        result.audioFiles = audioCount;
        result.totalBytes = archive.length();
        return result;
    }

    private void collectAndReplaceNativeUris(Object node, Map<File, String> files) throws Exception {
        if (node instanceof JSONObject) {
            JSONObject object = (JSONObject) node;
            List<String> keys = new ArrayList<>();
            java.util.Iterator<String> iterator = object.keys();
            while (iterator.hasNext()) keys.add(iterator.next());
            for (String key : keys) {
                Object value = object.opt(key);
                if ("nativeFileUri".equals(key) && value instanceof String) {
                    String uriValue = (String) value;
                    File file = ownedPadFile(uriValue);
                    if (file != null) {
                        if (file.exists() && file.isFile() && file.length() > 0) {
                            String archiveName = files.get(file);
                            if (archiveName == null) {
                                archiveName = files.size() + "-" + safePart(file.getName());
                                files.put(file, archiveName);
                            }
                            object.put(key, PLACEHOLDER_PREFIX + URLEncoder.encode(archiveName, "UTF-8"));
                        } else {
                            object.remove(key);
                        }
                    }
                } else collectAndReplaceNativeUris(value, files);
            }
        } else if (node instanceof JSONArray) {
            JSONArray array = (JSONArray) node;
            for (int i = 0; i < array.length(); i++) collectAndReplaceNativeUris(array.opt(i), files);
        }
    }

    private void removeUnavailablePlaceholders(Object node, List<String> successfulArchiveNames) throws Exception {
        if (node instanceof JSONObject) {
            JSONObject object = (JSONObject) node;
            List<String> keys = new ArrayList<>();
            java.util.Iterator<String> iterator = object.keys();
            while (iterator.hasNext()) keys.add(iterator.next());
            for (String key : keys) {
                Object value = object.opt(key);
                if ("nativeFileUri".equals(key) && value instanceof String && ((String) value).startsWith(PLACEHOLDER_PREFIX)) {
                    String encoded = ((String) value).substring(PLACEHOLDER_PREFIX.length());
                    String archiveName = URLDecoder.decode(encoded, "UTF-8");
                    if (!successfulArchiveNames.contains(archiveName)) object.remove(key);
                } else removeUnavailablePlaceholders(value, successfulArchiveNames);
            }
        } else if (node instanceof JSONArray) {
            JSONArray array = (JSONArray) node;
            for (int i = 0; i < array.length(); i++) removeUnavailablePlaceholders(array.opt(i), successfulArchiveNames);
        }
    }

    private String joinPreview(List<String> names) {
        StringBuilder out = new StringBuilder();
        int max = Math.min(3, names.size());
        for (int i = 0; i < max; i++) {
            if (i > 0) out.append(", ");
            out.append(names.get(i));
        }
        if (names.size() > max) out.append(" e mais ").append(names.size() - max);
        return out.toString();
    }

    private String formatBytes(long bytes) {
        double value = Math.max(0, bytes);
        String[] units = {"B", "KB", "MB", "GB"};
        int unit = 0;
        while (value >= 1024.0 && unit < units.length - 1) { value /= 1024.0; unit++; }
        return String.format(Locale.US, unit == 0 ? "%.0f %s" : "%.1f %s", value, units[unit]);
    }

    private void restoreNativeUris(Object node, Map<String, String> importedUris) throws Exception {
        if (node instanceof JSONObject) {
            JSONObject object = (JSONObject) node;
            java.util.Iterator<String> iterator = object.keys();
            List<String> keys = new ArrayList<>();
            while (iterator.hasNext()) keys.add(iterator.next());
            for (String key : keys) {
                Object value = object.opt(key);
                if ("nativeFileUri".equals(key) && value instanceof String && ((String) value).startsWith(PLACEHOLDER_PREFIX)) {
                    String encoded = ((String) value).substring(PLACEHOLDER_PREFIX.length());
                    String archiveName = URLDecoder.decode(encoded, "UTF-8");
                    String newUri = importedUris.get(archiveName);
                    if (newUri != null) object.put(key, newUri); else object.remove(key);
                } else restoreNativeUris(value, importedUris);
            }
        } else if (node instanceof JSONArray) {
            JSONArray array = (JSONArray) node;
            for (int i = 0; i < array.length(); i++) restoreNativeUris(array.opt(i), importedUris);
        }
    }

    private File ownedPadFile(String uriValue) {
        try {
            Uri uri = Uri.parse(uriValue);
            if (!"file".equalsIgnoreCase(uri.getScheme())) return null;
            File root = new File(getContext().getFilesDir(), "nexo_pads").getCanonicalFile();
            File file = new File(uri.getPath()).getCanonicalFile();
            if (!file.getPath().startsWith(root.getPath() + File.separator)) return null;
            return file;
        } catch (Exception ignored) { return null; }
    }

    private void resolveService(NsdServiceInfo serviceInfo, List<Peer> peers) {
        try {
            nsdManager.resolveService(serviceInfo, new NsdManager.ResolveListener() {
                @Override public void onResolveFailed(NsdServiceInfo serviceInfo, int errorCode) {}
                @Override public void onServiceResolved(NsdServiceInfo resolved) {
                    InetAddress host = resolved.getHost();
                    if (host == null || resolved.getPort() <= 0) return;
                    Peer peer = new Peer();
                    peer.name = resolved.getServiceName();
                    peer.host = host.getHostAddress();
                    peer.port = resolved.getPort();
                    synchronized (peers) {
                        boolean duplicate = false;
                        for (Peer p : peers) if (p.host.equals(peer.host) && p.port == peer.port) { duplicate = true; break; }
                        if (!duplicate) peers.add(peer);
                    }
                }
            });
        } catch (Exception ignored) {}
    }

    private void finishDiscovery(PluginCall call, List<Peer> peers, String errorMessage) {
        if (!discovering.compareAndSet(true, false)) return;
        stopDiscoveryInternal(false);
        if (errorMessage != null) {
            call.reject(errorMessage);
            return;
        }
        JSArray array = new JSArray();
        synchronized (peers) {
            for (Peer peer : peers) {
                JSObject item = new JSObject();
                item.put("name", peer.name);
                item.put("host", peer.host);
                item.put("port", peer.port);
                array.put(item);
            }
        }
        JSObject out = new JSObject();
        out.put("peers", array);
        call.resolve(out);
    }

    private void stopDiscoveryInternal() { stopDiscoveryInternal(true); }
    private void stopDiscoveryInternal(boolean updateFlag) {
        if (updateFlag) discovering.set(false);
        if (nsdManager != null && discoveryListener != null) {
            try { nsdManager.stopServiceDiscovery(discoveryListener); } catch (Exception ignored) {}
        }
        discoveryListener = null;
        releaseDiscoveryMulticastLock();
    }

    private void stopShareInternal() {
        synchronized (serverLock) {
            shareSessionId++;
            if (prepareThread != null) {
                try { prepareThread.interrupt(); } catch (Exception ignored) {}
                prepareThread = null;
            }
            if (nsdManager != null && registrationListener != null) {
                try { nsdManager.unregisterService(registrationListener); } catch (Exception ignored) {}
            }
            registrationListener = null;
            if (serverSocket != null) {
                try { serverSocket.close(); } catch (Exception ignored) {}
                serverSocket = null;
            }
            if (serverThread != null) {
                try { serverThread.interrupt(); } catch (Exception ignored) {}
                serverThread = null;
            }
            shareStateJson = null;
            shareFiles.clear();
            shareCode = null;
            sharePreparing = false;
            shareError = null;
            shareAudioFiles = 0;
            shareSkippedFiles = 0;
            shareWarning = null;
            shareBytes = 0;
            releaseShareMulticastLock();
        }
    }

    private void acquireShareMulticastLock() {
        try {
            if (shareMulticastLock != null && shareMulticastLock.isHeld()) return;
            WifiManager wifi = (WifiManager) getContext().getApplicationContext().getSystemService(android.content.Context.WIFI_SERVICE);
            if (wifi == null) return;
            shareMulticastLock = wifi.createMulticastLock("NEXO-Share");
            shareMulticastLock.setReferenceCounted(false);
            shareMulticastLock.acquire();
        } catch (Exception ignored) {}
    }

    private void releaseShareMulticastLock() {
        try { if (shareMulticastLock != null && shareMulticastLock.isHeld()) shareMulticastLock.release(); } catch (Exception ignored) {}
        shareMulticastLock = null;
    }

    private void acquireDiscoveryMulticastLock() {
        try {
            if (discoveryMulticastLock != null && discoveryMulticastLock.isHeld()) return;
            WifiManager wifi = (WifiManager) getContext().getApplicationContext().getSystemService(android.content.Context.WIFI_SERVICE);
            if (wifi == null) return;
            discoveryMulticastLock = wifi.createMulticastLock("NEXO-Discover");
            discoveryMulticastLock.setReferenceCounted(false);
            discoveryMulticastLock.acquire();
        } catch (Exception ignored) {}
    }

    private void releaseDiscoveryMulticastLock() {
        try { if (discoveryMulticastLock != null && discoveryMulticastLock.isHeld()) discoveryMulticastLock.release(); } catch (Exception ignored) {}
        discoveryMulticastLock = null;
    }

    private String localIpv4Address() {
        try {
            Enumeration<NetworkInterface> interfaces = NetworkInterface.getNetworkInterfaces();
            String fallback = "";
            while (interfaces != null && interfaces.hasMoreElements()) {
                NetworkInterface network = interfaces.nextElement();
                if (!network.isUp() || network.isLoopback()) continue;
                Enumeration<InetAddress> addresses = network.getInetAddresses();
                while (addresses.hasMoreElements()) {
                    InetAddress address = addresses.nextElement();
                    if (!(address instanceof Inet4Address) || address.isLoopbackAddress()) continue;
                    String value = address.getHostAddress();
                    if (address.isSiteLocalAddress()) return value;
                    if (fallback.isEmpty()) fallback = value;
                }
            }
            return fallback;
        } catch (Exception ignored) { return ""; }
    }

    private String defaultDeviceName() {
        String model = Build.MODEL == null ? "Android" : Build.MODEL.trim();
        return "PULSAR · " + model;
    }

    private String safeServiceName(String input) {
        String value = input.replaceAll("[\\r\\n\\t]", " ").trim();
        if (value.length() > 50) value = value.substring(0, 50);
        return value.isEmpty() ? "PULSAR" : value;
    }

    private String queryParam(String path, String key) {
        int q = path.indexOf('?');
        if (q < 0) return "";
        String[] parts = path.substring(q + 1).split("&");
        for (String part : parts) {
            int eq = part.indexOf('=');
            String k = eq >= 0 ? part.substring(0, eq) : part;
            if (key.equals(k)) {
                String value = eq >= 0 ? part.substring(eq + 1) : "";
                try { return URLDecoder.decode(value, "UTF-8"); } catch (Exception ignored) { return value; }
            }
        }
        return "";
    }

    private String readAsciiLine(InputStream input) throws Exception {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        int current;
        boolean seen = false;
        while ((current = input.read()) != -1) {
            seen = true;
            if (current == '\n') break;
            if (current != '\r') out.write(current);
            if (out.size() > 8192) throw new IllegalStateException("Cabeçalho muito grande");
        }
        return !seen && out.size() == 0 ? null : out.toString("US-ASCII");
    }

    private void writeHttpHeaders(OutputStream output, int status, String type, long length) throws Exception {
        String text = "HTTP/1.1 " + status + " OK\r\nContent-Type: " + type + "\r\nContent-Length: " + length + "\r\nConnection: close\r\n\r\n";
        output.write(text.getBytes(StandardCharsets.US_ASCII));
    }

    private void writeHttpError(OutputStream output, int status, String message) throws Exception {
        byte[] body = message.getBytes(StandardCharsets.UTF_8);
        String text = "HTTP/1.1 " + status + " " + message + "\r\nContent-Type: text/plain\r\nContent-Length: " + body.length + "\r\nConnection: close\r\n\r\n";
        output.write(text.getBytes(StandardCharsets.US_ASCII));
        output.write(body);
    }

    private void putZipBytes(ZipOutputStream zip, String name, byte[] bytes) throws Exception {
        zip.putNextEntry(new ZipEntry(name));
        zip.write(bytes);
        zip.closeEntry();
    }

    private byte[] readLimited(InputStream input, int max) throws Exception {
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        byte[] buffer = new byte[32768];
        int read;
        int total = 0;
        while ((read = input.read(buffer)) != -1) {
            total += read;
            if (total > max) throw new IllegalStateException("Arquivo interno muito grande");
            output.write(buffer, 0, read);
        }
        return output.toByteArray();
    }

    private long copy(InputStream input, OutputStream output, long max) throws Exception {
        byte[] buffer = new byte[65536];
        long total = 0;
        int read;
        while ((read = input.read(buffer)) != -1) {
            total += read;
            if (total > max) throw new IllegalStateException("Transferência excede o limite");
            output.write(buffer, 0, read);
        }
        output.flush();
        return total;
    }

    private void copyExact(InputStream input, OutputStream output, long length) throws Exception {
        byte[] buffer = new byte[65536];
        long remaining = length;
        while (remaining > 0) {
            int read = input.read(buffer, 0, (int) Math.min(buffer.length, remaining));
            if (read < 0) throw new IllegalStateException("Transferência interrompida");
            output.write(buffer, 0, read);
            remaining -= read;
        }
        output.flush();
    }

    private File uniqueFile(File directory, String desired) {
        String safe = safePart(desired);
        if (safe.isEmpty()) safe = "audio";
        File candidate = new File(directory, safe);
        int i = 1;
        while (candidate.exists()) candidate = new File(directory, i++ + "-" + safe);
        return candidate;
    }

    private String safePart(String value) {
        if (value == null) return "";
        String safe = value.replaceAll("[^a-zA-Z0-9._-]", "_");
        if (safe.length() > 100) safe = safe.substring(safe.length() - 100);
        return safe;
    }

    private String jsonEscape(String value) {
        return value == null ? "" : value.replace("\\", "\\\\").replace("\"", "\\\"");
    }
}
