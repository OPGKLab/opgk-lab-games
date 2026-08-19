/* =========================================================
   あわせて10パズル🔟 固有ロジック
   共通土台(GameShell)のAPIだけを使い、盤面生成・なぞり操作・判定を実装。

   ルール：盤面上で8方向（縦・横・斜め）に隣り合うマスを指でなぞってつなぎ、
   合計が10になったら「きめる」で確定して消す。指を離しても経路は保持され、
   「きめる」を押すまでは確定しない（考える猶予を残す設計）。
   ※隠しルールとして、同じ数字を2つ以上つなげても消せる（ヒント文言では触れず、
     初回のみトーストで気づかせる）。

   数字の出現率は重み付き（1・8・9は控えめ）にして、単純な2枚ペアに頼らず
   複数枚をつなぐ場面が増えるよう調整している。
   短い間隔で連続して決めるとコンボ演出（ポップアップ＋一音追加）が入る。

   通常: 6x6、時間制限なし・詰みなし（手詰まり時は自動シャッフル）
   激むず: マス数は変えず、15秒→9秒間隔で未解決なら下から1行せり上がる（使用不可に）。
   せり上がりが盤面の大部分を占めたらゲームオーバー。
   ========================================================= */

const shell = new GameShell({
  rootSelector: '#app',
  title: 'あわせて10🔟',
  hint: 'マスを指でなぞって合計が10になるようつなげ、「きめる」で消しましょう',
  hasScore: false,
  hasTimer: false,
});

const BOARD_SIZE = 6;           // 激むずでもマス数は変えない（せり上がりペースの速さで難易度を出す）
const ACHIEVEMENT_GOAL = 40;    // これだけ「そろえたら」クリア
const HARD_PENALTY_MS = 9000;   // 激むず：この間隔で未解決ならせり上がる（通常イメージの15秒より速め）
const MATCH_TARGET = 10;
const PATH_NODE_CAP = 20000;    // 経路探索の打ち切り上限（過剰シャッフル防止のため打ち切り時は「解けるかもしれない」扱いにする）
const COMBO_WINDOW_MS = 3500;   // この間隔以内に連続で決めるとコンボ扱い

/* 数字ごとの出現重み：1・8・9は単純な2枚ペアを作りやすいので控えめに、
   3〜6を中心に出しておくことで複数枚をつなぐ場面を増やす */
const NUM_WEIGHTS = { 1: 2, 2: 2, 3: 3, 4: 3, 5: 4, 6: 3, 7: 3, 8: 1, 9: 1 };
const NUM_WEIGHT_TOTAL = Object.values(NUM_WEIGHTS).reduce((a, b) => a + b, 0);

/* 数字ごとの極薄カラー（視認性向上のためのヒント色。彩度は低めに抑える） */
const NUM_COLORS = {
  1: '#ffe9e9', 2: '#ffedd9', 3: '#fff6d2', 4: '#e8f5df',
  5: '#dcf3ee', 6: '#dfeffa', 7: '#e6e6f7', 8: '#f2e0f5', 9: '#f7e0ea',
};

let SIZE = BOARD_SIZE;
let board = [];        // board[r][c] = 1〜9（数字タイル）
let cellEls = [];
let path = [];          // [[r,c], ...] 現在なぞっている経路（指を離しても保持）
let dragging = false;
let blockedRows = 0;    // 激むず：下からせり上がってきた使用不可の行数
let clearedCount = 0;   // 達成数（そろえたグループの回数）
let resolving = false;  // 消去・シャッフル演出中は操作不可
let penaltyTimer = null;
let gameOverFlag = false;
let sameNumberHintShown = false; // 同じ数字マッチの発見トーストは初回だけ表示する
let comboCount = 0;
let lastMatchTs = 0;

/* ---------- ユーティリティ ---------- */
function randVal() {
  let r = Math.random() * NUM_WEIGHT_TOTAL;
  for (const v of Object.keys(NUM_WEIGHTS)) {
    r -= NUM_WEIGHTS[v];
    if (r < 0) return Number(v);
  }
  return 5;
}

