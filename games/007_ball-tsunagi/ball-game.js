/* =========================================================
   ボールつなぎ🏀 固有ロジック
   共通土台(GameShell)のAPIだけを使い、盤面生成・ドラッグ接続・判定を実装。

   ルール：同じボール同士を線でつなぐ。ただし「全マスを埋めないとクリアにならない」。
   これにより、最短距離でつなぐだけでは他の色が孤立して詰むため、
   先読みが必要になる（＝単純な最短接続パズルより難易度が高い）。

   生成方式：盤面全体を一筆書き（ハミルトン経路）でバックトラック生成し、
   その経路をランダムな位置で色数ぶんに分割 → 各区間の両端だけをボールとして見せる。
   経路自体は必ず存在する（＝解けることは保証される）。
   ========================================================= */

const shell = new GameShell({
  rootSelector: '#app',
  title: 'ボールつなぎ🏀',
  hint: '同じボールを指でなぞってつなぎましょう。盤面のマスを全部使い切らないとクリアになりません',
  hasScore: false,
  hasTimer: false,
});

const NORMAL_SIZE = 6;
const HARD_SIZE = 8;
const NORMAL_COLOR_COUNT = 4;
const HARD_COLOR_COUNT = 6;
const HAMILTON_NODE_CAP = 60000;
const HAMILTON_MAX_ATTEMPTS = 15;

const COLORS = [
  { emoji: '⚽', name: 'サッカーボール' },
  { emoji: '🏀', name: 'バスケットボール' },
  { emoji: '🏈', name: 'アメフトボール' },
  { emoji: '🏐', name: 'バレーボール' },
  { emoji: '⚾', name: '野球ボール' },
  { emoji: '🥌', name: 'カーリングストーン' },
];

let SIZE = NORMAL_SIZE;
let COLOR_COUNT = NORMAL_COLOR_COUNT;
let board = [];         // board[r][c] = { color: number|null, isEndpoint: bool }
let endpoints = [];      // endpoints[color] = [ [r,c], [r,c] ]
let canonicalSegments = []; // canonicalSegments[color] = 生成時に確定した「基準ルート」（eA→eBの順）
let paths = [];          // paths[color] = [ [r,c], ... ] 現在つながっている順番
let cellEls = [];
let dragging = false;
let activeColor = null;
let hintTimeoutId = null;
let moveHistory = [];    // { type:'add', color, cell } | { type:'remove', color, cells:[...] }（色を跨いだ全体の操作履歴）

/* ---------- ユーティリティ ---------- */
function neighborsOf(r, c, n) {
  const list = [];
  if (r > 0) list.push([r - 1, c]);
  if (r < n - 1) list.push([r + 1, c]);
  if (c > 0) list.push([r, c - 1]);
  if (c < n - 1) list.push([r, c + 1]);
  return list;
}

