/* =========================================================
   間違い探し🍵 固有ロジック
   共通土台(GameShell)のAPIだけを使い、間違い探し（即時タップ判定）を実装。
   - 上段「見本」＝元の絵（変更なし）／下段「タップする絵」＝差分を適用した絵
   - 通常モード: 各問5個の間違い / 激むずモード: 各問8個（数を増やすだけ）
   - 時間制限なし・ヒント回数無制限（老眼配慮・プレッシャー低減を優先）
   - 見つけた差分は言語化リストで記録表示、「こたえを見る」で残りを開示可能
   - 全問クリア時は盤面内に紙吹雪演出を表示（呆気なさの解消）
   ========================================================= */

const shell = new GameShell({
  rootSelector: '#app',
  title: '間違い探し🍵',
  hint: '下の絵をタップして、見本との違いを見つけましょう。ヒントは何度でも使えます。',
  hasScore: true,
  hasTimer: false,
});

/* 内部設計座標系（レイアウトに関わらずこの座標で当たり判定を行う） */
const SCENE_W = 320;
const SCENE_H = 220;
const NORMAL_DIFF_COUNT = 5;
const HARD_DIFF_COUNT = 8;

/* ---------- お題データ（6問）----------
   base: 見本に表示する要素一覧（x,y は%、size はpx基準の絵文字サイズ）
   diffs: 「タップする絵」側にだけ適用する差分（最大8件、通常時は先頭5件を使用）
   label: 見つけた後にリスト表示する言語化ラベル */
