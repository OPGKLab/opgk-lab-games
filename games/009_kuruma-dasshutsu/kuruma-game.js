/* =========================================================
   くるま脱出🚗 固有ロジック
   共通土台(GameShell)のAPIだけを使い、盤面生成・ソルバー・ドラッグ操作を実装。
   - 盤面は通常/激むずとも6x6固定。難易度差は車の台数・最短手数のしきい値で調整。
   - パズルは毎回自動生成し、BFSソルバーで「解けること」「自明すぎないこと」を検証してから出題する。
   - 10問を1セッションとし、1問クリアごとに次を生成する（生成の重さを分散するため）。
   - ヒントはその場の盤面からBFSを再実行し、最短経路の最初の一手（車＋方向）だけを教える。
   ========================================================= */

const shell = new GameShell({
  rootSelector: '#app',
  title: 'くるま脱出🚗',
  hint: '車は前後方向にしか動かせません。ターゲットの車を出口まで動かそう！（タイトル5回タップで激むず）',
  hasScore: false,
  hasTimer: false,
});

const SIZE = 6;
const SESSION_LENGTH = 10;

const NORMAL_MODE = { carCountMin: 7, carCountMax: 9, minMoves: 5, floorMoves: 3 };
const HARD_MODE   = { carCountMin: 10, carCountMax: 12, minMoves: 10, floorMoves: 6 };
const GEN_ATTEMPTS_PER_ROUND = 20; // このぶん失敗したらminMovesを1下げて再挑戦
const GEN_MAX_ROUNDS = 6;
const PLACE_ATTEMPTS_PER_CAR = 40;

const CAR_COLORS = ['#4a7fd1', '#4cb98a', '#9575cd', '#f2b134', '#4fc3d9', '#f2925c', '#c9a227', '#8a5a3c', '#5c8a72', '#c17ab0', '#7a8fa6', '#e08e45'];
const TARGET_COLOR = '#e2574c';

let cars = [];          // { orientation:'h'|'v', length:2|3, row, col, isTarget, color }
let targetIndex = 0;
let initialSnapshot = null; // 現在の問題の初期配置（やり直し用）
let puzzleIndex = 0;    // 0-9
let moveCount = 0;
let lotEl = null;
let carEls = [];
let dragState = null;   // { carIndex, startRow, startCol, startX, startY, cellPx }
let hintTimeoutId = null;
let resolving = false;  // 演出中は操作不可
let generating = false;

/* ---------- ユーティリティ ---------- */
function cellsOf(car) {
  const list = [];
  for (let k = 0; k < car.length; k++) {
    list.push(car.orientation === 'h' ? [car.row, car.col + k] : [car.row + k, car.col]);
  }
  return list;
}

function buildOccupancy(carList) {
  const occ = new Map();
  carList.forEach((c, i) => {
    cellsOf(c).forEach(([r, cc]) => occ.set(`${r},${cc}`, i));
  });
  return occ;
}

function inBounds(r, c) { return r >= 0 && r < SIZE && c >= 0 && c < SIZE; }

function overlaps(carList, candidate, ignoreIndex = -1) {
  const occ = buildOccupancy(carList.filter((_, i) => i !== ignoreIndex));
  return cellsOf(candidate).some(([r, c]) => occ.has(`${r},${c}`));
}

/* ---------- 盤面生成 ---------- */
function randomCar(existingCars, forceHorizontalRow = null) {
  for (let attempt = 0; attempt < PLACE_ATTEMPTS_PER_CAR; attempt++) {
    const orientation = forceHorizontalRow !== null ? 'h' : (Math.random() < 0.5 ? 'h' : 'v');
    const length = Math.random() < 0.65 ? 2 : 3;
    let row, col;
    if (orientation === 'h') {
      row = forceHorizontalRow !== null ? forceHorizontalRow : ((Math.random() * SIZE) | 0);
      col = (Math.random() * (SIZE - length + 1)) | 0;
    } else {
      row = (Math.random() * (SIZE - length + 1)) | 0;
      col = (Math.random() * SIZE) | 0;
    }
    const candidate = { orientation, length, row, col };
    if (!overlaps(existingCars, candidate)) return candidate;
  }
  return null;
}

