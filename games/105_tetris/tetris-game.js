/* =========================================================
   テトリス🧱 固有ロジック
   共通土台(GameShell)のAPIだけを使い、盤面生成・落下・回転・
   ライン消去・レベル加速を実装。
   通常: 10x20 / 激むず: 8x20（幅が狭い分、詰みやすくなる）
   操作: 画面下の矢印ボタン（←→↓・回転）固定配置。
   ========================================================= */

const shell = new GameShell({
  rootSelector: '#app',
  title: 'テトリス🧩',
  hint: '下のボタンでブロックを動かそう。列を横一列そろえると消えます（タイトル5回タップで激むず・幅せまめ）',
  hasScore: true,
  hasTimer: false,
});

const ROWS = 17;
const NORMAL_COLS = 10;
const HARD_COLS = 8;
const BASE_INTERVAL = 700;   // ms（レベル1の落下間隔）
const MIN_INTERVAL = 130;    // ms（最速）
const INTERVAL_STEP = 55;    // レベル1つごとの短縮幅
const LINES_PER_LEVEL = 10;
const NEXT_COUNT = 3;

/* 7種のブロック形状。4回転ぶんを4x4枠内の座標であらかじめ定義（NES方式・簡易） */
const SHAPES = {
  I: [[[1,0],[1,1],[1,2],[1,3]], [[0,2],[1,2],[2,2],[3,2]], [[2,0],[2,1],[2,2],[2,3]], [[0,1],[1,1],[2,1],[3,1]]],
  O: [[[0,1],[0,2],[1,1],[1,2]], [[0,1],[0,2],[1,1],[1,2]], [[0,1],[0,2],[1,1],[1,2]], [[0,1],[0,2],[1,1],[1,2]]],
  T: [[[0,1],[1,0],[1,1],[1,2]], [[0,1],[1,1],[1,2],[2,1]], [[1,0],[1,1],[1,2],[2,1]], [[0,1],[1,0],[1,1],[2,1]]],
  S: [[[0,1],[0,2],[1,0],[1,1]], [[0,1],[1,1],[1,2],[2,2]], [[1,1],[1,2],[2,0],[2,1]], [[0,0],[1,0],[1,1],[2,1]]],
  Z: [[[0,0],[0,1],[1,1],[1,2]], [[0,2],[1,1],[1,2],[2,1]], [[1,0],[1,1],[2,1],[2,2]], [[0,1],[1,0],[1,1],[2,0]]],
  J: [[[0,0],[1,0],[1,1],[1,2]], [[0,1],[0,2],[1,1],[2,1]], [[1,0],[1,1],[1,2],[2,2]], [[0,1],[1,1],[2,0],[2,1]]],
  L: [[[0,2],[1,0],[1,1],[1,2]], [[0,1],[1,1],[2,1],[2,2]], [[1,0],[1,1],[1,2],[2,0]], [[0,0],[0,1],[1,1],[2,1]]],
};
const TYPES = Object.keys(SHAPES);
const LINE_SCORE = { 1: 100, 2: 300, 3: 500, 4: 800 };
const KICKS = [0, -1, 1, -2, 2]; // 回転時、壁に当たったら少しずらして再試行する順番

let cols = NORMAL_COLS;
let board = [];        // board[r][c] = 色id(1〜7) または null
let cellEls = [];
let bag = [];
let nextQueue = [];
let piece = null;      // { type, rotation, row, col }
let score = 0;
let totalLines = 0;
let level = 1;
let tickTimer = null;
let gameOver = true;
let paused = false;

/* ---------- 7種バッグ抽選（偏りなくランダムに出す） ---------- */
function refillBag() {
  const arr = TYPES.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  bag = bag.concat(arr);
}
function drawFromBag() {
  if (bag.length === 0) refillBag();
  return bag.shift();
}
function fillNextQueue() {
  while (nextQueue.length < NEXT_COUNT) nextQueue.push(drawFromBag());
}

/* ---------- 盤面ユーティリティ ---------- */
function cellsOf(type, rotation) {
  return SHAPES[type][rotation];
}
function colorIdOf(type) {
  return TYPES.indexOf(type) + 1;
}