const THEMES = [
  {
    label: '湯呑みと急須のセット',
    base: [
      { id: 'e1', emoji: '🫖', x: 50, y: 28, size: 62 },
      { id: 'e2', emoji: '🍵', x: 22, y: 58, size: 46 },
      { id: 'e3', emoji: '🍵', x: 50, y: 62, size: 46 },
      { id: 'e4', emoji: '🍵', x: 78, y: 58, size: 46 },
      { id: 'e5', emoji: '🌸', x: 14, y: 16, size: 32 },
      { id: 'e6', emoji: '🌸', x: 86, y: 16, size: 32 },
      { id: 'e7', emoji: '🍡', x: 30, y: 88, size: 36 },
      { id: 'e8', emoji: '🍘', x: 70, y: 88, size: 36 },
      { id: 'e9', emoji: '🍃', x: 50, y: 8, size: 26 },
      { id: 'e10', emoji: '🍬', x: 40, y: 50, size: 30 },
    ],
    diffs: [
      { type: 'swap', targetId: 'e2', to: '☕', label: '左の湯呑みの種類' },
      { type: 'remove', targetId: 'e5', label: '左の桜の花' },
      { type: 'move', targetId: 'e8', dx: -18, dy: 0, label: 'おせんべいの位置' },
      { type: 'resize', targetId: 'e3', scale: 1.4, label: '真ん中の湯呑みの大きさ' },
      { type: 'swap', targetId: 'e6', to: '🌼', label: '右の桜の種類' },
      { type: 'add', id: 'a1', emoji: '🦋', x: 50, y: 44, size: 28, label: 'ちょうちょの数' },
      { type: 'swap', targetId: 'e9', to: '🍂', label: '上の葉っぱの種類' },
      { type: 'move', targetId: 'e7', dx: 0, dy: -12, label: 'お団子の位置' },
      { type: 'resize', targetId: 'e1', scale: 1.3, label: '急須の大きさ' },
      { type: 'move', targetId: 'e4', dx: 16, dy: 0, label: '右の湯呑みの位置' },
      { type: 'remove', targetId: 'e10', label: 'あめ' },
      { type: 'add', id: 'a1b', emoji: '🌿', x: 60, y: 18, size: 26, label: '葉っぱの数' },
    ],
  },
  {
    label: '和菓子の盛り合わせ',
    base: [
      { id: 'w1', emoji: '🍡', x: 25, y: 30, size: 50 },
      { id: 'w2', emoji: '🍥', x: 50, y: 30, size: 50 },
      { id: 'w3', emoji: '🍰', x: 75, y: 30, size: 50 },
      { id: 'w4', emoji: '🍮', x: 25, y: 65, size: 46 },
      { id: 'w5', emoji: '🌰', x: 50, y: 65, size: 40 },
      { id: 'w6', emoji: '🍯', x: 75, y: 65, size: 44 },
      { id: 'w7', emoji: '🍁', x: 15, y: 10, size: 28 },
      { id: 'w8', emoji: '🍁', x: 85, y: 10, size: 28 },
      { id: 'w9', emoji: '🍵', x: 50, y: 90, size: 40 },
      { id: 'w10', emoji: '🍪', x: 40, y: 50, size: 30 },
    ],
    diffs: [
      { type: 'swap', targetId: 'w2', to: '🍩', label: '真ん中のお菓子の種類' },
      { type: 'remove', targetId: 'w5', label: '栗' },
      { type: 'move', targetId: 'w6', dx: -15, dy: 0, label: 'はちみつの位置' },
      { type: 'resize', targetId: 'w3', scale: 1.35, label: 'ケーキの大きさ' },
      { type: 'swap', targetId: 'w7', to: '🍂', label: '左上のもみじの種類' },
      { type: 'add', id: 'a2', emoji: '🍓', x: 50, y: 48, size: 30, label: 'いちごの数' },
      { type: 'swap', targetId: 'w8', to: '🌿', label: '右上の葉っぱの種類' },
      { type: 'move', targetId: 'w1', dx: 0, dy: 14, label: 'お団子の位置' },
      { type: 'resize', targetId: 'w4', scale: 1.3, label: 'プリンの大きさ' },
      { type: 'move', targetId: 'w9', dx: 0, dy: -12, label: 'お茶の位置' },
      { type: 'remove', targetId: 'w10', label: 'クッキー' },
      { type: 'add', id: 'a2b', emoji: '🍇', x: 60, y: 18, size: 28, label: 'ぶどうの数' },
    ],
  },
  {
    label: 'お茶菓子とお盆',
    base: [
      { id: 't1', emoji: '🍘', x: 22, y: 35, size: 48 },
      { id: 't2', emoji: '🍪', x: 50, y: 30, size: 44 },
      { id: 't3', emoji: '🍘', x: 78, y: 35, size: 48 },
      { id: 't4', emoji: '🍵', x: 50, y: 65, size: 52 },
      { id: 't5', emoji: '🍊', x: 22, y: 78, size: 38 },
      { id: 't6', emoji: '🌿', x: 78, y: 78, size: 32 },
      { id: 't7', emoji: '⭐', x: 12, y: 10, size: 24 },
      { id: 't8', emoji: '⭐', x: 88, y: 10, size: 24 },
      { id: 't9', emoji: '🍡', x: 40, y: 52, size: 32 },
      { id: 't10', emoji: '🌸', x: 60, y: 52, size: 28 },
    ],
    diffs: [
      { type: 'swap', targetId: 't2', to: '🧁', label: '真ん中のお菓子の種類' },
      { type: 'remove', targetId: 't7', label: '左上の星' },
      { type: 'move', targetId: 't5', dx: 0, dy: -14, label: 'みかんの位置' },
      { type: 'resize', targetId: 't4', scale: 1.3, label: '湯呑みの大きさ' },
      { type: 'swap', targetId: 't3', to: '🥮', label: '右のせんべいの種類' },
      { type: 'add', id: 'a3', emoji: '🍋', x: 50, y: 48, size: 28, label: 'レモンの数' },
      { type: 'swap', targetId: 't6', to: '🍀', label: '右下の葉っぱの種類' },
      { type: 'move', targetId: 't1', dx: 16, dy: 0, label: '左のせんべいの位置' },
      { type: 'move', targetId: 't8', dx: -14, dy: 0, label: '右上の星の位置' },
      { type: 'resize', targetId: 't9', scale: 1.3, label: 'お団子の大きさ' },
      { type: 'remove', targetId: 't10', label: 'さくら' },
      { type: 'add', id: 'a3b', emoji: '🍀', x: 50, y: 18, size: 26, label: 'クローバーの数' },
    ],
  },
  {
    label: '茶托に乗った湯呑み',
    base: [
      { id: 's1', emoji: '⚪', x: 50, y: 42, size: 80 },
      { id: 's2', emoji: '🍵', x: 50, y: 40, size: 64 },
      { id: 's3', emoji: '🌼', x: 20, y: 18, size: 30 },
      { id: 's4', emoji: '🌼', x: 80, y: 18, size: 30 },
      { id: 's5', emoji: '🕯️', x: 50, y: 78, size: 38 },
      { id: 's6', emoji: '🍂', x: 15, y: 78, size: 28 },
      { id: 's7', emoji: '🍂', x: 85, y: 78, size: 28 },
      { id: 's8', emoji: '✨', x: 50, y: 10, size: 26 },
      { id: 's9', emoji: '🍡', x: 35, y: 58, size: 30 },
      { id: 's10', emoji: '🌿', x: 65, y: 58, size: 26 },
    ],
    diffs: [
      { type: 'swap', targetId: 's2', to: '☕', label: '湯呑みの種類' },
      { type: 'remove', targetId: 's3', label: '左の花' },
      { type: 'move', targetId: 's5', dx: -18, dy: 0, label: 'ろうそくの位置' },
      { type: 'resize', targetId: 's1', scale: 1.2, label: '茶托の大きさ' },
      { type: 'swap', targetId: 's4', to: '🌺', label: '右の花の種類' },
      { type: 'add', id: 'a4', emoji: '🦋', x: 50, y: 58, size: 26, label: 'ちょうちょの数' },
      { type: 'swap', targetId: 's6', to: '🍁', label: '左下の葉っぱの種類' },
      { type: 'move', targetId: 's7', dx: 0, dy: -16, label: '右下の葉っぱの位置' },
      { type: 'move', targetId: 's8', dx: 14, dy: 0, label: 'キラキラの位置' },
      { type: 'resize', targetId: 's9', scale: 1.3, label: 'お団子の大きさ' },
      { type: 'remove', targetId: 's10', label: 'ハーブ' },
      { type: 'add', id: 'a4b', emoji: '🍓', x: 50, y: 60, size: 26, label: 'いちごの数' },
    ],
  },
  {
    label: '季節の一輪挿し＋お茶',
    base: [
      { id: 'f1', emoji: '🏺', x: 50, y: 55, size: 58 },
      { id: 'f2', emoji: '🌷', x: 50, y: 28, size: 52 },
      { id: 'f3', emoji: '🍵', x: 22, y: 82, size: 44 },
      { id: 'f4', emoji: '🍡', x: 78, y: 82, size: 40 },
      { id: 'f5', emoji: '🍃', x: 30, y: 42, size: 26 },
      { id: 'f6', emoji: '🍃', x: 70, y: 42, size: 26 },
      { id: 'f7', emoji: '🦋', x: 50, y: 10, size: 28 },
      { id: 'f8', emoji: '⭐', x: 15, y: 16, size: 22 },
      { id: 'f9', emoji: '🍡', x: 40, y: 65, size: 30 },
      { id: 'f10', emoji: '🌿', x: 60, y: 65, size: 26 },
    ],
    diffs: [
      { type: 'swap', targetId: 'f2', to: '🌻', label: 'お花の種類' },
      { type: 'remove', targetId: 'f7', label: 'ちょうちょ' },
      { type: 'move', targetId: 'f4', dx: -16, dy: 0, label: 'お団子の位置' },
      { type: 'resize', targetId: 'f1', scale: 1.25, label: '花瓶の大きさ' },
      { type: 'swap', targetId: 'f5', to: '🍁', label: '左の葉っぱの種類' },
      { type: 'add', id: 'a5', emoji: '🐝', x: 65, y: 30, size: 24, label: 'はちの数' },
      { type: 'swap', targetId: 'f3', to: '☕', label: '湯呑みの種類' },
      { type: 'move', targetId: 'f6', dx: 0, dy: 14, label: '右の葉っぱの位置' },
      { type: 'move', targetId: 'f8', dx: 0, dy: 14, label: '星の位置' },
      { type: 'resize', targetId: 'f9', scale: 1.3, label: 'お団子の大きさ' },
      { type: 'remove', targetId: 'f10', label: 'ハーブ' },
      { type: 'add', id: 'a5b', emoji: '🍄', x: 50, y: 20, size: 26, label: 'きのこの数' },
    ],
  },
  {
    label: '座布団とお茶セット',
    base: [
      { id: 'c1', emoji: '🟫', x: 50, y: 72, size: 92 },
      { id: 'c2', emoji: '🍵', x: 35, y: 45, size: 48 },
      { id: 'c3', emoji: '🫖', x: 65, y: 45, size: 54 },
      { id: 'c4', emoji: '🍡', x: 50, y: 88, size: 36 },
      { id: 'c5', emoji: '🌸', x: 15, y: 20, size: 30 },
      { id: 'c6', emoji: '🪭', x: 85, y: 20, size: 34 },
      { id: 'c7', emoji: '🍃', x: 50, y: 15, size: 26 },
      { id: 'c8', emoji: '🍡', x: 50, y: 35, size: 30 },
      { id: 'c9', emoji: '🌿', x: 20, y: 55, size: 26 },
      { id: 'c10', emoji: '🍓', x: 80, y: 55, size: 26 },
    ],
    diffs: [
      { type: 'swap', targetId: 'c2', to: '☕', label: '左の湯呑みの種類' },
      { type: 'remove', targetId: 'c5', label: 'お花' },
      { type: 'move', targetId: 'c4', dx: 0, dy: -14, label: 'お団子の位置' },
      { type: 'resize', targetId: 'c3', scale: 1.3, label: '急須の大きさ' },
      { type: 'resize', targetId: 'c6', scale: 1.4, label: '扇子の大きさ' },
      { type: 'add', id: 'a6', emoji: '🌟', x: 50, y: 55, size: 26, label: '星の数' },
      { type: 'swap', targetId: 'c7', to: '🍂', label: '上の葉っぱの種類' },
      { type: 'move', targetId: 'c1', dx: 0, dy: 6, label: '座布団の位置' },
      { type: 'resize', targetId: 'c8', scale: 1.3, label: 'お団子の大きさ' },
      { type: 'move', targetId: 'c9', dx: 15, dy: 0, label: 'ハーブの位置' },
      { type: 'remove', targetId: 'c10', label: 'いちご' },
      { type: 'add', id: 'a6b', emoji: '🍀', x: 50, y: 18, size: 24, label: 'クローバーの数' },
    ],
  },
];

