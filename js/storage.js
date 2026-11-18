// 白板存檔：IndexedDB（取代原本的 localStorage）。
// 存的內容和原本一模一樣：{S, custom, view}，放在 store "board" 的 key "main"。
// 第一次開啟時，如果 IndexedDB 是空的、但 localStorage 有舊存檔，會自動搬過來（舊資料保留不刪）。

const DB_NAME = 'kmu-gongbi-whiteboard';
const DB_VERSION = 1;
const STORE = 'board';
const KEY = 'main';
export const LEGACY_LS_KEY = 'kmu-gongbi-whiteboard-v1';

let dbp = null;
function open() {
  if (dbp) return dbp;
  dbp = new Promise((res, rej) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => { db.close(); dbp = null; };
      res(db);
    };
    req.onerror = () => { dbp = null; rej(req.error); };
    req.onblocked = () => rej(new Error('IndexedDB blocked'));
  });
  return dbp;
}

function tx(mode, fn) {
  return open().then(db => new Promise((res, rej) => {
    const t = db.transaction(STORE, mode);
    const r = fn(t.objectStore(STORE));
    t.oncomplete = () => res(r && r.result);
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error || new Error('aborted'));
  }));
}

export async function loadBoard() {
  let d = await tx('readonly', s => s.get(KEY));
  if (d) return d;
  // 從舊的 localStorage 搬過來
  let raw = null;
  try { raw = localStorage.getItem(LEGACY_LS_KEY); } catch (_) {}
  if (!raw) return null;
  d = JSON.parse(raw);
  await saveBoard(d);
  return d;
}

export function saveBoard(d) {
  // 存結構化複本，之後修改畫面狀態不會影響已存的內容
  return tx('readwrite', s => s.put(JSON.parse(JSON.stringify(d)), KEY));
}

// 請瀏覽器不要在空間不足時自動清掉資料（Safari 會自行判斷，不保證生效）
export function askPersist() {
  try { navigator.storage?.persist?.(); } catch (_) {}
}
