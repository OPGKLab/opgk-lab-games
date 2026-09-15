/* =========================================================
   OPGK Lab Casual Series - Service Worker
   -----------------------------------------------------------
   キャッシュ戦略（2種類）:

   1. コアファイル（common/・トップindex.html・about.html・manifest等）
      → キャッシュ優先（cache-first）。CACHE_VERSIONを上げた時だけ更新される。
        更新頻度が低い前提のファイル群。

   2. それ以外（各ゲームの index.html / *-game.js / *-style.css など）
      → ネット優先（network-first）。オンライン中は常に最新を取得し、
        取得できた版を実行時キャッシュ(RUNTIME_CACHE)に保存する。
        オフライン時のみ、直近に保存された版で代用する。
      → これにより、詩さんが各ゲームを更新した際、キャッシュリストの
        手動更新は一切不要（オンラインなら自動的に最新が反映される）。

   運用ルール：
   - common/series-shell.js や series-style-base.css を更新した時は、
     下の CACHE_VERSION を必ず1つ上げること（例: 'v1' → 'v2'）。
     上げ忘れると、スマホ側が古い共通ファイルを表示し続けてしまう。
   - 各ゲーム本体（games/配下）を更新した時は、何もしなくてよい
     （ネット優先のため次回アクセス時に自動で最新化される）。
   ========================================================= */

const CACHE_VERSION = 'v1';
const CORE_CACHE = `opgk-core-${CACHE_VERSION}`;
const RUNTIME_CACHE = 'opgk-runtime';

/* コアファイル一覧（sw.jsから見た相対パス＝サイトルート基準） */
const CORE_ASSET_PATHS = [
  './',
  './index.html',
  './about.html',
  './offline.html',
  './manifest.json',
  './icon.png',
  './common/series-shell.js',
  './common/series-style-base.css',
];

/* インストール時：コアファイルを先読みキャッシュ */
self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CORE_CACHE).then((cache) => cache.addAll(CORE_ASSET_PATHS))
  );
});

/* 有効化時：古いバージョンのコアキャッシュを削除 */
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => key.startsWith('opgk-core-') && key !== CORE_CACHE)
          .map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

/* コアファイルの絶対URL一覧（fetch時の判定用） */
const CORE_URL_SET = new Set(
  CORE_ASSET_PATHS.map((path) => new URL(path, self.registration.scope).href)
);

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // 外部リソースには関与しない

  if (CORE_URL_SET.has(url.href)) {
    event.respondWith(cacheFirst(request));
  } else {
    event.respondWith(networkFirst(request));
  }
});

/* コアファイル用：キャッシュにあればそれを返し、なければネット取得 */
async function cacheFirst(request) {
  const cached = await caches.match(request, { cacheName: CORE_CACHE });
  if (cached) return cached;
  try {
    return await fetch(request);
  } catch (err) {
    return cached || Response.error();
  }
}

/* 各ゲーム用：まずネットから最新を取りに行き、取れたら実行時キャッシュを更新。
   オフライン等で失敗した場合のみ、直近のキャッシュで代用する。
   ナビゲーション（ページ遷移）で代用も無い場合は offline.html を返す。 */
async function networkFirst(request) {
  const runtimeCache = await caches.open(RUNTIME_CACHE);
  try {
    const fresh = await fetch(request);
    runtimeCache.put(request, fresh.clone());
    return fresh;
  } catch (err) {
    const cached = await runtimeCache.match(request);
    if (cached) return cached;
    if (request.mode === 'navigate') {
      const offline = await caches.match('./offline.html', { cacheName: CORE_CACHE });
      if (offline) return offline;
    }
    throw err;
  }
}
