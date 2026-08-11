/* =========================================================
   スライドパズル 固有ロジック
   共通土台(GameShell)のAPIだけを使い、盤面生成・移動・ヒントを実装。
   - 通常: 3x3(8パズル) / 激むず: 4x4(15パズル)
   - シャッフルは「完成形から有効手を逆再生」する方式のため、
     生成される盤面は必ず解けることが保証される(詰みなし)。
   - ヒントはA*探索(マンハッタン距離+線形衝突)で次の一手を提示する。
   ========================================================= */

const shell = new GameShell({
  rootSelector: '#app',
  title: 'スライドパズル🔀',
  hint: 'タイトルを5回連続タップすると…激むずモード(5x5)に挑戦できます',
  hasScore: false,
  hasTimer: false,
});

const SIZE_NORMAL = 4;   // 15パズル
const SIZE_HARD = 5;     // 24パズル
const SHUFFLE_NORMAL = 60;
const SHUFFLE_HARD = 30;
const ASTAR_NODE_CAP_NORMAL = 150000;
const ASTAR_NODE_CAP_HARD = 400000;

let size = SIZE_NORMAL;
let board = [];       // 長さ size*size の配列。0が空白マス
let tileEls = [];     // board[i] に対応するDOM要素
let moveCount = 0;
let hintTimeoutId = null;

/* ---------- 盤面ユーティリティ ---------- */
function makeGoal(n) {
  const arr = [];
  for (let i = 1; i < n * n; i++) arr.push(i);
  arr.push(0);
  return arr;
}

function goalPositions(n) {
  const goal = makeGoal(n);
  const pos = {};
  goal.forEach((v, i) => { pos[v] = { r: Math.floor(i / n), c: i % n }; });
  return pos;
}

function neighborIdx(blank, n) {
  const r = Math.floor(blank / n), c = blank % n;
  const list = [];
  if (r > 0) list.push(blank - n);
  if (r < n - 1) list.push(blank + n);
  if (c > 0) list.push(blank - 1);
  if (c < n - 1) list.push(blank + 1);
  return list;
}

function isSolved(b) {
  const goal = makeGoal(size);
  return b.every((v, i) => v === goal[i]);
}

/* 完成形から有効手だけを逆再生してシャッフル → 必ず解ける盤面になる */
function shuffledBoard(n, steps) {
  const b = makeGoal(n);
  let blank = b.length - 1;
  let lastBlank = -1;
  for (let i = 0; i < steps; i++) {
    const candidates = neighborIdx(blank, n).filter((idx) => idx !== lastBlank);
    const next = candidates[Math.floor(Math.random() * candidates.length)];
    [b[blank], b[next]] = [b[next], b[blank]];
    lastBlank = blank;
    blank = next;
  }
  return b;
}

/* ---------- A* によるヒント探索 ---------- */
class MinHeap {
  constructor() { this.a = []; }
  size() { return this.a.length; }
  push(item) { this.a.push(item); this._up(this.a.length - 1); }
  pop() {
    const top = this.a[0];
    const last = this.a.pop();
    if (this.a.length) { this.a[0] = last; this._down(0); }
    return top;
  }
  _up(i) {
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.a[p].f <= this.a[i].f) break;
      [this.a[p], this.a[i]] = [this.a[i], this.a[p]];
      i = p;
    }
  }
  _down(i) {
    const n = this.a.length;
    for (;;) {
      let l = 2 * i + 1, r = 2 * i + 2, m = i;
      if (l < n && this.a[l].f < this.a[m].f) m = l;
      if (r < n && this.a[r].f < this.a[m].f) m = r;
      if (m === i) break;
      [this.a[m], this.a[i]] = [this.a[i], this.a[m]];
      i = m;
    }
  }
}

function heuristic(b, n, goalPos) {
  let h = 0;
  for (let i = 0; i < b.length; i++) {
    const v = b[i];
    if (v === 0) continue;
    const r = Math.floor(i / n), c = i % n;
    const g = goalPos[v];
    h += Math.abs(r - g.r) + Math.abs(c - g.c);
  }
  // 線形衝突(行)
  for (let r = 0; r < n; r++) {
    const row = [];
    for (let c = 0; c < n; c++) {
      const v = b[r * n + c];
      if (v !== 0 && goalPos[v].r === r) row.push(goalPos[v].c);
    }
    for (let i = 0; i < row.length; i++)
      for (let j = i + 1; j < row.length; j++)
        if (row[i] > row[j]) h += 2;
  }
  // 線形衝突(列)
  for (let c = 0; c < n; c++) {
    const col = [];
    for (let r = 0; r < n; r++) {
      const v = b[r * n + c];
      if (v !== 0 && goalPos[v].c === c) col.push(goalPos[v].r);
    }
    for (let i = 0; i < col.length; i++)
      for (let j = i + 1; j < col.length; j++)
        if (col[i] > col[j]) h += 2;
  }
  return h;
}

