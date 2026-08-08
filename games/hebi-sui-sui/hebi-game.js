/* =========================================================
   へびすいすい🐍 固有ロジック
   共通土台(GameShell)のAPIだけを使い、盤面生成・移動・当たり判定を実装。
   通常: 9x9マス / 激むず: 11x11マス（速度アップ）
   操作: 盤面下の十字ボタン固定配置。逆走入力は無視（自殺回避）。
   ========================================================= */

const shell = new GameShell({
  rootSelector: '#app',
  title: 'へびすいすい🐍',
  hint: '盤面の左右をタップして向きを変え、ネズミを食べて長くなろう（左半分＝左折／右半分＝右折、タイトル5回タップで激むず）',
  hasScore: true,
  hasTimer: false,
});

const NORMAL_MODE = { size: 9, tickMs: 280 };
const HARD_MODE   = { size: 11, tickMs: 190 };

let gridSize = NORMAL_MODE.size;
let tickMs = NORMAL_MODE.tickMs;
let cellEls = [];
let snake = [];       // [{r,c}, ...] 先頭が頭
let dir = { dr: 0, dc: 1 };
let nextDir = { dr: 0, dc: 1 };
let mouse = null;     // {r,c}
let tickTimer = null;
let gameOver = true;

/* ---------- 盤面構築 ---------- */
function buildBoard() {
  const mode = shell.hardMode ? HARD_MODE : NORMAL_MODE;
  gridSize = mode.size;
  tickMs = mode.tickMs;

  shell.board.className = 's-board hebi-board';
  shell.board.innerHTML = `<div class="hebi-grid" id="hebiGrid" style="--size:${gridSize}"></div>`;

  const grid = shell.board.querySelector('#hebiGrid');
  cellEls = [];
  for (let r = 0; r < gridSize; r++) {
    cellEls.push([]);
    for (let c = 0; c < gridSize; c++) {
      const cell = document.createElement('div');
      cell.className = 'hebi-cell';
      grid.appendChild(cell);
      cellEls[r].push(cell);
    }
  }

  grid.addEventListener('pointerdown', onBoardTap);
}

function showPlaceholder() {
  shell.board.className = 's-board';
  shell.board.innerHTML = '<div class="hebi-placeholder">「スタート」を押すとヘビが動き出します</div>';
}

/* ---------- 進行制御 ----------
   盤面の左右どちらをタップ/クリックしたかで「今の向きから見て左折/右折」を決める。
   絶対方向(上下左右ボタン)より直感的で、PCマウスでもワンクリックで操作できる。
   相対ターンなので反転(逆走)は原理上発生しない。 */
function turnLeft(d) {
  if (d.dc === 1) return { dr: -1, dc: 0 };
  if (d.dc === -1) return { dr: 1, dc: 0 };
  if (d.dr === 1) return { dr: 0, dc: 1 };
  return { dr: 0, dc: -1 };
}
function turnRight(d) {
  if (d.dc === 1) return { dr: 1, dc: 0 };
  if (d.dc === -1) return { dr: -1, dc: 0 };
  if (d.dr === 1) return { dr: 0, dc: -1 };
  return { dr: 0, dc: 1 };
}
function headRotation(d) {
  if (d.dc === 1) return 0;
  if (d.dr === 1) return 90;
  if (d.dc === -1) return 180;
  return 270;
}
function onBoardTap(e) {
  if (!shell.running || gameOver) return;
  const rect = shell.board.querySelector('#hebiGrid').getBoundingClientRect();
  const x = e.clientX - rect.left;
  nextDir = x < rect.width / 2 ? turnLeft(dir) : turnRight(dir);
}

function startGame() {
  gameOver = false;
  const mid = Math.floor(gridSize / 2);
  snake = [
    { r: mid, c: mid },
    { r: mid, c: mid - 1 },
    { r: mid, c: mid - 2 },
  ];
  dir = { dr: 0, dc: 1 };
  nextDir = { dr: 0, dc: 1 };
  placeMouse();
  renderAll();
  clearInterval(tickTimer);
  tickTimer = setInterval(tick, tickMs);
}

function placeMouse() {
  const empty = [];
  for (let r = 0; r < gridSize; r++) {
    for (let c = 0; c < gridSize; c++) {
      if (!snake.some((s) => s.r === r && s.c === c)) empty.push({ r, c });
    }
  }
  mouse = empty[(Math.random() * empty.length) | 0];
}

function tick() {
  if (!shell.running || gameOver) return;
  dir = nextDir;
  const head = snake[0];
  const newHead = { r: head.r + dir.dr, c: head.c + dir.dc };

  // 壁：ぶつからず反対側から出てくる（ワープ）
  newHead.r = (newHead.r + gridSize) % gridSize;
  newHead.c = (newHead.c + gridSize) % gridSize;

  const ate = mouse && newHead.r === mouse.r && newHead.c === mouse.c;
  // 自分の体判定（食べる時は尻尾が動かないので尻尾も含めて判定）
  const bodyToCheck = ate ? snake : snake.slice(0, -1);
  if (bodyToCheck.some((s) => s.r === newHead.r && s.c === newHead.c)) {
    return endGame();
  }

  snake.unshift(newHead);
  if (ate) {
    shell.addScore(10);
    shell.playTone(760, 0.1);
    shell.showPopup(cellEls[newHead.r][newHead.c], '+10', 'good');
    placeMouse();
  } else {
    snake.pop();
  }
  renderAll();
}

function endGame() {
  gameOver = true;
  clearInterval(tickTimer);
  shell.playTone(220, 0.3, 'sawtooth');
  shell.end(`ゲームオーバー！長さ: ${snake.length}`);
}

/* ---------- 描画 ---------- */
function renderAll() {
  for (let r = 0; r < gridSize; r++) {
    for (let c = 0; c < gridSize; c++) {
      cellEls[r][c].className = 'hebi-cell';
    }
  }
  snake.forEach((s, i) => {
    if (i === 0) {
      const headEl = cellEls[s.r][s.c];
      headEl.classList.add('hebi-head');
      headEl.style.setProperty('--head-rot', `${headRotation(dir)}deg`);
    } else {
      cellEls[s.r][s.c].classList.add('hebi-body');
    }
  });
  if (mouse) cellEls[mouse.r][mouse.c].classList.add('hebi-mouse');
}

showPlaceholder();

/* ---- GameShellのライフサイクルに接続 ---- */
shell.onStart(() => {
  buildBoard();
  startGame();
});
shell.onReset(() => {
  clearInterval(tickTimer);
  gameOver = true;
  showPlaceholder();
});
shell.onHardModeChange(() => {
  // running中は呼ばれない（GameShell側で保証）。次回スタート時のサイズ・速度に反映される。
});
