/* =========================================================
   にゃん独パズル🐱 固有ロジック
   共通土台(GameShell)のAPIだけを使用。
   ルール：行・列・色エリア・8方向隣接のいずれにも、
   ネコが2匹以上並ばないように盤面いっぱいに配置する。
   （LinkedIn Queensと同一ルール構造。数独ではなくクイーン配置パズル）

   生成方式：
   1. 行×列の順列（隣接行の列差が2以上）でランダムな解を1つ作る
   2. 各解マスを種にフラッドフィルで色エリアを作る
   3. バックトラック法で解の数を数え、唯一解でなければやり直す

   操作：モード切替式（🐱配置／✕印）。マインスイーパーと同じ構造。
   不正な配置は弾く（詰みを作らない設計。置いたネコはいつでも外せる）。
   ========================================================= */

const shell = new GameShell({
  rootSelector: '#app',
  title: 'にゃん独パズル🐱',
  hint: '縦・横・同じ色・ナナメを含めた隣接マスに、ネコが2匹以上並ばないように置きましょう',
  hasScore: false,
  hasTimer: false,
});

const NORMAL_SIZE = 6;
const HARD_SIZE = 8;
const GEN_ATTEMPTS = 200;

const REGION_COLORS = [
  '#ffd8c2', '#c8e6c9', '#bcd9f7', '#f5c6de',
  '#fff2b0', '#d8c8f0', '#bdeeea', '#e0d2b8',
];

let SIZE = NORMAL_SIZE;
let regionOf = [];
let solutionCols = [];
let placed = [];
let marks = [];
let cellEls = [];
let placedCount = 0;
let mode = 'place';
let solved = false;

/* ---------- ユーティリティ ---------- */
function shuffleArr(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/* ---------- 解の生成（行→列のランダムな順列、隣接行は列差2以上） ---------- */
function generateSolution(size) {
  const usedCols = Array(size).fill(false);
  const cols = Array(size).fill(-1);
  function backtrack(row, prevCol) {
    const order = shuffleArr([...Array(size).keys()]);
    for (const c of order) {
      if (usedCols[c]) continue;
      if (prevCol !== -1 && Math.abs(c - prevCol) <= 1) continue;
      usedCols[c] = true;
      cols[row] = c;
      if (row === size - 1 || backtrack(row + 1, c)) return true;
      usedCols[c] = false;
    }
    return false;
  }
  backtrack(0, -1);
  return cols;
}

/* ---------- 色エリア生成（解マスを種にフラッドフィルで拡張） ---------- */
function buildRegions(size, cols) {
  const ro = Array.from({ length: size }, () => Array(size).fill(-1));
  const regionCells = [];
  for (let i = 0; i < size; i++) {
    ro[i][cols[i]] = i;
    regionCells.push([[i, cols[i]]]);
  }
  const DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1]];
  let remaining = size * size - size;
  while (remaining > 0) {
    const candidates = [];
    for (let i = 0; i < size; i++) {
      for (const [r, c] of regionCells[i]) {
        for (const [dr, dc] of DIRS) {
          const nr = r + dr, nc = c + dc;
          if (nr >= 0 && nr < size && nc >= 0 && nc < size && ro[nr][nc] === -1) {
            candidates.push([i, nr, nc]);
          }
        }
      }
    }
    if (candidates.length === 0) break;
    const [i, r, c] = candidates[(Math.random() * candidates.length) | 0];
    if (ro[r][c] === -1) {
      ro[r][c] = i;
      regionCells[i].push([r, c]);
      remaining--;
    }
  }
  // 孤立セルの保険（通常は発生しない）
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (ro[r][c] !== -1) continue;
      let best = 0, bestD = Infinity;
      for (let i = 0; i < size; i++) {
        const d = Math.abs(i - r) + Math.abs(cols[i] - c);
        if (d < bestD) { bestD = d; best = i; }
      }
      ro[r][c] = best;
    }
  }
  return ro;
}

