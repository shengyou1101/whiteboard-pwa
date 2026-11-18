import { loadBoard, saveBoard, askPersist } from './storage.js';

// 內容資料（原本內嵌在 HTML 裡）
const getJSON = p => fetch(p).then(r => { if (!r.ok) throw new Error(p + ' ' + r.status); return r.json(); });
const [BOOK, PDF_IMGS, OLD_TEXT] = await Promise.all([
  getJSON('data/book.json'), getJSON('data/pdf-imgs.json'), getJSON('data/old-text.json'),
]);   // OLD_TEXT: earlier hand-made cards: still render on old boards, hidden from the shelf
const KINDS = {
  fig:{n:'圖解',c:'#4a3e8e'}, ask:{n:'問題',c:'#c2506f'}, one:{n:'重點',c:'#2f6fde'}, table:{n:'表格',c:'#0f766e'},
  box:{n:'框格',c:'#a16207'}, flow:{n:'流程',c:'#0e7490'}, warn:{n:'易混',c:'#d9480f'}, link:{n:'串聯',c:'#7c3aed'},
  img:{n:'原圖',c:'#57534e'}, text:{n:'知識卡',c:'#57534e'}
};
const KIND_ORDER = ['fig','ask','one','table','box','flow','warn','link','img','text'];
const CH = {};
BOOK.chapters.forEach(c => { CH[c.id] = c; c.secMap = {}; c.secs.forEach(s => c.secMap[s.id] = s); });
const GROUPS = [{id:'all', name:'全部'}, ...BOOK.chapters.map(c => ({id:c.id, name:c.name, full:c.title})), {id:'pdf', name:'共筆原圖'}, {id:'mine', name:'我的素材'}];
const PDF_SECS = {dev:'腹股溝管的發育（共筆原圖）', canal:'腹股溝管（共筆原圖）'};
BOOK.mats.forEach(m => { m.grp = m.ch + ':' + m.sec; });
PDF_IMGS.forEach(m => { m.kind = 'img'; m.ch = 'pdf'; m.grp = 'pdf:' + m.sec; });
OLD_TEXT.forEach(m => { m.kind = 'text'; m.ch = 'old'; m.grp = 'old'; m.hidden = true; });
function normMat(m){ if(!m.kind) m.kind = m.type === 'img' ? 'img' : 'text'; m.ch = 'mine'; m.grp = 'mine'; m.sec = 'mine'; return m; }
const PEN_COLORS = ['#1f2328','#e5484d','#2f6fde','#2f9e44'];
const HL_COLORS = ['#ffd60a','#7ee081','#ff9ec4','#8ecbff'];

/* ---------------- state ---------------- */
let S = {items:[], strokes:[], links:[]};
let custom = [];         // user materials
let view = {x:40, y:80, s:0.8};
let tool = 'select';
let penColor = PEN_COLORS[0], hlColor = HL_COLORS[0];
let selected = null;     // {type:'item'|'link', id}
let filter = 'a1', kfilter = 'all', query = '', hidePlaced = false;
let penSeen = false, spaceDown = false;
let undoStack = [], redoStack = [];
let uid = Date.now() % 100000;
const nid = p => p + (++uid).toString(36) + Math.random().toString(36).slice(2,5);

const $ = id => document.getElementById(id);
const vp = $('viewport'), world = $('world');
const itemEls = {};

function allMats(){ return [...BOOK.mats, ...PDF_IMGS, ...OLD_TEXT, ...custom]; }
let MI = null;
function matById(id){ if(!MI) MI = new Map(allMats().map(m => [m.id, m])); return MI.get(id); }
function customChanged(){ MI = null; renderShelf(); save(); }
function grpInfo(grp){
  if(grp === 'mine') return {num:'', title:'我的素材', src:''};
  const [ch, sec] = grp.split(':');
  if(ch === 'pdf') return {num:'原圖', title:PDF_SECS[sec] || '共筆原圖', src:'共筆 abdomen 2'};
  const c = CH[ch], s = c && c.secMap[sec];
  return s ? {num: s.num, title: s.title, src: s.src, ch: c} : {num:'', title:grp, src:''};
}
function tagLabel(m){
  if(m.ch && CH[m.ch]){ const g = grpInfo(m.grp); return `${CH[m.ch].name}・${g.title}`; }
  return m.title;
}
function getItem(id){ return S.items.find(i => i.id === id); }

/* ---------------- persistence ---------------- */
let saveT = null, storageOK = true;
function flushSave(){
  clearTimeout(saveT); saveT = null;
  return saveBoard({S, custom, view}).then(() => {
    storageOK = true;
    setStatus('已自動儲存在這個瀏覽器');
  }, e => {
    storageOK = false;
    console.error(e);
    setStatus('⚠ 無法自動儲存（空間不足或瀏覽器限制）— 可用「⋯ → 備份」');
  });
}
function save(){
  clearTimeout(saveT);
  saveT = setTimeout(flushSave, 400);
}
// 切到背景或關掉 App 前，把還沒寫入的變更立刻存起來
document.addEventListener('visibilitychange', () => { if(document.visibilityState === 'hidden' && saveT) flushSave(); });
window.addEventListener('pagehide', () => { if(saveT) flushSave(); });
async function load(){
  try{
    const d = await loadBoard();
    if(!d) return false;
    if(d.S){ S = d.S; S.items ||= []; S.strokes ||= []; S.links ||= []; }
    if(d.custom) custom = d.custom.map(normMat);
    if(d.view) view = d.view;
    return true;
  }catch(e){ console.error(e); return false; }
}
function setStatus(t){ $('status').textContent = t; }

/* ---------------- undo ---------------- */
function snap(){ return JSON.stringify(S); }
let pending = null;
function begin(){ pending = snap(); }
function commit(){
  if(pending === null) return;
  const now = snap();
  if(now !== pending){ undoStack.push(pending); if(undoStack.length > 80) undoStack.shift(); redoStack = []; save(); }
  pending = null;
}
function undo(){ if(!undoStack.length) return; redoStack.push(snap()); S = JSON.parse(undoStack.pop()); selected = null; renderAll(); save(); }
function redo(){ if(!redoStack.length) return; undoStack.push(snap()); S = JSON.parse(redoStack.pop()); selected = null; renderAll(); save(); }

