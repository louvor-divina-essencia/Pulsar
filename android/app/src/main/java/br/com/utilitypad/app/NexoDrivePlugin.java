package br.com.utilitypad.app;

import android.app.Activity;
import android.content.ContentResolver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.database.Cursor;
import android.net.Uri;
import android.provider.DocumentsContract;
import android.os.ParcelFileDescriptor;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.FileInputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;

@CapacitorPlugin(name = "NexoDrive")
public class NexoDrivePlugin extends Plugin {
    private static final String PREFS = "nexo_drive";
    private static final String KEY_TREE_URI = "tree_uri";
    private static final String CONFIG_FOLDER = "_NEXO";
    private static final String CONFIG_FILE = "nexo-config.json";
    private static final long MAX_CONFIG_BYTES = 12L * 1024L * 1024L;

    private static class Doc {
        String id;
        String name;
        String mime;
        long size;
        long modified;
        boolean directory;
    }

    private static class Asset {
        Doc doc;
        String relativePath;
    }

    private SharedPreferences prefs() {
        return getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private Uri savedTreeUri() {
        String value = prefs().getString(KEY_TREE_URI, null);
        return value == null || value.trim().isEmpty() ? null : Uri.parse(value);
    }

    @PluginMethod
    public void selectRootFolder(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION | Intent.FLAG_GRANT_PREFIX_URI_PERMISSION);
        startActivityForResult(call, intent, "driveFolderPicked");
    }