/* ---------- 解の数をカウント（唯一解の検証。cap到達で打ち切り） ---------- */
function countSolutions(size, ro, cap) {
  const usedCols = Array(size).fill(false);
  const usedRegions = Array(size).fill(false);
  let count = 0;
  function backtrack(row, prevCol) {
    if (count >= cap) return;
    if (row === size) { count++; return; }
    for (let c = 0; c < size; c++) {
      if (usedCols[c]) continue;
      const reg = ro[row][c];
      if (usedRegions[reg]) continue;
      if (prevCol !== -1 && Math.abs(c - prevCol) <= 1) continue;
      usedCols[c] = true; usedRegions[reg] = true;
      backtrack(row + 1, c);
      usedCols[c] = false; usedRegions[reg] = false;
      if (count >= cap) return;
    }
  }
  backtrack(0, -1);
  return count;
}

function generatePuzzle(size) {
  let ro, cols, guard = 0;
  do {
    cols = generateSolution(size);
    ro = buildRegions(size, cols);
    guard++;
  } while (countSolutions(size, ro, 2) !== 1 && guard < GEN_ATTEMPTS);
  return { regionOf: ro, solutionCols: cols };
}

/* ---------- 盤面構築 ---------- */
function buildBoard() {
  SIZE = shell.hardMode ? HARD_SIZE : NORMAL_SIZE;
  const gen = generatePuzzle(SIZE);
  regionOf = gen.regionOf;
  solutionCols = gen.solutionCols;
  placed = Array.from({ length: SIZE }, () => Array(SIZE).fill(false));
  marks = Array.from({ length: SIZE }, () => Array(SIZE).fill(false));
  placedCount = 0;
  solved = false;
  mode = 'place';

  shell.board.className = 's-board nya-board';
  shell.board.innerHTML = `
    <div class="nya-toolbar">
      <div class="nya-modes">
        <button class="nya-mode-btn" data-mode="place">🐱 配置</button>
        <button class="nya-mode-btn" data-mode="mark">✕ 印</button>
      </div>
      <span class="nya-progress">🐱 <b id="nyaProgress">0</b> / ${SIZE}</span>
    </div>
    <div class="nya-grid" id="nyaGrid" style="--cols:${SIZE}"></div>
    <div class="nya-actions">
      <button class="s-icon-btn-text" id="nyaHintBtn">💡 ヒント</button>
      <button class="s-icon-btn-text" id="nyaRestartBtn">↩️ はじめから</button>
    </div>
  `;
  shell.board.querySelectorAll('.nya-mode-btn').forEach((btn) => {
    btn.addEventListener('click', () => setMode(btn.dataset.mode));
  });
  setMode('place');

  const grid = shell.board.querySelector('#nyaGrid');
  cellEls = [];
  for (let r = 0; r < SIZE; r++) {
    cellEls.push([]);
    for (let c = 0; c < SIZE; c++) {
      const btn = document.createElement('button');
      btn.className = 'nya-cell';
      btn.addEventListener('click', () => onCellClick(r, c));
      grid.appendChild(btn);
      cellEls[r].push(btn);
      renderCell(r, c);
    }
  }
  shell.board.querySelector('#nyaHintBtn').addEventListener('click', showHint);
  shell.board.querySelector('#nyaRestartBtn').addEventListener('click', restartBoard);
  updateProgress();
}

function showPlaceholder() {
  shell.board.className = 's-board';
  shell.board.innerHTML = `
    <div class="nya-placeholder">
      <p>同じ<b>行・列・色エリア</b>、そして<b>ナナメを含めた隣接マス</b>に、ネコが2匹以上並ばないように、盤面いっぱいにネコを置くパズルです。</p>
      <p>「🐱配置」「✕印」をボタンで切り替えて考えましょう。</p>
      <p>「スタート」を押すとはじまります</p>
    </div>
  `;
}

/* ---------- 描画 ---------- */
function renderCell(r, c) {
  const el = cellEls[r][c];
  el.className = 'nya-cell';
  el.style.background = REGION_COLORS[regionOf[r][c] % REGION_COLORS.length];
  if (placed[r][c]) {
    el.classList.add('nya-has-cat');
    el.textContent = '🐱';
  } else if (marks[r][c]) {
    el.classList.add('nya-marked');
    el.textContent = '✕';
  } else {
    el.textContent = '';
  }
}

function updateProgress() {
  const el = shell.board.querySelector('#nyaProgress');
  if (el) el.textContent = placedCount;
}

function setMode(m) {
  mode = m;
  shell.board.querySelectorAll('.nya-mode-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.mode === m);
  });
}

