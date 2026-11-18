// 把《腹部課本》的分層圖解（每個部分標了 data-s 步驟）換進白板的「圖解」卡。
// usage: node scripts/import-book-figs.mjs <放 ch1.html…ch5.html 的資料夾>
// 會改寫 data/book.json 裡 kind:'fig' 的 svg 與 steps，並產生 css/figure.css（課本的圖解配色，限定在 .figsvg 內）。
import fs from 'node:fs';
import path from 'node:path';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const dir = process.argv[2];
if (!dir) { console.error('usage: node scripts/import-book-figs.mjs <dir>'); process.exit(1); }

const unesc = s => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const strip = s => s.replace(/<[^>]+>/g, '').trim();

const figs = [];
const vars = new Map();
const rules = new Set();
for (let n = 1; n <= 5; n++) {
  const html = fs.readFileSync(path.join(dir, `ch${n}.html`), 'utf8');
  const re = /<section class="fig" data-steps="([^"]*)" id="([^"]*)">([\s\S]*?)<\/section>/g;
  let m;
  while ((m = re.exec(html))) {
    const body = m[3];
    const svg = (body.match(/<svg[\s\S]*?<\/svg>/) || [])[0];
    figs.push({
      ch: 'a' + n,
      bookId: m[2],
      steps: JSON.parse(unesc(m[1])),
      title: strip((body.match(/<h2>([\s\S]*?)<\/h2>/) || [])[1] || ''),
      svg,
      layers: (svg.match(/data-s="/g) || []).length,
    });
  }
  // 圖解用到的 CSS 變數（只取淺色，白板沒有深色模式）與 svg 規則
  const css = [...html.matchAll(/<style>([\s\S]*?)<\/style>/g)].map(x => x[1]).join('\n');
  const light = css
    .replace(/@media \(prefers-color-scheme:\s*dark\)\{[^{}]*\{[^}]*\}\s*\}/g, '')
    .replace(/:root\[data-theme="dark"\][^{]*\{[^}]*\}/g, '');
  for (const v of light.matchAll(/(--(?:t|c|a)-[a-z0-9]+)\s*:\s*([^;}]+)/g)) if (!vars.has(v[1])) vars.set(v[1], v[2].trim());
  for (const line of css.split('\n')) {
    if (/^@media \(prefers-reduced-motion/.test(line) && line.includes('svg')) { rules.add(line.trim()); continue; }
    for (const r of line.matchAll(/(?:^|\s|\})(svg\s[^{}]*\{[^}]*\})/g)) rules.add(r[1].trim());
  }
}

const bookPath = path.join(root, 'data/book.json');
const book = JSON.parse(fs.readFileSync(bookPath, 'utf8'));
const mats = book.mats.filter(m => m.kind === 'fig');
const used = new Set();
let ok = 0;
for (const m of mats) {
  const f = figs.find(f => !used.has(f) && f.ch === m.ch && f.title === m.title)
        || figs.find(f => !used.has(f) && f.ch === m.ch && f.steps.length === m.steps.length && f.steps[1]?.[0] === m.steps[1]?.[0]);
  if (!f) { console.warn('沒有對應的課本圖：', m.id, m.title); continue; }
  used.add(f);
  if (!f.layers) console.warn('課本圖沒有圖層：', m.id, m.title);
  m.svg = f.svg;
  m.steps = f.steps;
  ok++;
}
for (const f of figs) if (!used.has(f)) console.warn('課本圖沒有用到：', f.ch, f.title);
fs.writeFileSync(bookPath, JSON.stringify(book, null, 1));

// 課本的 svg 規則原本是全域的 "svg .x"，這裡限定在白板的 .figsvg / .pv-fig 內，避免影響白板自己的 svg
const scope = sel => sel.split(',').map(s => s.trim().replace(/^svg\b/, '.figsvg svg')).join(',')
  + ',' + sel.split(',').map(s => s.trim().replace(/^svg\b/, '.pv-fig svg')).join(',');
const out = [
  '/* 由 scripts/import-book-figs.mjs 產生：《腹部課本》圖解的配色與樣式，限定在 .figsvg / .pv-fig 內 */',
  `.figsvg,.pv-fig{--surface:#fff;--bg:#f5f6fa;--ink:#1e1c2e;--muted:#5e5b74;--line:#dddbe9;--hema:#4a3e8e;--eosin:#c2506f;--hema-soft:#ebe8f7;--pale:#f1eff8;${[...vars].map(([k, v]) => `${k}:${v}`).join(';')}}`,
  '.figsvg svg,.pv-fig svg{color:var(--ink)}',
];
for (const r of rules) {
  if (r.startsWith('@media')) {
    out.push(r.replace(/svg ([^{,}]+)\{/g, (_, s) => `.figsvg svg ${s},.pv-fig svg ${s}{`));
    continue;
  }
  const i = r.indexOf('{');
  out.push(scope(r.slice(0, i)) + r.slice(i));
}
fs.writeFileSync(path.join(root, 'css/figure.css'), out.join('\n') + '\n');
console.log(`課本圖 ${figs.length} 張（有圖層 ${figs.filter(f => f.layers).length}），換進白板 ${ok}/${mats.length} 張；CSS 變數 ${vars.size}、規則 ${rules.size} 條`);
