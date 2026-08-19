/* =========================================================
   マインスイーパー💣 固有ロジック
   共通土台(GameShell)のAPIだけを使い、盤面生成・開封・旗/？判定を実装。
   モードは「開く／旗／？」の3ボタン切替式（右クリック・長押し不要）。
   ========================================================= */

const shell = new GameShell({
  rootSelector: '#app',
  title: 'マインスイーパー💣',
  hint: '👆／🚩／❓のモードを切り替えて、地雷のないマスをすべて開けましょう',
  hasScore: false,
  hasTimer: false,
});

const NORMAL = { rows: 8, cols: 8, mines: 10 };
const HARD   = { rows: 10, cols: 10, mines: 20 };

let rows, cols, mineCount;
let board = [];      // { mine, revealed, state:'hidden'|'flag'|'question', adjacent }
let cellEls = [];
let mode = 'open';   // 'open' | 'flag' | 'question'
let firstClickDone = false;
let revealedCount = 0;
let flaggedCount = 0;
let gameOver = false;

function forEachNeighbor(r, c, fn) {
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue;
      const nr = r + dr, nc = c + dc;
      if (nr >= 0 && nr < rows && nc >= 0 && nc < cols) fn(nr, nc);
    }
  }
}

function buildEmptyBoard(r, c) {
  rows = r; cols = c;
  board = Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => ({ mine: false, revealed: false, state: 'hidden', adjacent: 0 }))
  );
}

/* 最初にタップしたマスとその周囲8マスには地雷を置かない（いきなり事故を防ぐ） */
function placeMines(excludeR, excludeC) {
  const forbidden = new Set([`${excludeR},${excludeC}`]);
  forEachNeighbor(excludeR, excludeC, (r, c) => forbidden.add(`${r},${c}`));

  let placed = 0;
  while (placed < mineCount) {
    const r = (Math.random() * rows) | 0;
    const c = (Math.random() * cols) | 0;
    if (forbidden.has(`${r},${c}`) || board[r][c].mine) continue;
    board[r][c].mine = true;
    placed++;
  }
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (board[r][c].mine) continue;
      let n = 0;
      forEachNeighbor(r, c, (nr, nc) => { if (board[nr][nc].mine) n++; });
      board[r][c].adjacent = n;
    }
  }
}

function buildBoard() {
  const size = shell.hardMode ? HARD : NORMAL;
  buildEmptyBoard(size.rows, size.cols);
  mineCount = size.mines;
  firstClickDone = false;
  revealedCount = 0;
  flaggedCount = 0;
  gameOver = false;
  mode = 'open';

  shell.board.className = 's-board mine-board';
  shell.board.innerHTML = `
    <div class="mine-toolbar">
      <div class="mine-modes">
        <button class="mine-mode-btn" data-mode="open">👆 開く</button>
        <button class="mine-mode-btn" data-mode="flag">🚩 旗</button>
        <button class="mine-mode-btn" data-mode="question">❓ ？</button>
      </div>
      <span class="mine-remain">残り🚩: <b id="mineRemain">${mineCount}</b></span>
    </div>
    <div class="mine-grid" id="mineGrid" style="--cols:${cols}"></div>
  `;
  shell.board.querySelectorAll('.mine-mode-btn').forEach((btn) => {
    btn.addEventListener('click', () => setMode(btn.dataset.mode));
  });
  setMode('open');

  const grid = shell.board.querySelector('#mineGrid');
  cellEls = [];
  for (let r = 0; r < rows; r++) {
    cellEls.push([]);
    for (let c = 0; c < cols; c++) {
      const btn = document.createElement('button');
      btn.className = 'mine-cell';
      btn.addEventListener('click', () => onCellClick(r, c));
      grid.appendChild(btn);
      cellEls[r].push(btn);
    }
  }
}

function setMode(m) {
  mode = m;
  shell.board.querySelectorAll('.mine-mode-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.mode === m);
  });
}

function updateRemain() {
  const el = shell.board.querySelector('#mineRemain');
  if (el) el.textContent = mineCount - flaggedCount;
}