/* ---------------- view ---------------- */
function applyView(){
  world.style.transform = `translate(${view.x}px,${view.y}px) scale(${view.s})`;
  const g = 24 * view.s;
  vp.style.backgroundSize = `${g}px ${g}px`;
  vp.style.backgroundPosition = `${view.x}px ${view.y}px`;
  $('zpct').textContent = Math.round(view.s * 100) + '%';
}
function vpRect(){ return vp.getBoundingClientRect(); }
function toWorld(cx, cy){ const r = vpRect(); return {x:(cx - r.left - view.x) / view.s, y:(cy - r.top - view.y) / view.s}; }
function zoomAt(sx, sy, f){
  const ns = Math.min(4, Math.max(0.12, view.s * f));
  const wx = (sx - view.x) / view.s, wy = (sy - view.y) / view.s;
  view.x = sx - wx * ns; view.y = sy - wy * ns; view.s = ns;
  applyView(); save();
}
function bbox(){
  let x1=Infinity,y1=Infinity,x2=-Infinity,y2=-Infinity;
  for(const it of S.items){ const r = rectOf(it.id); if(!r) continue; x1=Math.min(x1,r.x); y1=Math.min(y1,r.y-24); x2=Math.max(x2,r.x+r.w); y2=Math.max(y2,r.y+r.h); }
  for(const s of S.strokes) for(const [x,y] of s.pts){ x1=Math.min(x1,x); y1=Math.min(y1,y); x2=Math.max(x2,x); y2=Math.max(y2,y); }
  return x1===Infinity ? null : {x:x1,y:y1,w:x2-x1,h:y2-y1};
}
function fit(){
  const b = bbox(); const r = vpRect();
  if(!b){ view = {x:40,y:80,s:0.8}; applyView(); return; }
  const pad = 80;
  const s = Math.min(1.6, Math.max(0.12, Math.min((r.width - pad*2) / b.w, (r.height - pad*2 - 40) / b.h)));
  view.s = s; view.x = (r.width - b.w*s)/2 - b.x*s; view.y = (r.height - b.h*s)/2 - b.y*s + 20;
  applyView(); save();
}
function focusItem(id){
  const r = rectOf(id); if(!r) return;
  const vr = vpRect(); const s = Math.max(view.s, 0.7);
  view.s = s; view.x = vr.width/2 - (r.x + r.w/2)*s; view.y = vr.height/2 - (r.y + r.h/2)*s;
  applyView(); select({type:'item', id}); save();
}

