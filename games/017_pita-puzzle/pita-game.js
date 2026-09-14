/* =========================================================
   ぴたっとパズル🪟 固有ロジック
   共通土台(GameShell)のAPIだけを使い、盤面生成・回転・配置判定を実装。

   生成方式：盤面を空きマスからランダムにテトロミノで埋めていき、
   置けなくなったマスは「穴（対象外）」として扱う（じゃぐちパズルと
   同じ「完成形から生成→保険検証」系の考え方）。この生成そのものが
   解の存在を保証するため、唯一解の検証は行わない。
   （ピース数ちょうどで対象マスを埋め尽くせるため、
   　「全ピース配置済み＝盤面完成」として判定できる）

   操作：ピースをタップで選択→盤面マスをタップで配置（●の位置が基準）。
   将来ドラッグ操作へ移行しやすいよう、選択・配置・回転のロジックは
   UIイベントから独立した関数に分離してある。
   ========================================================= */

const shell = new GameShell({
  rootSelector: '#app',
  title: 'ぴたっとパズル🪟',
  hint: '●のついたマスを、置きたい場所に合わせてタップしましょう。グレーのマスは使いません。',
  hasScore: false,
  hasTimer: false,
});

const NORMAL_SIZE = 6;
const HARD_SIZE = 7;
const NORMAL_TARGET_PIECES = 6;
const HARD_TARGET_PIECES = 9;
const COLOR_COUNT = 7;

/* ---------- テトロミノ基本形（7種） ---------- */
const BASE_SHAPES = [
  [[0,0],[0,1],[0,2],[0,3]],           // I
  [[0,0],[0,1],[1,0],[1,1]],           // O
  [[0,0],[0,1],[0,2],[1,1]],           // T
  [[0,1],[0,2],[1,0],[1,1]],           // S
  [[0,0],[0,1],[1,1],[1,2]],           // Z
  [[0,0],[1,0],[1,1],[1,2]],           // J
  [[0,2],[1,0],[1,1],[1,2]],           // L
];

