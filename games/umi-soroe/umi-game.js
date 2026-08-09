/* =========================================================
   うみそろえ🐳 固有ロジック
   共通土台(GameShell)のAPIだけを使い、3つ消しパズルを実装。
   通常: 6x6・4種類 / 激むず: 8x8・6種類
   入力はドラッグ（隣接マスへなぞって入れ替え）。
   ========================================================= */

const shell = new GameShell({
  rootSelector: '#app',
  title: 'うみそろえ🐳',
  hint: '海の生き物を指でなぞって、同じ仲間を3つ並べよう（タイトル5回タップで激むず）',
  hasScore: true,
  hasTimer: true,
  duration: 45,
});

const NORMAL_SIZE = 6;
const HARD_SIZE = 7;
const NORMAL_CANDIES = ['🐳', '🦑', '🦭', '🪼'];
const HARD_CANDIES = NORMAL_CANDIES.concat(['🦐', '🐟']);
const SWAP_DRAG_THRESHOLD = 18; // px。これ未満の移動はドラッグとみなさない

let SIZE = NORMAL_SIZE;
let candies = NORMAL_CANDIES;
let board = [];
let isResolving = false;
let cascadeLevel = 0;
let pointerStartInfo = null;

/* ---------- 消えた個数に応じたサウンド段階 ---------- */
/* ▼▼▼ テストβ用フラグ：3個消しでも★スペシャル音を確認できるようにする一時措置。
   確認後は false に戻すこと（正規α = 3個は単音、10個以上のみ★スペシャル） ▼▼▼ */
const TEST_FORCE_SPECIAL_ON_3 = false;

function getSoundTier(count) {
  if (TEST_FORCE_SPECIAL_ON_3 && count === 3) return 5; // ★テスト確認用
  if (count >= 10) return 5; // ★スペシャル
  if (count >= 8) return 4;
  if (count >= 6) return 3;
  if (count >= 4) return 2;
  return 1; // 通常3個
}

function playNotes(freqs, type, spacing, duration) {
  freqs.forEach((f, i) => setTimeout(() => shell.playTone(f, duration, type), i * spacing));
}

function playMatchSound(count) {
  const tier = getSoundTier(count);
  if (tier === 1) { shell.playTone(660, 0.1); return; }
  if (tier === 2) { playNotes([660, 880], 'sine', 90, 0.1); return; }
  if (tier === 3) { playNotes([660, 880, 1046.5], 'sine', 85, 0.11); return; }
  if (tier === 4) { playNotes([660, 880, 1046.5, 1318.51], 'triangle', 80, 0.12); return; }
  playNotes([523.25, 659.25, 783.99, 1046.5, 1318.51], 'triangle', 90, 0.14); // tier5
}

/* ---------- 盤面生成（3つ並び禁止・詰みなし保証） ---------- */
function randomIndex(colorCount) {
  return Math.floor(Math.random() * colorCount);
}

function generateBoard(colorCount) {
  let attempts = 0;
  let b;
  do {
    b = [];
    for (let r = 0; r < SIZE; r++) {
      b.push([]);
      for (let c = 0; c < SIZE; c++) {
        let val;
        do {
          val = randomIndex(colorCount);
        } while (
          (c >= 2 && b[r][c - 1] === val && b[r][c - 2] === val) ||
          (r >= 2 && b[r - 1][c] === val && b[r - 2][c] === val)
        );
        b[r].push(val);
      }
    }
    attempts++;
  } while (findHintPair(b) === null && attempts < 20);
  return b;
}

/* ---------- マッチ判定 ---------- */
function findMatches(b) {
  const matched = new Set();
  for (let r = 0; r < SIZE; r++) {
    let runStart = 0;
    for (let c = 1; c <= SIZE; c++) {
      if (c < SIZE && b[r][c] === b[r][runStart]) continue;
      if (c - runStart >= 3) for (let k = runStart; k < c; k++) matched.add(r + ',' + k);
      runStart = c;
    }
  }
  for (let c = 0; c < SIZE; c++) {
    let runStart = 0;
    for (let r = 1; r <= SIZE; r++) {
      if (r < SIZE && b[r][c] === b[runStart][c]) continue;
      if (r - runStart >= 3) for (let k = runStart; k < r; k++) matched.add(k + ',' + c);
      runStart = r;
    }
  }
  return matched;
}