/* ---------------- rendering ---------------- */
function esc(s){ return String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
function bodyHTML(m){
  if(m.html) return m.html;
  const l = m.body || [];
  return l.length > 1 ? '<ul>' + l.map(x => `<li>${esc(x)}</li>`).join('') + '</ul>' : `<p>${esc(l[0] || '')}</p>`;
}
const kc = k => (KINDS[k] || KINDS.text).c;
function kindChip(k){ return `<span class="kchip" style="--kc:${kc(k)}">${(KINDS[k] || KINDS.text).n}</span>`; }
function matBoardHTML(m){
  if(m.kind === 'img') return `<img src="${m.src}" alt="">`;
  if(m.kind === 'fig') return `<div class="fcard"><div class="fh">${kindChip('fig')}<h4>${esc(m.title)}</h4></div><div class="figsvg">${m.svg}</div>${m.take ? `<p class="take">${esc(m.take)}</p>` : ''}</div>`;
  return `<div class="tcard k-${m.kind}"><div class="fh">${kindChip(m.kind)}<h4>${esc(m.title)}</h4></div><div class="cb">${bodyHTML(m)}</div></div>`;
}

function renderItems(){
  $('frames').innerHTML = ''; $('items').innerHTML = '';
  for(const k in itemEls) delete itemEls[k];
  let fn = 0;
  for(const it of S.items){
    const el = document.createElement('div');
    el.dataset.id = it.id;
    if(it.kind === 'frame'){
      fn++;
      el.className = 'frame';
      el.innerHTML = `<div class="fhead"><span class="fnum">第 ${fn} 節</span><span class="ftitle">${esc(it.title || '')}</span></div><button class="xbtn" title="刪除區塊">×</button><div class="rz"></div>`;
      $('frames').appendChild(el);
    } else if(it.kind === 'note'){
      el.className = 'item note';
      el.innerHTML = `<div class="txt"></div><button class="xbtn" title="刪除">×</button><div class="rz"></div>`;
      el.querySelector('.txt').textContent = it.text || '';
      $('items').appendChild(el);
    } else {
      const m = matById(it.matId);
      if(!m) continue;
      el.className = 'item mat' + (m.kind === 'img' ? '' : m.kind === 'fig' ? ' fig' : ' text');
      el.style.setProperty('--kc', kc(m.kind));
      el.innerHTML = matBoardHTML(m)
        + `<div class="tag">${esc(tagLabel(m))}</div><button class="xbtn" title="從白板移除（素材會回到右邊）">×</button><div class="rz"></div>`;
      $('items').appendChild(el);
    }
    itemEls[it.id] = el;
    placeEl(it);
    const im = el.querySelector('img'); if(im && !im.complete) im.addEventListener('load', () => renderLinks(), {once:true});
  }
  markSelection();
}
function placeEl(it){
  const el = itemEls[it.id]; if(!el) return;
  el.style.left = it.x + 'px'; el.style.top = it.y + 'px'; el.style.width = it.w + 'px';
  if(it.kind === 'frame') el.style.height = it.h + 'px';
}
function rectOf(id){
  const it = getItem(id), el = itemEls[id];
  if(!it || !el) return null;
  return {x:it.x, y:it.y, w:el.offsetWidth || it.w, h: it.kind === 'frame' ? it.h : (el.offsetHeight || 80)};
}
function edgePt(r, tx, ty, pad){
  const cx = r.x + r.w/2, cy = r.y + r.h/2, dx = tx - cx, dy = ty - cy;
  if(!dx && !dy) return {x:cx, y:cy};
  const hw = r.w/2 + pad, hh = r.h/2 + pad;
  const t = Math.min(dx ? hw/Math.abs(dx) : Infinity, dy ? hh/Math.abs(dy) : Infinity);
  return {x: cx + dx*t, y: cy + dy*t};
}
function linkGeom(l){
  const a = rectOf(l.from), b = rectOf(l.to);
  if(!a || !b) return null;
  const p1 = edgePt(a, b.x + b.w/2, b.y + b.h/2, 6), p2 = edgePt(b, a.x + a.w/2, a.y + a.h/2, 8);
  return {p1, p2, mx:(p1.x+p2.x)/2, my:(p1.y+p2.y)/2};
}
function renderLinks(){
  const lg = $('lg'), lb = $('labels');
  let svg = '', html = '';
  S.links = S.links.filter(l => getItem(l.from) && getItem(l.to));
  for(const l of S.links){
    const g = linkGeom(l); if(!g) continue;
    const sel = selected && selected.type === 'link' && selected.id === l.id;
    const d = `M${g.p1.x} ${g.p1.y} L${g.p2.x} ${g.p2.y}`;
    svg += `<path class="lline${sel?' sel':''}" d="${d}" marker-end="url(#${sel?'arrS':'arr'})"/><path class="lhit" data-link="${l.id}" d="${d}"/>`;
    if(editingLink === l.id) continue;
    html += `<div class="lbl${l.label ? '' : ' empty'}${sel ? ' sel show' : ''}" data-link="${l.id}" style="left:${g.mx}px;top:${g.my}px">${l.label ? esc(l.label) : '✎'}</div>`;
  }
  lg.innerHTML = svg;
  [...lb.querySelectorAll('.lbl:not(.editing)')].forEach(n => n.remove());
  lb.insertAdjacentHTML('beforeend', html);
}
function pathD(p){
  if(p.length === 1){ const [x,y] = p[0]; return `M${x} ${y}L${x+.1} ${y+.1}`; }
  let d = `M${p[0][0]} ${p[0][1]}`;
  for(let i = 1; i < p.length - 1; i++){
    const mx = ((p[i][0] + p[i+1][0]) / 2).toFixed(1), my = ((p[i][1] + p[i+1][1]) / 2).toFixed(1);
    d += `Q${p[i][0]} ${p[i][1]} ${mx} ${my}`;
  }
  const l = p[p.length-1]; d += `L${l[0]} ${l[1]}`;
  return d;
}
function strokeAttrs(s){
  return s.hl ? `stroke="${s.color}" stroke-width="${s.w}" stroke-opacity=".42" style="mix-blend-mode:multiply"` : `stroke="${s.color}" stroke-width="${s.w}"`;
}
function renderInk(){
  $('ig').innerHTML = S.strokes.map(s => `<path d="${pathD(s.pts)}" fill="none" stroke-linecap="round" stroke-linejoin="round" ${strokeAttrs(s)}/>`).join('');
}
function renderAll(){
  renderItems(); renderInk();
  requestAnimationFrame(renderLinks);
  refreshShelf(); updateHint();
}
function updateHint(){ $('hint').style.display = (S.items.length || S.strokes.length) ? 'none' : ''; }
function markSelection(){
  for(const id in itemEls) itemEls[id].classList.toggle('sel', !!(selected && selected.type === 'item' && selected.id === id));
}
function select(sel){ selected = sel; markSelection(); renderLinks(); }

/* ---------------- shelf ---------------- */
function placedCount(){ return new Set(S.items.filter(i => i.kind === 'mat').map(i => i.matId)); }
const stripTags = s => String(s || '').replace(/<[^>]+>/g, ' ');
function searchText(m){ if(!m._s) m._s = (m.title + ' ' + stripTags(m.html) + ' ' + (m.take || '') + ' ' + (m.body || []).join(' ') + ' ' + grpInfo(m.grp).title).toLowerCase(); return m._s; }
function shelfMats(){
  const q = query.trim().toLowerCase();
  return allMats().filter(m => !m.hidden
    && (filter === 'all' || m.ch === filter)
    && (kfilter === 'all' || m.kind === kfilter)
    && (!q || q.split(/\s+/).every(w => searchText(m).includes(w))));
}
function shelfCardHTML(m){
  let pv;
  if(m.kind === 'img') pv = `<img src="${m.src}" alt="">`;
  else if(m.kind === 'fig') pv = `<div class="pv-fig">${m.svg}</div>`;
  else pv = `<div class="tprev" style="--kc:${kc(m.kind)}"><div class="cb">${bodyHTML(m)}</div></div>`;
  return pv + `<div class="mt">${kindChip(m.kind)}<span title="${esc(m.title)}">${esc(m.title)}</span>`
    + `<span class="badge">✓ 已放上</span><button class="mini b-find" data-act="find">找到</button><button class="mini b-add" data-act="add">＋ 放上</button></div>`
    + (m.ch === 'mine' ? `<button class="del" data-act="delmat" title="從素材庫刪除">×</button>` : '');
}
function renderShelf(){
  $('chips').innerHTML = GROUPS.map(g => `<button class="chip${filter === g.id ? ' on' : ''}" data-f="${g.id}" title="${esc(g.full || g.name)}">${g.name}</button>`).join('');
  const present = new Set(allMats().filter(m => !m.hidden && (filter === 'all' || m.ch === filter)).map(m => m.kind));
  $('kchips').innerHTML = `<button class="chip${kfilter === 'all' ? ' on' : ''}" data-k="all">全部類型</button>`
    + KIND_ORDER.filter(k => present.has(k)).map(k => `<button class="chip${kfilter === k ? ' on' : ''}" data-k="${k}"><i style="background:${kc(k)}"></i>${KINDS[k].n}</button>`).join('');
  const ms = shelfMats(), list = $('mlist');
  let html = '', cur = null;
  for(const m of ms){
    if(m.grp !== cur){
      if(cur !== null) html += '</div>';
      cur = m.grp; const g = grpInfo(cur);
      const chName = g.ch && filter === 'all' ? `${g.ch.name}・` : '';
      html += `<div class="grp" data-grp="${esc(cur)}"><div class="secHead"><div>${g.num ? `<span class="snum">${esc(g.num)}</span>` : ''}${esc(chName + g.title)}${g.src ? `<small>${esc(g.src)}</small>` : ''}</div>`
        + (cur !== 'mine' ? `<button class="bulk" data-bulk="${esc(cur)}" title="把這一節還沒放上的卡片，整齊排進一個新區塊">整節放上</button>` : '') + `</div>`;
    }
    html += `<div class="mcard" data-mat="${esc(m.id)}">${shelfCardHTML(m)}</div>`;
  }
  if(cur !== null) html += '</div>';
  list.innerHTML = html || `<div style="text-align:center;color:var(--muted);font-size:13px;padding:30px 10px">${filter === 'mine' && !query ? '還沒有自己的素材<br>上傳或貼上一張課本截圖試試看' : '找不到符合的素材'}</div>`;
  list.scrollTop = 0;
  refreshShelf();
}
function refreshShelf(){
  const placed = placedCount();
  let shown = 0;
  for(const g of $('mlist').querySelectorAll('.grp')){
    let vis = 0;
    for(const c of g.querySelectorAll('.mcard')){
      const p = placed.has(c.dataset.mat);
      c.classList.toggle('placed', p);
      const hid = hidePlaced && p; c.classList.toggle('hid', hid);
      if(!hid) vis++;
    }
    g.classList.toggle('hid', !vis); shown += vis;
  }
  $('cnt').textContent = `${shown} 項`;
  const scope = allMats().filter(m => !m.hidden && (filter === 'all' || m.ch === filter));
  const total = scope.length, done = scope.filter(m => placed.has(m.id)).length;
  const gname = filter === 'all' ? '全部' : (GROUPS.find(g => g.id === filter) || {}).name;
  $('progbar').style.width = total ? (done / total * 100) + '%' : '0';
  $('progtxt').textContent = `${gname}：已放上 ${done} / ${total}`;
  $('progmsg').textContent = !total || done === 0 ? '' : done === total ? '🎉 這一區全部排好了！' : done >= total / 2 ? '過半了，架構越來越清楚 💪' : '好的開始 ✨';
}
$('chips').addEventListener('click', e => { const b = e.target.closest('[data-f]'); if(b){ filter = b.dataset.f; kfilter = 'all'; renderShelf(); } });
$('kchips').addEventListener('click', e => { const b = e.target.closest('[data-k]'); if(b){ kfilter = b.dataset.k; renderShelf(); } });
let qT = null;
$('search').addEventListener('input', e => { clearTimeout(qT); qT = setTimeout(() => { query = e.target.value; renderShelf(); }, 160); });
$('hidePlaced').addEventListener('change', e => { hidePlaced = e.target.checked; refreshShelf(); });

function defaultWidth(m){
  if(m.kind === 'img') return Math.min(460, Math.max(260, (m.w || 400) * 0.55));
  if(m.kind === 'fig' || m.kind === 'table') return 470;
  return 320;
}
function addMatToBoard(matId, wx, wy, center){
  const m = matById(matId); if(!m) return;
  begin();
  const w = defaultWidth(m);
  const h = m.kind === 'img' && m.w ? w * m.h / m.w : m.kind === 'fig' ? w * 0.65 : 160;
  const it = {id:nid('i'), kind:'mat', matId, x: center ? wx - w/2 : wx, y: center ? wy - h/2 : wy, w};
  S.items.push(it);
  commit(); renderAll(); select({type:'item', id:it.id});
  if(placedCount().size === 1) toast('第一張卡片上板了！接下來想想：它跟什麼有關？');
  return it;
}
function focusRect(r){
  const vr = vpRect(), pad = 70;
  const s = Math.min(1.2, Math.max(0.15, Math.min((vr.width - pad*2) / r.w, (vr.height - pad*2 - 40) / r.h)));
  view.s = s; view.x = (vr.width - r.w*s)/2 - r.x*s; view.y = (vr.height - r.h*s)/2 - r.y*s + 24;
  applyView(); save();
}
function bulkPlace(grp){
  const placed = placedCount();
  const ms = allMats().filter(m => !m.hidden && m.grp === grp && !placed.has(m.id));
  const g = grpInfo(grp);
  if(!ms.length){ toast('這一節的卡片都已經在白板上了'); return; }
  begin();
  const b = bbox();
  const COLW = 440, GAP = 30, PAD = 36, TOP = 60;
  const ncol = Math.min(3, ms.length);
  let fx, fy;
  if(b){ fx = b.x + b.w + 160; fy = b.y; } else { const c = toWorld(vpRect().left + 60, vpRect().top + 110); fx = c.x; fy = c.y; }
  const its = ms.map(m => ({id:nid('i'), kind:'mat', matId:m.id, x:fx, y:fy, w:COLW}));
  S.items.push(...its);
  renderItems();
  const colH = Array(ncol).fill(0);
  for(const it of its){
    const h = itemEls[it.id] ? itemEls[it.id].offsetHeight : 200;
    const c = colH.indexOf(Math.min(...colH));
    it.x = fx + PAD + c * (COLW + GAP); it.y = fy + TOP + colH[c];
    colH[c] += h + GAP + 12;
  }
  const fr = {id:nid('f'), kind:'frame', x:fx, y:fy, w:PAD*2 + ncol*COLW + (ncol-1)*GAP, h:TOP + Math.max(...colH) - GAP + PAD, title:g.title};
  S.items.unshift(fr);
  commit(); renderAll(); select({type:'item', id:fr.id});
  focusRect({x:fr.x, y:fr.y - 30, w:fr.w, h:fr.h + 30});
  toast(`「${g.title}」的 ${ms.length} 張卡片放好了，接著用你的方式重排吧`);
}
/* shelf drag (pointer based – works with mouse, pen and finger) */
let sdrag = null;
$('mlist').addEventListener('pointerdown', e => {
  const bk = e.target.closest('[data-bulk]');
  if(bk){ e.preventDefault(); bulkPlace(bk.dataset.bulk); return; }
  const card = e.target.closest('.mcard'); if(!card) return;
  const act = e.target.closest('[data-act]');
  if(act){
    const id = card.dataset.mat, a = act.dataset.act;
    if(a === 'add'){ const c = viewCenterWorld(); addMatToBoard(id, c.x, c.y, true); }
    if(a === 'find'){ const it = S.items.find(i => i.matId === id); if(it) focusItem(it.id); }
    if(a === 'delmat') confirmBox('刪除這個素材？', '白板上用到它的卡片也會一起移除。', () => {
      begin(); custom = custom.filter(m => m.id !== id); S.items = S.items.filter(i => i.matId !== id); commit(); customChanged(); renderAll();
    });
    e.preventDefault(); return;
  }
  sdrag = {id:card.dataset.mat, sx:e.clientX, sy:e.clientY, started:false, pid:e.pointerId, card};
});
window.addEventListener('pointermove', e => {
  if(!sdrag || e.pointerId !== sdrag.pid) return;
  const dx = e.clientX - sdrag.sx, dy = e.clientY - sdrag.sy;
  if(!sdrag.started){
    const thresh = e.pointerType === 'touch' ? (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy)) : Math.hypot(dx,dy) > 6;
    if(!thresh) return;
    sdrag.started = true;
    try{ sdrag.card.setPointerCapture(e.pointerId); }catch(_){}
    const m = matById(sdrag.id), g = $('ghost');
    g.innerHTML = m.kind === 'img' ? `<img src="${m.src}">` : m.kind === 'fig' ? `<div class="pv-fig">${m.svg}</div>` : `<div class="gt">${kindChip(m.kind)} <b>${esc(m.title)}</b></div>`;
    g.style.display = 'block';
  }
  const g = $('ghost'); g.style.left = e.clientX + 'px'; g.style.top = e.clientY + 'px';
});
function endShelfDrag(e){
  if(!sdrag || e.pointerId !== sdrag.pid) return;
  const d = sdrag; sdrag = null; $('ghost').style.display = 'none';
  if(!d.started || e.type === 'pointercancel') return;
  const r = vpRect();
  if(e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom){
    const w = toWorld(e.clientX, e.clientY);
    addMatToBoard(d.id, w.x, w.y, true);
  }
}
window.addEventListener('pointerup', endShelfDrag);
window.addEventListener('pointercancel', endShelfDrag);