function generateLayout(carCount) {
  const targetRow = (Math.random() * SIZE) | 0;
  const targetLength = Math.random() < 0.6 ? 2 : 3;
  const maxStartCol = SIZE - targetLength - 1; // 出口にべた付けの自明配置を避ける
  const targetCol = maxStartCol >= 0 ? (Math.random() * (maxStartCol + 1)) | 0 : 0;
  const target = { orientation: 'h', length: targetLength, row: targetRow, col: targetCol, isTarget: true };

  const list = [target];
  for (let i = 1; i < carCount; i++) {
    const c = randomCar(list);
    if (!c) break;
    list.push(c);
  }
  return list;
}

/* ---------- BFSソルバー ----------
   1回のmoveは「1台の車を、遮られるまで任意の距離だけ滑らせる」動作として定義する
   （実プレイのドラッグ操作と1対1で対応させ、手数の数え方を一致させるため）。 */
function neighborStates(carList) {
  const occ = buildOccupancy(carList);
  const results = [];
  carList.forEach((car, idx) => {
    cellsOf(car).forEach(([r, c]) => occ.delete(`${r},${c}`)); // 自分自身のマスは判定から一時除外
    const dirs = car.orientation === 'h' ? [-1, 1] : [-1, 1];
    dirs.forEach((dir) => {
      for (let step = 1; step <= SIZE; step++) {
        const newRow = car.orientation === 'v' ? car.row + dir * step : car.row;
        const newCol = car.orientation === 'h' ? car.col + dir * step : car.col;
        const leadR = car.orientation === 'v' ? (dir < 0 ? newRow : newRow + car.length - 1) : newRow;
        const leadC = car.orientation === 'h' ? (dir < 0 ? newCol : newCol + car.length - 1) : newCol;
        if (!inBounds(leadR, leadC)) break;
        if (occ.has(`${leadR},${leadC}`)) break;
        const nextList = carList.map((c, i) => (i === idx ? { ...c, row: newRow, col: newCol } : c));
        results.push({ cars: nextList, carIndex: idx, row: newRow, col: newCol });
      }
    });
    cellsOf(car).forEach(([r, c]) => occ.set(`${r},${c}`, idx)); // 復元
  });
  return results;
}

function stateKey(carList) {
  return carList.map((c) => `${c.row},${c.col}`).join('|');
}

function isGoal(carList, tIdx) {
  const t = carList[tIdx];
  return t.col + t.length - 1 === SIZE - 1;
}

/* 幅優先探索で最短手数と経路を求める。見つからなければnullを返す。 */
function solve(carList, tIdx, nodeCap = 60000) {
  if (isGoal(carList, tIdx)) return { distance: 0, firstMove: null };
  const startKey = stateKey(carList);
  const visited = new Set([startKey]);
  const parent = new Map(); // key -> { prevKey, move }
  let queue = [{ cars: carList, key: startKey }];
  let depth = 0;
  let expanded = 0;

  while (queue.length) {
    const nextQueue = [];
    for (const node of queue) {
      for (const nb of neighborStates(node.cars)) {
        const key = stateKey(nb.cars);
        if (visited.has(key)) continue;
        visited.add(key);
        parent.set(key, { prevKey: node.key, move: { carIndex: nb.carIndex, row: nb.row, col: nb.col } });
        expanded++;
        if (expanded > nodeCap) return null;

        if (isGoal(nb.cars, tIdx)) {
          // 経路をたどって「startから見た最初の一手」を求める
          let k = key;
          let firstMove = parent.get(k).move;
          while (parent.get(k).prevKey !== startKey) {
            k = parent.get(k).prevKey;
            firstMove = parent.get(k).move;
          }
          return { distance: depth + 1, firstMove };
        }
        nextQueue.push({ cars: nb.cars, key });
      }
    }
    queue = nextQueue;
    depth++;
    if (depth > 40) return null; // 極端に長い解は打ち切り（生成やり直しに回す）
  }
  return null;
}