function neighbors8(r, c, size) {
  const list = [];
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue;
      const nr = r + dr, nc = c + dc;
      if (nr >= 0 && nr < size && nc >= 0 && nc < size) list.push([nr, nc]);
    }
  }
  return list;
}
function isAdjacent(a, b) {
  const dr = Math.abs(a[0] - b[0]);
  const dc = Math.abs(a[1] - b[1]);
  return dr <= 1 && dc <= 1 && !(dr === 0 && dc === 0);
}

/* 盤面上（minRow行目より下）に、隣接しながら合計10を作れる経路が存在するかをDFSで判定する。
   ノード上限に達したら「あるかもしれない」として楽観的にtrue扱いにし、過剰なシャッフルを避ける。 */
function hasTenPath(b, size, minRow) {
  let nodes = 0;
  const visited = Array.from({ length: size }, () => Array(size).fill(false));
  function dfs(r, c, sum) {
    nodes++;
    if (nodes > PATH_NODE_CAP) return null;
    if (sum === MATCH_TARGET) return true;
    visited[r][c] = true;
    for (const [nr, nc] of neighbors8(r, c, size)) {
      if (nr < minRow || visited[nr][nc]) continue;
      const nsum = sum + b[nr][nc];
      if (nsum > MATCH_TARGET) continue;
      const res = dfs(nr, nc, nsum);
      if (res === true) { visited[r][c] = false; return true; }
      if (res === null) { visited[r][c] = false; return null; }
    }
    visited[r][c] = false;
    return false;
  }
  for (let r = minRow; r < size; r++) {
    for (let c = 0; c < size; c++) {
      const res = dfs(r, c, b[r][c]);
      if (res === true || res === null) return true;
    }
  }
  return false;
}

/* 隣接する同じ数字のペアが存在するか（合計10ルールとは別に、これだけでも消せる） */
function hasSameAdjacentPair(b, size, minRow) {
  for (let r = minRow; r < size; r++) {
    for (let c = 0; c < size; c++) {
      for (const [nr, nc] of neighbors8(r, c, size)) {
        if (nr < minRow) continue;
        if (b[r][c] === b[nr][nc]) return true;
      }
    }
  }
  return false;
}
// 「合計10」または「同じ数字の隣接」のどちらかが作れれば解ける状態とみなす
function boardSolvable(b, size, minRow) {
  return hasSameAdjacentPair(b, size, minRow) || hasTenPath(b, size, minRow);
}

/* ---------- 盤面生成（必ず合計10の経路が作れる状態を保証） ---------- */
function generateBoard() {
  let b, guard = 0;
  do {
    b = Array.from({ length: SIZE }, () => Array.from({ length: SIZE }, randVal));
    guard++;
  } while (!boardSolvable(b, SIZE, 0) && guard < 30);
  return b;
}

/* ---------- 盤面構築 ---------- */
function buildBoard() {
  SIZE = BOARD_SIZE;
  board = generateBoard();
  path = [];
  dragging = false;
  blockedRows = 0;
  clearedCount = 0;
  resolving = false;
  gameOverFlag = false;
  sameNumberHintShown = false;
  comboCount = 0;
  lastMatchTs = 0;

  shell.board.className = 's-board atj-board';
  shell.board.innerHTML = `
    <div class="atj-toolbar">
      <span class="atj-progress">そろえた数：<b id="atjCount">0</b> / ${ACHIEVEMENT_GOAL}</span>
      <span class="atj-sum">合計：<b id="atjSum">0</b></span>
    </div>
    <div class="atj-grid" id="atjGrid" style="--cols:${SIZE}"></div>
    <div class="atj-actions">
      <button class="s-icon-btn-text" id="atjClearBtn">選択解除</button>
      <button class="s-btn" id="atjConfirmBtn">きめる</button>
    </div>
  `;
  const grid = shell.board.querySelector('#atjGrid');
  cellEls = [];
  for (let r = 0; r < SIZE; r++) {
    cellEls.push([]);
    for (let c = 0; c < SIZE; c++) {
      const btn = document.createElement('button');
      btn.className = 'atj-tile';
      btn.dataset.r = r;
      btn.dataset.c = c;
      btn.innerHTML = '<span class="atj-val"></span><span class="atj-order"></span>';
      btn.addEventListener('pointerdown', () => startDrag(r, c));
      grid.appendChild(btn);
      cellEls[r].push(btn);
    }
  }
  shell.board.querySelector('#atjConfirmBtn').addEventListener('click', confirmSelection);
  shell.board.querySelector('#atjClearBtn').addEventListener('click', clearSelection);

  renderAll();
  updateCountDisplay();

  if (shell.hardMode) {
    clearInterval(penaltyTimer);
    penaltyTimer = setInterval(applyPenalty, HARD_PENALTY_MS);
  }
}