/* ---------- 操作 ---------- */
function onCellClick(r, c) {
  if (!shell.running || solved) return;
  if (mode === 'mark') {
    if (placed[r][c]) return;
    marks[r][c] = !marks[r][c];
    renderCell(r, c);
    shell.playTone(400, 0.04);
    return;
  }
  if (placed[r][c]) { removeCat(r, c); return; }
  tryPlaceCat(r, c);
}

function tryPlaceCat(r, c) {
  for (let rr = 0; rr < SIZE; rr++) {
    for (let cc = 0; cc < SIZE; cc++) {
      if (!placed[rr][cc]) continue;
      const conflict =
        rr === r || cc === c ||
        regionOf[rr][cc] === regionOf[r][c] ||
        (Math.abs(rr - r) <= 1 && Math.abs(cc - c) <= 1);
      if (conflict) { rejectPlacement(r, c); return; }
    }
  }
  placed[r][c] = true;
  marks[r][c] = false;
  placedCount++;
  renderCell(r, c);
  shell.playTone(620, 0.06);
  updateProgress();
  if (placedCount === SIZE) triggerClear();
}

function rejectPlacement(r, c) {
  shell.playTone(260, 0.12, 'sawtooth');
  const el = cellEls[r][c];
  el.classList.add('nya-shake');
  setTimeout(() => el.classList.remove('nya-shake'), 300);
}

function removeCat(r, c) {
  placed[r][c] = false;
  placedCount--;
  renderCell(r, c);
  shell.playTone(360, 0.05);
  updateProgress();
}

function restartBoard() {
  if (!shell.running) return;
  placed = Array.from({ length: SIZE }, () => Array(SIZE).fill(false));
  marks = Array.from({ length: SIZE }, () => Array(SIZE).fill(false));
  placedCount = 0;
  for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) renderCell(r, c);
  updateProgress();
  shell.toast('はじめから置き直しましょう');
}

/* ---------- ヒント（唯一解から確定マスを教える） ---------- */
function showHint() {
  if (!shell.running || solved) return;
  // 既存の配置が正解からズレていないか確認
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      if (placed[r][c] && solutionCols[r] !== c) {
        const el = cellEls[r][c];
        el.classList.add('nya-wrong');
        setTimeout(() => el.classList.remove('nya-wrong'), 900);
        shell.playTone(280, 0.15, 'triangle');
        shell.toast('この配置だと完成できません。ネコを見直してみましょう');
        return;
      }
    }
  }
  for (let r = 0; r < SIZE; r++) {
    if (!placed[r][solutionCols[r]]) {
      const el = cellEls[r][solutionCols[r]];
      el.classList.add('nya-hint');
      shell.playTone(600, 0.08);
      shell.toast('光っているマスに置けます');
      setTimeout(() => el.classList.remove('nya-hint'), 1800);
      return;
    }
  }
}

/* ---------- クリア演出：光の波＋紙吹雪ポップ ---------- */
function triggerClear() {
  solved = true;
  const wave = [];
  for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) wave.push([r, c]);
  wave.sort((a, b) => (a[0] + a[1]) - (b[0] + b[1]));
  const stepDelay = Math.max(10, Math.min(26, 500 / wave.length));

  wave.forEach(([r, c], i) => {
    setTimeout(() => {
      const el = cellEls[r][c];
      if (el) el.classList.add('nya-solved');
    }, i * stepDelay);
  });

  [523.25, 659.25, 783.99, 1046.5, 1318.51].forEach((f, i) =>
    setTimeout(() => shell.playTone(f, 0.14, 'triangle'), i * 90)
  );

  const emojis = ['🐱', '🐾', '✨'];
  const spots = shuffleArr(wave.slice()).slice(0, Math.min(6, wave.length));
  spots.forEach((pos, i) => {
    setTimeout(() => {
      const el = cellEls[pos[0]][pos[1]];
      if (el) shell.showPopup(el, emojis[(Math.random() * emojis.length) | 0], 'bonus');
    }, 150 + i * 90);
  });

  const totalDelay = wave.length * stepDelay + 250;
  setTimeout(() => {
    shell.end('やったね！ぜんぶのネコがおさまったよ🐱');
  }, totalDelay);
}

showPlaceholder();

/* ---- GameShellのライフサイクルに接続 ---- */
shell.onStart(() => {
  buildBoard();
});
shell.onReset(() => {
  showPlaceholder();
});
shell.onHardModeChange(() => {
  // running中は呼ばれない（GameShell側で保証）。次回スタート時のサイズに反映される。
});