// 由 scripts/build-sw.mjs 產生，請勿直接修改 sw.js（改 scripts/sw.template.js）
const VERSION = '65886b3e9d';
const PRECACHE = [
  "./",
  "index.html",
  "manifest.webmanifest",
  "css/style.css",
  "js/app.js",
  "js/pwa.js",
  "js/storage.js",
  "data/book.json",
  "data/old-text.json",
  "data/pdf-imgs.json",
  "img/i-000.jpg",
  "img/i-001.jpg",
  "img/i-002.jpg",
  "img/i-003.jpg",
  "img/i-004.jpg",
  "img/i-005.jpg",
  "img/i-006.jpg",
  "img/i-007.jpg",
  "img/i-008.jpg",
  "img/i-009.jpg",
  "img/i-010.jpg",
  "img/i-011.jpg",
  "icons/apple-touch-icon.png",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/icon.svg"
];
const CACHE = 'whiteboard-' + VERSION;
const FONT_CACHE = 'whiteboard-fonts';

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE && k !== FONT_CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Google Fonts：有網路時更新，離線時用快取
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    e.respondWith(caches.open(FONT_CACHE).then(async c => {
      const hit = await c.match(req);
      const net = fetch(req).then(r => { if (r.ok || r.type === 'opaque') c.put(req, r.clone()); return r; }).catch(() => hit);
      return hit || net;
    }));
    return;
  }
  if (url.origin !== location.origin) return;

  // 自己的檔案：先用快取（離線可用），沒有才上網
  e.respondWith((async () => {
    const hit = await caches.match(req, { ignoreSearch: true });
    if (hit) return hit;
    try { return await fetch(req); }
    catch (err) {
      if (req.mode === 'navigate') return caches.match('./index.html');
      throw err;
    }
  })());
});