function collides(type, rotation, row, col) {
  for (const [dr, dc] of cellsOf(type, rotation)) {
    const r = row + dr, c = col + dc;
    if (c < 0 || c >= cols || r >= ROWS) return true;
    if (r < 0) continue; // 出現直後、盤外上部は許容
    if (board[r][c] !== null) return true;
  }
  return false;
}

function intervalForLevel() {
  return Math.max(MIN_INTERVAL, BASE_INTERVAL - (level - 1) * INTERVAL_STEP);
}

/* ---------- 出現・操作 ---------- */
function spawnPiece() {
  fillNextQueue();
  const type = nextQueue.shift();
  fillNextQueue();
  const startCol = Math.floor((cols - 4) / 2);
  piece = { type, rotation: 0, row: -1, col: startCol };
  if (collides(piece.type, piece.rotation, piece.row, piece.col)) {
    triggerGameOver();
  }
}

function tryMove(dRow, dCol) {
  if (!piece) return false;
  const nr = piece.row + dRow, nc = piece.col + dCol;
  if (collides(piece.type, piece.rotation, nr, nc)) return false;
  piece.row = nr; piece.col = nc;
  return true;
}

function moveLeft() {
  if (!shell.running || gameOver || paused) return;
  if (tryMove(0, -1)) { shell.playTone(420, 0.04); renderBoard(); }
}
function moveRight() {
  if (!shell.running || gameOver || paused) return;
  if (tryMove(0, 1)) { shell.playTone(420, 0.04); renderBoard(); }
}
function hardDrop() {
  if (!shell.running || gameOver || paused || !piece) return;
  let dist = 0;
  while (tryMove(1, 0)) dist++;
  shell.playTone(210, 0.05, 'triangle');
  setTimeout(() => shell.playTone(150, 0.1, 'triangle'), 45);
  if (dist > 0) shell.addScore(dist * 2); // 落とした分だけ少しボーナス
  lockPiece();
  renderBoard();
}
function rotatePiece() {
  if (!shell.running || gameOver || paused || !piece) return;
  const nextRot = (piece.rotation + 1) % 4;
  for (const k of KICKS) {
    if (!collides(piece.type, nextRot, piece.row, piece.col + k)) {
      piece.rotation = nextRot;
      piece.col += k;
      shell.playTone(560, 0.05, 'triangle');
      renderBoard();
      return;
    }
  }
}

/* ---------- 一時停止 ---------- */
function togglePause() {
  if (!shell.running || gameOver) return;
  paused = !paused;
  const grid = shell.board.querySelector('#tetGrid');
  const label = shell.board.querySelector('#tetPauseLabel');
  const btn = shell.board.querySelector('#tetPauseBtn');
  if (paused) {
    clearTimeout(tickTimer);
    if (grid) grid.classList.add('tetris-dimmed');
    if (label) label.style.display = 'block';
    if (btn) btn.textContent = '▶ 再開';
  } else {
    if (grid) grid.classList.remove('tetris-dimmed');
    if (label) label.style.display = 'none';
    if (btn) btn.textContent = '⏸ 一時停止';
    scheduleTick();
  }
}

/* ---------- 落下ループ ---------- */
function scheduleTick() {
  clearTimeout(tickTimer);
  tickTimer = setTimeout(tick, intervalForLevel());
}
function tick() {
  if (!shell.running || gameOver || paused) return;
  if (!tryMove(1, 0)) {
    lockPiece();
  } else {
    renderBoard();
  }
  scheduleTick();
}

/* ---------- 固定・ライン消去 ---------- */
function lockPiece() {
  const colorId = colorIdOf(piece.type);
  for (const [dr, dc] of cellsOf(piece.type, piece.rotation)) {
    const r = piece.row + dr, c = piece.col + dc;
    if (r >= 0 && r < ROWS) board[r][c] = colorId;
  }
  piece = null;
  const cleared = clearLines();
  if (cleared > 0) applyLineClear(cleared);
  if (!gameOver) spawnPiece();
  renderBoard();
}

function clearLines() {
  const remaining = board.filter((row) => row.some((v) => v === null));
  const clearedCount = ROWS - remaining.length;
  while (remaining.length < ROWS) remaining.unshift(Array(cols).fill(null));
  board = remaining;
  return clearedCount;
}