function renderCell(r, c) {
  const cell = board[r][c];
  const el = cellEls[r][c];
  el.className = 'mine-cell';
  el.textContent = '';
  if (cell.revealed) {
    el.classList.add('mine-revealed');
    if (cell.mine) {
      el.classList.add('mine-revealed-mine');
      el.textContent = '💣';
    } else if (cell.adjacent > 0) {
      el.classList.add(`mine-n${cell.adjacent}`);
      el.textContent = cell.adjacent;
    }
  } else if (cell.state === 'flag') {
    el.classList.add('mine-flagged');
    el.textContent = '🚩';
  } else if (cell.state === 'question') {
    el.classList.add('mine-question');
    el.textContent = '❓';
  }
}

function renderAll() {
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) renderCell(r, c);
  updateRemain();
}

function onCellClick(r, c) {
  if (!shell.running || gameOver) return;
  const cell = board[r][c];

  if (mode === 'open') {
    if (cell.revealed || cell.state === 'flag') return;
    if (!firstClickDone) {
      placeMines(r, c);
      firstClickDone = true;
    }
    openCell(r, c);
    checkWin();
  } else if (mode === 'flag') {
    if (cell.revealed) return;
    if (cell.state === 'flag') { cell.state = 'hidden'; flaggedCount--; shell.playTone(420, 0.06); }
    else { cell.state = 'flag'; flaggedCount++; shell.playTone(600, 0.08); }
    renderCell(r, c);
    updateRemain();
  } else if (mode === 'question') {
    if (cell.revealed) return;
    if (cell.state === 'question') { cell.state = 'hidden'; }
    else {
      if (cell.state === 'flag') flaggedCount--;
      cell.state = 'question';
    }
    shell.playTone(500, 0.06, 'triangle');
    renderCell(r, c);
    updateRemain();
  }
}

function openCell(r, c, isUserTap = true) {
  const cell = board[r][c];
  if (cell.revealed || cell.state === 'flag') return;
  cell.revealed = true;
  cell.state = 'hidden';
  revealedCount++;
  renderCell(r, c);

  if (cell.mine) {
    triggerGameOver(r, c);
    return;
  }
  // 連鎖オープンで音が重なって大きく聞こえないよう、実際にタップしたマスの分だけ鳴らす
  if (isUserTap) shell.playTone(cell.adjacent ? 640 + cell.adjacent * 20 : 720, 0.06);

  if (cell.adjacent === 0) {
    forEachNeighbor(r, c, (nr, nc) => {
      if (!board[nr][nc].revealed && board[nr][nc].state !== 'flag') openCell(nr, nc, false);
    });
  }
}

function triggerGameOver(r, c) {
  gameOver = true;
  for (let rr = 0; rr < rows; rr++) {
    for (let cc = 0; cc < cols; cc++) {
      if (board[rr][cc].mine && !board[rr][cc].revealed) {
        board[rr][cc].revealed = true;
        renderCell(rr, cc);
      }
    }
  }
  cellEls[r][c].classList.add('mine-exploded');
  shell.playTone(180, 0.3, 'sawtooth');
  shell.end('ゲームオーバー…💥');
}

function checkWin() {
  const totalSafe = rows * cols - mineCount;
  if (revealedCount === totalSafe && !gameOver) {
    gameOver = true;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (board[r][c].mine && board[r][c].state !== 'flag') {
          board[r][c].state = 'flag';
          renderCell(r, c);
        }
      }
    }
    updateRemain();
    [523.25, 659.25, 783.99, 1046.5].forEach((freq, i) =>
      setTimeout(() => shell.playTone(freq, 0.16, 'triangle'), i * 100)
    );
    shell.end('クリア！すべて開けました🎉');
  }
}

function showPlaceholder() {
  shell.board.className = 's-board';
  shell.board.innerHTML = '<div class="mine-placeholder">「スタート」を押すと盤面が生成されます</div>';
}

showPlaceholder();

/* ---- GameShellのライフサイクルに接続 ---- */
shell.onStart(() => {
  buildBoard();
  renderAll();
});
shell.onReset(() => {
  showPlaceholder();
});