function shuffleArr(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function sameCell(a, b) {
  return a[0] === b[0] && a[1] === b[1];
}

/* ---------- 盤面全体を一筆書きする経路をバックトラックで生成 ----------
   Warnsdorffルール（行き止まりになりやすいマスを先に埋める）を使うことで、
   大きめの盤面でも現実的な時間でハミルトン経路が見つかる。 */
function generateHamiltonianPath(n) {
  const total = n * n;
  for (let attempt = 0; attempt < HAMILTON_MAX_ATTEMPTS; attempt++) {
    const visited = Array.from({ length: n }, () => Array(n).fill(false));
    const path = [];
    let nodeCount = 0;

    function degreeAt(r, c) {
      let d = 0;
      for (const [nr, nc] of neighborsOf(r, c, n)) if (!visited[nr][nc]) d++;
      return d;
    }

    function dfs(r, c) {
      nodeCount++;
      if (nodeCount > HAMILTON_NODE_CAP) return false;
      visited[r][c] = true;
      path.push([r, c]);
      if (path.length === total) return true;

      const nbrs = shuffleArr(neighborsOf(r, c, n).filter(([nr, nc]) => !visited[nr][nc]));
      nbrs.sort((a, b) => degreeAt(a[0], a[1]) - degreeAt(b[0], b[1]));

      for (const [nr, nc] of nbrs) {
        if (dfs(nr, nc)) return true;
      }
      visited[r][c] = false;
      path.pop();
      return false;
    }

    const startR = (Math.random() * n) | 0;
    const startC = (Math.random() * n) | 0;
    if (dfs(startR, startC)) return path;
  }
  return null;
}

/* 経路をcolorCount個の区間に分割（各区間2マス以上）。分割位置はランダム。 */
function splitIntoSegments(path, colorCount) {
  const total = path.length;
  const minSeg = 2;
  const remaining = total - minSeg * colorCount;
  if (remaining < 0) return null;

  const sizes = Array(colorCount).fill(minSeg);
  for (let i = 0; i < remaining; i++) {
    sizes[(Math.random() * colorCount) | 0]++;
  }

  const segments = [];
  let idx = 0;
  for (const sz of sizes) {
    segments.push(path.slice(idx, idx + sz));
    idx += sz;
  }
  return segments;
}

/* ---------- 盤面構築 ---------- */
function buildPuzzle() {
  SIZE = shell.hardMode ? HARD_SIZE : NORMAL_SIZE;
  COLOR_COUNT = shell.hardMode ? HARD_COLOR_COUNT : NORMAL_COLOR_COUNT;

  let path = null;
  let segments = null;
  let guard = 0;
  while ((!path || !segments) && guard < 10) {
    path = generateHamiltonianPath(SIZE);
    segments = path ? splitIntoSegments(path, COLOR_COUNT) : null;
    guard++;
  }

  board = Array.from({ length: SIZE }, () =>
    Array.from({ length: SIZE }, () => ({ color: null, isEndpoint: false }))
  );
  endpoints = [];
  canonicalSegments = segments;
  paths = Array.from({ length: COLOR_COUNT }, () => []);
  moveHistory = [];

  segments.forEach((seg, idx) => {
    const [r1, c1] = seg[0];
    const [r2, c2] = seg[seg.length - 1];
    board[r1][c1] = { color: idx, isEndpoint: true };
    board[r2][c2] = { color: idx, isEndpoint: true };
    endpoints[idx] = [[r1, c1], [r2, c2]];
  });

  buildDom();
  renderBoard();
  updateProgress();
}

function buildDom() {
  shell.board.className = 's-board ball-board';
  shell.board.innerHTML = `
    <div class="ball-toolbar">
      <span class="ball-progress">つながった: <b id="ballProgress">0</b> / ${COLOR_COUNT}</span>
      <div class="ball-toolbar-actions">
        <button class="s-icon-btn-text" id="ballHintBtn">💡 ヒント</button>
        <button class="s-icon-btn-text" id="ballUndoBtn">⬅️ 戻す</button>
      </div>
    </div>
    <div class="ball-grid" id="ballGrid" style="--cols:${SIZE}"></div>
  `;
  const grid = shell.board.querySelector('#ballGrid');
  cellEls = [];
  for (let r = 0; r < SIZE; r++) {
    cellEls.push([]);
    for (let c = 0; c < SIZE; c++) {
      const btn = document.createElement('button');
      btn.className = 'ball-cell';
      btn.dataset.r = r;
      btn.dataset.c = c;
      btn.addEventListener('pointerdown', () => startDrag(r, c));
      grid.appendChild(btn);
      cellEls[r].push(btn);
    }
  }
  shell.board.querySelector('#ballHintBtn').addEventListener('click', showHint);
  shell.board.querySelector('#ballUndoBtn').addEventListener('click', undoLastMove);
}

function showPlaceholder() {
  shell.board.className = 's-board';
  shell.board.innerHTML = `
    <div class="ball-placeholder">
      <p>同じ絵柄のボール同士を、指でなぞってつなぐゲームです。</p>
      <p><b>盤面のマスを1つ残らず使い切る</b>と、はじめてクリアになります。線をつなぐだけでは終わりません。</p>
      <p>最短で近道すると、他のボールが孤立して詰んでしまうことがあります。あせらず、先を見ながらつなぎましょう。</p>
      <p class="ball-placeholder-start">「スタート」を押すとはじまります</p>
    </div>
  `;
}

/* ---------- 描画 ---------- */
function renderBoard() {
  for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) renderCell(r, c);
}

