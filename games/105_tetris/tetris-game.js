/* =========================================================
   落ちものパズル🧩 固有ロジック
   共通土台(GameShell)のAPIだけを使い、盤面生成・落下・回転・
   ライン消去・レベル加速を実装。
   通常: 10x20 / 激むず: 8x20（幅が狭い分、詰みやすくなる）
   操作: 画面下の矢印ボタン（←→↓・回転）固定配置。
   ========================================================= */

const shell = new GameShell({
  rootSelector: '#app',
  title: '落ちものパズル🧩',
  hint: '下のボタンでブロックを動かしましょう。列を横一列そろえると消えます。',
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
let clearing = false;   // 4列消し演出中（落下・操作を止める）
let flashRows = [];     // 演出中に光らせる行
let effectTimer = null;
const QUAD_EFFECT_MS = 500;

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
  if (!shell.running || gameOver || paused || clearing) return;
  if (tryMove(0, -1)) { shell.playTone(420, 0.04); renderBoard(); }
}
function moveRight() {
  if (!shell.running || gameOver || paused || clearing) return;
  if (tryMove(0, 1)) { shell.playTone(420, 0.04); renderBoard(); }
}
function hardDrop() {
  if (!shell.running || gameOver || paused || clearing || !piece) return;
  let dist = 0;
  while (tryMove(1, 0)) dist++;
  shell.playTone(210, 0.05, 'triangle');
  setTimeout(() => shell.playTone(150, 0.1, 'triangle'), 45);
  if (dist > 0) shell.addScore(dist * 2); // 落とした分だけ少しボーナス
  lockPiece();
  renderBoard();
}
function rotatePiece() {
  if (!shell.running || gameOver || paused || clearing || !piece) return;
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
  if (!shell.running || gameOver || clearing) return;
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
  if (!shell.running || gameOver || paused || clearing) return;
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
  const full = findFullRows();
  if (full.length >= 4) { playQuadEffect(full); return; } // 4列同時消しは特別演出
  const cleared = clearLines();
  if (cleared > 0) applyLineClear(cleared);
  if (!gameOver) spawnPiece();
  renderBoard();
}

function findFullRows() {
  const rows = [];
  for (let r = 0; r < ROWS; r++) {
    if (board[r].every((v) => v !== null)) rows.push(r);
  }
  return rows;
}

/* ---------- 4列同時消しの特別演出（金色に光る＋絵文字が舞う） ---------- */
function playQuadEffect(rows) {
  clearing = true;
  clearTimeout(tickTimer);
  flashRows = rows;
  renderBoard();
  playQuadSound();
  spawnQuadFx(rows);
  effectTimer = setTimeout(() => {
    clearing = false;
    flashRows = [];
    removeQuadFx();
    const cleared = clearLines();
    if (cleared > 0) applyLineClear(cleared, true);
    spawnPiece();
    renderBoard();
    if (!gameOver && shell.running) scheduleTick();
  }, QUAD_EFFECT_MS);
}

/* 4列消し専用サウンド：高音の速い上昇（キラキラ）→ 長めに響く2音（リーン） */
function playQuadSound() {
  const sparkle = [1046.5, 1318.5, 1568, 2093, 2637]; // C6 E6 G6 C7 E7
  sparkle.forEach((f, i) => setTimeout(() => shell.playTone(f, 0.12, 'sine'), i * 55));
  const ringAt = sparkle.length * 55;
  setTimeout(() => shell.playTone(2093, 0.8, 'sine'), ringAt);
  setTimeout(() => shell.playTone(2637, 0.6, 'sine'), ringAt + 30);
}

function spawnQuadFx(rows) {
  const wrap = shell.board.querySelector('#tetBoardWrap');
  if (!wrap) return;
  const emojis = ['✨', '🎉', '✨', '✨'];
  emojis.forEach((emoji, i) => {
    const r = rows[i % rows.length];
    const c = (Math.random() * cols) | 0;
    const cell = cellEls[r][c];
    const fx = document.createElement('span');
    fx.className = 'tetris-fx';
    fx.textContent = emoji;
    fx.style.left = `${cell.offsetLeft + cell.offsetWidth / 2}px`;
    fx.style.top = `${cell.offsetTop}px`;
    wrap.appendChild(fx);
  });
}
function removeQuadFx() {
  shell.board.querySelectorAll('.tetris-fx').forEach((el) => el.remove());
}

function clearLines() {
  const remaining = board.filter((row) => row.some((v) => v === null));
  const clearedCount = ROWS - remaining.length;
  while (remaining.length < ROWS) remaining.unshift(Array(cols).fill(null));
  board = remaining;
  return clearedCount;
}

function applyLineClear(count, silent) {
  totalLines += count;
  const gained = (LINE_SCORE[count] || LINE_SCORE[4]) * level;
  shell.addScore(gained);
  if (!silent) playLineClearSound(count);
  shell.toast(count >= 4 ? `大量消去！+${gained}` : `${count}ライン消去！+${gained}`);

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
  flashRows.forEach((r) => cellEls[r].forEach((el) => el.classList.add('tetris-flash')));
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

/* ---------- スタート前の自動デモ（文字なしで「落ちものパズル」と伝える） ----------
   2マス幅のすき間に□型が落ちてはまり、2列そろって金色に光って消える流れをループ再生。
   ゲーム本体の状態(board/piece等)には触れず、専用の変数で動かす。音は鳴らさない。 */
let demoActive = false;
let demoTimers = [];
let demoCells = [];
let demoCols = NORMAL_COLS;
let demoBoard = [];
let demoGap = 0;
const DEMO_STEP_MS = 110;
const DEMO_COLOR = colorIdOf('J'); // デモのピースは青（本番ではJ型の色。L型は本番ではオレンジ）

function demoLater(fn, ms) { demoTimers.push(setTimeout(fn, ms)); }

function stopDemo() {
  demoActive = false;
  demoTimers.forEach(clearTimeout);
  demoTimers = [];
}

function startDemo(c) {
  demoActive = true;
  demoCols = c;
  const grid = shell.board.querySelector('#tetGrid');
  demoCells = [];
  for (let r = 0; r < ROWS; r++) {
    demoCells.push([]);
    for (let col = 0; col < demoCols; col++) {
      const cell = document.createElement('div');
      cell.className = 'tetris-cell';
      grid.appendChild(cell);
      demoCells[r].push(cell);
    }
  }
  runDemoCycle();
}

function renderDemo(pieceRow, state, flash) {
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < demoCols; c++) setCellColor(demoCells[r][c], demoBoard[r][c]);
  }
  if (pieceRow !== null) {
    const landRow = ROWS - 3;
    // 着地予測は、回転が終わってから（本番と同じく、今の向きで落ちる先を示す）
    if (state === 2 && pieceRow !== landRow) {
      SHAPES.L[2].forEach(([dr, dc]) => setCellGhost(demoCells[landRow + dr][demoGap + dc], DEMO_COLOR));
    }
    SHAPES.L[state].forEach(([dr, dc]) => setCellColor(demoCells[pieceRow + dr][demoGap + dc], DEMO_COLOR));
  }
  (flash || []).forEach((r) => demoCells[r].forEach((el) => el.classList.add('tetris-flash')));
}

