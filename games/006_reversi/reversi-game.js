/* =========================================================
   リバーシ⚫ 固有ロジック（CPU対戦）
   共通土台(GameShell)のAPIだけを使い、盤面生成・着手・CPU思考を実装。
   通常: 6x6 / CPUは貪欲(角優先+多少ランダム)
   激むず: 8x8 / CPUはミニマックス(αβ枝刈り)
   石数表示・手番表示は独自ツールバーで行う(hasScore:false)。
   ========================================================= */

const shell = new GameShell({
  rootSelector: '#app',
  title: 'リバーシ⚫',
  hint: 'マスをタップして石を置きましょう',
  hasScore: false,
  hasTimer: false,
});

const EMPTY = 0, BLACK = 1, WHITE = 2; // プレイヤー=黒, CPU=白
const DIRS = [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]];
const NORMAL_SIZE = 6;
const HARD_SIZE = 8;
const CPU_THINK_DELAY = 550;

let size = NORMAL_SIZE;
let board = [];
let cellEls = [];
let turn = 'player'; // 'player' | 'cpu'
let gameEnded = true;

/* ---------- 盤面ロジック（共通） ---------- */
function makeEmptyBoard(n) {
  return Array.from({ length: n }, () => Array(n).fill(EMPTY));
}

function initialBoard(n) {
  const b = makeEmptyBoard(n);
  const r0 = n / 2 - 1, r1 = n / 2, c0 = n / 2 - 1, c1 = n / 2;
  b[r0][c0] = WHITE; b[r0][c1] = BLACK;
  b[r1][c0] = BLACK; b[r1][c1] = WHITE;
  return b;
}

function opponent(p) { return p === BLACK ? WHITE : BLACK; }

function flipsForMove(b, n, r, c, player) {
  if (b[r][c] !== EMPTY) return [];
  const opp = opponent(player);
  const all = [];
  for (const [dr, dc] of DIRS) {
    let rr = r + dr, cc = c + dc;
    const line = [];
    while (rr >= 0 && rr < n && cc >= 0 && cc < n && b[rr][cc] === opp) {
      line.push([rr, cc]);
      rr += dr; cc += dc;
    }
    if (line.length && rr >= 0 && rr < n && cc >= 0 && cc < n && b[rr][cc] === player) {
      all.push(...line);
    }
  }
  return all;
}

function getValidMoves(b, n, player) {
  const moves = [];
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const flips = flipsForMove(b, n, r, c, player);
      if (flips.length) moves.push({ r, c, flips });
    }
  }
  return moves;
}

function cloneApply(b, n, move, player) {
  const nb = b.map((row) => row.slice());
  nb[move.r][move.c] = player;
  move.flips.forEach(([fr, fc]) => (nb[fr][fc] = player));
  return nb;
}

function countDiscs(b, n) {
  let black = 0, white = 0;
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
    if (b[r][c] === BLACK) black++;
    else if (b[r][c] === WHITE) white++;
  }
  return { black, white };
}

function isCorner(r, c, n) {
  return (r === 0 || r === n - 1) && (c === 0 || c === n - 1);
}

/* マス評価値：角=高評価、角の隣=低評価、辺=やや高評価 */
function cellWeight(r, c, n) {
  if (isCorner(r, c, n)) return 100;
  const nearCornerEdge =
    ((r === 0 || r === n - 1) && (c === 1 || c === n - 2)) ||
    ((c === 0 || c === n - 1) && (r === 1 || r === n - 2));
  const nearCornerDiag = (r === 1 || r === n - 2) && (c === 1 || c === n - 2);
  if (nearCornerEdge) return -12;
  if (nearCornerDiag) return -20;
  const edge = r === 0 || r === n - 1 || c === 0 || c === n - 1;
  return edge ? 8 : 2;
}

/* ---------- CPU: 通常モード（貪欲＋多少ランダム、角は優先） ---------- */
function cpuMoveNormal(moves) {
  const corners = moves.filter((m) => isCorner(m.r, m.c, size));
  if (corners.length && Math.random() < 0.9) {
    return corners[(Math.random() * corners.length) | 0];
  }
  if (Math.random() < 0.7) {
    let best = moves[0];
    for (const m of moves) if (m.flips.length > best.flips.length) best = m;
    return best;
  }
  return moves[(Math.random() * moves.length) | 0];
}

