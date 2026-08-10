/* =========================================================
   ぷるぷるコネクト🫧 固有ロジック
   共通土台(GameShell)のAPIだけを使い、盤面生成・落下・回転・
   連結消去（4個以上）・連鎖処理・一時停止を実装。
   通常: 6x9・4色 / 激むず: 6x10・5色（落下速度アップ）
   盤面サイズはiPhone16e基準でスマホスクロール不要に調整済み。
   操作: ◀▶回転ボタン＋「一気に落とす」ボタン、矢印キーにも対応。
   ========================================================= */

const shell = new GameShell({
  rootSelector: '#app',
  title: 'ぷるぷるコネクト🫧',
  hint: '同じ色を4つ以上つなげて消そう。（矢印キーにも対応、タイトル5回タップで激むず）',
  hasScore: true,
  hasTimer: false,
});

const NORMAL_MODE = { cols: 6, rows: 9, colorCount: 4, tickMs: 900 };
const HARD_MODE   = { cols: 6, rows: 10, colorCount: 5, tickMs: 550 };
const MATCH_MIN = 4;
const LOCK_ANIM_MS = 280;
const CLEAR_GLOW_MS = 200;
const CLEAR_SHRINK_MS = 220;
const CASCADE_GAP_MS = 200;

let COLS = NORMAL_MODE.cols, ROWS = NORMAL_MODE.rows, COLOR_COUNT = NORMAL_MODE.colorCount, tickMs = NORMAL_MODE.tickMs;
let boardGrid = [];    // boardGrid[row][col] = colorIndex|null（着地済み）
let cellEls = [];
let fallTimer = null;
let piece = null;      // { axisRow, axisCol, subRow, subCol, rot, axisColor, subColor }
let nextColors = null; // [axisColor, subColor]
let resolving = false; // 消去演出中は操作を受け付けない
let paused = false;
let gameOver = true;
let nextPreviewEl = null;

/* ---------- ユーティリティ ---------- */
function randColor() { return (Math.random() * COLOR_COUNT) | 0; }
function inBounds(r, c) { return r >= 0 && r < ROWS && c >= 0 && c < COLS; }
function isEmpty(r, c) { return inBounds(r, c) && boardGrid[r][c] === null; }

// 回転状態(0:上 1:右 2:下 3:左) → 軸に対する副ぷよの相対位置
function subOffset(rot) {
  if (rot === 0) return [-1, 0];
  if (rot === 1) return [0, 1];
  if (rot === 2) return [1, 0];
  return [0, -1];
}
function computeSub(axisRow, axisCol, rot) {
  const [dr, dc] = subOffset(rot);
  return [axisRow + dr, axisCol + dc];
}

function isValidPos(axisRow, axisCol, subRow, subCol) {
  if (!inBounds(axisRow, axisCol) || !inBounds(subRow, subCol)) return false;
  if (boardGrid[axisRow][axisCol] !== null) return false;
  if (boardGrid[subRow][subCol] !== null) return false;
  return true;
}