/* ---------- パズル1問の生成（解けること・自明でないことを保証） ---------- */
function generatePuzzle() {
  const mode = shell.hardMode ? HARD_MODE : NORMAL_MODE;
  let minMoves = mode.minMoves;

  for (let round = 0; round < GEN_MAX_ROUNDS; round++) {
    for (let attempt = 0; attempt < GEN_ATTEMPTS_PER_ROUND; attempt++) {
      const carCount = mode.carCountMin + ((Math.random() * (mode.carCountMax - mode.carCountMin + 1)) | 0);
      const layout = generateLayout(carCount);
      if (layout.length < Math.min(carCount, mode.carCountMin)) continue;
      const result = solve(layout, 0);
      if (result && result.distance >= minMoves) {
        return layout;
      }
    }
    minMoves = Math.max(mode.floorMoves, minMoves - 1);
  }
  // 最終手段：しきい値を無視してでも「解ける盤面」を1つ確保する
  for (let attempt = 0; attempt < 100; attempt++) {
    const carCount = mode.carCountMin;
    const layout = generateLayout(carCount);
    const result = solve(layout, 0);
    if (result) return layout;
  }
  // 万一それも失敗したら、車1台だけの自明盤面（必ず解ける）を返す
  return [{ orientation: 'h', length: 2, row: (SIZE / 2) | 0, col: 0, isTarget: true }];
}

/* ---------- 描画 ---------- */
function colorFor(index, isTarget) {
  return isTarget ? TARGET_COLOR : CAR_COLORS[(index - 1) % CAR_COLORS.length];
}

function emojiFor(car) {
  if (!car.isTarget) return '';
  return car.length >= 3 ? '🚌' : '🚗';
}

function positionCarEl(el, car) {
  const leftPct = (car.orientation === 'h' ? car.col : car.col) / SIZE * 100;
  const topPct = (car.orientation === 'v' ? car.row : car.row) / SIZE * 100;
  const wPct = (car.orientation === 'h' ? car.length : 1) / SIZE * 100;
  const hPct = (car.orientation === 'v' ? car.length : 1) / SIZE * 100;
  el.style.left = `${leftPct}%`;
  el.style.top = `${topPct}%`;
  el.style.width = `${wPct}%`;
  el.style.height = `${hPct}%`;
}

function renderCars() {
  carEls = cars.map((car, i) => {
    const el = document.createElement('div');
    el.className = 'kuruma-car' + (car.orientation === 'h' ? ' kuruma-car-h' : ' kuruma-car-v') + (car.isTarget ? ' kuruma-target' : '');
    el.style.background = colorFor(i, car.isTarget);
    if (car.isTarget) {
      const span = document.createElement('span');
      span.className = 'kuruma-target-emoji';
      span.textContent = emojiFor(car);
      el.appendChild(span);
    } else {
      const sunroof = document.createElement('div');
      sunroof.className = 'kuruma-sunroof';
      el.appendChild(sunroof);
    }
    positionCarEl(el, car);
    el.addEventListener('pointerdown', (e) => onCarPointerDown(e, i));
    lotEl.appendChild(el);
    return el;
  });
  positionExitMarker();
  sizeCarDecorations();
}

/* ターゲット車の絵文字サイズ、および各車のサンルーフ位置・形状を、セル基準のpxで統一する。
   サンルーフは「車の向きが縦でも横でも、見た目は常に横長の楕円」で統一し、
   車の長さ方向の端寄り（driver/passenger seatをイメージした位置）に配置する。 */