/* ---------- 形状ユーティリティ ---------- */
function shuffleArr(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function normalizeShape(cells) {
  const minR = Math.min(...cells.map((c) => c[0]));
  const minC = Math.min(...cells.map((c) => c[1]));
  return cells.map(([r, c]) => [r - minR, c - minC]).sort((a, b) => (a[0] - b[0]) || (a[1] - b[1]));
}
function rotateShape(cells) {
  return normalizeShape(cells.map(([r, c]) => [c, -r]));
}
function getUniqueRotations(base) {
  const list = [];
  let cur = normalizeShape(base);
  for (let i = 0; i < 4; i++) {
    const key = JSON.stringify(cur);
    if (!list.some((v) => v.key === key)) list.push({ key, cells: cur });
    cur = rotateShape(cur);
  }
  return list.map((v) => v.cells);
}
const ALL_ORIENTATIONS = BASE_SHAPES.flatMap((base) => getUniqueRotations(base));

/* ---------- 盤面生成（ランダムにテトロミノで埋め、置けないマスは穴に） ---------- */
function generateLayout(size, targetPieces) {
  const owner = Array.from({ length: size }, () => Array(size).fill(-1)); // -1未定 / -2穴 / >=0 ピース番号
  const pieces = [];
  const cellOrder = shuffleArr(
    Array.from({ length: size * size }, (_, i) => [(i / size) | 0, i % size])
  );

  for (const [r, c] of cellOrder) {
    if (owner[r][c] !== -1) continue;
    if (pieces.length >= targetPieces) { owner[r][c] = -2; continue; }

    let placed = false;
    for (const shape of shuffleArr(ALL_ORIENTATIONS)) {
      for (const [sr, sc] of shuffleArr(shape)) {
        const originR = r - sr, originC = c - sc;
        const cells = shape.map(([dr, dc]) => [originR + dr, originC + dc]);
        const ok = cells.every(([rr, cc]) => rr >= 0 && rr < size && cc >= 0 && cc < size && owner[rr][cc] === -1);
        if (ok) {
          const idx = pieces.length;
          cells.forEach(([rr, cc]) => (owner[rr][cc] = idx));
          pieces.push({ solvedCells: cells, colorIndex: idx % COLOR_COUNT });
          placed = true;
          break;
        }
      }
      if (placed) break;
    }
    if (!placed) owner[r][c] = -2;
  }
  return { owner, pieces };
}

/* ---------- 状態 ---------- */
let SIZE = NORMAL_SIZE;
let cellType = [];      // 'hole' | 'target'
let occupiedBy = [];    // null | pieceId
let pieces = [];        // { id, colorIndex, template, shape(現在の回転形), placed, solvedCells }
let selectedId = null;
let placedCount = 0;
let solved = false;
let hintTimeoutId = null;

/* ---------- 生成・初期化 ---------- */
function buildPuzzle() {
  SIZE = shell.hardMode ? HARD_SIZE : NORMAL_SIZE;
  const targetPieces = shell.hardMode ? HARD_TARGET_PIECES : NORMAL_TARGET_PIECES;
  const { owner, pieces: genPieces } = generateLayout(SIZE, targetPieces);

  cellType = Array.from({ length: SIZE }, (_, r) =>
    Array.from({ length: SIZE }, (_, c) => (owner[r][c] === -2 ? 'hole' : 'target'))
  );
  occupiedBy = Array.from({ length: SIZE }, () => Array(SIZE).fill(null));

  pieces = genPieces.map((p, id) => {
    const template = normalizeShape(p.solvedCells.map(([r, c]) => [r, c]));
    // ランダムな初期回転でスクランブル
    let shape = template;
    const spins = (Math.random() * 4) | 0;
    for (let i = 0; i < spins; i++) shape = rotateShape(shape);
    return { id, colorIndex: p.colorIndex, template, shape, placed: false, solvedCells: p.solvedCells };
  });

  selectedId = null;
  placedCount = 0;
  solved = false;

  renderAll();
}

/* ---------- 描画 ---------- */
function renderAll() {
  shell.board.className = 's-board pita-board-wrap';
  shell.board.innerHTML = `
    <div class="pita-toolbar">
      <span class="pita-progress">配置済み: <b id="pitaCount">0</b> / ${pieces.length}</span>
      <div class="pita-toolbar-actions">
        <button class="s-icon-btn-text" id="pitaHintBtn">💡 ヒント</button>
        <button class="s-icon-btn-text" id="pitaRestartBtn">↩️ はじめから</button>
      </div>
    </div>
    <div class="pita-board" id="pitaBoard" style="--cols:${SIZE}"></div>
    <div class="pita-rotate-row">
      <button class="s-icon-btn-text pita-rotate-btn" id="pitaRotateBtn" disabled>🔄 回転</button>
    </div>
    <div class="pita-tray-label">ピースをタップして選び、盤面に置きましょう</div>
    <div class="pita-tray" id="pitaTray"></div>
  `;
  shell.board.querySelector('#pitaHintBtn').addEventListener('click', showHint);
  shell.board.querySelector('#pitaRestartBtn').addEventListener('click', restartPuzzle);
  shell.board.querySelector('#pitaRotateBtn').addEventListener('click', rotateSelected);

  renderBoard();
  renderTray();
}

function renderBoard() {
  const boardEl = shell.board.querySelector('#pitaBoard');
  boardEl.innerHTML = '';
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const btn = document.createElement('button');
      btn.className = 'pita-cell';
      if (cellType[r][c] === 'hole') {
        btn.classList.add('pita-hole');
      } else if (occupiedBy[r][c] !== null) {
        btn.classList.add('pita-filled', `pita-c${pieces[occupiedBy[r][c]].colorIndex}`);
      }
      btn.addEventListener('click', () => onBoardCellClick(r, c));
      boardEl.appendChild(btn);
    }
  }
}

function renderTray() {
  const trayEl = shell.board.querySelector('#pitaTray');
  trayEl.innerHTML = '';
  const rotateBtn = shell.board.querySelector('#pitaRotateBtn');
  rotateBtn.disabled = selectedId === null;

  pieces.filter((p) => !p.placed).forEach((p) => {
    const rows = Math.max(...p.shape.map((c) => c[0])) + 1;
    const cols = Math.max(...p.shape.map((c) => c[1])) + 1;
    const wrap = document.createElement('div');
    wrap.className = 'pita-piece' + (selectedId === p.id ? ' pita-piece-selected' : '');
    wrap.style.gridTemplateColumns = `repeat(${cols}, 16px)`;
    wrap.style.gridTemplateRows = `repeat(${rows}, 16px)`;

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const on = p.shape.some(([sr, sc]) => sr === r && sc === c);
        const isAnchor = on && p.shape[0][0] === r && p.shape[0][1] === c;
        const cell = document.createElement('div');
        cell.className = 'pita-piece-cell' + (on ? ` pita-piece-cell-on pita-c${p.colorIndex}` : '') + (isAnchor ? ' pita-anchor' : '');
        wrap.appendChild(cell);
      }
    }
    wrap.addEventListener('click', () => selectPiece(p.id));
    trayEl.appendChild(wrap);
  });

  const countEl = shell.board.querySelector('#pitaCount');
  if (countEl) countEl.textContent = placedCount;
}

/* ---------- 操作 ---------- */
function selectPiece(id) {
  if (!shell.running || solved) return;
  selectedId = selectedId === id ? null : id;
  renderTray();
}

function rotateSelected() {
  if (!shell.running || solved || selectedId === null) return;
  const p = pieces.find((x) => x.id === selectedId);
  p.shape = rotateShape(p.shape);
  shell.playTone(480, 0.05);
  renderTray();
}