function applyLineClear(count) {
  totalLines += count;
  const gained = (LINE_SCORE[count] || LINE_SCORE[4]) * level;
  shell.addScore(gained);
  playLineClearSound(count);
  shell.toast(count >= 4 ? `テトリス！+${gained}` : `${count}ライン消去！+${gained}`);

  const newLevel = Math.floor(totalLines / LINES_PER_LEVEL) + 1;
  if (newLevel !== level) {
    level = newLevel;
    shell.toast(`レベル${level}！速くなります`);
  }
  updateToolbar();
}

function playLineClearSound(count) {
  if (count === 1) { shell.playTone(660, 0.1); return; }
  if (count === 2) { const f = [660, 880]; f.forEach((v, i) => setTimeout(() => shell.playTone(v, 0.1), i * 90)); return; }
  if (count === 3) { const f = [660, 880, 1046.5]; f.forEach((v, i) => setTimeout(() => shell.playTone(v, 0.11, 'triangle'), i * 85)); return; }
  const f = [523.25, 659.25, 783.99, 1046.5, 1318.51];
  f.forEach((v, i) => setTimeout(() => shell.playTone(v, 0.14, 'triangle'), i * 90));
}

/* ---------- 描画 ---------- */
function buildDom() {
  cols = shell.hardMode ? HARD_COLS : NORMAL_COLS;
  shell.board.className = 's-board tetris-board';
  shell.board.innerHTML = `
    <div class="tetris-toolbar">
      <span class="tetris-info">レベル: <b id="tetLevel">1</b></span>
      <span class="tetris-info">ライン: <b id="tetLines">0</b></span>
      <div class="tetris-next-wrap">
        <span class="tetris-next-label">つぎ</span>
        <div class="tetris-next" id="tetNext"></div>
      </div>
      <button class="tetris-pause-btn" id="tetPauseBtn">⏸ 一時停止</button>
    </div>
    <div class="tetris-board-wrap" id="tetBoardWrap">
      <div class="tetris-grid" id="tetGrid" style="--cols:${cols};--rows:${ROWS}"></div>
      <div class="tetris-pause-label" id="tetPauseLabel">⏸ 一時停止中<br><span class="tetris-pause-sub">タップで再開</span></div>
    </div>
    <div class="tetris-controls">
      <div class="tetris-main-group">
        <button class="tetris-ctrl-btn" id="tetLeft">◀</button>
        <button class="tetris-ctrl-btn tetris-rotate-btn" id="tetRotate">⟳ 回転</button>
        <button class="tetris-ctrl-btn" id="tetRight">▶</button>
      </div>
      <button class="tetris-drop-btn" id="tetDrop">⏬ 一気に落とす</button>
    </div>
  `;
  const grid = shell.board.querySelector('#tetGrid');
  cellEls = [];
  for (let r = 0; r < ROWS; r++) {
    cellEls.push([]);
    for (let c = 0; c < cols; c++) {
      const cell = document.createElement('div');
      cell.className = 'tetris-cell';
      grid.appendChild(cell);
      cellEls[r].push(cell);
    }
  }
  shell.board.querySelector('#tetLeft').addEventListener('click', moveLeft);
  shell.board.querySelector('#tetRight').addEventListener('click', moveRight);
  shell.board.querySelector('#tetDrop').addEventListener('click', hardDrop);
  shell.board.querySelector('#tetRotate').addEventListener('click', rotatePiece);
  shell.board.querySelector('#tetPauseBtn').addEventListener('click', togglePause);
  shell.board.querySelector('#tetBoardWrap').addEventListener('click', () => { if (paused) togglePause(); });
}

// 現在のピースがこのまま真下に落ちたら止まる行を求める（着地予測用）
function ghostRow() {
  if (!piece) return null;
  let r = piece.row;
  while (!collides(piece.type, piece.rotation, r + 1, piece.col)) r++;
  return r;
}