/* ---------- 初期化 ---------- */
function buildBoard() {
  const mode = shell.hardMode ? HARD_MODE : NORMAL_MODE;
  COLS = mode.cols; ROWS = mode.rows; COLOR_COUNT = mode.colorCount; tickMs = mode.tickMs;

  boardGrid = Array.from({ length: ROWS }, () => Array(COLS).fill(null));
  resolving = false;
  paused = false;
  gameOver = false;
  nextColors = [randColor(), randColor()];

  shell.board.className = 's-board puyo-board';
  shell.board.innerHTML = `
    <div class="puyo-toolbar">
      <span class="puyo-next-wrap">
        <span class="puyo-next-label">つぎ</span>
        <span class="puyo-next-preview" id="puyoNextPreview"></span>
      </span>
      <button class="puyo-pause-btn" id="puyoPauseBtn">⏸ 一時停止</button>
    </div>
    <div class="puyo-board-wrap" id="puyoBoardWrap">
      <div class="puyo-grid" id="puyoGrid" style="--cols:${COLS};--rows:${ROWS}"></div>
      <div class="puyo-pause-label" id="puyoPauseLabel">⏸ 一時停止中<br><span class="puyo-pause-sub">タップで再開</span></div>
    </div>
    <div class="puyo-controls">
      <div class="puyo-main-group">
        <button class="puyo-ctrl-btn" id="puyoLeftBtn">◀</button>
        <button class="puyo-ctrl-btn puyo-rotate-btn" id="puyoRotateBtn">⟳ 回転</button>
        <button class="puyo-ctrl-btn" id="puyoRightBtn">▶</button>
      </div>
      <button class="puyo-drop-btn" id="puyoDropBtn">⬇ 一気に落とす</button>
    </div>
  `;

  const grid = shell.board.querySelector('#puyoGrid');
  cellEls = [];
  for (let r = 0; r < ROWS; r++) {
    cellEls.push([]);
    for (let c = 0; c < COLS; c++) {
      const cell = document.createElement('div');
      cell.className = 'puyo-cell';
      grid.appendChild(cell);
      cellEls[r].push(cell);
    }
  }
  nextPreviewEl = shell.board.querySelector('#puyoNextPreview');

  shell.board.querySelector('#puyoLeftBtn').addEventListener('click', () => moveHorizontal(-1));
  shell.board.querySelector('#puyoRightBtn').addEventListener('click', () => moveHorizontal(1));
  shell.board.querySelector('#puyoRotateBtn').addEventListener('click', rotatePiece);
  shell.board.querySelector('#puyoDropBtn').addEventListener('click', hardDrop);
  shell.board.querySelector('#puyoPauseBtn').addEventListener('click', togglePause);
  shell.board.querySelector('#puyoBoardWrap').addEventListener('click', () => { if (paused) togglePause(); });

  spawnPiece();
  renderAll();
  clearInterval(fallTimer);
  fallTimer = setInterval(tick, tickMs);
}

function showPlaceholder() {
  shell.board.className = 's-board';
  shell.board.innerHTML = '<div class="puyo-placeholder">「スタート」を押すとぷよが落ちてきます</div>';
}

/* ---------- 一時停止 ---------- */
function togglePause() {
  if (!shell.running || gameOver) return;
  paused = !paused;
  const grid = shell.board.querySelector('#puyoGrid');
  const label = shell.board.querySelector('#puyoPauseLabel');
  const btn = shell.board.querySelector('#puyoPauseBtn');
  if (paused) {
    clearInterval(fallTimer);
    if (grid) grid.classList.add('puyo-dimmed');
    if (label) label.style.display = 'block';
    if (btn) btn.textContent = '▶ 再開';
  } else {
    if (grid) grid.classList.remove('puyo-dimmed');
    if (label) label.style.display = 'none';
    if (btn) btn.textContent = '⏸ 一時停止';
    clearInterval(fallTimer);
    fallTimer = setInterval(tick, tickMs);
  }
}

/* ---------- 出現 ---------- */
function spawnPiece() {
  const axisCol = (COLS / 2) | 0;
  const axisRow = 1;
  const subRow = 0;
  const [axisColor, subColor] = nextColors;
  piece = { axisRow, axisCol, subRow, subCol: axisCol, rot: 0, axisColor, subColor };
  nextColors = [randColor(), randColor()];
  renderNextPreview();

  if (!isEmpty(axisRow, axisCol) || !isEmpty(subRow, axisCol)) {
    triggerGameOver();
  }
}

function renderNextPreview() {
  if (!nextPreviewEl) return;
  // 出現時は副ぷよが上・軸ぷよが下なので、見た目もその並びに合わせる
  nextPreviewEl.innerHTML = `
    <span class="puyo-next-dot puyo-c${nextColors[1]}"></span>
    <span class="puyo-next-dot puyo-c${nextColors[0]}"></span>
  `;
}

/* ---------- 移動・回転 ---------- */
function moveHorizontal(dir) {
  if (!shell.running || !piece || resolving || paused) return;
  const newAxisCol = piece.axisCol + dir;
  const newSubCol = piece.subCol + dir;
  if (isValidPos(piece.axisRow, newAxisCol, piece.subRow, newSubCol)) {
    piece.axisCol = newAxisCol;
    piece.subCol = newSubCol;
    renderAll();
  }
}

