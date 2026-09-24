import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const web = path.join(root, 'web');
fs.mkdirSync(web, { recursive: true });
for (const file of ['index.html','styles.css','pulsar-2.1.css','app.js','manifest.json','player-v21-upgrade.js','player-v21-upgrade.css','pulsar-drive-v22.js','pulsar-layout-v22.css']) {
  const src = path.join(root, file);
  const dst = path.join(web, file);
  fs.copyFileSync(src, dst);
}

const indexPath = path.join(web, 'index.html');
let html = fs.readFileSync(indexPath, 'utf8');
html = html.replace('</head>', '  <link rel="stylesheet" href="player-v21-upgrade.css">\n  <link rel="stylesheet" href="pulsar-layout-v22.css">\n</head>');
html = html.replace('<script src="app.js"></script>', '<script src="app.js"></script>\n  <script src="player-v21-upgrade.js"></script>\n  <script src="pulsar-drive-v22.js"></script>');
fs.writeFileSync(indexPath, html, 'utf8');

const assetsSrc = path.join(root, 'assets');
const assetsDst = path.join(web, 'assets');
if (fs.existsSync(assetsSrc)) fs.cpSync(assetsSrc, assetsDst, { recursive:true, force:true });
console.log('Web preparado em', web);