/* ---------------- own materials ---------------- */
function readImage(file){
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => {
      const img = new Image();
      img.onload = () => {
        const max = 1200, k = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement('canvas'); c.width = Math.round(img.width*k); c.height = Math.round(img.height*k);
        const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0,0,c.width,c.height); ctx.drawImage(img, 0, 0, c.width, c.height);
        res({src:c.toDataURL('image/jpeg', .86), w:c.width, h:c.height});
      };
      img.onerror = rej; img.src = fr.result;
    };
    fr.onerror = rej; fr.readAsDataURL(file);
  });
}
let shotN = 0;
async function addFiles(files, placeAt){
  const imgs = [...files].filter(f => f.type.startsWith('image/'));
  if(!imgs.length) return;
  let k = 0;
  for(const f of imgs){
    try{
      const d = await readImage(f);
      const name = (f.name && !/^image\.\w+$/.test(f.name)) ? f.name.replace(/\.[^.]+$/, '') : `我的截圖 ${custom.filter(m=>m.kind==='img').length + 1}`;
      const m = normMat({id:nid('m'), kind:'img', title:name, ...d});
      custom.push(m); MI = null;
      if(placeAt) addMatToBoard(m.id, placeAt.x + k*30, placeAt.y + k*30, true);
      k++;
    }catch(err){ toast('這個檔案讀不進來'); }
  }
  if(!placeAt){ filter = 'mine'; kfilter = 'all'; }
  customChanged();
  toast(placeAt ? `已加入 ${k} 張並放上白板` : `已加入 ${k} 張到「我的素材」`);
}
$('upBtn').onclick = () => $('fileIn').click();
$('fileIn').onchange = e => { addFiles(e.target.files); e.target.value = ''; };
$('tBtn').onclick = () => { $('tform').classList.add('open'); $('tTitle').focus(); };
$('tCancel').onclick = () => $('tform').classList.remove('open');
$('tAdd').onclick = () => {
  const t = $('tTitle').value.trim(), b = $('tBody').value.split('\n').map(s => s.trim()).filter(Boolean);
  if(!t && !b.length) return;
  custom.push(normMat({id:nid('m'), kind:'text', title:t || b[0], body: t ? b : b.slice(1)}));
  $('tTitle').value = ''; $('tBody').value = ''; $('tform').classList.remove('open');
  filter = 'mine'; kfilter = 'all'; customChanged(); toast('知識卡已加入「我的素材」');
};
document.addEventListener('paste', e => {
  if(isEditing()) return;
  const files = [...(e.clipboardData?.files || [])];
  if(files.length){ e.preventDefault(); addFiles(files); }
});
// drop image files from the computer
let dragDepth = 0;
document.addEventListener('dragenter', e => { if([...e.dataTransfer.types].includes('Files')){ dragDepth++; $('dropzone').style.display = 'flex'; } });
document.addEventListener('dragleave', () => { if(--dragDepth <= 0){ dragDepth = 0; $('dropzone').style.display = 'none'; } });
document.addEventListener('dragover', e => e.preventDefault());
document.addEventListener('drop', e => {
  e.preventDefault(); dragDepth = 0; $('dropzone').style.display = 'none';
  const r = vpRect(); const onBoard = e.clientX < r.right;
  addFiles(e.dataTransfer.files, onBoard ? toWorld(e.clientX, e.clientY) : null);
});