/* ---------- CPU: 激むずモード（ミニマックス＋αβ枝刈り） ---------- */
function evaluateBoard(b, n, aiPlayer) {
  const human = opponent(aiPlayer);
  let posScore = 0;
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
    if (b[r][c] === aiPlayer) posScore += cellWeight(r, c, n);
    else if (b[r][c] === human) posScore -= cellWeight(r, c, n);
  }
  const mobility = getValidMoves(b, n, aiPlayer).length - getValidMoves(b, n, human).length;
  const { black, white } = countDiscs(b, n);
  const discDiff = aiPlayer === BLACK ? black - white : white - black;
  return posScore + mobility * 4 + discDiff * 1;
}

function minimax(b, player, depth, alpha, beta, aiPlayer) {
  const moves = getValidMoves(b, size, player);
  if (depth === 0) return { score: evaluateBoard(b, size, aiPlayer) };
  if (!moves.length) {
    const oppMoves = getValidMoves(b, size, opponent(player));
    if (!oppMoves.length) return { score: evaluateBoard(b, size, aiPlayer) };
    const res = minimax(b, opponent(player), depth - 1, alpha, beta, aiPlayer);
    return { score: res.score };
  }
  const maximizing = player === aiPlayer;
  let bestMove = moves[0];
  let value = maximizing ? -Infinity : Infinity;
  for (const mv of moves) {
    const nb = cloneApply(b, size, mv, player);
    const res = minimax(nb, opponent(player), depth - 1, alpha, beta, aiPlayer);
    if (maximizing) {
      if (res.score > value) { value = res.score; bestMove = mv; }
      alpha = Math.max(alpha, value);
    } else {
      if (res.score < value) { value = res.score; bestMove = mv; }
      beta = Math.min(beta, value);
    }
    if (alpha >= beta) break;
  }
  return { score: value, move: bestMove };
}

function cpuMoveHard(moves) {
  const depth = size >= 8 ? 4 : 5;
  const result = minimax(board, WHITE, depth, -Infinity, Infinity, WHITE);
  return result.move || moves[0];
}

/* ---------- 描画 ---------- */
function buildBoard() {
  size = shell.hardMode ? HARD_SIZE : NORMAL_SIZE;
  board = initialBoard(size);
  turn = 'player';
  gameEnded = false;

  shell.board.className = 's-board reversi-board-wrap';
  shell.board.innerHTML = `
    <div class="reversi-toolbar">
      <span class="reversi-count">⚫ <b id="revBlack">2</b></span>
      <span class="reversi-turn" id="revTurn">あなたの番</span>
      <span class="reversi-count">⚪ <b id="revWhite">2</b></span>
    </div>
    <div class="reversi-grid" id="revGrid" style="--cols:${size}"></div>
  `;
  const grid = shell.board.querySelector('#revGrid');
  cellEls = [];
  for (let r = 0; r < size; r++) {
    cellEls.push([]);
    for (let c = 0; c < size; c++) {
      const cell = document.createElement('button');
      cell.className = 'reversi-cell';
      cell.innerHTML = '<span class="reversi-hint-dot"></span><span class="reversi-disc"></span>';
      cell.addEventListener('click', () => onCellClick(r, c));
      grid.appendChild(cell);
      cellEls[r].push(cell);
    }
  }
  renderAll(board);
  updateToolbar();
  updateHints();
}

function showPlaceholder() {
  shell.board.className = 's-board';
  shell.board.innerHTML = '<div class="reversi-placeholder">「スタート」を押すと対局が始まります</div>';
}

function renderAll(refBoard) {
  for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) setCellInstant(r, c, refBoard[r][c]);
}

function setCellInstant(r, c, val) {
  const cell = cellEls[r][c];
  const disc = cell.querySelector('.reversi-disc');
  cell.classList.toggle('has-disc', val !== EMPTY);
  disc.classList.toggle('is-black', val === BLACK);
  disc.classList.toggle('is-white', val === WHITE);
  disc.style.transition = 'none';
  disc.style.transform = 'scaleX(1)';
}