function renderCell(r, c) {
  const cell = board[r][c];
  const el = cellEls[r][c];
  el.className = 'ball-cell';
  el.textContent = '';
  if (cell.color === null) return;
  el.classList.add(`ball-c${cell.color}`);
  if (cell.isEndpoint) {
    el.classList.add('ball-endpoint');
    el.textContent = COLORS[cell.color].emoji;
  } else {
    el.classList.add('ball-trail');
    el.textContent = COLORS[cell.color].emoji;
  }
}

function updateProgress() {
  const el = shell.board.querySelector('#ballProgress');
  if (!el) return;
  const connected = paths.filter((p, i) => isColorConnected(i)).length;
  el.textContent = connected;
}

function isColorConnected(color) {
  const path = paths[color];
  if (path.length < 2) return false;
  const [eA, eB] = endpoints[color];
  const first = path[0];
  const last = path[path.length - 1];
  return (sameCell(first, eA) && sameCell(last, eB)) || (sameCell(first, eB) && sameCell(last, eA));
}

/* 現在の線が「生成時の基準ルート」と何マス目まで一致しているかを調べ、
   一致している区間だけ薄く蛍光固定表示にする（別解を否定はしない、あくまで装飾） */
function updateCanonicalGlow(color) {
  const path = paths[color];
  path.forEach(([r, c]) => cellEls[r][c] && cellEls[r][c].classList.remove('ball-canon'));
  if (path.length === 0) return;

  const [eA] = endpoints[color];
  const canon = canonicalSegments[color];
  const ref = sameCell(path[0], eA) ? canon : canon.slice().reverse();

  let k = 0;
  while (k < path.length && k < ref.length && sameCell(path[k], ref[k])) k++;

  for (let i = 0; i < k; i++) {
    const [r, c] = path[i];
    cellEls[r][c].classList.add('ball-canon');
  }
}

/* ---------- ドラッグ操作 ---------- */
function startDrag(r, c) {
  if (!shell.running) return;
  const cell = board[r][c];
  if (cell.color === null) return;
  const color = cell.color;
  const path = paths[color];

  if (cell.isEndpoint) {
    if (path.length === 0) {
      paths[color] = [[r, c]];
      moveHistory.push({ type: 'add', color, cell: [r, c] });
    } else {
      const tip = path[path.length - 1];
      const head = path[0];
      if (sameCell(tip, [r, c]) || sameCell(head, [r, c])) {
        // 端から再開／逆端から描き直し
        if (!sameCell(tip, [r, c])) {
          clearColorPath(color);
          paths[color] = [[r, c]];
          moveHistory.push({ type: 'add', color, cell: [r, c] });
        }
      } else {
        // 既に両端がつながっている状態でどちらかを再タップ→引き直し
        clearColorPath(color);
        paths[color] = [[r, c]];
        moveHistory.push({ type: 'add', color, cell: [r, c] });
      }
    }
  } else {
    const idx = path.findIndex((p) => sameCell(p, [r, c]));
    if (idx === -1) return;
    truncatePath(color, idx);
  }

  updateCanonicalGlow(color);
  activeColor = color;
  dragging = true;
}