function renderBoard() {
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < cols; c++) {
      const colorId = board[r][c];
      setCellColor(cellEls[r][c], colorId);
    }
  }
  if (piece) {
    const gr = ghostRow();
    if (gr !== null && gr !== piece.row) {
      for (const [dr, dc] of cellsOf(piece.type, piece.rotation)) {
        const r = gr + dr, c = piece.col + dc;
        if (r >= 0 && r < ROWS && c >= 0 && c < cols) setCellGhost(cellEls[r][c], colorIdOf(piece.type));
      }
    }
    for (const [dr, dc] of cellsOf(piece.type, piece.rotation)) {
      const r = piece.row + dr, c = piece.col + dc;
      if (r >= 0 && r < ROWS && c >= 0 && c < cols) setCellColor(cellEls[r][c], colorIdOf(piece.type));
    }
  }
  renderNextQueue();
}

function setCellColor(el, colorId) {
  el.className = 'tetris-cell' + (colorId ? ` tetris-c${colorId}` : '');
}
function setCellGhost(el, colorId) {
  el.className = `tetris-cell tetris-ghost tetris-ghost-c${colorId}`;
}

function renderNextQueue() {
  const box = shell.board.querySelector('#tetNext');
  if (!box) return;
  box.innerHTML = '';
  nextQueue.slice(0, NEXT_COUNT).forEach((type) => {
    const mini = document.createElement('div');
    mini.className = 'tetris-mini';
    const cells = cellsOf(type, 0);
    const minR = Math.min(...cells.map((p) => p[0]));
    const maxR = Math.max(...cells.map((p) => p[0]));
    const minC = Math.min(...cells.map((p) => p[1]));
    const maxC = Math.max(...cells.map((p) => p[1]));
    const rowOffset = Math.floor((4 - (maxR - minR + 1)) / 2);
    const colOffset = Math.floor((4 - (maxC - minC + 1)) / 2);
    for (const [dr, dc] of cells) {
      const dot = document.createElement('span');
      dot.className = `tetris-mini-dot tetris-c${colorIdOf(type)}`;
      dot.style.gridRow = dr - minR + 1 + rowOffset;
      dot.style.gridColumn = dc - minC + 1 + colOffset;
      mini.appendChild(dot);
    }
    box.appendChild(mini);
  });
}

function updateToolbar() {
  const lv = shell.board.querySelector('#tetLevel');
  const ln = shell.board.querySelector('#tetLines');
  if (lv) lv.textContent = level;
  if (ln) ln.textContent = totalLines;
}

function showPlaceholder() {
  shell.board.className = 's-board';
  shell.board.innerHTML = '<div class="tetris-placeholder">「スタート」を押すとブロックが降ってきます</div>';
}

/* ---------- 終了 ---------- */
function triggerGameOver() {
  gameOver = true;
  clearTimeout(tickTimer);
  shell.playTone(220, 0.3, 'sawtooth');
  shell.end(`ゲームオーバー！スコア: ${shell.getScore()}（レベル${level}・${totalLines}ライン）`);
}

/* ---------- キーボード操作（PC向け） ---------- */
document.addEventListener('keydown', (e) => {
  if (!shell.running) return;
  if (e.key === 'ArrowLeft') { moveLeft(); e.preventDefault(); }
  else if (e.key === 'ArrowRight') { moveRight(); e.preventDefault(); }
  else if (e.key === 'ArrowUp') { rotatePiece(); e.preventDefault(); }
  else if (e.key === 'ArrowDown') { hardDrop(); e.preventDefault(); }
});

/* ---- GameShellのライフサイクルに接続 ---- */
shell.onStart(() => {
  cols = shell.hardMode ? HARD_COLS : NORMAL_COLS;
  board = Array.from({ length: ROWS }, () => Array(cols).fill(null));
  bag = [];
  nextQueue = [];
  score = 0;
  totalLines = 0;
  level = 1;
  gameOver = false;
  paused = false;

  buildDom();
  fillNextQueue();
  spawnPiece();
  updateToolbar();
  renderBoard();
  scheduleTick();
});

shell.onReset(() => {
  clearTimeout(tickTimer);
  gameOver = true;
  paused = false;
  piece = null;
  showPlaceholder();
});

shell.onHardModeChange(() => {
  // running中は呼ばれない（GameShell側で保証）。次回スタート時のcolsに反映される。
});

showPlaceholder();