/* 新規に置かれた石はふわっと出現、既存の石は反転(scaleXつぶれ→色替え→復元)で表現 */
function renderDiff(prevBoard) {
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (prevBoard[r][c] === board[r][c]) continue;
      const cell = cellEls[r][c];
      const disc = cell.querySelector('.reversi-disc');
      cell.classList.add('has-disc');
      if (prevBoard[r][c] === EMPTY) {
        disc.classList.toggle('is-black', board[r][c] === BLACK);
        disc.classList.toggle('is-white', board[r][c] === WHITE);
        disc.classList.remove('reversi-pop');
        void disc.offsetWidth;
        disc.classList.add('reversi-pop');
      } else {
        disc.style.transition = 'transform 0.16s ease-in';
        disc.style.transform = 'scaleX(0)';
        setTimeout(() => {
          disc.classList.toggle('is-black', board[r][c] === BLACK);
          disc.classList.toggle('is-white', board[r][c] === WHITE);
          disc.style.transition = 'transform 0.16s ease-out';
          disc.style.transform = 'scaleX(1)';
        }, 160);
      }
    }
  }
}

function updateToolbar() {
  const { black, white } = countDiscs(board, size);
  shell.board.querySelector('#revBlack').textContent = black;
  shell.board.querySelector('#revWhite').textContent = white;
  const turnEl = shell.board.querySelector('#revTurn');
  if (gameEnded) turnEl.textContent = '終局';
  else turnEl.textContent = turn === 'player' ? 'あなたの番' : 'CPU思考中…';
}

function updateHints() {
  const moves = (!gameEnded && turn === 'player') ? getValidMoves(board, size, BLACK) : [];
  const set = new Set(moves.map((m) => `${m.r},${m.c}`));
  for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) {
    cellEls[r][c].classList.toggle('reversi-hintable', set.has(`${r},${c}`));
  }
}

/* ---------- 進行制御 ---------- */
function onCellClick(r, c) {
  if (!shell.running || gameEnded || turn !== 'player') return;
  const moves = getValidMoves(board, size, BLACK);
  const move = moves.find((m) => m.r === r && m.c === c);
  if (!move) return;
  applyMove(move, BLACK);
  shell.playTone(560, 0.08);
  nextTurn(BLACK);
}

function applyMove(move, player) {
  const prev = board.map((row) => row.slice());
  board = cloneApply(board, size, move, player);
  renderDiff(prev);
}

function nextTurn(justMoved) {
  const other = opponent(justMoved);
  const otherMoves = getValidMoves(board, size, other);
  if (otherMoves.length) {
    turn = other === BLACK ? 'player' : 'cpu';
    updateToolbar();
    updateHints();
    if (turn === 'cpu') setTimeout(cpuTurn, CPU_THINK_DELAY);
    return;
  }
  const selfMoves = getValidMoves(board, size, justMoved);
  if (selfMoves.length) {
    shell.toast(`${other === BLACK ? 'あなた' : 'CPU'}はパスです`);
    turn = justMoved === BLACK ? 'player' : 'cpu';
    updateToolbar();
    updateHints();
    if (turn === 'cpu') setTimeout(cpuTurn, CPU_THINK_DELAY);
    return;
  }
  endGame();
}

function cpuTurn() {
  if (!shell.running || gameEnded) return;
  const moves = getValidMoves(board, size, WHITE);
  if (!moves.length) { nextTurn(WHITE); return; }
  const move = shell.hardMode ? cpuMoveHard(moves) : cpuMoveNormal(moves);
  applyMove(move, WHITE);
  shell.playTone(360, 0.08, 'triangle');
  nextTurn(WHITE);
}

function endGame() {
  gameEnded = true;
  updateToolbar();
  updateHints();
  const { black, white } = countDiscs(board, size);
  let message;
  if (black > white) {
    message = `あなたの勝ち！⚫${black} - ⚪${white}`;
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => setTimeout(() => shell.playTone(f, 0.16, 'triangle'), i * 100));
  } else if (black < white) {
    message = `CPUの勝ち…⚫${black} - ⚪${white}`;
    shell.playTone(220, 0.3, 'sawtooth');
  } else {
    message = `引き分け！⚫${black} - ⚪${white}`;
    shell.playTone(440, 0.2, 'sine');
  }
  shell.end(message);
}

showPlaceholder();

/* ---- GameShellのライフサイクルに接続 ---- */
shell.onStart(() => {
  buildBoard();
});
shell.onReset(() => {
  gameEnded = true;
  showPlaceholder();
});