// 現在盤面からA*で最短手順を探索し、最初の一手(動かすべきタイルの現在位置)だけ返す
function solveAStarFirstMove(startBoard, n, nodeCap) {
  const goalKey = makeGoal(n).join(',');
  const gPos = goalPositions(n);
  const startKey = startBoard.join(',');
  if (startKey === goalKey) return null;

  const gScore = new Map([[startKey, 0]]);
  const cameFrom = new Map(); // key -> { prevKey, swapIdx }
  const closed = new Set();
  const heap = new MinHeap();
  heap.push({ board: startBoard, key: startKey, g: 0, f: heuristic(startBoard, n, gPos) });

  let expanded = 0;
  while (heap.size()) {
    const node = heap.pop();
    if (closed.has(node.key)) continue;
    closed.add(node.key);

    if (node.key === goalKey) {
      let k = node.key;
      let firstSwapIdx = null;
      while (cameFrom.has(k)) {
        const step = cameFrom.get(k);
        firstSwapIdx = step.swapIdx; // 遡って上書きし続けると最終的に「startからの最初の一手」が残る
        k = step.prevKey;
      }
      return firstSwapIdx;
    }

    expanded++;
    if (expanded > nodeCap) return undefined; // 上限超過 = 探索打ち切り

    const blank = node.board.indexOf(0);
    for (const nIdx of neighborIdx(blank, n)) {
      const nb = node.board.slice();
      [nb[blank], nb[nIdx]] = [nb[nIdx], nb[blank]];
      const key = nb.join(',');
      if (closed.has(key)) continue;
      const g = node.g + 1;
      if (!gScore.has(key) || g < gScore.get(key)) {
        gScore.set(key, g);
        cameFrom.set(key, { prevKey: node.key, swapIdx: nIdx });
        heap.push({ board: nb, key, g, f: g + heuristic(nb, n, gPos) });
      }
    }
  }
  return null;
}

// A*が間に合わなかった場合の簡易フォールバック(1手先のヒューリスティック最小手)
function greedyFallback(b, n) {
  const gPos = goalPositions(n);
  const blank = b.indexOf(0);
  let best = null, bestH = Infinity;
  for (const nIdx of neighborIdx(blank, n)) {
    const nb = b.slice();
    [nb[blank], nb[nIdx]] = [nb[nIdx], nb[blank]];
    const h = heuristic(nb, n, gPos);
    if (h < bestH) { bestH = h; best = nIdx; }
  }
  return best;
}

/* ---------- 描画 ---------- */
function buildGrid() {
  shell.board.classList.add('slide-board');
  shell.board.innerHTML = `
    <div class="slide-toolbar">
      <span class="slide-count">手数: <b id="slideMoves">0</b></span>
      <button class="s-icon-btn-text slide-hint-btn" id="slideHintBtn">💡 ヒント</button>
    </div>
    <div class="slide-grid" id="slideGrid" style="--size:${size}"></div>
  `;
  const grid = shell.board.querySelector('#slideGrid');
  tileEls = [];
  for (let i = 0; i < size * size; i++) {
    const btn = document.createElement('button');
    btn.className = 'slide-tile';
    btn.addEventListener('click', () => handleTileClick(i));
    grid.appendChild(btn);
    tileEls.push(btn);
  }
  shell.board.querySelector('#slideHintBtn').addEventListener('click', showHint);
}

function updateGrid() {
  const blank = board.indexOf(0);
  const movable = new Set(neighborIdx(blank, size));
  board.forEach((v, i) => {
    const el = tileEls[i];
    el.classList.remove('hint-glow');
    if (v === 0) {
      el.textContent = '';
      el.classList.add('slide-blank');
      el.disabled = true;
    } else {
      el.textContent = v;
      el.classList.remove('slide-blank');
      el.disabled = !shell.running || !movable.has(i);
    }
  });
  const moveEl = shell.board.querySelector('#slideMoves');
  if (moveEl) moveEl.textContent = moveCount;
}

/* ---------- 操作 ---------- */
function handleTileClick(i) {
  if (!shell.running) return;
  const blank = board.indexOf(0);
  if (!neighborIdx(blank, size).includes(i)) return;
  [board[blank], board[i]] = [board[i], board[blank]];
  moveCount++;
  shell.playTone(700, 0.08);
  updateGrid();
  if (isSolved(board)) {
    shell.playTone(523.25, 0.12);
    setTimeout(() => shell.playTone(659.25, 0.12), 110);
    setTimeout(() => shell.playTone(783.99, 0.12), 220);
    setTimeout(() => shell.playTone(1046.5, 0.18), 330);
    shell.end(`クリア！ 手数: ${moveCount}`);
  }
}

function showHint() {
  if (!shell.running) { shell.toast('スタートしてから使えます'); return; }
  clearTimeout(hintTimeoutId);
  const nodeCap = size === SIZE_HARD ? ASTAR_NODE_CAP_HARD : ASTAR_NODE_CAP_NORMAL;
  let targetIdx = solveAStarFirstMove(board.slice(), size, nodeCap);
  if (targetIdx === undefined) targetIdx = greedyFallback(board, size); // 探索打ち切り時の代替
  if (targetIdx === null || targetIdx === undefined) return; // 既に完成
  tileEls[targetIdx].classList.add('hint-glow');
  shell.toast('光っているタイルを動かしてみましょう');
  hintTimeoutId = setTimeout(() => tileEls[targetIdx].classList.remove('hint-glow'), 1800);
}

/* ---------- GameShellのライフサイクルに接続 ---------- */
function setupPuzzle(shuffle) {
  board = shuffle ? shuffledBoard(size, size === SIZE_HARD ? SHUFFLE_HARD : SHUFFLE_NORMAL) : makeGoal(size);
  moveCount = 0;
  buildGrid();
  updateGrid();
}

setupPuzzle(false); // 初期表示は完成形のプレビュー

shell.onStart(() => {
  setupPuzzle(true);
  updateGrid();
});

shell.onReset(() => {
  clearTimeout(hintTimeoutId);
  setupPuzzle(false);
});

shell.onHardModeChange((hard) => {
  size = hard ? SIZE_HARD : SIZE_NORMAL;
  setupPuzzle(false);
});