function demoFx(rows) {
  const wrap = shell.board.querySelector('#tetBoardWrap');
  if (!wrap) return;
  ['✨', '🎉', '✨', '✨'].forEach((emoji, i) => {
    const cell = demoCells[rows[i % rows.length]][(Math.random() * demoCols) | 0];
    const fx = document.createElement('span');
    fx.className = 'tetris-fx';
    fx.textContent = emoji;
    fx.style.left = `${cell.offsetLeft + cell.offsetWidth / 2}px`;
    fx.style.top = `${cell.offsetTop}px`;
    wrap.appendChild(fx);
  });
}

function runDemoCycle() {
  if (!demoActive) return;
  // L字ピースが「1マスのくぼみ＋その上の3マス幅」にぴったりはまる場面（g〜g+2が落ちる先）
  const g = (Math.random() * (demoCols - 2)) | 0;
  demoGap = g;
  const palette = [1, 2, 3, 4, 5, 7]; // 青(ピースの色)以外で積み、ピースが目立つようにする
  const pick = () => palette[(Math.random() * palette.length) | 0];
  demoBoard = Array.from({ length: ROWS }, () => Array(demoCols).fill(null));
  for (let c = 0; c < demoCols; c++) {
    if (c !== g) demoBoard[ROWS - 1][c] = pick();            // 最下段：gだけ空ける
    if (c < g || c > g + 2) demoBoard[ROWS - 2][c] = pick(); // その上：g〜g+2を空ける
  }
  // 少しだけ上にも積んで自然な盤面に（落ちる先の真上は空けておく）
  for (let c = 0; c < demoCols; c++) {
    if (c >= g && c <= g + 2) continue;
    if (Math.random() < 0.5) {
      demoBoard[ROWS - 3][c] = pick();
      if (Math.random() < 0.3) demoBoard[ROWS - 4][c] = pick();
    }
  }

  const landRow = ROWS - 3;
  const rotateAt = 5;       // この行まで落ちたところで1回転（縦のL→着地の向き）
  const fallStart = 700;
  renderDemo(0, 1);
  for (let r = 1; r <= landRow; r++) {
    demoLater(() => renderDemo(r, r >= rotateAt ? 2 : 1), fallStart + r * DEMO_STEP_MS);
  }

  const landedAt = fallStart + landRow * DEMO_STEP_MS + 80;
  demoLater(() => {
    SHAPES.L[2].forEach(([dr, dc]) => { demoBoard[landRow + dr][g + dc] = DEMO_COLOR; });
    renderDemo(null, 0, [ROWS - 2, ROWS - 1]);
    demoFx([ROWS - 2, ROWS - 1]);
  }, landedAt);
  demoLater(() => {
    removeQuadFx();
    const remaining = demoBoard.filter((row) => row.some((v) => v === null));
    while (remaining.length < ROWS) remaining.unshift(Array(demoCols).fill(null));
    demoBoard = remaining;
    renderDemo(null, 0);
  }, landedAt + QUAD_EFFECT_MS);
  demoLater(runDemoCycle, landedAt + QUAD_EFFECT_MS + 1300);
}

