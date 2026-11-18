// 註冊 service worker，讓 App 可以離線使用；有新版本時在畫面下方提示更新
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', async () => {
    let reg;
    try { reg = await navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }); }
    catch (e) { console.warn('SW 註冊失敗', e); return; }

    // iPad 上「關掉」App 通常只是切到背景，不會重新載入；所以每次回到 App 都檢查一次新版
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') reg.update().catch(() => {});
    });

    // 已經有舊版在運作、新版接手時，請使用者點一下重新載入（不自動重整，避免打斷正在畫的筆畫）
    if (!navigator.serviceWorker.controller) return;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (document.getElementById('updBar')) return;
      const b = document.createElement('button');
      b.id = 'updBar';
      b.textContent = '有新版本，點這裡更新';
      b.style.cssText = 'position:fixed;left:50%;bottom:calc(18px + env(safe-area-inset-bottom));transform:translateX(-50%);z-index:9999;'
        + 'padding:11px 20px;border:0;border-radius:999px;background:#1f2328;color:#fff;font:600 15px/1.2 inherit;'
        + 'box-shadow:0 6px 20px rgba(0,0,0,.22);cursor:pointer';
      b.onclick = () => location.reload();
      document.body.appendChild(b);
    });
  });
}