function sizeCarDecorations() {
  const cellPx = lotEl.getBoundingClientRect().width / SIZE;
  const targetEl = carEls[targetIndex];
  const emojiSpan = targetEl && targetEl.querySelector('.kuruma-target-emoji');
  if (emojiSpan) emojiSpan.style.fontSize = `${Math.round(cellPx * 0.72)}px`;

  const longSize = cellPx * 1.05;   // 車の向きに沿った長い方
  const shortSize = cellPx * 0.56;  // 車の向きに対して垂直な短い方
  const offset = cellPx * 0.32;     // 中央ではなく端寄りに配置するためのオフセット

  cars.forEach((car, i) => {
    if (car.isTarget) return;
    const sr = carEls[i].querySelector('.kuruma-sunroof');
    if (!sr) return;
// width/heightは向きに関わらず常に固定（横長を維持）。位置（top/left）だけ向きで切り替える。
sr.style.width = `${srW}px`;
sr.style.height = `${srH}px`;
if (car.orientation === 'h') {
  sr.style.left = `${offset}px`;
  sr.style.top = '50%';
  sr.style.transform = 'translateY(-50%)';
} else {
  sr.style.top = `${offset}px`;
  sr.style.left = '50%';
  sr.style.transform = 'translateX(-50%)';
}
  });
}

function positionExitMarker() {
  const target = cars[targetIndex];
  let exitEl = lotEl.querySelector('.kuruma-exit');
  if (!exitEl) {
    exitEl = document.createElement('div');
    exitEl.className = 'kuruma-exit';
    exitEl.innerHTML = '<span class="kuruma-exit-emoji">🚪</span><span class="kuruma-exit-label">出口</span>';
    lotEl.appendChild(exitEl);
  }
  exitEl.style.top = `${(target.row / SIZE) * 100}%`;
  exitEl.style.height = `${(1 / SIZE) * 100}%`;
}

function updateToolbar() {
  const p = shell.board.querySelector('#kurumaPuzzleNo');
  const m = shell.board.querySelector('#kurumaMoves');
  if (p) p.textContent = `${puzzleIndex + 1}`;
  if (m) m.textContent = moveCount;
}

/* ---------- ドラッグ操作 ---------- */
function maxSlide(carIndex, dir) {
  // dir: -1 または +1。返り値は移動可能な最大セル数（0なら動けない）。
  const occ = buildOccupancy(cars);
  const car = cars[carIndex];
  cellsOf(car).forEach(([r, c]) => occ.delete(`${r},${c}`));
  let step = 0;
  for (let s = 1; s <= SIZE; s++) {
    const newRow = car.orientation === 'v' ? car.row + dir * s : car.row;
    const newCol = car.orientation === 'h' ? car.col + dir * s : car.col;
    const leadR = car.orientation === 'v' ? (dir < 0 ? newRow : newRow + car.length - 1) : newRow;
    const leadC = car.orientation === 'h' ? (dir < 0 ? newCol : newCol + car.length - 1) : newCol;
    if (!inBounds(leadR, leadC)) break;
    if (occ.has(`${leadR},${leadC}`)) break;
    step = s;
  }
  return step;
}

/* ドラッグ中は実データ(row/col)を書き換えず、CSS transformで指に連続追従させるだけにする。
   離した瞬間にだけ、動ける範囲内で最も近いマスへ「スナップ」して実データを確定する。
   これにより、途中でマス単位に飛び飛びになる「ガタつき」を解消している。 */
function onCarPointerDown(e, carIndex) {
  if (!shell.running || resolving) return;
  const car = cars[carIndex];
  const rect = lotEl.getBoundingClientRect();
  const cellPx = rect.width / SIZE;
  const maxNegCells = maxSlide(carIndex, -1);
  const maxPosCells = maxSlide(carIndex, 1);

  dragState = {
    carIndex,
    startRow: car.row,
    startCol: car.col,
    startX: e.clientX,
    startY: e.clientY,
    cellPx,
    minPx: -maxNegCells * cellPx,
    maxPx: maxPosCells * cellPx,
  };
  const el = carEls[carIndex];
  el.classList.remove('kuruma-snapping');
  el.classList.add('kuruma-dragging');
  if (el.setPointerCapture) { try { el.setPointerCapture(e.pointerId); } catch (err) { /* noop */ } }
  clearHint();
}

function clampedDragPx(e) {
  const car = cars[dragState.carIndex];
  const rawPx = car.orientation === 'h' ? (e.clientX - dragState.startX) : (e.clientY - dragState.startY);
  return Math.min(dragState.maxPx, Math.max(dragState.minPx, rawPx));
}

