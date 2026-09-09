/* =========================================================
   動物ドナドナ🐄 固有ロジック
   共通土台(GameShell)のAPIだけを使い、行列・乗車口・駐車場・
   待避スペースの状態管理と、1手ずつのアニメーション演出を実装。

   重要な実装ノート（バグ修正）：
   黒(id=0)は数値として偽(false)扱いされるため、`!bay.color`のような
   truthy判定を使うと黒トラックを「空席」と誤認識してしまう。
   このファイルでは必ず `bay.color === null` の厳密比較で判定する。

   ルール概要：
   - 動物は1本の行列に並ぶ。先頭だけがアクセス可能。
   - 「乗車口」は複数あり、駐車場からトラックを配置すると、
     行列の先頭（または待避スペース）から色が一致する動物を
     自動で乗せ続ける（1匹ずつ、アニメーション付きで連鎖）。
   - トラックは定員4匹で満員になるまで出発しない。ただし、
     その色の動物がもう行列にも待避にも残っていない場合は、
     少人数のままでも出発する（でないと永久に出発できなくなるため）。
   - 乗車口が全部ふさがっていて先頭と色が合わない時は、
     先頭を「待避」に一時的にどかせる（最大3枠）。
   - 待避が満杯・空き乗車口なし・先頭と合う乗車口なし、が
     同時に起きると詰み。

   生成方式：ランダムな行列を生成し、貪欲法（待避の滞留を優先的に
   解消しつつ、無理なら先頭を待避へどかす）でシミュレーションして
   解けるか検証する。解けなければ再生成し、それでもダメな場合のみ
   色ごとのブロックをシャッフルする方式（必ず解ける）にフォールバックする。
   ========================================================= */

const shell = new GameShell({
  rootSelector: '#app',
  title: '動物ドナドナ🐄',
  hint: '行列の先頭と同じ色のトラックを、空いている乗車口に呼びましょう。合わない先頭は待避へどかせます。',
  hasScore: false,
  hasTimer: false,
});

const ANIMALS = [
  { id: 0, heart: '🖤', emoji: '🐄' },
  { id: 1, heart: '🩷', emoji: '🐖' },
  { id: 2, heart: '💚', emoji: '🐓' },
  { id: 3, heart: '🤍', emoji: '🐑' },
  { id: 4, heart: '🤎', emoji: '🐐' },
];

const NORMAL_QUEUE_LEN = 24;
const HARD_QUEUE_LEN = 36;
const NORMAL_BAYS = 3;
const HARD_BAYS = 4;
const HOLDING_MAX = 3;
const CAPACITY = 4;
const QUEUE_ROW_SIZE = 12; // 行列を折り返す1行あたりの数（Sの字レイアウト用）
const MAX_GEN_ATTEMPTS = 800;

let queue = [];    // [colorId, ...]（先頭 = queue[0]）
let holding = [];  // 待避。最大HOLDING_MAX
let bays = [];     // [{ color: null|colorId, loaded: number }, ...]
let pool = {};     // colorId -> 残りトラック台数
let gameEnded = false;
let animating = false; // アニメーション再生中は入力を受け付けない
let queueBoxMinHeight = 40; // 行列ボックスの高さ（生成時の行数から算出し、以後は固定して画面のガタつきを防ぐ）

/* ---------- ユーティリティ ---------- */
function randColor() { return Math.floor(Math.random() * ANIMALS.length); }

function computePool(queueArr) {
  const counts = {};
  ANIMALS.forEach((a) => (counts[a.id] = 0));
  queueArr.forEach((c) => counts[c]++);
  const p = {};
  ANIMALS.forEach((a) => (p[a.id] = Math.ceil(counts[a.id] / CAPACITY) || 0));
  return p;
}

/* 色ごとにブロックを作り、ブロック単位でシャッフルする保険用の生成方式。
   一度に必要な色が1種類ずつになるため、必ず解ける（が単調になるため最終手段）。 */