function showPlaceholder() {
  shell.board.className = 's-board';
  shell.board.innerHTML = '<div class="atj-placeholder">「スタート」を押すと数字が並びます</div>';
}

/* ---------- 描画 ---------- */
function renderAll() {
  for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) renderCell(r, c);
  updateSumDisplay();
}
function renderCell(r, c) {
  const el = cellEls[r][c];
  const v = board[r][c];
  const isBlocked = r < blockedRows;
  const idx = path.findIndex(([pr, pc]) => pr === r && pc === c);

  el.className = 'atj-tile';
  el.classList.toggle('atj-blocked', isBlocked);
  el.classList.toggle('atj-selected', idx !== -1);
  el.disabled = isBlocked;

  const valEl = el.querySelector('.atj-val');
  const orderEl = el.querySelector('.atj-order');
  if (valEl) valEl.textContent = v || '';
  if (v) el.style.setProperty('--num-tint', NUM_COLORS[v]);
  else el.style.removeProperty('--num-tint');
  // 順番バッジは2マス以上つないだ時だけ表示（1マスだけでは意味がないため）
  if (orderEl) orderEl.textContent = (idx !== -1 && path.length > 1) ? String(idx + 1) : '';
}
function updateSumDisplay() {
  const values = path.map(([r, c]) => board[r][c]);
  const sum = values.reduce((s, v) => s + v, 0);
  const sumEl = shell.board.querySelector('#atjSum');
  if (sumEl) sumEl.textContent = sum;

  // 合計10、または同じ数字の連続ができたら「押せます」と視覚的に伝える（自動確定はしない）
  const allSame = path.length >= 2 && values.every((v) => v === values[0]);
  const ready = path.length > 0 && (sum === MATCH_TARGET || allSame);
  const sumWrap = shell.board.querySelector('.atj-sum');
  const confirmBtn = shell.board.querySelector('#atjConfirmBtn');
  if (sumWrap) sumWrap.classList.toggle('atj-sum-ready', ready);
  if (confirmBtn) confirmBtn.classList.toggle('atj-ready', ready);
}
function updateCountDisplay() {
  const el = shell.board.querySelector('#atjCount');
  if (el) el.textContent = clearedCount;
}

/* ---------- なぞり操作 ----------
   pointerdown: 経路上の地点を再タップした場合はそこまで巻き戻す（末尾なら続きから再開）。
                経路外のマスなら、そこを起点に新しい経路を開始する。
   pointermove: 隣接マスへなぞると経路に追加。ひとつ前のマスへ戻ると1マス取り消し（ボールつなぎと同じ操作感）。
   pointerup:   経路はそのまま保持（＝「きめる」を押すまでは確定しない） */
function startDrag(r, c) {
  if (!shell.running || resolving || gameOverFlag || r < blockedRows) return;
  const idx = path.findIndex(([pr, pc]) => pr === r && pc === c);
  path = idx !== -1 ? path.slice(0, idx + 1) : [[r, c]];
  dragging = true;
  renderAll();
}

function extendTo(r, c) {
  if (!dragging || r < blockedRows) return;
  const tip = path[path.length - 1];
  if (tip[0] === r && tip[1] === c) return;

  if (path.length >= 2) {
    const prev = path[path.length - 2];
    if (prev[0] === r && prev[1] === c) { path.pop(); renderAll(); return; }
  }
  if (path.some(([pr, pc]) => pr === r && pc === c)) return;
  if (!isAdjacent(tip, [r, c])) return;

  path.push([r, c]);
  renderAll();
}

document.addEventListener('pointermove', (e) => {
  if (!dragging) return;
  const el = document.elementFromPoint(e.clientX, e.clientY);
  if (!el || !el.classList || !el.classList.contains('atj-tile')) return;
  extendTo(+el.dataset.r, +el.dataset.c);
});
document.addEventListener('pointerup', () => { dragging = false; });