function rotatePiece() {
  if (!shell.running || !piece || resolving || paused) return;
  const newRot = (piece.rot + 1) % 4;
  const [nr, nc] = computeSub(piece.axisRow, piece.axisCol, newRot);

  if (isValidPos(piece.axisRow, piece.axisCol, nr, nc)) {
    piece.rot = newRot; piece.subRow = nr; piece.subCol = nc;
    shell.playTone(480, 0.06);
    renderAll();
    return;
  }
  // 壁際の簡易キック：軸ごと1マス反対側へずらして再試行
  for (const kick of [-1, 1]) {
    const kAxisCol = piece.axisCol + kick;
    const [kr, kc] = computeSub(piece.axisRow, kAxisCol, newRot);
    if (isValidPos(piece.axisRow, kAxisCol, kr, kc)) {
      piece.axisCol = kAxisCol; piece.subCol = kc; piece.subRow = kr; piece.rot = newRot;
      shell.playTone(480, 0.06);
      renderAll();
      return;
    }
  }
}

/* ---------- 落下 ---------- */
function tick() {
  if (!shell.running || !piece || resolving || paused) return;
  attemptFall();
}

function attemptFall() {
  const newAxisRow = piece.axisRow + 1;
  const newSubRow = piece.subRow + 1;
  if (isValidPos(newAxisRow, piece.axisCol, newSubRow, piece.subCol)) {
    piece.axisRow = newAxisRow;
    piece.subRow = newSubRow;
    renderAll();
    return true;
  }
  lockPiece();
  return false;
}

function hardDrop() {
  if (!shell.running || !piece || resolving || paused) return;
  while (attemptFall()) { /* 落ちきるまで繰り返す */ }
}

function lockPiece() {
  clearInterval(fallTimer);
  boardGrid[piece.axisRow][piece.axisCol] = piece.axisColor;
  boardGrid[piece.subRow][piece.subCol] = piece.subColor;
  const lockedCells = [[piece.axisRow, piece.axisCol], [piece.subRow, piece.subCol]];
  piece = null;
  resolving = true;
  renderAll();

  lockedCells.forEach(([r, c]) => {
    cellEls[r][c].classList.add('puyo-landed');
    setTimeout(() => cellEls[r][c] && cellEls[r][c].classList.remove('puyo-landed'), LOCK_ANIM_MS);
  });
  pulseConnections(lockedCells);

  shell.playTone(320, 0.06);
  setTimeout(() => resolveBoard(0), LOCK_ANIM_MS);
}

// 着地したぷよの隣に同色があれば、両方を軽くパルスさせて「くっつく」感を出す演出
function pulseConnections(cells) {
  const toPulse = new Set();
  cells.forEach(([r, c]) => {
    const color = boardGrid[r][c];
    if (color === null) return;
    for (const [nr, nc] of [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]]) {
      if (inBounds(nr, nc) && boardGrid[nr][nc] === color) {
        toPulse.add(`${r},${c}`);
        toPulse.add(`${nr},${nc}`);
      }
    }
  });
  toPulse.forEach((key) => {
    const [r, c] = key.split(',').map(Number);
    const el = cellEls[r][c];
    if (!el) return;
    el.classList.add('puyo-attract');
    setTimeout(() => el && el.classList.remove('puyo-attract'), 260);
  });
}

/* ---------- 重力（浮いたぷよを下に詰める） ---------- */
function applyGravity() {
  let moved = false;
  for (let c = 0; c < COLS; c++) {
    const vals = [];
    for (let r = 0; r < ROWS; r++) if (boardGrid[r][c] !== null) vals.push(boardGrid[r][c]);
    const missing = ROWS - vals.length;
    for (let i = 0; i < missing; i++) vals.unshift(null);
    for (let r = 0; r < ROWS; r++) {
      if (boardGrid[r][c] !== vals[r]) moved = true;
      boardGrid[r][c] = vals[r];
    }
  }
  return moved;
}

/* ---------- 連結判定・消去（連鎖） ---------- */
function findMatches() {
  const visited = Array.from({ length: ROWS }, () => Array(COLS).fill(false));
  const matched = new Set();
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (visited[r][c] || boardGrid[r][c] === null) continue;
      const color = boardGrid[r][c];
      const stack = [[r, c]];
      visited[r][c] = true;
      const group = [];
      while (stack.length) {
        const [cr, cc] = stack.pop();
        group.push([cr, cc]);
        for (const [nr, nc] of [[cr - 1, cc], [cr + 1, cc], [cr, cc - 1], [cr, cc + 1]]) {
          if (inBounds(nr, nc) && !visited[nr][nc] && boardGrid[nr][nc] === color) {
            visited[nr][nc] = true;
            stack.push([nr, nc]);
          }
        }
      }
      if (group.length >= MATCH_MIN) group.forEach(([gr, gc]) => matched.add(`${gr},${gc}`));
    }
  }
  return matched;
}