function buildBlockFallback(len) {
  const perColor = Math.ceil(len / ANIMALS.length);
  let arr = [];
  ANIMALS.forEach((a) => { for (let i = 0; i < perColor; i++) arr.push(a.id); });
  arr = arr.slice(0, len);
  const blocks = [];
  arr.forEach((c) => {
    const last = blocks[blocks.length - 1];
    if (last && last.color === c) last.items.push(c);
    else blocks.push({ color: c, items: [c] });
  });
  for (let i = blocks.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [blocks[i], blocks[j]] = [blocks[j], blocks[i]];
  }
  return blocks.flatMap((b) => b.items);
}

/* ---------- 解けるかの検証（貪欲法シミュレーション） ----------
   ※ここは生成時の検証専用のロジックであり、実プレイの動作を強制するものではない。
   待避に滞留している色があれば、それを優先的に乗車口へ呼ぶことで
   待避の詰まりを早めに解消する（単純な「先頭優先」より解ける確率が上がる）。 */
function simulateSolvable(queueArr, bayCount, poolInit) {
  const q = queueArr.slice();
  const hold = [];
  const simBays = Array.from({ length: bayCount }, () => ({ color: null, loaded: 0 }));
  const simPool = Object.assign({}, poolInit);

  function colorRemaining(color) {
    let c = 0;
    for (const v of q) if (v === color) c++;
    for (const v of hold) if (v === color) c++;
    return c;
  }
  function resolve() {
    let changed = true;
    while (changed) {
      changed = false;
      for (const bay of simBays) {
        if (bay.color === null) continue;
        let matched = false;
        const hIdx = hold.indexOf(bay.color);
        if (hIdx !== -1) { hold.splice(hIdx, 1); bay.loaded++; matched = true; changed = true; }
        else if (q.length > 0 && q[0] === bay.color) { q.shift(); bay.loaded++; matched = true; changed = true; }
        if (matched && bay.loaded > 0 && (bay.loaded >= CAPACITY || colorRemaining(bay.color) === 0)) {
          bay.color = null; bay.loaded = 0; changed = true;
        }
      }
    }
  }

  resolve();
  let guard = 0;
  while (q.length > 0 && guard < 6000) {
    guard++;
    const front = q[0];
    const emptyIdx = simBays.findIndex((b) => b.color === null);
    if (emptyIdx !== -1) {
      // 待避に残っている色があれば優先的に処理して滞留を解消する
      let chosen = null;
      if (hold.length > 0 && simPool[hold[0]] > 0) chosen = hold[0];
      else if (simPool[front] > 0) chosen = front;
      if (chosen !== null) {
        simPool[chosen]--;
        simBays[emptyIdx] = { color: chosen, loaded: 0 };
        resolve();
        continue;
      }
    }
    if (hold.length < HOLDING_MAX) {
      hold.push(q.shift());
      resolve();
      continue;
    }
    return false; // 詰み
  }
  return q.length === 0 && hold.length === 0;
}

/* ---------- 盤面生成 ---------- */
function generatePuzzle() {
  const bayCount = shell.hardMode ? HARD_BAYS : NORMAL_BAYS;
  const queueLen = shell.hardMode ? HARD_QUEUE_LEN : NORMAL_QUEUE_LEN;

  let queueArr, poolInit;
  let attempt = 0;
  do {
    queueArr = Array.from({ length: queueLen }, randColor);
    poolInit = computePool(queueArr);
    attempt++;
  } while (!simulateSolvable(queueArr, bayCount, poolInit) && attempt < MAX_GEN_ATTEMPTS);

  if (attempt >= MAX_GEN_ATTEMPTS) {
    queueArr = buildBlockFallback(queueLen);
    poolInit = computePool(queueArr);
  }

  queue = queueArr;
  pool = poolInit;
  holding = [];
  bays = Array.from({ length: bayCount }, () => ({ color: null, loaded: 0 }));
  gameEnded = false;
  animating = false;

  // 行数から必要な高さを見積もり、以後クリアまで固定する（動的縮小によるガタつき防止）
  const totalRows = Math.ceil(queue.length / QUEUE_ROW_SIZE);
  queueBoxMinHeight = totalRows * 26 + 10 + Math.max(0, totalRows - 1) * 4 + 16;

  renderBoard();
}

/* ---------- 実プレイ用ロジック ---------- */
function colorRemainingReal(color) {
  let c = 0;
  for (const v of queue) if (v === color) c++;
  for (const v of holding) if (v === color) c++;
  return c;
}