function clearSelection() {
  if (!shell.running) return;
  path = [];
  renderAll();
}

function confirmSelection() {
  if (!shell.running || resolving || gameOverFlag || path.length === 0) return;
  const values = path.map(([r, c]) => board[r][c]);
  const sum = values.reduce((s, v) => s + v, 0);
  const allSame = path.length >= 2 && values.every((v) => v === values[0]);

  if (sum === MATCH_TARGET || allSame) {
    if (allSame && sum !== MATCH_TARGET && !sameNumberHintShown) {
      sameNumberHintShown = true;
      shell.toast('おなじ数字をつなげても消せます✨');
    }
    resolveMatch(path.slice());
  } else {
    shell.playTone(220, 0.15, 'sawtooth');
    const cells = path.slice();
    cells.forEach(([r, c]) => cellEls[r][c].classList.add('atj-shake'));
    setTimeout(() => cells.forEach(([r, c]) => cellEls[r][c] && cellEls[r][c].classList.remove('atj-shake')), 300);
    clearSelection();
  }
}

/* ---------- サウンド（つないだ枚数・連続具合に応じて段階化） ---------- */
function playMatchSound(len, combo) {
  if (len <= 2) { shell.playTone(660, 0.1); }
  else if (len === 3) { [660, 880].forEach((f, i) => setTimeout(() => shell.playTone(f, 0.1), i * 90)); }
  else if (len <= 5) { [660, 880, 1046.5].forEach((f, i) => setTimeout(() => shell.playTone(f, 0.11), i * 85)); }
  else if (len <= 7) { [660, 880, 1046.5, 1318.51].forEach((f, i) => setTimeout(() => shell.playTone(f, 0.12, 'triangle'), i * 80)); }
  else { [523.25, 659.25, 783.99, 1046.5, 1318.51].forEach((f, i) => setTimeout(() => shell.playTone(f, 0.14, 'triangle'), i * 90)); }
  // 連続で決めている時は、仕上げに一音だけ高い煌めきを足して爽快感を出す
  if (combo >= 2) setTimeout(() => shell.playTone(1568, 0.1, 'triangle'), 260);
}
// 新しい数字が補充された時の小さな「キュルリン♪」音（連打を避けるため1回だけ鳴らす）
function playRefillChirp() {
  shell.playTone(950, 0.05, 'sine');
  setTimeout(() => shell.playTone(1300, 0.06, 'sine'), 45);
}

// 激むず：せり上がり（ペナルティ）専用の音。ゲームオーバー音（低いsawtooth）と
// 紛らわしくならないよう、軽めの2音の「注意喚起」トーンにする。
function playPenaltyChime() {
  shell.playTone(520, 0.08, 'triangle');
  setTimeout(() => shell.playTone(420, 0.08, 'triangle'), 90);
}

/* ---------- 消去・重力・演出 ---------- */
function resolveMatch(cells) {
  resolving = true;
  path = [];
  renderAll(); // 選択表示を先にクリアしてから、これから光らせる演出クラスを付ける
  cells.forEach(([r, c]) => cellEls[r][c].classList.add('atj-match-glow'));

  const now = Date.now();
  comboCount = (now - lastMatchTs <= COMBO_WINDOW_MS) ? comboCount + 1 : 1;
  lastMatchTs = now;
  playMatchSound(cells.length, comboCount);

  clearedCount++;
  updateCountDisplay();
  const anchor = cellEls[cells[0][0]][cells[0][1]];
  let label = cells.length >= 3 ? `まとめて${cells.length}枚！` : `${cells.length}枚そろった！`;
  if (comboCount >= 2) label += ` 🔥${comboCount}連続`;
  shell.showPopup(anchor, label, cells.length >= 3 || comboCount >= 2 ? 'bonus' : 'good');

  setTimeout(() => {
    cells.forEach(([r, c]) => {
      cellEls[r][c].classList.remove('atj-match-glow');
      cellEls[r][c].classList.add('atj-matched');
    });
    setTimeout(() => {
      cells.forEach(([r, c]) => (board[r][c] = null));
      const fresh = applyGravity();
      playRefillChirp();
      renderAll();
      fresh.forEach(([r, c]) => cellEls[r][c].classList.add('atj-fresh'));
      setTimeout(() => fresh.forEach(([r, c]) => cellEls[r][c] && cellEls[r][c].classList.remove('atj-fresh')), 400);
      resolving = false;

      if (shell.hardMode) resetPenaltyTimer(); // 解けたので次のペナルティまでの時間をリセット

      if (clearedCount >= ACHIEVEMENT_GOAL) {
        triggerClear();
        return;
      }
      checkDeadlockAndShuffle();
    }, 220);
  }, 200);
}