function truncatePath(color, keepUntilIdx) {
  const path = paths[color];
  const removed = path.slice(keepUntilIdx + 1); // 前方向の順番のまま保持（戻す時に再現するため）
  removed.forEach(([r, c]) => {
    if (!board[r][c].isEndpoint) board[r][c] = { color: null, isEndpoint: false };
    renderCell(r, c);
  });
  paths[color] = path.slice(0, keepUntilIdx + 1);
  if (removed.length) moveHistory.push({ type: 'remove', color, cells: removed });
  updateCanonicalGlow(color);
  updateProgress();
}

function clearColorPath(color) {
  const removed = paths[color].slice();
  removed.forEach(([r, c]) => {
    if (!board[r][c].isEndpoint) {
      board[r][c] = { color: null, isEndpoint: false };
      renderCell(r, c);
    }
  });
  paths[color] = [];
  if (removed.length) moveHistory.push({ type: 'remove', color, cells: removed });
  updateCanonicalGlow(color);
  updateProgress();
}

function extendTo(r, c) {
  if (activeColor === null) return;
  const color = activeColor;
  const path = paths[color];
  if (path.length === 0) return;
  const tip = path[path.length - 1];

  const dr = Math.abs(tip[0] - r);
  const dc = Math.abs(tip[1] - c);
  if (!((dr === 1 && dc === 0) || (dr === 0 && dc === 1))) return; // 隣接マスのみ

  // 一歩戻る（直前のマスに戻ったら1マス消す）
  if (path.length >= 2) {
    const prev = path[path.length - 2];
    if (sameCell(prev, [r, c])) {
      const [tr, tc] = path.pop();
      if (!board[tr][tc].isEndpoint) board[tr][tc] = { color: null, isEndpoint: false };
      renderCell(tr, tc);
      moveHistory.push({ type: 'remove', color, cells: [[tr, tc]] });
      updateCanonicalGlow(color);
      updateProgress();
      return;
    }
  }

  if (path.some((p) => sameCell(p, [r, c]))) return; // 自分の線を踏み直しは不可

  const target = board[r][c];
  if (target.color !== null && target.color !== color) return; // 他の色は通れない
  if (target.color === color && !target.isEndpoint) return; // 通常ここには来ない想定

  paths[color].push([r, c]);
  const wasEmpty = target.color === null;
  board[r][c] = { color, isEndpoint: target.isEndpoint };
  renderCell(r, c);
  moveHistory.push({ type: 'add', color, cell: [r, c] });
  if (wasEmpty) shell.playTone(520 + color * 30, 0.04);

  if (target.isEndpoint && isColorConnected(color)) {
    shell.playTone(760, 0.1);
    cellEls[r][c].classList.add('ball-linked');
    setTimeout(() => cellEls[r][c] && cellEls[r][c].classList.remove('ball-linked'), 500);
  }

  updateCanonicalGlow(color);
  updateProgress();
  checkWin();
}

/* 全体の操作履歴から直前の1手だけ取り消す（色を跨いだ「一手戻す」） */
function undoLastMove() {
  if (!shell.running) return;
  const entry = moveHistory.pop();
  if (!entry) {
    shell.toast('これ以上は戻せません');
    return;
  }
  const { color } = entry;
  if (entry.type === 'add') {
    const path = paths[color];
    const last = path[path.length - 1];
    if (last && sameCell(last, entry.cell)) {
      path.pop();
      const [r, c] = entry.cell;
      if (!board[r][c].isEndpoint) board[r][c] = { color: null, isEndpoint: false };
      renderCell(r, c);
    }
  } else if (entry.type === 'remove') {
    entry.cells.forEach(([r, c]) => {
      paths[color].push([r, c]);
      const isEndpointCell = endpoints[color].some((e) => sameCell(e, [r, c]));
      board[r][c] = { color, isEndpoint: isEndpointCell };
      renderCell(r, c);
    });
  }
  updateCanonicalGlow(color);
  updateProgress();
}

document.addEventListener('pointermove', (e) => {
  if (!dragging) return;
  const el = document.elementFromPoint(e.clientX, e.clientY);
  if (!el || !el.classList || !el.classList.contains('ball-cell')) return;
  extendTo(+el.dataset.r, +el.dataset.c);
});
document.addEventListener('pointerup', () => {
  dragging = false;
  activeColor = null;
});