/* ---------------- tools ---------------- */
function setTool(t){
  tool = t;
  document.querySelectorAll('[data-tool]').forEach(b => b.classList.toggle('on', b.dataset.tool === t));
  vp.className = 't-' + t;
  renderSwatches();
  if(t !== 'select') stopEditing();
}
function renderSwatches(){
  const sw = $('swatches');
  if(tool === 'pen' || tool === 'hl'){
    const cols = tool === 'pen' ? PEN_COLORS : HL_COLORS, cur = tool === 'pen' ? penColor : hlColor;
    sw.innerHTML = cols.map(c => `<button class="sw${c === cur ? ' on' : ''}" data-c="${c}" style="background:${c}"></button>`).join('');
    sw.style.display = 'flex';
  } else sw.style.display = 'none';
}
$('swatches').addEventListener('click', e => { const b = e.target.closest('[data-c]'); if(!b) return; if(tool === 'pen') penColor = b.dataset.c; else hlColor = b.dataset.c; renderSwatches(); });
$('toolbar').addEventListener('click', e => { const b = e.target.closest('[data-tool]'); if(b) setTool(b.dataset.tool); });
$('undoBtn').onclick = undo; $('redoBtn').onclick = redo;
$('zin').onclick = () => { const r = vpRect(); zoomAt(r.width/2, r.height/2, 1.2); };
$('zout').onclick = () => { const r = vpRect(); zoomAt(r.width/2, r.height/2, 1/1.2); };
$('zfit').onclick = fit;
$('shelfToggle').onclick = () => {
  const closed = $('app').classList.toggle('shelf-closed');
  $('stIcon').textContent = closed ? '⟨' : '⟩'; $('stTxt').textContent = closed ? '素材庫' : '收起素材';
};

