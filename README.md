# 共筆白板・腹部（PWA）

由單檔原型 `whiteboard.html` 拆出來的版本，功能不變。可加到 iPad 主畫面、離線使用。

```
index.html               頁面骨架
css/style.css            樣式
css/figure.css           圖解配色（由 import-book-figs.mjs 產生，勿手改）
js/app.js                白板程式（原本 <script> 的內容）
js/storage.js            存檔：IndexedDB（第一次開啟會自動搬移舊的 localStorage 存檔）
js/pwa.js                註冊 service worker
data/book.json           5 章、232 張素材
data/pdf-imgs.json       共筆原圖清單（圖片在 img/）
data/old-text.json       舊的手寫卡（舊白板上仍會顯示，素材庫不列出）
img/                     12 張共筆原圖（原本是內嵌 base64）
icons/ manifest.webmanifest  PWA 圖示與設定
sw.js                    service worker（由 scripts/build-sw.mjs 產生，勿手改）
scripts/
  build-sw.mjs           重新產生 sw.js 的離線檔案清單與版本號
  sw.template.js         sw.js 的範本
  serve.mjs              本機測試伺服器
  split-original.mjs     一次性：把原始單檔拆成上面這些檔案
  import-book-figs.mjs   把《腹部課本》的分層圖解換進圖解卡，並產生 css/figure.css
```

## 開發

```
npm run dev      # 產生 sw.js 並在 http://localhost:8080 開啟
```

**改了任何檔案之後，部署前一定要跑 `npm run build`**，這樣 sw.js 的版本號會變，iPad 下次開啟時才會抓到新版（通常要關掉 App 再開一次）。

## 存檔

- 存在 IndexedDB 資料庫 `kmu-gongbi-whiteboard`，store `board`，key `main`，內容是 `{S, custom, view}`，與原本 localStorage 的格式相同。
- iPad 上「加到主畫面」的 App 和 Safari 分頁是**不同的儲存空間**，兩邊的白板不共通。要搬移請用「⋯ → 複製備份碼／貼上備份碼還原」。

## 圖解（一步一步看）

33 張圖解卡的 SVG 來自《腹部課本》，每個部分用 `data-s="1,2"` 標記屬於哪幾步，`steps` 是每一步的標題與說明。白板上點步驟按鈕，這一步的部分保持清楚、其他變淡；「▶ 自動播放」每 3.2 秒換一步，可隨時暫停。看到第幾步只記在畫面上，不存檔。

課本更新圖解後：把課本的 ch1.html…ch5.html 放到同一個資料夾，然後

```
node scripts/import-book-figs.mjs <資料夾>
npm run build
```