// 消えたマスの上から新しい数字を補充する（ブロック行より下の範囲でのみ落下）。
// 新しく補充されたマスの座標を返し、呼び出し側で「ふわっと出現」演出に使う。
function applyGravity() {
  const freshCells = [];
  for (let c = 0; c < SIZE; c++) {
    const vals = [];
    for (let r = blockedRows; r < SIZE; r++) if (board[r][c] !== null) vals.push(board[r][c]);
    const missing = (SIZE - blockedRows) - vals.length;
    for (let i = 0; i < missing; i++) vals.unshift(randVal());
    for (let r = blockedRows; r < SIZE; r++) board[r][c] = vals[r - blockedRows];
    for (let i = 0; i < missing; i++) freshCells.push([blockedRows + i, c]);
  }
  return freshCells;
}

function checkDeadlockAndShuffle() {
  if (!shell.running || gameOverFlag || boardSolvable(board, SIZE, blockedRows)) return;
  resolving = true;
  const grid = shell.board.querySelector('#atjGrid');
  if (grid) grid.classList.add('atj-shuffling');
  shell.toast('シャッフル！🔟');
  setTimeout(() => {
    let guard = 0;
    do {
      for (let r = blockedRows; r < SIZE; r++) for (let c = 0; c < SIZE; c++) board[r][c] = randVal();
      guard++;
    } while (!boardSolvable(board, SIZE, blockedRows) && guard < 30);
    renderAll();
    if (grid) grid.classList.remove('atj-shuffling');
    resolving = false;
  }, 500);
}

/* ---------- 激むず：ペナルティ（せり上がり） ---------- */
function resetPenaltyTimer() {
  clearInterval(penaltyTimer);
  penaltyTimer = setInterval(applyPenalty, HARD_PENALTY_MS);
}

function applyPenalty() {
  if (!shell.running || resolving || gameOverFlag) return;
  blockedRows++;
  playPenaltyChime();
  shell.toast('じかんぎれ…盤面がせまくなります⚠️');
  path = [];
  renderAll();

  if (blockedRows >= SIZE - 2) {
    triggerGameOver();
    return;
  }
  checkDeadlockAndShuffle();
}

/* ---------- 終了 ---------- */
// 終了時、盤面全体を暗くして「終わったこと」を視覚的にはっきりさせるオーバーレイ
function showEndOverlay(title, sub, variant) {
  const grid = shell.board.querySelector('#atjGrid');
  if (grid) grid.classList.add('atj-dimmed');
  const overlay = document.createElement('div');
  overlay.className = `atj-end-overlay atj-end-${variant}`;
  overlay.innerHTML = `<div class="atj-end-title">${title}</div><div class="atj-end-sub">${sub}</div>`;
  shell.board.appendChild(overlay);
}

function triggerClear() {
  gameOverFlag = true;
  clearInterval(penaltyTimer);
  [523.25, 659.25, 783.99, 1046.5].forEach((f, i) =>
    setTimeout(() => shell.playTone(f, 0.16, 'triangle'), i * 100)
  );
  showEndOverlay('🎉 クリア！', `${ACHIEVEMENT_GOAL}回そろえました`, 'clear');
  shell.end();
}
function triggerGameOver() {
  gameOverFlag = true;
  clearInterval(penaltyTimer);
  shell.playTone(220, 0.3, 'sawtooth');
  showEndOverlay('ここまで！', `そろえた数：${clearedCount}`, 'over');
  shell.end();
}

showPlaceholder();

/* ---- GameShellのライフサイクルに接続 ---- */
shell.onStart(() => {
  buildBoard();
});
shell.onReset(() => {
  clearInterval(penaltyTimer);
  dragging = false;
  showPlaceholder();
});
shell.onHardModeChange(() => {
  // running中は呼ばれない（GameShell側で保証）。次回スタート時のサイズ・ペナルティに反映される。
});