function onPointerMoveDrag(e) {
  if (!dragState) return;
  const car = cars[dragState.carIndex];
  const px = clampedDragPx(e);
  const el = carEls[dragState.carIndex];
  el.style.transform = car.orientation === 'h' ? `translateX(${px}px)` : `translateY(${px}px)`;
}

function onPointerUpDrag(e) {
  if (!dragState) return;
  const idx = dragState.carIndex;
  const car = cars[idx];
  const el = carEls[idx];
  const px = e.clientX !== undefined ? clampedDragPx(e) : 0;
  const deltaCells = Math.round(px / dragState.cellPx);

  el.classList.remove('kuruma-dragging');
  el.style.transform = '';
  el.classList.add('kuruma-snapping');
  setTimeout(() => el.classList.remove('kuruma-snapping'), 150);

  const moved = deltaCells !== 0;
  if (moved) {
    if (car.orientation === 'h') car.col = dragState.startCol + deltaCells;
    else car.row = dragState.startRow + deltaCells;
  }
  positionCarEl(el, car);
  dragState = null;

  if (moved) {
    moveCount++;
    shell.playTone(500, 0.05);
    updateToolbar();
    if (idx === targetIndex && isGoal(cars, targetIndex)) {
      triggerExit();
    }
  }
}

function onPointerCancelDrag() {
  if (!dragState) return;
  const el = carEls[dragState.carIndex];
  el.classList.remove('kuruma-dragging');
  el.classList.add('kuruma-snapping');
  el.style.transform = '';
  positionCarEl(el, cars[dragState.carIndex]); // 移動確定なし、元の位置に戻す
  setTimeout(() => el.classList.remove('kuruma-snapping'), 150);
  dragState = null;
}

document.addEventListener('pointermove', onPointerMoveDrag);
document.addEventListener('pointerup', onPointerUpDrag);
document.addEventListener('pointercancel', onPointerCancelDrag);

/* ---------- ヒント ---------- */
function clearHint() {
  clearTimeout(hintTimeoutId);
  carEls.forEach((el) => el && el.classList.remove('kuruma-hint'));
  const arrow = lotEl && lotEl.querySelector('.kuruma-hint-arrow');
  if (arrow) arrow.remove();
}

function showHint() {
  if (!shell.running || resolving) return;
  const result = solve(cars, targetIndex);
  if (!result || !result.firstMove) {
    shell.toast('あと少しで出口です！ターゲットの車を右へ動かしてみましょう');
    return;
  }
  clearHint();
  const { carIndex, row, col } = result.firstMove;
  const car = cars[carIndex];
  const el = carEls[carIndex];
  el.classList.add('kuruma-hint');

  const dirIsRight = col > car.col;
  const dirIsDown = row > car.row;
  const dirLabel = car.orientation === 'h' ? (dirIsRight ? '右' : '左') : (dirIsDown ? '下' : '上');

  const arrow = document.createElement('div');
  arrow.className = 'kuruma-hint-arrow';
  arrow.textContent = car.orientation === 'h' ? (dirIsRight ? '▶' : '◀') : (dirIsDown ? '▼' : '▲');
  const cx = (car.col + (car.orientation === 'h' ? car.length : 0.5)) / SIZE * 100;
  const cy = (car.row + (car.orientation === 'v' ? car.length : 0.5)) / SIZE * 100;
  arrow.style.left = `${Math.min(92, cx)}%`;
  arrow.style.top = `${Math.min(92, cy)}%`;
  lotEl.appendChild(arrow);

  shell.playTone(600, 0.08);
  shell.toast(`光っている車を${dirLabel}へ動かしてみましょう`);
  hintTimeoutId = setTimeout(clearHint, 2200);
}

/* ---------- リセット（この問題をやり直す） ---------- */
function retryPuzzle() {
  if (!shell.running || resolving) return;
  cars = initialSnapshot.map((c) => ({ ...c }));
  moveCount = 0;
  clearHint();
  renderBoard();
  shell.toast('はじめの配置に戻しました');
}