/* ---------------- editing text ---------------- */
let editingEl = null, editingLink = null;
function isEditing(){ const a = document.activeElement; return a && (a.isContentEditable || a.tagName === 'INPUT' || a.tagName === 'TEXTAREA'); }
function startEdit(itemId){
  const it = getItem(itemId), el = itemEls[itemId]; if(!it || !el) return;
  const t = el.querySelector(it.kind === 'frame' ? '.ftitle' : '.txt'); if(!t) return;
  stopEditing();
  begin();
  t.contentEditable = 'true'; editingEl = {t, it};
  t.focus();
  const r = document.createRange(); r.selectNodeContents(t); r.collapse(false);
  const s = getSelection(); s.removeAllRanges(); s.addRange(r);
  t.addEventListener('input', () => { if(it.kind === 'frame') it.title = t.textContent; else it.text = t.innerText; renderLinks(); });
  t.addEventListener('blur', stopEditing, {once:true});
  t.addEventListener('keydown', ev => { if(ev.key === 'Escape' || (it.kind === 'frame' && ev.key === 'Enter')){ ev.preventDefault(); t.blur(); } });
}
function stopEditing(){
  if(!editingEl) return;
  const {t, it} = editingEl; editingEl = null;
  t.contentEditable = 'false';
  if(it.kind === 'note' && !(it.text || '').trim()){ S.items = S.items.filter(i => i !== it); renderAll(); }
  commit();
}
function editLinkLabel(id){
  const l = S.links.find(x => x.id === id); if(!l) return;
  const g = linkGeom(l); if(!g) return;
  editingLink = id; renderLinks();
  const d = document.createElement('div');
  d.className = 'lbl sel editing'; d.style.left = g.mx + 'px'; d.style.top = g.my + 'px';
  d.innerHTML = `<input placeholder="它們的關係是？" value="${esc(l.label || '')}">`;
  $('labels').appendChild(d);
  const inp = d.querySelector('input'); setTimeout(() => { inp.focus(); inp.select(); }, 0);
  begin();
  const done = () => { l.label = inp.value.trim(); editingLink = null; d.remove(); commit(); renderLinks(); };
  inp.addEventListener('blur', done, {once:true});
  inp.addEventListener('keydown', ev => { if(ev.key === 'Enter' || ev.key === 'Escape') inp.blur(); });
}

/* ---------------- board pointer handling ---------------- */
const touches = new Map();
let act = null;   // current action
const lastTap = {};
vp.addEventListener('pointerdown', e => {
  if(e.target.closest('#toolbar,#zoombar,#shelfToggle')) return;
  if(e.target.closest('[contenteditable=true],input')) return;
  if(e.pointerType === 'pen') penSeen = true;
  if(e.pointerType === 'touch'){
    touches.set(e.pointerId, {x:e.clientX, y:e.clientY});
    if(touches.size === 2){ cancelAct(); startPinch(); return; }
    if(touches.size > 2) return;
  }
  if(isEditing()) document.activeElement.blur();
  const r = vpRect(), sx = e.clientX - r.left, sy = e.clientY - r.top, w = toWorld(e.clientX, e.clientY);
  const fingerPan = e.pointerType === 'touch' && penSeen && tool !== 'select' && tool !== 'hand';
  try{ vp.setPointerCapture(e.pointerId); }catch(_){}
  if(e.button === 1 || spaceDown || tool === 'hand' || fingerPan){ startPan(e, sx, sy); return; }

  if(tool === 'pen' || tool === 'hl'){
    const hl = tool === 'hl';
    act = {type:'draw', pid:e.pointerId, pts:[[+w.x.toFixed(1), +w.y.toFixed(1)]], hl, color: hl ? hlColor : penColor, w: hl ? 18 : 2.6};
    const live = $('live'); live.setAttribute('d', pathD(act.pts));
    live.setAttribute('stroke', act.color); live.setAttribute('stroke-width', act.w);
    live.setAttribute('stroke-opacity', hl ? .42 : 1); live.style.mixBlendMode = hl ? 'multiply' : '';
    return;
  }
  if(tool === 'eraser'){ begin(); act = {type:'erase', pid:e.pointerId}; eraseAt(w); return; }
  if(tool === 'text'){
    begin();
    const it = {id:nid('n'), kind:'note', x:w.x - 10, y:w.y - 20, w:220, text:''};
    e.preventDefault();
    S.items.push(it); commit(); renderAll(); setTool('select'); select({type:'item', id:it.id});
    startEdit(it.id);
    return;
  }
  if(tool === 'frame'){ act = {type:'frame', pid:e.pointerId, x0:w.x, y0:w.y, x1:w.x, y1:w.y}; return; }
  if(tool === 'link'){
    const el = e.target.closest('.item,.frame .fhead');
    const id = el && (el.closest('[data-id]') || {}).dataset?.id;
    if(!id){ startPan(e, sx, sy); return; }
    act = {type:'link', pid:e.pointerId, from:id};
    updateTmpLink(w); return;
  }
  // select tool
  const lblEl = e.target.closest('.lbl[data-link]');
  if(lblEl){ select({type:'link', id:lblEl.dataset.link}); act = {type:'tapLabel', pid:e.pointerId, id:lblEl.dataset.link}; return; }
  const hit = e.target.closest('.lhit');
  if(hit){ select({type:'link', id:hit.dataset.link}); act = {type:'none', pid:e.pointerId}; return; }
  if(e.target.closest('.xbtn')){ const id = e.target.closest('[data-id]').dataset.id; removeItem(id); act = {type:'none', pid:e.pointerId}; return; }
  const host = e.target.closest('[data-id]');
  if(host && (e.target.closest('.item') || e.target.closest('.fhead') || e.target.closest('.rz'))){
    const id = host.dataset.id, it = getItem(id);
    select({type:'item', id});
    if(it.kind !== 'frame' && !e.target.closest('.rz')){ S.items = S.items.filter(i => i !== it); S.items.push(it); itemEls[id].parentNode.appendChild(itemEls[id]); }
    begin();
    if(e.target.closest('.rz')){
      const r0 = rectOf(id);
      act = {type:'resize', pid:e.pointerId, it, w0:it.w, h0:r0.h, sx:w.x, sy:w.y};
    } else {
      const kids = [], kidStrokes = [];
      if(it.kind === 'frame'){
        for(const o of S.items){ if(o === it || o.kind === 'frame') continue; const ro = rectOf(o.id); if(!ro) continue; const cx = ro.x + ro.w/2, cy = ro.y + ro.h/2; if(cx > it.x && cx < it.x + it.w && cy > it.y && cy < it.y + it.h) kids.push({o, x:o.x, y:o.y}); }
        for(const s of S.strokes){ if(s.pts.every(([x,y]) => x > it.x && x < it.x + it.w && y > it.y && y < it.y + it.h)) kidStrokes.push({s, pts:s.pts.map(p => p.slice())}); }
      }
      act = {type:'move', pid:e.pointerId, it, x0:it.x, y0:it.y, sx:w.x, sy:w.y, kids, kidStrokes, moved:false, t0:Date.now()};
    }
    return;
  }
  select(null);
  startPan(e, sx, sy);
});