function testSwapCreatesMatch(b, r1, c1, r2, c2) {
  const copy = b.map((row) => row.slice());
  const t = copy[r1][c1];
  copy[r1][c1] = copy[r2][c2];
  copy[r2][c2] = t;
  return findMatches(copy).size > 0;
}

function findHintPair(b) {
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      if (c + 1 < SIZE && testSwapCreatesMatch(b, r, c, r, c + 1)) return { r1: r, c1: c, r2: r, c2: c + 1 };
      if (r + 1 < SIZE && testSwapCreatesMatch(b, r, c, r + 1, c)) return { r1: r, c1: c, r2: r + 1, c2: c };
    }
  }
  return null;
}

/* ---------- 盤面操作 ---------- */
function swapCells(r1, c1, r2, c2) {
  const t = board[r1][c1];
  board[r1][c1] = board[r2][c2];
  board[r2][c2] = t;
}

function removeMatches(matchedSet) {
  matchedSet.forEach((key) => {
    const [r, c] = key.split(',').map(Number);
    board[r][c] = null;
  });
}

function applyGravity() {
  for (let c = 0; c < SIZE; c++) {
    const colVals = [];
    for (let r = 0; r < SIZE; r++) if (board[r][c] !== null) colVals.push(board[r][c]);
    const missing = SIZE - colVals.length;
    const newVals = [];
    for (let i = 0; i < missing; i++) newVals.push(randomIndex(candies.length));
    const merged = newVals.concat(colVals);
    for (let r = 0; r < SIZE; r++) board[r][c] = merged[r];
  }
}

/* ---------- 描画 ---------- */
function buildBoard() {
  SIZE = shell.hardMode ? HARD_SIZE : NORMAL_SIZE;
  candies = shell.hardMode ? HARD_CANDIES : NORMAL_CANDIES;
  board = generateBoard(candies.length);
  isResolving = false;
  cascadeLevel = 0;

  shell.board.className = 's-board umi-board';
  shell.board.innerHTML = `
    <div class="umi-toolbar">
      <button class="s-icon-btn-text umi-hint-btn" id="umiHintBtn">💡 ヒント</button>
    </div>
    <div class="umi-grid" id="umiGrid" style="--cols:${SIZE}"></div>
  `;
  shell.board.querySelector('#umiHintBtn').addEventListener('click', useHint);
  renderBoard();
}

function renderBoard() {
  const grid = shell.board.querySelector('#umiGrid');
  if (!grid) return;
  grid.innerHTML = '';
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const v = board[r][c];
      const tile = document.createElement('button');
      tile.className = `umi-tile umi-c${v}`;
      tile.dataset.r = r;
      tile.dataset.c = c;
      tile.textContent = candies[v];
      tile.addEventListener('pointerdown', (e) => onTilePointerDown(e, r, c));
      grid.appendChild(tile);
    }
  }
}

function getTileEl(r, c) {
  return shell.board.querySelector(`.umi-tile[data-r="${r}"][data-c="${c}"]`);
}

function showPlaceholder() {
  shell.board.className = 's-board';
  shell.board.innerHTML = '<div class="umi-placeholder">「スタート」を押すと盤面が生成されます</div>';
}

/* ---------- 入力（ドラッグでなぞって隣と入れ替え） ---------- */
function onTilePointerDown(e, r, c) {
  if (!shell.running || isResolving) return;
  const el = getTileEl(r, c);
  if (el) el.classList.add('umi-selected');
  pointerStartInfo = { r, c, x: e.clientX, y: e.clientY, el };
}

document.addEventListener('pointerup', (e) => {
  if (!pointerStartInfo) return;
  const startEl = pointerStartInfo.el;
  const dx = e.clientX - pointerStartInfo.x;
  const dy = e.clientY - pointerStartInfo.y;
  if (Math.abs(dx) < SWAP_DRAG_THRESHOLD && Math.abs(dy) < SWAP_DRAG_THRESHOLD) {
    if (startEl) startEl.classList.remove('umi-selected');
    pointerStartInfo = null;
    return;
  }
  let tr = pointerStartInfo.r;
  let tc = pointerStartInfo.c;
  if (Math.abs(dx) > Math.abs(dy)) tc += dx > 0 ? 1 : -1;
  else tr += dy > 0 ? 1 : -1;
  if (tr >= 0 && tr < SIZE && tc >= 0 && tc < SIZE) {
    attemptSwap(pointerStartInfo.r, pointerStartInfo.c, tr, tc);
  }
  if (startEl) startEl.classList.remove('umi-selected');
  pointerStartInfo = null;
});