/* 乗車口を先頭から順に見て、待避→行列先頭の順で1匹だけ乗せる。
   何も乗せられなければnullを返す（＝この時点での連鎖は終わり）。
   満員 or その色がもう残っていない場合はその場で出発させる。 */
function stepOnce() {
  for (let bi = 0; bi < bays.length; bi++) {
    const bay = bays[bi];
    if (bay.color === null) continue;

    const hIdx = holding.indexOf(bay.color);
    if (hIdx !== -1) {
      holding.splice(hIdx, 1);
      bay.loaded++;
      const event = { type: 'board', from: 'holding', fromIndex: hIdx, bayIndex: bi, color: bay.color };
      finalizeBay(bay, bi, event);
      return event;
    }
    if (queue.length > 0 && queue[0] === bay.color) {
      const color = queue.shift();
      bay.loaded++;
      const event = { type: 'board', from: 'queue', bayIndex: bi, color };
      finalizeBay(bay, bi, event);
      return event;
    }
  }
  return null;
}

function finalizeBay(bay, bi, event) {
  if (bay.loaded > 0 && (bay.loaded >= CAPACITY || colorRemainingReal(bay.color) === 0)) {
    event.departed = { bayIndex: bi, color: bay.color, count: bay.loaded };
    bay.color = null;
    bay.loaded = 0;
  }
}

function isCleared() {
  return queue.length === 0 && holding.length === 0 && bays.every((b) => b.color === null);
}

function isDeadlocked() {
  if (queue.length === 0) return false;
  const front = queue[0];
  const hasMatchingBay = bays.some((b) => b.color === front);
  if (hasMatchingBay) return false;
  const hasEmptyBay = bays.some((b) => b.color === null);
  if (hasEmptyBay) return false;
  return holding.length >= HOLDING_MAX;
}