/* ---------- ヒント ---------- */
/* 未接続の色から1つ選び、基準ルート上の「次の1マス」だけをそっと教える。
   現在の線が基準ルートから外れている場合は、次の1マスを特定できないため
   軌道修正を促すメッセージにとどめる（別解を否定しないため）。 */
function findNextHintCell(color) {
  const path = paths[color];
  const canon = canonicalSegments[color];
  if (path.length === 0) return canon[1]; // まだ描いていない→基準ルートの2マス目を提案

  const [eA] = endpoints[color];
  const ref = sameCell(path[0], eA) ? canon : canon.slice().reverse();
  let k = 0;
  while (k < path.length && k < ref.length && sameCell(path[k], ref[k])) k++;
  if (k !== path.length) return null; // 基準ルートから外れている
  if (k >= ref.length) return null; // 既に最後まで一致（＝接続済みのはず）
  return ref[k];
}

function showHint() {
  if (!shell.running) return;
  const unconnected = [];
  for (let i = 0; i < COLOR_COUNT; i++) if (!isColorConnected(i)) unconnected.push(i);
  if (unconnected.length === 0) {
    shell.toast('すべてつながっています');
    return;
  }
  clearTimeout(hintTimeoutId);
  const shuffled = shuffleArr(unconnected.slice());
  for (const color of shuffled) {
    const next = findNextHintCell(color);
    if (!next) continue;
    const [r, c] = next;
    cellEls[r][c].classList.add('ball-hint-next');
    shell.toast(`${COLORS[color].emoji} は、光っているマスに進めそうです`);
    hintTimeoutId = setTimeout(() => {
      cellEls[r][c] && cellEls[r][c].classList.remove('ball-hint-next');
    }, 1800);
    return;
  }
  shell.toast('今の線が少し複雑なようです。「戻す」で調整してみましょう');
}

/* ---------- 判定 ---------- */
function checkWin() {
  if (!shell.running) return;
  let filled = 0;
  for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) if (board[r][c].color !== null) filled++;
  if (filled !== SIZE * SIZE) return;

  for (let i = 0; i < COLOR_COUNT; i++) {
    if (!isColorConnected(i)) return;
  }

  triggerWin();
}

/* クリア演出：斜め方向に光の波が広がり、ところどころで🎉ポップが弾ける */
function triggerWin() {
  const wave = [];
  for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) wave.push([r, c]);
  wave.sort((a, b) => (a[0] + a[1]) - (b[0] + b[1]));
  const stepDelay = Math.max(10, Math.min(26, 500 / wave.length));

  wave.forEach(([r, c], i) => {
    setTimeout(() => {
      const el = cellEls[r][c];
      if (el) el.classList.add('ball-linked');
    }, i * stepDelay);
  });

  [523.25, 659.25, 783.99, 1046.5, 1318.51, 1567.98].forEach((f, i) =>
    setTimeout(() => shell.playTone(f, 0.14, 'triangle'), i * 90)
  );

  const confettiSpots = shuffleArr(wave.slice()).slice(0, Math.min(6, wave.length));
  confettiSpots.forEach((pos, i) => {
    setTimeout(() => {
      const el = cellEls[pos[0]][pos[1]];
      if (el) shell.showPopup(el, '🎉', 'bonus');
    }, 150 + i * 90);
  });

  const totalDelay = wave.length * stepDelay + 250;
  setTimeout(() => {
    shell.end('やったね！ぜんぶのボールがつながったよ🏀🎉');
  }, totalDelay);
}

showPlaceholder();

/* ---- GameShellのライフサイクルに接続 ---- */
shell.onStart(() => {
  buildPuzzle();
});
shell.onReset(() => {
  clearTimeout(hintTimeoutId);
  dragging = false;
  activeColor = null;
  showPlaceholder();
});
