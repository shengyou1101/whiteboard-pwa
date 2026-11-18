// 產生 sw.js：列出所有要離線快取的檔案，並用檔案內容的雜湊當版本號。
// 任何檔案改了，版本號就會變，iPad 下次開啟時會自動更新。
// usage: node scripts/build-sw.mjs
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const dirs = ['css', 'js', 'data', 'img', 'icons'];
const files = ['index.html', 'manifest.webmanifest'];
for (const d of dirs)
  for (const f of fs.readdirSync(path.join(root, d)).sort())
    if (!f.startsWith('.')) files.push(`${d}/${f}`);
const h = crypto.createHash('sha256');
for (const f of files) { h.update(f); h.update(fs.readFileSync(path.join(root, f))); }
const version = h.digest('hex').slice(0, 10);
const tpl = fs.readFileSync(path.join(root, 'scripts/sw.template.js'), 'utf8');
const out = tpl.replace('__VERSION__', version)
  .replace('__FILES__', JSON.stringify(['./', ...files], null, 2));
fs.writeFileSync(path.join(root, 'sw.js'), out);
console.log(`sw.js: ${files.length + 1} files, version ${version}`);