function startPan(e, sx, sy){ act = {type:'pan', pid:e.pointerId, sx, sy, vx:view.x, vy:view.y}; vp.classList.add('panning'); }
function startPinch(){
  const [a, b] = [...touches.values()];
  const r = vpRect();
  act = {type:'pinch', d0:Math.hypot(a.x-b.x, a.y-b.y), mx:(a.x+b.x)/2 - r.left, my:(a.y+b.y)/2 - r.top, v0:{...view}};
}
function cancelAct(){
  if(act && act.type === 'draw'){ $('live').setAttribute('d', ''); }
  if(act && act.type === 'frame'){ $('frameDraft').style.display = 'none'; }
  if(act && (act.type === 'move' || act.type === 'resize')){ commit(); }
  if(act && act.type === 'link'){ $('tmpLink').style.display = 'none'; }
  act = null; vp.classList.remove('panning');
}

vp.addEventListener('pointermove', e => {
  if(e.pointerType === 'touch' && touches.has(e.pointerId)) touches.set(e.pointerId, {x:e.clientX, y:e.clientY});
  if(!act) return;
  if(act.type === 'pinch'){
    if(touches.size < 2) return;
    const [a, b] = [...touches.values()]; const r = vpRect();
    const d = Math.hypot(a.x-b.x, a.y-b.y), mx = (a.x+b.x)/2 - r.left, my = (a.y+b.y)/2 - r.top;
    const ns = Math.min(4, Math.max(0.12, act.v0.s * d / act.d0));
    const wx = (act.mx - act.v0.x) / act.v0.s, wy = (act.my - act.v0.y) / act.v0.s;
    view.s = ns; view.x = mx - wx*ns; view.y = my - wy*ns; applyView(); return;
  }
  if(e.pointerId !== act.pid) return;
  const r = vpRect(), sx = e.clientX - r.left, sy = e.clientY - r.top;
  const w = toWorld(e.clientX, e.clientY);
  switch(act.type){
    case 'pan': view.x = act.vx + sx - act.sx; view.y = act.vy + sy - act.sy; applyView(); break;
    case 'draw': {
      const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
      for(const ce of evs){ const p = toWorld(ce.clientX, ce.clientY); const l = act.pts[act.pts.length-1];
        if(Math.hypot(p.x - l[0], p.y - l[1]) * view.s > 1.5) act.pts.push([+p.x.toFixed(1), +p.y.toFixed(1)]); }
      $('live').setAttribute('d', pathD(act.pts)); break;
    }
    case 'erase': eraseAt(w); break;
    case 'frame': {
      act.x1 = w.x; act.y1 = w.y;
      const fd = $('frameDraft'); fd.style.display = '';
      fd.setAttribute('x', Math.min(act.x0, act.x1)); fd.setAttribute('y', Math.min(act.y0, act.y1));
      fd.setAttribute('width', Math.abs(act.x1 - act.x0)); fd.setAttribute('height', Math.abs(act.y1 - act.y0)); break;
    }
    case 'link': updateTmpLink(w); break;
    case 'move': {
      const dx = w.x - act.sx, dy = w.y - act.sy;
      if(Math.hypot(dx, dy) * view.s > 3) act.moved = true;
      act.it.x = act.x0 + dx; act.it.y = act.y0 + dy; placeEl(act.it);
      for(const k of act.kids){ k.o.x = k.x + dx; k.o.y = k.y + dy; placeEl(k.o); }
      if(act.kidStrokes.length){ for(const k of act.kidStrokes) k.s.pts = k.pts.map(([x,y]) => [+(x+dx).toFixed(1), +(y+dy).toFixed(1)]); renderInk(); }
      renderLinks(); break;
    }
    case 'resize': {
      const it = act.it;
      it.w = Math.max(it.kind === 'frame' ? 160 : 120, act.w0 + (w.x - act.sx));
      if(it.kind === 'frame') it.h = Math.max(120, act.h0 + (w.y - act.sy));
      placeEl(it); renderLinks(); break;
    }
  }
});
function endPointer(e){
  if(e.pointerType === 'touch') touches.delete(e.pointerId);
  if(!act) return;
  if(act.type === 'pinch'){ if(touches.size < 2){ act = null; save(); } return; }
  if(e.pointerId !== act.pid) return;
  const a = act; act = null; vp.classList.remove('panning');
  switch(a.type){
    case 'pan': save(); break;
    case 'draw':
      $('live').setAttribute('d', '');
      if(e.type === 'pointercancel') break;
      begin(); S.strokes.push({id:nid('s'), pts:a.pts, color:a.color, w:a.w, hl:a.hl}); commit(); renderInk(); updateHint(); break;
    case 'erase': commit(); break;
    case 'frame': {
      $('frameDraft').style.display = 'none';
      let x = Math.min(a.x0, a.x1), y = Math.min(a.y0, a.y1), w = Math.abs(a.x1 - a.x0), h = Math.abs(a.y1 - a.y0);
      if(w < 40 || h < 40){ w = 720; h = 480; x = a.x0; y = a.y0; }
      begin();
      const n = S.items.filter(i => i.kind === 'frame').length + 1;
      const it = {id:nid('f'), kind:'frame', x, y, w, h, title:''};
      S.items.unshift(it); commit(); renderAll(); setTool('select'); select({type:'item', id:it.id});
      startEdit(it.id);
      toast(`第 ${n} 節開好了，幫它取個名字吧`);
      break;
    }
    case 'link': {
      $('tmpLink').style.display = 'none';
      const under = document.elementFromPoint(e.clientX, e.clientY);
      const host = under && under.closest('[data-id]');
      const to = host && host.dataset.id;
      if(to && to !== a.from){
        begin(); const l = {id:nid('l'), from:a.from, to, label:''}; S.links.push(l); commit();
        select({type:'link', id:l.id}); setTimeout(() => editLinkLabel(l.id), 0);
        if(S.links.length === 1) toast('你建立了第一條連結 🔗 寫下它們的關係吧');
      }
      break;
    }
    case 'move':
      commit();
      if(!a.moved && Date.now() - a.t0 < 400 && (a.it.kind === 'note' || a.it.kind === 'frame')){
        if(lastTap[a.it.id] && Date.now() - lastTap[a.it.id] < 450){ startEdit(a.it.id); lastTap[a.it.id] = 0; }
        else lastTap[a.it.id] = Date.now();
      }
      break;
    case 'resize': commit(); renderLinks(); break;
    case 'tapLabel': editLinkLabel(a.id); break;
  }
}
vp.addEventListener('pointerup', endPointer);
vp.addEventListener('pointercancel', endPointer);
vp.addEventListener('dblclick', e => {
  if(tool !== 'select') return;
  const host = e.target.closest('[data-id]'); if(!host) return;
  const it = getItem(host.dataset.id);
  if(it && (it.kind === 'note' || it.kind === 'frame') && !editingEl) startEdit(it.id);
});
vp.addEventListener('wheel', e => {
  if(e.target.closest('#toolbar,#zoombar')) return;
  e.preventDefault();
  const r = vpRect();
  if(e.ctrlKey || e.metaKey) zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * 0.01));
  else { view.x -= e.deltaX; view.y -= e.deltaY; applyView(); save(); }
}, {passive:false});