let order = [];
let currentIndex = 0;
let activeDiffs = [];
let hitboxes = [];
let foundSet = new Set();
let locked = false;
let refSceneEl = null;
let playSceneEl = null;
let hintTimeoutId = null;

/* ---------- ユーティリティ ---------- */
function shuffleArr(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/* 見本(base)に差分(diffs)を適用し、「タップする絵」用の要素配列を作る */
function buildModifiedElements(base, diffs) {
  let elements = base.map((e) => ({ ...e }));
  diffs.forEach((d) => {
    if (d.type === 'remove') {
      elements = elements.filter((e) => e.id !== d.targetId);
    } else if (d.type === 'add') {
      elements.push({ id: d.id, emoji: d.emoji, x: d.x, y: d.y, size: d.size });
    } else if (d.type === 'swap') {
      elements = elements.map((e) => (e.id === d.targetId ? { ...e, emoji: d.to } : e));
    } else if (d.type === 'move') {
      elements = elements.map((e) => (e.id === d.targetId ? { ...e, x: e.x + d.dx, y: e.y + d.dy } : e));
    } else if (d.type === 'resize') {
      elements = elements.map((e) => (e.id === d.targetId ? { ...e, size: e.size * d.scale } : e));
    } else if (d.type === 'rotate') {
      elements = elements.map((e) => (e.id === d.targetId ? { ...e, rotate: (e.rotate || 0) + d.deg } : e));
    }
  });
  return elements;
}

/* 各差分について「タップする絵」上での当たり判定座標(%)とサイズを求める */
function computeHitboxes(base, diffs) {
  return diffs.map((d, i) => {
    if (d.type === 'remove') {
      const orig = base.find((e) => e.id === d.targetId);
      return { index: i, x: orig.x, y: orig.y, size: orig.size, label: d.label };
    }
    if (d.type === 'add') {
      return { index: i, x: d.x, y: d.y, size: d.size, label: d.label };
    }
    const orig = base.find((e) => e.id === d.targetId);
    if (d.type === 'move') return { index: i, x: orig.x + d.dx, y: orig.y + d.dy, size: orig.size, label: d.label };
    if (d.type === 'resize') return { index: i, x: orig.x, y: orig.y, size: orig.size * d.scale, label: d.label };
    return { index: i, x: orig.x, y: orig.y, size: orig.size, label: d.label }; // swap / rotate
  });
}

function renderScene(container, elements) {
  container.innerHTML = '';
  elements.forEach((el) => {
    const div = document.createElement('div');
    div.className = 'ocha-item';
    div.style.left = `${el.x}%`;
    div.style.top = `${el.y}%`;
    div.style.fontSize = `${el.size}px`;
    if (el.rotate) div.style.transform = `translate(-50%, -50%) rotate(${el.rotate}deg)`;
    div.textContent = el.emoji;
    container.appendChild(div);
  });
}

/* 画面上のタップ位置を、内部設計座標系(320x220)に変換する */
function getScenePos(e, el) {
  const rect = el.getBoundingClientRect();
  return {
    x: (e.clientX - rect.left) * (SCENE_W / rect.width),
    y: (e.clientY - rect.top) * (SCENE_H / rect.height),
  };
}

/* ---------- 出題 ---------- */
function buildQuestion(idx) {
  const theme = THEMES[order[idx]];
  const diffCount = shell.hardMode ? Math.min(HARD_DIFF_COUNT, theme.diffs.length) : NORMAL_DIFF_COUNT;
  // 8個の差分プールからランダムに選ぶ（同じお題でも毎回組み合わせが変わり、再プレイ時の目新しさを確保）
  activeDiffs = shuffleArr(theme.diffs.slice()).slice(0, diffCount);
  hitboxes = computeHitboxes(theme.base, activeDiffs);
  foundSet = new Set();
  locked = false;

  shell.board.className = 's-board ocha-board';
  shell.board.innerHTML = `
    <div class="ocha-question-badge">問題 ${idx + 1} / ${THEMES.length}（${theme.label}）</div>
    <div class="ocha-toolbar">
      <span class="ocha-progress">見つけた: <b id="ochaFound">0</b> / ${activeDiffs.length}</span>
      <button class="s-icon-btn-text" id="ochaHintBtn">💡 ヒント</button>
    </div>
    <div class="ocha-scenes">
      <div class="ocha-scene-wrap">
        <div class="ocha-scene-label">見本</div>
        <div class="ocha-scene" id="ochaRefScene"></div>
      </div>
      <div class="ocha-scene-wrap">
        <div class="ocha-scene-label">こちらをタップしてね</div>
        <div class="ocha-scene" id="ochaPlayScene"></div>
      </div>
    </div>
  `;

  refSceneEl = shell.board.querySelector('#ochaRefScene');
  playSceneEl = shell.board.querySelector('#ochaPlayScene');
  renderScene(refSceneEl, theme.base);
  renderScene(playSceneEl, buildModifiedElements(theme.base, activeDiffs));
  playSceneEl.addEventListener('pointerdown', onInteractiveTap);
  shell.board.querySelector('#ochaHintBtn').addEventListener('click', showHint);
}

/* ---------- 判定（即時） ---------- */
function onInteractiveTap(e) {
  if (!shell.running || locked) return;
  const pos = getScenePos(e, playSceneEl);
  let best = null, bestDist = Infinity;
  hitboxes.forEach((hb) => {
    if (foundSet.has(hb.index)) return;
    const hx = (hb.x / 100) * SCENE_W, hy = (hb.y / 100) * SCENE_H;
    const dist = Math.hypot(pos.x - hx, pos.y - hy);
    const radius = Math.max(28, hb.size * 0.7);
    if (dist <= radius && dist < bestDist) { best = hb; bestDist = dist; }
  });
  if (best) markFound(best);
  else showWrongMark(pos);
}

function markFound(hb) {
  foundSet.add(hb.index);
  const mark = document.createElement('div');
  mark.className = 'ocha-found-mark';
  mark.style.left = `${hb.x}%`;
  mark.style.top = `${hb.y}%`;
  mark.textContent = '✓';
  playSceneEl.appendChild(mark);

  shell.addScore(10);
  shell.playTone(720, 0.1);
  updateProgress();

  if (foundSet.size === hitboxes.length) {
    locked = true;
    setTimeout(finishQuestion, 600);
  }
}

function showWrongMark(pos) {
  shell.playTone(260, 0.12, 'triangle'); // 不正解は軽い音のみ、減点なし
  const mark = document.createElement('div');
  mark.className = 'ocha-wrong-mark';
  mark.style.left = `${(pos.x / SCENE_W) * 100}%`;
  mark.style.top = `${(pos.y / SCENE_H) * 100}%`;
  mark.textContent = '✕';
  playSceneEl.appendChild(mark);
  setTimeout(() => mark.remove(), 600);
}

function updateProgress() {
  const el = shell.board.querySelector('#ochaFound');
  if (el) el.textContent = foundSet.size;
}

/* ---------- ヒント（回数無制限） ---------- */
function showHint() {
  if (!shell.running || locked) return;
  const remain = hitboxes.filter((hb) => !foundSet.has(hb.index));
  if (remain.length === 0) return;
  clearTimeout(hintTimeoutId);
  const hb = remain[(Math.random() * remain.length) | 0];

  const mark = document.createElement('div');
  mark.className = 'ocha-hint-mark';
  const size = Math.max(36, hb.size * 0.9);
  mark.style.left = `${hb.x}%`;
  mark.style.top = `${hb.y}%`;
  mark.style.width = `${size}px`;
  mark.style.height = `${size}px`;
  playSceneEl.appendChild(mark);

  shell.playTone(500, 0.08);
  shell.toast('光っているところを探してみましょう');
  hintTimeoutId = setTimeout(() => mark.remove(), 1800);
}

/* ---------- 問題送り・終了 ---------- */
function finishQuestion() {
  [523.25, 659.25, 783.99, 1046.5].forEach((f, i) =>
    setTimeout(() => shell.playTone(f, 0.14, 'triangle'), i * 90)
  );
  const nextIdx = currentIndex + 1;
  if (nextIdx >= THEMES.length) {
    setTimeout(showAllClear, 500);
  } else {
    shell.toast(`${currentIndex + 1}問目クリア！`);
    setTimeout(() => {
      currentIndex = nextIdx;
      buildQuestion(currentIndex);
    }, 900);
  }
}

/* 全問クリア時：盤面内に紙吹雪演出とスコアを表示してから終了処理へ */
function showAllClear() {
  const finalScore = shell.getScore();
  shell.board.className = 's-board ocha-board';
  shell.board.innerHTML = `
    <div class="ocha-allclear" id="ochaAllClear">
      <div class="ocha-allclear-title">🎉 全問クリア！ 🎉</div>
      <div class="ocha-allclear-score">スコア: <b>${finalScore}</b></div>
      <div class="ocha-allclear-sub">お疲れ様でした🍵</div>
    </div>
  `;
  const container = shell.board.querySelector('#ochaAllClear');
  const emojis = ['🎉', '🍵', '✨', '🍡', '🌿', '⭐'];
  for (let i = 0; i < 20; i++) {
    const el = document.createElement('div');
    el.className = 'ocha-confetti';
    el.textContent = emojis[(Math.random() * emojis.length) | 0];
    el.style.left = `${Math.random() * 100}%`;
    el.style.animationDelay = `${Math.random() * 0.6}s`;
    el.style.animationDuration = `${1.6 + Math.random() * 1.2}s`;
    el.style.fontSize = `${20 + Math.random() * 14}px`;
    container.appendChild(el);
  }
  [523.25, 659.25, 783.99, 1046.5, 1318.51].forEach((f, i) =>
    setTimeout(() => shell.playTone(f, 0.16, 'triangle'), i * 100)
  );
  shell.end(); // メッセージなし＝盤面の演出そのものを結果表示とする
}

function showPlaceholder() {
  shell.board.className = 's-board';
  shell.board.innerHTML = `
    <div class="ocha-placeholder">
      <p>見本の絵と見比べて、下の絵にある<b>違うところ</b>をタップして見つけるゲームです。</p>
      <p>制限時間はありません。ヒントは💡ボタンで何度でも使えます。</p>
      <p>「スタート」を押すとはじまります</p>
    </div>
  `;
}

showPlaceholder();

/* ---- GameShellのライフサイクルに接続 ---- */
shell.onStart(() => {
  order = shuffleArr(THEMES.map((_, i) => i));
  currentIndex = 0;
  buildQuestion(currentIndex);
});

shell.onReset(() => {
  clearTimeout(hintTimeoutId);
  locked = true;
  showPlaceholder();
});

shell.onHardModeChange(() => {
  // running中は呼ばれない（GameShell側で保証）。次回スタート時のdiffCountに反映される。
});