function onBoardCellClick(r, c) {
  if (!shell.running || solved) return;

  if (occupiedBy[r][c] !== null) {
    unplacePiece(occupiedBy[r][c]);
    return;
  }
  if (selectedId === null) {
    shell.toast('先にピースを選びましょう');
    return;
  }
  const p = pieces.find((x) => x.id === selectedId);
  const [ar, ac] = p.shape[0];
  const cells = p.shape.map(([dr, dc]) => [r + (dr - ar), c + (dc - ac)]);
  const ok = cells.every(([rr, cc]) =>
    rr >= 0 && rr < SIZE && cc >= 0 && cc < SIZE && cellType[rr][cc] === 'target' && occupiedBy[rr][cc] === null
  );
  if (!ok) {
    shell.playTone(220, 0.12, 'sawtooth');
    const boardEl = shell.board.querySelector('#pitaBoard');
    boardEl.classList.add('pita-shake');
    setTimeout(() => boardEl.classList.remove('pita-shake'), 300);
    return;
  }

  cells.forEach(([rr, cc]) => (occupiedBy[rr][cc] = p.id));
  p.placed = true;
  placedCount++;
  selectedId = null;
  shell.playTone(560, 0.07);
  renderBoard();
  renderTray();

  if (placedCount === pieces.length) triggerClear();
}

function unplacePiece(id) {
  const p = pieces.find((x) => x.id === id);
  for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) if (occupiedBy[r][c] === id) occupiedBy[r][c] = null;
  p.placed = false;
  placedCount--;
  shell.playTone(360, 0.05);
  renderBoard();
  renderTray();
}

function restartPuzzle() {
  if (!shell.running) return;
  clearTimeout(hintTimeoutId);
  pieces.forEach((p) => { p.placed = false; });
  occupiedBy = Array.from({ length: SIZE }, () => Array(SIZE).fill(null));
  placedCount = 0;
  selectedId = null;
  renderBoard();
  renderTray();
  shell.toast('はじめから置き直しましょう');
}

/* ---------- ヒント ---------- */
function showHint() {
  if (!shell.running || solved) return;
  clearTimeout(hintTimeoutId);
  const target = pieces.find((p) => !p.placed && p.solvedCells.every(([r, c]) => occupiedBy[r][c] === null));
  if (!target) {
    shell.toast('今の配置だと道が見えません。置いたピースを見直してみましょう');
    return;
  }
  const boardEl = shell.board.querySelector('#pitaBoard');
  target.solvedCells.forEach(([r, c]) => {
    boardEl.children[r * SIZE + c].classList.add('pita-hint-glow');
  });
  shell.playTone(600, 0.08);
  shell.toast('光っているマスに、選んだピースを置いてみましょう');
  hintTimeoutId = setTimeout(() => {
    target.solvedCells.forEach(([r, c]) => boardEl.children[r * SIZE + c] && boardEl.children[r * SIZE + c].classList.remove('pita-hint-glow'));
  }, 1800);
}

/* ---------- クリア演出 ---------- */
function triggerClear() {
  solved = true;
  [523.25, 659.25, 783.99, 1046.5].forEach((f, i) =>
    setTimeout(() => shell.playTone(f, 0.16, 'triangle'), i * 100)
  );
  shell.end('ぴったり！ぜんぶのピースがおさまりました🪟');
}

/* ---------- プレースホルダー ---------- */
function showPlaceholder() {
  shell.board.className = 's-board';
  shell.board.innerHTML = `
    <div class="pita-placeholder">
      <div class="pita-howto-scene">
        <div class="pita-howto-floating">
          <div class="pita-howto-fcell pita-howto-anchor"></div>
          <div class="pita-howto-fcell pita-howto-fcell-off"></div>
          <div class="pita-howto-fcell"></div>
          <div class="pita-howto-fcell"></div>
        </div>
        <div class="pita-howto-drop-arrow">↓</div>
        <div class="pita-howto-frame">
          <div class="pita-howto-frame-cell pita-howto-frame-target"></div>
          <div class="pita-howto-frame-cell"></div>
          <div class="pita-howto-frame-cell"></div>
          <div class="pita-howto-frame-cell"></div>
        </div>
      </div>
      <p class="pita-howto-note">●のマスを、置きたい場所に合わせます</p>

      <div class="pita-howto-hole-row">
        <div class="pita-howto-hole-swatch"></div>
        <span>グレーのマスは使いません</span>
      </div>

      <p>🔄回転ボタンで向きを変えられます。</p>
      <p>「スタート」を押すとはじまります</p>
    </div>
  `;
}

showPlaceholder();

/* ---- GameShellのライフサイクルに接続 ---- */
shell.onStart(() => {
  buildPuzzle();
});
shell.onReset(() => {
  clearTimeout(hintTimeoutId);
  showPlaceholder();
});
shell.onHardModeChange(() => {
  // running中は呼ばれない（GameShell側で保証）。次回スタート時のサイズ・ピース数に反映される。
});