/* ---------- 描画 ---------- */
function renderBoard() {
  shell.board.className = 's-board donadona-board' + (animating ? ' donadona-animating' : '');
  shell.board.innerHTML = `
    <div class="donadona-legend">
      ${ANIMALS.map((a) => `<span>${a.heart}${a.emoji}</span>`).join('<span class="donadona-legend-sep">｜</span>')}
    </div>

    <div class="donadona-section-label">🚶 動物の行列（先頭をタップで待避）</div>
    <div class="donadona-queue" id="donadonaQueue"></div>

    <div class="donadona-lane">▼ 乗車レーン ▼</div>

    <div class="donadona-section-label donadona-bays-label">
      <span>🚪 乗車口</span><span>⏳ 待避</span>
    </div>
    <div class="donadona-bays-row">
      <div class="donadona-bays" id="donadonaBays"></div>
      <div class="donadona-holding" id="donadonaHolding"></div>
    </div>

    <div class="donadona-section-label">🅿️ 駐車場（タップで乗車口へ）</div>
    <div class="donadona-pool" id="donadonaPool"></div>
  `;

  // Sの字レイアウト：QUEUE_ROW_SIZEごとに行を作り、偶数行は右詰め、
  // 奇数行は左詰めにして、前の行のお尻から続いて見えるようにする。
  // column-reverseで包んでいるので、最初に追加した行（先頭を含む行）が一番下に来る。
  const queueEl = shell.board.querySelector('#donadonaQueue');
  queueEl.style.minHeight = queueBoxMinHeight + 'px';
  for (let start = 0; start < queue.length; start += QUEUE_ROW_SIZE) {
    const rowIdx = start / QUEUE_ROW_SIZE;
    const rowItems = queue.slice(start, start + QUEUE_ROW_SIZE);
    const rowEl = document.createElement('div');
    rowEl.className = 'donadona-queue-row' + (rowIdx % 2 === 1 ? ' donadona-queue-row-rev' : '');
    rowItems.forEach((c, i) => {
      const globalIdx = start + i;
      if (globalIdx === 0) {
        const arrow = document.createElement('span');
        arrow.className = 'donadona-queue-front-arrow';
        arrow.textContent = '🔽';
        rowEl.appendChild(arrow);
        const btn = document.createElement('button');
        btn.className = 'donadona-queue-front';
        btn.textContent = ANIMALS[c].heart;
        btn.addEventListener('click', onQueueFrontTap);
        rowEl.appendChild(btn);
      } else {
        const span = document.createElement('span');
        span.className = 'donadona-queue-heart';
        span.textContent = ANIMALS[c].heart;
        rowEl.appendChild(span);
      }
    });
    queueEl.appendChild(rowEl);
  }

  const holdEl = shell.board.querySelector('#donadonaHolding');
  for (let i = 0; i < HOLDING_MAX; i++) {
    const el = document.createElement('div');
    const filled = holding[i] !== undefined;
    el.className = 'donadona-holding-slot' + (filled ? ' donadona-holding-slot-filled' : '');
    el.textContent = filled ? ANIMALS[holding[i]].heart : '';
    holdEl.appendChild(el);
  }

  const baysEl = shell.board.querySelector('#donadonaBays');
  bays.forEach((bay) => {
    const el = document.createElement('div');
    if (bay.color === null) {
      el.className = 'donadona-bay donadona-bay-empty';
      el.textContent = 'あき';
    } else {
      el.className = 'donadona-bay';
      el.innerHTML = `
        <span class="donadona-bay-emoji">🚚${ANIMALS[bay.color].heart}</span>
        <span class="donadona-bay-count">${bay.loaded} / ${CAPACITY}</span>
      `;
    }
    baysEl.appendChild(el);
  });

  const poolEl = shell.board.querySelector('#donadonaPool');
  const poolRow1 = document.createElement('div');
  poolRow1.className = 'donadona-pool-row';
  const poolRow2 = document.createElement('div');
  poolRow2.className = 'donadona-pool-row';
  const POOL_ROW1_SIZE = 3; // 画面幅によらず常に3・2の2段になるよう固定
  ANIMALS.forEach((a, idx) => {
    const btn = document.createElement('button');
    btn.className = 'donadona-pool-btn';
    btn.disabled = !pool[a.id];
    btn.innerHTML = `
      <span class="donadona-pool-inner">
        <span class="donadona-pool-emoji">🚚${a.heart}</span>
        <span class="donadona-pool-count">×${pool[a.id] || 0}</span>
      </span>
    `;
    btn.addEventListener('click', (e) => onPoolTap(a.id, e.currentTarget));
    (idx < POOL_ROW1_SIZE ? poolRow1 : poolRow2).appendChild(btn);
  });
  poolEl.appendChild(poolRow1);
  poolEl.appendChild(poolRow2);
}

function showPlaceholder() {
  shell.board.className = 's-board';
  shell.board.innerHTML = `
    <div class="donadona-placeholder">
      <p>行列の先頭と同じ色のトラックを、乗車口に呼びましょう。</p>
      <p>トラックは満員になるまで出発しません。合わない先頭は待避へどかせます。</p>
      <p>「スタート」を押すとはじまります</p>
    </div>
  `;
}

/* ---------- アニメーション ---------- */
/* srcEl→destElへ絵文字を実際に飛ばす。board基準の座標に変換して配置する。 */
function flyEmoji(srcEl, destEl, content, callback) {
  if (!srcEl || !destEl) { callback(); return; }
  const boardRect = shell.board.getBoundingClientRect();
  const srcRect = srcEl.getBoundingClientRect();
  const destRect = destEl.getBoundingClientRect();

  const fly = document.createElement('div');
  fly.className = 'donadona-fly';
  fly.textContent = content;
  fly.style.left = (srcRect.left - boardRect.left + srcRect.width / 2) + 'px';
  fly.style.top = (srcRect.top - boardRect.top + srcRect.height / 2) + 'px';
  shell.board.appendChild(fly);

  requestAnimationFrame(() => {
    fly.style.left = (destRect.left - boardRect.left + destRect.width / 2) + 'px';
    fly.style.top = (destRect.top - boardRect.top + destRect.height / 2) + 'px';
    fly.style.opacity = '0.65';
  });

  setTimeout(() => { fly.remove(); callback(); }, 260);
}