function resolveBoard(chainLevel) {
  const felt = applyGravity();
  renderAll();

  const check = () => {
    const matched = findMatches();
    if (matched.size === 0) {
      resolving = false;
      finishTurn();
      return;
    }
    processMatches(matched, chainLevel);
  };

  if (felt) setTimeout(check, CASCADE_GAP_MS);
  else check();
}

function processMatches(matched, chainLevel) {
  matched.forEach((key) => {
    const [r, c] = key.split(',').map(Number);
    cellEls[r][c].classList.add('puyo-match-glow');
  });

  const gained = Math.round(matched.size * 10 * (1 + 0.5 * chainLevel));
  shell.addScore(gained);
  playClearSound(chainLevel);

  const [fr, fc] = matched.values().next().value.split(',').map(Number);
  const anchorEl = cellEls[fr][fc];
  const text = chainLevel > 0 ? `${chainLevel + 1}連鎖！+${gained}` : `+${gained}`;
  shell.showPopup(anchorEl, text, chainLevel > 0 ? 'bonus' : 'good');

  setTimeout(() => {
    matched.forEach((key) => {
      const [r, c] = key.split(',').map(Number);
      cellEls[r][c].classList.remove('puyo-match-glow');
      cellEls[r][c].classList.add('puyo-matched');
    });
    setTimeout(() => {
      matched.forEach((key) => {
        const [r, c] = key.split(',').map(Number);
        boardGrid[r][c] = null;
      });
      resolveBoard(chainLevel + 1);
    }, CLEAR_SHRINK_MS);
  }, CLEAR_GLOW_MS);
}

function playClearSound(chainLevel) {
  const tier = Math.min(chainLevel, 4);
  const freqsList = [
    [660],
    [660, 880],
    [660, 880, 1046.5],
    [660, 880, 1046.5, 1318.51],
    [523.25, 659.25, 783.99, 1046.5, 1318.51],
  ];
  const freqs = freqsList[tier];
  freqs.forEach((f, i) => setTimeout(() => shell.playTone(f, 0.1, tier >= 3 ? 'triangle' : 'sine'), i * 80));
}

function finishTurn() {
  if (gameOver) return;
  spawnPiece();
  renderAll();
  if (!gameOver) {
    clearInterval(fallTimer);
    fallTimer = setInterval(tick, tickMs);
  }
}

function triggerGameOver() {
  gameOver = true;
  piece = null;
  clearInterval(fallTimer);
  shell.playTone(220, 0.3, 'sawtooth');
  shell.end(`ゲームオーバー！スコア: ${shell.getScore()}`);
}

/* ---------- 描画 ---------- */
function renderAll() {
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const el = cellEls[r][c];
      const val = boardGrid[r][c];
      el.className = 'puyo-cell';
      if (val !== null) el.classList.add('puyo-filled', `puyo-c${val}`);
    }
  }
  if (piece) {
    paintPieceCell(piece.axisRow, piece.axisCol, piece.axisColor);
    paintPieceCell(piece.subRow, piece.subCol, piece.subColor);
  }
}

function paintPieceCell(r, c, color) {
  if (!inBounds(r, c)) return;
  cellEls[r][c].className = `puyo-cell puyo-filled puyo-c${color}`;
}

/* ---------- キーボード操作 ---------- */
document.addEventListener('keydown', (e) => {
  if (!shell.running) return;
  if (e.key === 'ArrowLeft') { moveHorizontal(-1); e.preventDefault(); }
  else if (e.key === 'ArrowRight') { moveHorizontal(1); e.preventDefault(); }
  else if (e.key === 'ArrowUp') { rotatePiece(); e.preventDefault(); }
  else if (e.key === 'ArrowDown') { hardDrop(); e.preventDefault(); }
});

showPlaceholder();

/* ---- GameShellのライフサイクルに接続 ---- */
shell.onStart(() => {
  buildBoard();
});
shell.onReset(() => {
  clearInterval(fallTimer);
  gameOver = true;
  paused = false;
  piece = null;
  showPlaceholder();
});
shell.onHardModeChange(() => {
  // running中は呼ばれない（GameShell側で保証）。次回スタート時のサイズ・速度に反映される。
});
