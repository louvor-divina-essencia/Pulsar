import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const web = path.join(root, 'web');
fs.mkdirSync(web, { recursive: true });
for (const file of ['index.html','styles.css','pulsar-2.1.css','app.js','manifest.json']) {
  const src = path.join(root, file);
  const dst = path.join(web, file);
  fs.copyFileSync(src, dst);
}
const assetsSrc = path.join(root, 'assets');
const assetsDst = path.join(web, 'assets');
if (fs.existsSync(assetsSrc)) fs.cpSync(assetsSrc, assetsDst, { recursive:true, force:true });
console.log('Web preparado em', web);
