// 註冊 service worker，讓 App 可以離線使用
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(e => console.warn('SW 註冊失敗', e));
  });
}