function attemptSwap(r1, c1, r2, c2) {
  if (!shell.running || isResolving) return;
  swapCells(r1, c1, r2, c2);
  const matched = findMatches(board);
  if (matched.size > 0) {
    renderBoard();
    cascadeLevel = 0;
    isResolving = true;
    processTurn();
  } else {
    renderBoard();
    shell.playTone(220, 0.12, 'sawtooth'); // 揃わない時は軽い音のみ、減点なし
    setTimeout(() => {
      swapCells(r1, c1, r2, c2);
      renderBoard();
    }, 200);
  }
}

/* ---------- マッチ処理・連鎖（コンボ） ---------- */
function processTurn() {
  if (!shell.running) return;
  const matched = findMatches(board);
  if (matched.size === 0) {
    isResolving = false;
    checkDeadlockAndShuffle();
    return;
  }

  matched.forEach((key) => {
    const [r, c] = key.split(',').map(Number);
    const el = getTileEl(r, c);
    if (el) el.classList.add('umi-match-glow');
  });

  const gained = Math.round(matched.size * 10 * (1 + 0.5 * cascadeLevel));
  shell.addScore(gained);
  playMatchSound(matched.size);

  const [fr, fc] = matched.values().next().value.split(',').map(Number);
  const anchorEl = getTileEl(fr, fc);
  if (anchorEl) {
    const tier = getSoundTier(matched.size);
    let text, type;
    if (tier === 5) { text = `★スペシャル+${gained}`; type = 'bonus'; }
    else if (tier >= 2 || cascadeLevel > 0) { text = `✨+${gained}`; type = 'bonus'; }
    else { text = `+${gained}`; type = 'good'; }
    shell.showPopup(anchorEl, text, type);
  }

  setTimeout(() => {
    matched.forEach((key) => {
      const [r, c] = key.split(',').map(Number);
      const el = getTileEl(r, c);
      if (el) {
        el.classList.remove('umi-match-glow');
        el.classList.add('umi-matched');
      }
    });
    setTimeout(() => {
      removeMatches(matched);
      applyGravity();
      cascadeLevel++;
      renderBoard();
      setTimeout(processTurn, 220);
    }, 220);
  }, 150);
}

/* ---------- 手詰まり救済 ---------- */
function checkDeadlockAndShuffle() {
  if (!shell.running) return;
  if (findHintPair(board) !== null) return;
  shuffleBoard();
}

function shuffleBoard() {
  isResolving = true;
  const grid = shell.board.querySelector('#umiGrid');
  grid.classList.add('umi-shuffling');
  shell.toast('シャッフル！✨');
  setTimeout(() => {
    board = generateBoard(candies.length);
    renderBoard();
    const g = shell.board.querySelector('#umiGrid');
    if (g) g.classList.remove('umi-shuffling');
    isResolving = false;
  }, 500);
}

/* ---------- ヒント ---------- */
function useHint() {
  if (!shell.running || isResolving) return;
  const pair = findHintPair(board);
  if (!pair) return;
  const el1 = getTileEl(pair.r1, pair.c1);
  const el2 = getTileEl(pair.r2, pair.c2);
  if (el1) el1.classList.add('umi-hint');
  if (el2) el2.classList.add('umi-hint');
  shell.playTone(500, 0.08);
  setTimeout(() => {
    if (el1) el1.classList.remove('umi-hint');
    if (el2) el2.classList.remove('umi-hint');
  }, 1500);
}

showPlaceholder();

/* ---- GameShellのライフサイクルに接続 ---- */
shell.onStart(() => {
  buildBoard();
});
shell.onReset(() => {
  showPlaceholder();
});
shell.onTimeUp(() => {
  shell.toast(`終了！スコア: ${shell.getScore()}`);
});
