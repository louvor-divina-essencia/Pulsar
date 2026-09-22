import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const read = file => fs.readFileSync(file, 'utf8');
const html = read('index.html');
const js = read('app.js');
const ids = [...html.matchAll(/\bid=["']([^"']+)["']/g)].map(match => match[1]);
assert.equal(new Set(ids).size, ids.length, 'Há IDs duplicados no HTML');
const handlers = [...js.matchAll(/\$\(['"]#([^'"]+)['"]\)\.(?:onclick|onchange|oninput|onkeydown|onsubmit|addEventListener)/g)].map(match => match[1]);
for (const id of handlers) assert(ids.includes(id), `Elemento ausente para evento: ${id}`);

for (const file of ['styles.css', 'pulsar-2.1.css', 'manifest.json', 'assets/icon.png', 'android/gradlew', 'android/gradle/wrapper/gradle-wrapper.jar']) {
  assert(fs.statSync(file).size > 0, `Arquivo obrigatório vazio: ${file}`);
}
const config = JSON.parse(read('capacitor.config.json'));
assert.equal(config.appId, 'br.com.utilitypad.app');
assert.equal(config.webDir, 'web');
const nativeRoot = 'android/app/src/main/java/br/com/utilitypad/app';
const main = read(path.join(nativeRoot, 'MainActivity.java'));
for (const plugin of ['MediaLibraryPlugin', 'NexoDrivePlugin', 'NexoSyncPlugin']) {
  assert(main.includes(`registerPlugin(${plugin}.class)`), `Plugin não registrado: ${plugin}`);
  assert(fs.statSync(path.join(nativeRoot, `${plugin}.java`)).size > 0);
}
const gradle = read('android/app/build.gradle');
assert(gradle.includes('applicationIdSuffix ".preview"'), 'APK de teste deve ser separado');
const manifest = read('android/app/src/main/AndroidManifest.xml');
assert(manifest.includes('${applicationId}.fileprovider'), 'Provider deve acompanhar o applicationId');
assert(manifest.includes('${pulsarAppLabel}'), 'Nome do app deve distinguir a versão de teste');
console.log(`Verificações estáticas OK: ${ids.length} IDs, ${handlers.length} eventos e 3 plugins. Não substitui testes de áudio em dispositivo.`);