function updateTmpLink(w){
  const a = rectOf(act.from); if(!a) return;
  const p1 = edgePt(a, w.x, w.y, 6);
  const t = $('tmpLink'); t.style.display = ''; t.setAttribute('d', `M${p1.x} ${p1.y} L${w.x} ${w.y}`);
}
function eraseAt(w){
  const rad = 12 / view.s;
  const before = S.strokes.length;
  S.strokes = S.strokes.filter(s => !s.pts.some(([x,y]) => Math.hypot(x - w.x, y - w.y) < rad + s.w/2));
  if(S.strokes.length !== before){ renderInk(); updateHint(); }
}
function removeItem(id){
  begin();
  S.items = S.items.filter(i => i.id !== id);
  S.links = S.links.filter(l => l.from !== id && l.to !== id);
  selected = null; commit(); renderAll();
}

/* ---------------- keyboard ---------------- */
document.addEventListener('keydown', e => {
  if(isEditing()) return;
  const k = e.key.toLowerCase();
  if((e.ctrlKey || e.metaKey) && k === 'z'){ e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
  if((e.ctrlKey || e.metaKey) && k === 'y'){ e.preventDefault(); redo(); return; }
  if(e.ctrlKey || e.metaKey || e.altKey) return;
  if(e.key === ' '){ if(!spaceDown){ spaceDown = true; vp.classList.add('t-hand'); } e.preventDefault(); return; }
  if((e.key === 'Delete' || e.key === 'Backspace') && selected){
    e.preventDefault();
    if(selected.type === 'item') removeItem(selected.id);
    else { begin(); S.links = S.links.filter(l => l.id !== selected.id); selected = null; commit(); renderLinks(); }
    return;
  }
  if(e.key === 'Enter' && selected){
    e.preventDefault();
    if(selected.type === 'link') editLinkLabel(selected.id);
    else { const it = getItem(selected.id); if(it && it.kind !== 'mat') startEdit(it.id); }
    return;
  }
  if(e.key === 'Escape'){ select(null); setTool('select'); return; }
  const map = {v:'select', h:'hand', p:'pen', m:'hl', e:'eraser', t:'text', l:'link', f:'frame'};
  if(map[k]) setTool(map[k]);
});
document.addEventListener('keyup', e => { if(e.key === ' '){ spaceDown = false; vp.className = 't-' + tool; } });

/* ---------------- menu / modal ---------------- */
function openModal(html){ $('mbox').innerHTML = html; $('modal').classList.add('open'); }
function closeModal(){ $('modal').classList.remove('open'); }
$('modal').addEventListener('pointerdown', e => { if(e.target.id === 'modal') closeModal(); });
function confirmBox(title, text, onYes){
  openModal(`<h3>${esc(title)}</h3><p>${esc(text)}</p><div class="mbtns"><button class="gbtn" id="mNo">取消</button><button class="pbtn" id="mYes" style="background:#e5484d">確定</button></div>`);
  $('mNo').onclick = closeModal; $('mYes').onclick = () => { closeModal(); onYes(); };
}
$('menuBtn').onclick = () => {
  openModal(`<h3>白板選單</h3>
    <p>白板會自動存在這個瀏覽器裡。想換裝置或保險起見，可以把下面的備份碼複製起來存好；之後貼回來就能還原。</p>
    <textarea id="bk" readonly></textarea>
    <div class="mbtns">
      <button class="gbtn" id="mClear" style="color:#e5484d;margin-right:auto">清空白板</button>
      <button class="gbtn" id="mImport">貼上備份碼還原</button>
      <button class="pbtn" id="mCopy">複製備份碼</button>
      <button class="gbtn" id="mClose">關閉</button>
    </div>`);
  $('bk').value = JSON.stringify({S, custom});
  $('mClose').onclick = closeModal;
  $('mCopy').onclick = async () => { try{ await navigator.clipboard.writeText($('bk').value); toast('已複製備份碼'); }catch(_){ $('bk').select(); toast('請手動全選後複製'); } };
  $('mImport').onclick = () => {
    const ta = $('bk'); ta.readOnly = false; ta.value = ''; ta.placeholder = '把備份碼貼在這裡'; ta.focus();
    $('mImport').textContent = '確定還原';
    $('mImport').onclick = () => {
      try{ const d = JSON.parse(ta.value); if(!d.S) throw 0; begin(); S = d.S; custom = (d.custom || []).map(normMat); commit(); customChanged(); renderAll(); closeModal(); fit(); toast('還原完成'); }
      catch(_){ toast('備份碼格式不對'); }
    };
  };
  $('mClear').onclick = () => { closeModal(); confirmBox('清空整個白板？', '素材庫不會受影響；清空後仍可以按「復原」救回來。', () => { begin(); S = {items:[], strokes:[], links:[]}; commit(); selected = null; renderAll(); }); };
};

let toastT = null;
function toast(t){ const el = $('toast'); el.textContent = t; el.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove('show'), 2600); }

/* ---------------- init ---------------- */
await load();
askPersist();
setTool('select');
applyView();
renderShelf();
renderAll();
if(window.innerWidth < 760){ $('app').classList.add('shelf-closed'); $('stIcon').textContent = '⟨'; $('stTxt').textContent = '素材庫'; }
setStatus(S.items.length ? '已載入上次的白板' : '');
window.addEventListener('resize', () => renderLinks());
vp.addEventListener('scroll', () => { vp.scrollLeft = 0; vp.scrollTop = 0; });
document.getElementById('app').addEventListener('scroll', e => { e.currentTarget.scrollLeft = 0; });