    @ActivityCallback
    private void driveFolderPicked(PluginCall call, ActivityResult result) {
        if (call == null) return;
        Intent data = result.getData();
        if (result.getResultCode() != Activity.RESULT_OK || data == null || data.getData() == null) {
            call.reject("cancelled");
            return;
        }
        Uri tree = data.getData();
        int flags = data.getFlags() & (Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
        try { getContext().getContentResolver().takePersistableUriPermission(tree, flags); } catch (Exception ignored) {}
        prefs().edit().putString(KEY_TREE_URI, tree.toString()).apply();
        try { call.resolve(buildStatus(tree)); }
        catch (Exception error) { call.reject("Não foi possível acessar a pasta escolhida", error); }
    }

    @PluginMethod
    public void getStatus(PluginCall call) {
        Uri tree = savedTreeUri();
        if (tree == null) {
            JSObject out = new JSObject(); out.put("connected", false); call.resolve(out); return;
        }
        try { call.resolve(buildStatus(tree)); }
        catch (Exception error) {
            JSObject out = new JSObject(); out.put("connected", false); out.put("error", friendly(error)); call.resolve(out);
        }
    }

    @PluginMethod
    public void disconnect(PluginCall call) {
        prefs().edit().remove(KEY_TREE_URI).apply();
        JSObject out = new JSObject(); out.put("connected", false); call.resolve(out);
    }

    @PluginMethod
    public void scanLibrary(PluginCall call) {
        Uri tree = savedTreeUri();
        if (tree == null) { call.reject("Nenhuma pasta do Drive conectada"); return; }
        new Thread(() -> {
            try {
                String rootId = DocumentsContract.getTreeDocumentId(tree);
                Doc root = readDoc(tree, rootId);
                Doc padRoot = sameName(root.name, "PAD") ? root : findFolder(tree, rootId, "PAD", 2, new HashSet<>());
                Doc drumRoot = sameName(root.name, "DRUM PAD") ? root : findFolder(tree, rootId, "DRUM PAD", 2, new HashSet<>());
                JSObject out = new JSObject();
                out.put("connected", true);
                out.put("name", root.name);
                out.put("padFound", padRoot != null);
                out.put("drumFound", drumRoot != null);
                out.put("padBanks", scanBanks(tree, padRoot, "Pads"));
                out.put("drumBanks", scanBanks(tree, drumRoot, "Drums"));
                call.resolve(out);
            } catch (Exception error) { call.reject("Não foi possível ler PAD e DRUM PAD no Drive: " + friendly(error), error); }
        }, "NEXO-Drive-Scan").start();
    }

    @PluginMethod
    public void downloadBank(PluginCall call) {
        Uri tree = savedTreeUri();
        if (tree == null) { call.reject("Nenhuma pasta do Drive conectada"); return; }
        String kindValue = call.getString("kind", "Pads");
        boolean drum = kindValue != null && kindValue.toLowerCase(Locale.ROOT).startsWith("drum");
        String bankName = call.getString("bankName", "__ROOT__");
        final String kind = drum ? "Drums" : "Pads";
        new Thread(() -> {
            try {
                String rootId = DocumentsContract.getTreeDocumentId(tree);
                Doc root = readDoc(tree, rootId);
                String parentName = drum ? "DRUM PAD" : "PAD";
                Doc parent = sameName(root.name, parentName) ? root : findFolder(tree, rootId, parentName, 2, new HashSet<>());
                if (parent == null) throw new IllegalStateException("Pasta " + parentName + " não encontrada");
                Doc bank = "__ROOT__".equals(bankName) ? parent : findChildByName(tree, parent.id, bankName, true);
                if (bank == null) throw new IllegalStateException("Banco " + bankName + " não encontrado");

                List<Asset> assets = new ArrayList<>();
                collectAudio(tree, bank.id, "", 0, assets, new HashSet<>());
                if (assets.isEmpty()) throw new IllegalStateException("Nenhum áudio encontrado neste banco");
                long totalBytes = 0;
                for (Asset a : assets) totalBytes += Math.max(0, a.doc.size);

                File rootCache = new File(getContext().getFilesDir(), "nexo_drive_cache");
                File kindDir = new File(rootCache, drum ? "drum" : "pad");
                File bankDir = new File(kindDir, Integer.toHexString(bank.id.hashCode()) + "-" + safePart(bank.name));
                if (!bankDir.exists() && !bankDir.mkdirs()) throw new IllegalStateException("Não foi possível criar o cache offline");

                JSArray files = new JSArray();
                JSArray failedFiles = new JSArray();
                long copiedBytes = 0;
                int index = 0;
                int failed = 0;
                Exception firstFailure = null;
                for (Asset asset : assets) {
                    index++;
                    Doc doc = asset.doc;
                    String outputName = Integer.toHexString(doc.id.hashCode()) + "-" + safeFileName(doc.name);
                    File output = new File(bankDir, outputName);
                    Uri sourceUri = DocumentsContract.buildDocumentUriUsingTree(tree, doc.id);
                    long copied;
                    try {
                        boolean currentCopy = output.exists() && doc.size > 0 && output.length() == doc.size && (doc.modified <= 0 || Math.abs(output.lastModified() - doc.modified) < 2000);
                        if (currentCopy) {
                            copied = output.length();
                            JSObject cached = new JSObject(); cached.put("stage", "downloading"); cached.put("bankName", bank.name); cached.put("fileName", doc.name + " · já offline"); cached.put("current", index); cached.put("total", assets.size()); cached.put("bytes", copiedBytes + copied); cached.put("totalBytes", totalBytes); notifyListeners("driveProgress", cached);
                        } else {
                            File partial = new File(bankDir, outputName + ".download");
                            if (partial.exists()) partial.delete();
                            copied = copyWithProgress(sourceUri, partial, copiedBytes, totalBytes, index, assets.size(), bank.name, doc.name);
                            if (doc.modified > 0) partial.setLastModified(doc.modified);
                            replaceDownloadedFile(partial, output);
                        }
                        copiedBytes += copied;
                        JSObject f = new JSObject();
                        f.put("name", doc.name);
                        f.put("fileUri", Uri.fromFile(output).toString());
                        f.put("size", output.length());
                        f.put("sourceId", doc.id);
                        f.put("relativePath", asset.relativePath);
                        f.put("driveRelativePath", logicalPath(kind, bank.name, asset.relativePath));
                        f.put("modified", doc.modified);
                        files.put(f);
                    } catch (Exception fileError) {
                        if (firstFailure == null) firstFailure = fileError;
                        failed++;
                        File partial = new File(bankDir, outputName + ".download");
                        if (partial.exists()) partial.delete();
                        boolean keptPrevious = output.exists() && output.length() > 0;
                        if (keptPrevious) {
                            JSObject fallback = new JSObject();
                            fallback.put("name", doc.name);
                            fallback.put("fileUri", Uri.fromFile(output).toString());
                            fallback.put("size", output.length());
                            fallback.put("sourceId", doc.id);
                            fallback.put("relativePath", asset.relativePath);
                            fallback.put("driveRelativePath", logicalPath(kind, bank.name, asset.relativePath));
                            fallback.put("modified", doc.modified);
                            fallback.put("stale", true);
                            files.put(fallback);
                        }
                        JSObject skipped = new JSObject();
                        skipped.put("name", doc.name);
                        skipped.put("relativePath", asset.relativePath);
                        skipped.put("message", friendly(fileError));
                        skipped.put("keptPrevious", keptPrevious);
                        failedFiles.put(skipped);
                        JSObject progress = new JSObject();
                        progress.put("stage", "skipped"); progress.put("bankName", bank.name); progress.put("fileName", doc.name); progress.put("current", index); progress.put("total", assets.size()); progress.put("bytes", copiedBytes); progress.put("totalBytes", totalBytes); progress.put("message", friendly(fileError)); progress.put("keptPrevious", keptPrevious);
                        notifyListeners("driveProgress", progress);
                    }
                }
                if (files.length() == 0 && failed > 0) {
                    String detail = firstFailure == null ? "erro desconhecido" : friendly(firstFailure);
                    throw new IllegalStateException("Nenhum arquivo pôde ser baixado. Primeiro erro: " + detail, firstFailure);
                }
                cleanupStaleFiles(bankDir, files);
                JSObject out = new JSObject();
                out.put("kind", kind); out.put("bankId", bank.id); out.put("bankName", bank.name); out.put("files", files); out.put("total", files.length()); out.put("failed", failed); out.put("failedFiles", failedFiles); out.put("bytes", copiedBytes);
                JSObject done = new JSObject();
                done.put("stage", "done"); done.put("bankName", bank.name); done.put("current", files.length()); done.put("total", files.length()); done.put("bytes", copiedBytes); done.put("totalBytes", totalBytes);
                notifyListeners("driveProgress", done);
                call.resolve(out);
            } catch (Exception error) {
                JSObject fail = new JSObject(); fail.put("stage", "error"); fail.put("message", friendly(error)); notifyListeners("driveProgress", fail);
                call.reject("Falha ao baixar banco: " + friendly(error), error);
            }
        }, "NEXO-Drive-Download").start();
    }

    @PluginMethod
    public void saveConfig(PluginCall call) {
        Uri tree = savedTreeUri();
        if (tree == null) { call.reject("Nenhuma pasta do Drive conectada"); return; }
        String stateJson = call.getString("stateJson");
        if (stateJson == null) { call.reject("Configuração vazia"); return; }
        byte[] bytes = stateJson.getBytes(StandardCharsets.UTF_8);
        if (bytes.length > MAX_CONFIG_BYTES) { call.reject("Configuração maior que o limite de segurança"); return; }
        new Thread(() -> {
            try {
                String rootId = DocumentsContract.getTreeDocumentId(tree);
                String folderId = ensureFolder(tree, rootId, CONFIG_FOLDER);
                String fileId = ensureFile(tree, folderId, CONFIG_FILE, "application/json");
                Uri uri = DocumentsContract.buildDocumentUriUsingTree(tree, fileId);
                try (OutputStream output = getContext().getContentResolver().openOutputStream(uri, "wt")) {
                    if (output == null) throw new IllegalStateException("O Drive não abriu o arquivo de configuração para escrita");
                    output.write(bytes); output.flush();
                }
                JSObject out = new JSObject(); out.put("saved", true); out.put("bytes", bytes.length); call.resolve(out);
            } catch (Exception error) { call.reject("Não foi possível salvar a configuração no Drive: " + friendly(error), error); }
        }, "NEXO-Drive-Config-Save").start();
    }

    @PluginMethod
    public void loadConfig(PluginCall call) {
        Uri tree = savedTreeUri();
        if (tree == null) { call.reject("Nenhuma pasta do Drive conectada"); return; }
        new Thread(() -> {
            try {
                String rootId = DocumentsContract.getTreeDocumentId(tree);
                Doc folder = findChildByName(tree, rootId, CONFIG_FOLDER, true);
                if (folder == null) throw new IllegalStateException("Ainda não existe configuração do PULSAR nesta pasta");
                Doc file = findChildByName(tree, folder.id, CONFIG_FILE, false);
                if (file == null) throw new IllegalStateException("Arquivo de configuração não encontrado");
                Uri uri = DocumentsContract.buildDocumentUriUsingTree(tree, file.id);
                byte[] bytes = readLimited(uri, MAX_CONFIG_BYTES);
                JSObject out = new JSObject(); out.put("stateJson", new String(bytes, StandardCharsets.UTF_8)); out.put("bytes", bytes.length); call.resolve(out);
            } catch (Exception error) { call.reject("Não foi possível restaurar a configuração: " + friendly(error), error); }
        }, "NEXO-Drive-Config-Load").start();
    }

    private JSObject buildStatus(Uri tree) throws Exception {
        String rootId = DocumentsContract.getTreeDocumentId(tree);
        Doc root = readDoc(tree, rootId);
        boolean hasConfig = false;
        try {
            Doc folder = findChildByName(tree, rootId, CONFIG_FOLDER, true);
            hasConfig = folder != null && findChildByName(tree, folder.id, CONFIG_FILE, false) != null;
        } catch (Exception ignored) {}
        JSObject out = new JSObject(); out.put("connected", true); out.put("name", root.name); out.put("treeUri", tree.toString()); out.put("hasConfig", hasConfig); return out;
    }

    private JSArray scanBanks(Uri tree, Doc parent, String kind) throws Exception {
        JSArray result = new JSArray();
        if (parent == null) return result;
        List<Doc> children = listChildren(tree, parent.id);
        boolean hasFolders = false;
        for (Doc d : children) if (d.directory) { hasFolders = true; break; }
        if (!hasFolders) {
            List<Asset> assets = new ArrayList<>(); collectAudio(tree, parent.id, "", 0, assets, new HashSet<>());
            if (!assets.isEmpty()) result.put(bankJson(parent, "__ROOT__", parent.name, assets, kind));
            return result;
        }
        for (Doc child : children) {
            if (!child.directory) continue;
            List<Asset> assets = new ArrayList<>(); collectAudio(tree, child.id, "", 0, assets, new HashSet<>());
            if (assets.isEmpty()) continue;
            result.put(bankJson(child, child.name, child.name, assets, kind));
        }
        return result;
    }

    private JSObject bankJson(Doc doc, String name, String displayName, List<Asset> assets, String kind) {
        long bytes = 0; JSArray files = new JSArray();
        for (Asset a : assets) {
            bytes += Math.max(0, a.doc.size);
            JSObject f = new JSObject(); f.put("name", a.doc.name); f.put("size", a.doc.size); f.put("relativePath", a.relativePath); f.put("sourceId", a.doc.id); f.put("driveRelativePath", logicalPath(kind, name, a.relativePath)); files.put(f);
        }
        JSObject out = new JSObject(); out.put("id", doc.id); out.put("name", name); out.put("displayName", displayName); out.put("count", assets.size()); out.put("bytes", bytes); out.put("files", files); return out;
    }

    private String logicalPath(String kind, String bankName, String relativePath) {
        String bank = "__ROOT__".equals(bankName) ? "" : bankName + "/";
        return (kind + "/" + bank + relativePath).replaceAll("/+", "/");
    }

    private void collectAudio(Uri tree, String docId, String prefix, int depth, List<Asset> result, Set<String> visited) throws Exception {
        if (depth > 5 || !visited.add(docId)) return;
        for (Doc d : listChildren(tree, docId)) {
            if (d.directory) collectAudio(tree, d.id, prefix + d.name + "/", depth + 1, result, visited);
            else if (isAudio(d)) { Asset a = new Asset(); a.doc = d; a.relativePath = prefix + d.name; result.add(a); }
        }
    }

    private boolean isAudio(Doc d) {
        if (d == null || d.directory) return false;
        String mime = d.mime == null ? "" : d.mime.toLowerCase(Locale.ROOT);
        if (mime.startsWith("audio/")) return true;
        String name = d.name == null ? "" : d.name.toLowerCase(Locale.ROOT);
        return name.matches(".*\\.(mp3|wav|m4a|aac|ogg|flac|opus|aiff|aif)$");
    }

    private Doc findFolder(Uri tree, String parentId, String target, int depth, Set<String> visited) throws Exception {
        if (depth < 0 || !visited.add(parentId)) return null;
        List<Doc> children = listChildren(tree, parentId);
        for (Doc d : children) if (d.directory && sameName(d.name, target)) return d;
        if (depth == 0) return null;
        for (Doc d : children) {
            if (!d.directory) continue;
            if (depth == 2 && !sameName(d.name, "LOUVORES")) continue;
            Doc found = findFolder(tree, d.id, target, depth - 1, visited);
            if (found != null) return found;
        }
        return null;
    }

    private List<Doc> listChildren(Uri tree, String parentId) throws Exception {
        Uri childrenUri = DocumentsContract.buildChildDocumentsUriUsingTree(tree, parentId);
        String[] projection = new String[]{DocumentsContract.Document.COLUMN_DOCUMENT_ID, DocumentsContract.Document.COLUMN_DISPLAY_NAME, DocumentsContract.Document.COLUMN_MIME_TYPE, DocumentsContract.Document.COLUMN_SIZE, DocumentsContract.Document.COLUMN_LAST_MODIFIED};
        List<Doc> docs = new ArrayList<>();
        try (Cursor cursor = getContext().getContentResolver().query(childrenUri, projection, null, null, null)) {
            if (cursor == null) throw new IllegalStateException("A pasta do Drive não respondeu");
            while (cursor.moveToNext()) docs.add(docFromCursor(cursor));
        }
        return docs;
    }

    private Doc readDoc(Uri tree, String id) throws Exception {
        Uri uri = DocumentsContract.buildDocumentUriUsingTree(tree, id);
        String[] projection = new String[]{DocumentsContract.Document.COLUMN_DOCUMENT_ID, DocumentsContract.Document.COLUMN_DISPLAY_NAME, DocumentsContract.Document.COLUMN_MIME_TYPE, DocumentsContract.Document.COLUMN_SIZE, DocumentsContract.Document.COLUMN_LAST_MODIFIED};
        try (Cursor c = getContext().getContentResolver().query(uri, projection, null, null, null)) {
            if (c == null || !c.moveToFirst()) throw new IllegalStateException("A pasta do Drive não está disponível");
            return docFromCursor(c);
        }
    }

    private Doc docFromCursor(Cursor c) {
        Doc d = new Doc(); d.id = c.getString(0); d.name = c.getString(1); d.mime = c.getString(2); d.size = c.isNull(3) ? 0 : c.getLong(3); d.modified = c.isNull(4) ? 0 : c.getLong(4); d.directory = DocumentsContract.Document.MIME_TYPE_DIR.equals(d.mime); return d;
    }

    private Doc findChildByName(Uri tree, String parentId, String name, boolean folder) throws Exception {
        for (Doc d : listChildren(tree, parentId)) if (d.directory == folder && sameName(d.name, name)) return d;
        return null;
    }

    private String ensureFolder(Uri tree, String parentId, String name) throws Exception {
        Doc existing = findChildByName(tree, parentId, name, true); if (existing != null) return existing.id;
        Uri parentUri = DocumentsContract.buildDocumentUriUsingTree(tree, parentId);
        Uri created = DocumentsContract.createDocument(getContext().getContentResolver(), parentUri, DocumentsContract.Document.MIME_TYPE_DIR, name);
        if (created == null) throw new IllegalStateException("Sem permissão para criar a pasta _NEXO");
        return DocumentsContract.getDocumentId(created);
    }

    private String ensureFile(Uri tree, String parentId, String name, String mime) throws Exception {
        Doc existing = findChildByName(tree, parentId, name, false); if (existing != null) return existing.id;
        Uri parentUri = DocumentsContract.buildDocumentUriUsingTree(tree, parentId);
        Uri created = DocumentsContract.createDocument(getContext().getContentResolver(), parentUri, mime, name);
        if (created == null) throw new IllegalStateException("Sem permissão para criar o arquivo de configuração");
        return DocumentsContract.getDocumentId(created);
    }

    private void replaceDownloadedFile(File partial, File output) throws Exception {
        if (partial == null || !partial.exists() || partial.length() <= 0) throw new IllegalStateException("Download temporário inválido");
        File backup = new File(output.getParentFile(), output.getName() + ".previous");
        if (backup.exists()) backup.delete();
        boolean hadOld = output.exists();
        if (hadOld && !output.renameTo(backup)) throw new IllegalStateException("Não foi possível preservar o arquivo offline anterior");
        if (!partial.renameTo(output)) {
            if (hadOld && backup.exists()) backup.renameTo(output);
            throw new IllegalStateException("Não foi possível finalizar o arquivo baixado");
        }
        if (backup.exists()) backup.delete();
    }

    private long copyWithProgress(Uri source, File output, long alreadyCopied, long totalBytes, int current, int total, String bankName, String fileName) throws Exception {
        Exception last = null;
        final int attempts = 4;
        for (int attempt = 1; attempt <= attempts; attempt++) {
            try {
                return copyOnceWithProgress(source, output, alreadyCopied, totalBytes, current, total, bankName, fileName);
            } catch (Exception error) {
                last = error;
                if (output.exists()) output.delete();
                if (attempt < attempts) {
                    JSObject retry = new JSObject();
                    retry.put("stage", "retrying"); retry.put("bankName", bankName); retry.put("fileName", fileName); retry.put("current", current); retry.put("total", total); retry.put("bytes", alreadyCopied); retry.put("totalBytes", totalBytes); retry.put("attempt", attempt + 1); retry.put("attempts", attempts); retry.put("message", friendly(error));
                    notifyListeners("driveProgress", retry);
                    try { Thread.sleep(700L * attempt); } catch (InterruptedException interrupted) { Thread.currentThread().interrupt(); throw interrupted; }
                }
            }
        }
        throw new IllegalStateException(fileName + ": " + friendly(last), last);
    }

    private long copyOnceWithProgress(Uri source, File output, long alreadyCopied, long totalBytes, int current, int total, String bankName, String fileName) throws Exception {
        ContentResolver resolver = getContext().getContentResolver();
        InputStream input = null;
        ParcelFileDescriptor descriptor = null;
        long copied = 0, lastNotify = 0;
        try {
            try { input = resolver.openInputStream(source); }
            catch (Exception firstOpenError) {
                descriptor = resolver.openFileDescriptor(source, "r");
                if (descriptor == null) throw firstOpenError;
                input = new FileInputStream(descriptor.getFileDescriptor());
            }
            if (input == null) throw new IllegalStateException("Arquivo indisponível no Drive: " + fileName);
            try (FileOutputStream stream = new FileOutputStream(output, false)) {
                byte[] buffer = new byte[256 * 1024]; int read;
                while ((read = input.read(buffer)) != -1) {
                    stream.write(buffer, 0, read); copied += read;
                    if (copied - lastNotify >= 1024 * 1024) {
                        lastNotify = copied;
                        JSObject p = new JSObject(); p.put("stage", "downloading"); p.put("bankName", bankName); p.put("fileName", fileName); p.put("current", current); p.put("total", total); p.put("bytes", alreadyCopied + copied); p.put("totalBytes", totalBytes); notifyListeners("driveProgress", p);
                    }
                }
                stream.flush();
            }
            if (copied <= 0) throw new IllegalStateException("O Drive retornou um arquivo vazio: " + fileName);
            return copied;
        } finally {
            try { if (input != null) input.close(); } catch (Exception ignored) {}
            try { if (descriptor != null) descriptor.close(); } catch (Exception ignored) {}
        }
    }

    private void cleanupStaleFiles(File bankDir, JSArray files) {
        try {
            Set<String> keep = new HashSet<>();
            for (int i = 0; i < files.length(); i++) {
                Object raw = files.get(i);
                if (!(raw instanceof org.json.JSONObject)) continue;
                String uri = ((org.json.JSONObject) raw).optString("fileUri", "");
                if (!uri.isEmpty()) keep.add(new File(Uri.parse(uri).getPath()).getName());
            }
            File[] existing = bankDir.listFiles(); if (existing != null) for (File f : existing) if (f.isFile() && !keep.contains(f.getName())) f.delete();
        } catch (Exception ignored) {}
    }

    private byte[] readLimited(Uri uri, long max) throws Exception {
        try (InputStream input = getContext().getContentResolver().openInputStream(uri); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            if (input == null) throw new IllegalStateException("Configuração indisponível no Drive");
            byte[] buffer = new byte[32768]; int read; long total = 0;
            while ((read = input.read(buffer)) != -1) { total += read; if (total > max) throw new IllegalStateException("Configuração grande demais"); out.write(buffer, 0, read); }
            return out.toByteArray();
        }
    }

    private boolean sameName(String a, String b) { return a != null && b != null && normalize(a).equals(normalize(b)); }
    private String normalize(String value) { return value.toUpperCase(Locale.ROOT).replace('_',' ').replace('-',' ').trim().replaceAll("\\s+", " "); }
    private String safePart(String value) { String out = value == null ? "bank" : value.replaceAll("[^a-zA-Z0-9._-]+", "-"); return out.length() > 50 ? out.substring(0, 50) : out; }
    private String safeFileName(String value) { String out = value == null ? "audio" : value.replaceAll("[\\\\/:*?\"<>|]+", "-").trim(); return out.isEmpty() ? "audio" : out; }
    private String friendly(Exception error) { String m = error == null ? null : error.getMessage(); return m == null || m.trim().isEmpty() ? "erro desconhecido" : m; }
}