function playDepartSound(count) {
  if (count <= 1) { shell.playTone(620, 0.08); return; }
  if (count <= 3) { [620, 780].forEach((f, i) => setTimeout(() => shell.playTone(f, 0.08), i * 70)); return; }
  [620, 780, 980].forEach((f, i) => setTimeout(() => shell.playTone(f, 0.09, 'triangle'), i * 70));
}

function showBigPop(color, count) {
  const pop = document.createElement('div');
  pop.className = 'donadona-bigpop';
  pop.innerHTML = `<span class="donadona-bigpop-emoji">${ANIMALS[color].emoji}</span>${count > 1 ? `<span class="donadona-bigpop-count">×${count}</span>` : ''}`;
  shell.board.appendChild(pop);
  setTimeout(() => pop.remove(), 1000);
}

/* 連鎖を1手ずつアニメーション付きで再生し、終わったら詰み/クリア判定を行う */
function playStepsThenCheck() {
  const event = stepOnce();
  if (!event) {
    animating = false;
    renderBoard();
    if (isCleared()) { triggerClear(); return; }
    if (isDeadlocked()) { triggerGameOver(); }
    return;
  }

  const srcEl = event.from === 'holding'
    ? shell.board.querySelectorAll('.donadona-holding-slot')[event.fromIndex]
    : shell.board.querySelector('.donadona-queue-front');
  const destEl = shell.board.querySelectorAll('.donadona-bay')[event.bayIndex];
  const content = ANIMALS[event.color].heart;

  flyEmoji(srcEl, destEl, content, () => {
    renderBoard();
    if (event.departed) {
      playDepartSound(event.departed.count);
      showBigPop(event.departed.color, event.departed.count);
      setTimeout(playStepsThenCheck, 700);
    } else {
      shell.playTone(560, 0.04);
      setTimeout(playStepsThenCheck, 160);
    }
  });
}

/* ---------- 操作 ---------- */
function onQueueFrontTap() {
  if (!shell.running || gameEnded || animating) return;
  if (queue.length === 0) return;
  if (holding.length >= HOLDING_MAX) {
    shell.toast('待避がいっぱいです');
    return;
  }
  const srcEl = shell.board.querySelector('.donadona-queue-front');
  const destEl = shell.board.querySelector('#donadonaHolding').children[holding.length];
  const color = queue.shift();
  holding.push(color);
  shell.playTone(480, 0.05);
  animating = true;
  flyEmoji(srcEl, destEl, ANIMALS[color].heart, () => {
    renderBoard();
    setTimeout(playStepsThenCheck, 80);
  });
}

function onPoolTap(color, srcEl) {
  if (!shell.running || gameEnded || animating) return;
  if (!pool[color]) return;
  const emptyIdx = bays.findIndex((b) => b.color === null);
  if (emptyIdx === -1) {
    shell.toast('乗車口に空きがありません');
    return;
  }
  const destEl = shell.board.querySelectorAll('.donadona-bay')[emptyIdx];
  pool[color]--;
  bays[emptyIdx] = { color, loaded: 0 };
  shell.playTone(540, 0.06);
  animating = true;
  flyEmoji(srcEl, destEl, '🚚' + ANIMALS[color].heart, () => {
    renderBoard();
    setTimeout(playStepsThenCheck, 80);
  });
}

/* ---------- 終了 ---------- */
function triggerClear() {
  gameEnded = true;
  [523.25, 659.25, 783.99, 1046.5].forEach((f, i) =>
    setTimeout(() => shell.playTone(f, 0.16, 'triangle'), i * 100)
  );
  shell.end('クリア！ぜんぶのどうぶつを運べました🐄🚚');
}

function triggerGameOver() {
  gameEnded = true;
  shell.playTone(220, 0.3, 'sawtooth');
  const remain = queue.length + holding.length;
  shell.end(`詰みました…（残り${remain}匹）はじめからやり直しましょう`);
}

showPlaceholder();

/* ---- GameShellのライフサイクルに接続 ---- */
shell.onStart(() => {
  generatePuzzle();
});
shell.onReset(() => {
  animating = false;
  showPlaceholder();
});
shell.onHardModeChange(() => {
  // running中は呼ばれない（GameShell側で保証）。次回スタート時の乗車口数・行列長に反映される。
});