function showPlaceholder() {
  stopDemo();
  const c = shell.hardMode ? HARD_COLS : NORMAL_COLS;
  shell.board.className = 's-board tetris-board';
  shell.board.innerHTML = `
    <div class="tetris-demo-bar"><span class="tetris-demo-badge">見本 sample</span></div>
    <div class="tetris-board-wrap" id="tetBoardWrap">
      <div class="tetris-grid" id="tetGrid" style="--cols:${c};--rows:${ROWS}"></div>
    </div>
    <div class="tetris-placeholder-note">「スタート」を押すとブロックが降ってきます</div>
  `;
  startDemo(c);
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
  stopDemo();
  cols = shell.hardMode ? HARD_COLS : NORMAL_COLS;
  board = Array.from({ length: ROWS }, () => Array(cols).fill(null));
  bag = [];
  nextQueue = [];
  score = 0;
  totalLines = 0;
  level = 1;
  gameOver = false;
  paused = false;
  clearing = false;
  flashRows = [];
  clearTimeout(effectTimer);

  buildDom();
  fillNextQueue();
  spawnPiece();
  updateToolbar();
  renderBoard();
  scheduleTick();
});

shell.onReset(() => {
  clearTimeout(tickTimer);
  clearTimeout(effectTimer);
  clearing = false;
  flashRows = [];
  gameOver = true;
  paused = false;
  piece = null;
  showPlaceholder();
});

shell.onHardModeChange(() => {
  // running中は呼ばれない（GameShell側で保証）。デモ表示中だけ、盤面幅に合わせて作り直す。
  if (demoActive) showPlaceholder();
});

showPlaceholder();