/* ---------- クリア演出・進行 ---------- */
function triggerExit() {
  resolving = true;
  clearHint();
  const el = carEls[targetIndex];
  el.classList.add('kuruma-exiting');
  const target = cars[targetIndex];
  // 見た目だけ、盤外までさらにスライドさせて「脱出」を表現する
  el.style.left = `${((target.col + target.length + 2) / SIZE) * 100}%`;
  [523.25, 659.25, 783.99, 1046.5].forEach((f, i) =>
    setTimeout(() => shell.playTone(f, 0.14, 'triangle'), i * 90)
  );
  shell.toast(`${puzzleIndex + 1}問目クリア！（${moveCount}手）`);

  setTimeout(() => {
    puzzleIndex++;
    if (puzzleIndex >= SESSION_LENGTH) {
      showSessionComplete();
    } else {
      startNextPuzzle();
    }
  }, 750);
}

function showSessionComplete() {
  shell.board.className = 's-board kuruma-board';
  shell.board.innerHTML = `
    <div class="kuruma-complete">
      <div class="kuruma-complete-title">🎉 全10問クリア！</div>
      <div class="kuruma-complete-sub">お疲れ様でした🚗</div>
    </div>
  `;
  [523.25, 659.25, 783.99, 1046.5, 1318.51].forEach((f, i) =>
    setTimeout(() => shell.playTone(f, 0.16, 'triangle'), i * 100)
  );
  shell.end();
}

/* ---------- 問題の切り替え ---------- */
function startNextPuzzle() {
  generating = true;
  shell.board.className = 's-board kuruma-board';
  shell.board.innerHTML = '<div class="kuruma-loading">つぎの問題を作成中…</div>';
  // 生成処理の前に一度描画を挟み、UIが固まって見えないようにする
  setTimeout(() => {
    const layout = generatePuzzle();
    cars = layout;
    targetIndex = 0;
    initialSnapshot = layout.map((c) => ({ ...c }));
    moveCount = 0;
    generating = false;
    renderBoard();
  }, 30);
}

function renderBoard() {
  resolving = false;
  shell.board.className = 's-board kuruma-board';
  shell.board.innerHTML = `
    <div class="kuruma-toolbar">
      <span class="kuruma-progress">問題 <b id="kurumaPuzzleNo">${puzzleIndex + 1}</b> / ${SESSION_LENGTH}</span>
      <span class="kuruma-moves">手数: <b id="kurumaMoves">0</b></span>
      <div class="kuruma-toolbar-actions">
        <button class="s-icon-btn-text" id="kurumaHintBtn">💡 ヒント</button>
        <button class="s-icon-btn-text" id="kurumaRetryBtn">↩️ はじめから</button>
      </div>
    </div>
    <div class="kuruma-lot-wrap">
      <div class="kuruma-lot" id="kurumaLot"></div>
    </div>
  `;
  lotEl = shell.board.querySelector('#kurumaLot');
  shell.board.querySelector('#kurumaHintBtn').addEventListener('click', showHint);
  shell.board.querySelector('#kurumaRetryBtn').addEventListener('click', retryPuzzle);
  renderCars();
  updateToolbar();
}

function showPlaceholder() {
  shell.board.className = 's-board kuruma-board';
  shell.board.innerHTML = `
    <div class="kuruma-placeholder">
  <p><b>🚗 ターゲットの車</b>を<b>🚪出口</b>まで動かして脱出させるパズルです。</p>
  <p>車は前後方向にしか動きません。ドラッグで自由な距離を動かせます。</p>
  <p>他の車をどかしながら道すじを作りましょう。</p>
  <p>全10問、ヒントは何度でも使えます。</p>
  <p>「スタート」を押すとはじまります</p>
</div>
  `;
}

/* ---- GameShellのライフサイクルに接続 ---- */
shell.onStart(() => {
  puzzleIndex = 0;
  startNextPuzzle();
});
shell.onReset(() => {
  clearHint();
  dragState = null;
  resolving = true;
  showPlaceholder();
});
shell.onHardModeChange(() => {
  // running中は呼ばれない（GameShell側で保証）。次回スタート時の生成パラメータに反映される。
});

showPlaceholder();
