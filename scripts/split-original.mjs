// One-time: split the original single-file whiteboard.html into project files.
// usage: node scripts/split-original.mjs ../whiteboard.html
import fs from 'node:fs';
import path from 'node:path';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const src = fs.readFileSync(process.argv[2], 'utf8');
const lines = src.split('\n');
const find = (re, from = 0) => lines.findIndex((l, i) => i >= from && re.test(l));
const sOpen = find(/^<style>$/), sClose = find(/^<\/style>$/);
const jOpen = find(/^<script>$/), jClose = find(/^<\/script>$/, jOpen);
const css = lines.slice(sOpen + 1, sClose).join('\n') + '\n';
const head = lines.slice(0, sOpen);
const body = lines.slice(sClose + 1, jOpen);
let code = lines.slice(jOpen + 1, jClose);
const take = name => {
  const i = code.findIndex(l => l.startsWith(`const ${name} = `));
  if (i < 0) throw new Error('missing ' + name);
  const json = code[i].slice(`const ${name} = `.length).replace(/;\s*(\/\/.*)?$/, '');
  code.splice(i, 1);
  return JSON.parse(json);
};
const BOOK = take('BOOK'), PDF_IMGS = take('PDF_IMGS'), OLD_TEXT = take('OLD_TEXT');
// pull base64 images out into files
for (const m of PDF_IMGS) {
  const mm = /^data:image\/(jpeg|png);base64,(.*)$/.exec(m.src || '');
  if (!mm) continue;
  const file = `img/${m.id}.${mm[1] === 'jpeg' ? 'jpg' : 'png'}`;
  fs.writeFileSync(path.join(root, file), Buffer.from(mm[2], 'base64'));
  m.src = file;
}
const w = (f, d) => fs.writeFileSync(path.join(root, f), d);
w('data/book.json', JSON.stringify(BOOK, null, 1));
w('data/pdf-imgs.json', JSON.stringify(PDF_IMGS, null, 1));
w('data/old-text.json', JSON.stringify(OLD_TEXT, null, 1));
w('css/style.css', css);
w('js/app.js', code.join('\n') + '\n');
w('_head.html', head.join('\n'));
w('_body.html', body.join('\n'));
console.log('ok', PDF_IMGS.length, 'imgs,', BOOK.mats?.length, 'mats');
