/* =========================================================
   ドリンクそーと🍹 固有ロジック
   共通土台(GameShell)のAPIだけを使い、盤面生成・ドラッグ&ドロップ・判定を実装。
   トレイの中身をドラッグでまとめ、同じ種類ごとに揃えたらクリア。
   ========================================================= */

const shell = new GameShell({
  rootSelector: '#app',
  title: 'ドリンクそーと🍹',
  hint: 'カップをドラッグして、同じ種類ごとにまとめましょう',
  hasScore: false,
  hasTimer: false,
});

/* 形・色がはっきり分かれる6種のみ採用。
   🍶(白い徳利)・🥛(白い牛乳)は白系で紛らわしいため除外。
   🧉は🍵と同系の緑で紛らわしいため除外。🍵自体もあまり可愛くないため除外。 */
const DRINKS = ['☕', '🍷', '🍸', '🍹', '🍺', '🧋'];

/* カップ1つ1つに敷く、飲み物に合わせた色（視認性アップ用・やや濃いめ） */
const TINTS = {
  '☕': '#e8c9a0', // コーヒー：濃いめベージュ
  '🍷': '#eeb9c4', // 赤ワイン：濃いめローズ
  '🍸': '#b9e0e6', // カクテル：濃いめアイスブルー
  '🍹': '#fbc98a', // トロピカル：濃いめオレンジ
  '🍺': '#f2df85', // ビール：濃いめゴールド
  '🧋': '#ddbdae', // タピオカ：濃いめモカ
};

let CAPACITY = 4; // 通常/激むずで切り替える（buildPuzzle内で設定）
const NORMAL_SETTING = { species: 4, empty: 1, capacity: 4, minDepth: 14 };
const HARD_SETTING = { species: 4, empty: 1, capacity: 5, minDepth: 20 };

let trays = [];
let initialTrays = null;
let solved = false;
let locked = false;
let dragState = null;
let trayAreaEl = null;
let activeHint = null; // { a, b } ヒントで提示中の手（他の手を選んだ時に知らせるため）

/* トレイを移動した時の効果音：明るい2音チャイム（ピロリン） */
function playCupChime() {
  shell.playTone(880, 0.05, 'triangle');
  setTimeout(() => shell.playTone(1174.66, 0.08, 'triangle'), 45);
}

function shuffleArray(arr) {
  const list = arr.slice();
  for (let i = list.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

function isSolved(state) {
  return state.every((t) => t.length === 0 || (t.length === CAPACITY && t.every((v) => v === t[0])));
}

function canMoveOn(state, a, b) {
  if (a === b) return false;
  if (state[a].length === 0) return false;
  const t = state[b];
  if (t.length >= CAPACITY) return false;
  if (t.length === 0) return true;
  return t[t.length - 1] === state[a][state[a].length - 1];
}

/* 種類ごとに満杯のカップを全部まとめて完全にシャッフルし、トレイへランダムに配る。
   （「完成状態から少し戻す」方式だと簡単に元へ戻せてしまうため、あえて総崩し配置にする） */
function randomDeal(speciesCount, emptyCount) {
  const picked = shuffleArray(DRINKS).slice(0, speciesCount);
  let items = [];
  picked.forEach((emoji) => { for (let i = 0; i < CAPACITY; i++) items.push(emoji); });
  items = shuffleArray(items);

  const trayCount = speciesCount + emptyCount;
  const state = Array.from({ length: trayCount }, () => []);
  const fillTargets = shuffleArray([...Array(trayCount).keys()]).slice(0, speciesCount);
  let itemIdx = 0;
  fillTargets.forEach((idx) => {
    for (let c = 0; c < CAPACITY; c++) state[idx].push(items[itemIdx++]);
  });
  return state;
}

/* BFSで最短クリア手数を求める（解けない/手数が少なすぎる場合は作り直すための判定用）。
   ノード数・時間に上限を設け、盤面サイズが小さいためすぐに終わる。 */
function minSolveDepth(initial, nodeCap = 250000, timeCapMs = 1200) {
  const key = (s) => s.map((t) => t.join(',')).join('|');
  if (isSolved(initial)) return 0;
  const seen = new Set([key(initial)]);
  let queue = [initial];
  let depth = 0;
  let nodes = 0;
  const t0 = Date.now();
  while (queue.length) {
    depth++;
    const next = [];
    for (const state of queue) {
      for (let a = 0; a < state.length; a++) {
        if (state[a].length === 0) continue;
        for (let b = 0; b < state.length; b++) {
          if (!canMoveOn(state, a, b)) continue;
          const ns = state.map((t) => t.slice());
          const item = ns[a].pop();
          ns[b].push(item);
          const k = key(ns);
          if (seen.has(k)) continue;
          if (isSolved(ns)) return depth;
          seen.add(k);
          next.push(ns);
          nodes++;
          if (nodes > nodeCap || Date.now() - t0 > timeCapMs) return -2; // 打ち切り
        }
      }
    }
    queue = next;
    if (queue.length === 0) return -1; // 解けない配置
  }
  return -1;
}

/* 「最低◯手は必要」を満たす配置になるまで作り直す（最低10手以上の歯応えを保証） */
function buildTrays(speciesCount, emptyCount, minDepth) {
  const maxAttempts = 30;
  let best = null;
  let bestDepth = -1;
  for (let i = 0; i < maxAttempts; i++) {
    const state = randomDeal(speciesCount, emptyCount);
    const depth = minSolveDepth(state);
    if (depth >= minDepth) return state;
    if (depth > bestDepth) { bestDepth = depth; best = state; }
  }
  return best || randomDeal(speciesCount, emptyCount); // 保険（通常ここには来ない）
}

/* いまの状態から完成までの最短手順を求め、その最初の1手（a→b）を返す（ヒント用）。
   詰み判定と同じBFSに、経路を逆算するための親情報を追加しただけの構成。 */
function findHintMove(initial) {
  const key = (s) => s.map((t) => t.join(',')).join('|');
  if (isSolved(initial)) return null;

  const startKey = key(initial);
  const cameFrom = new Map(); // key -> { prevKey, move: [a, b] }
  const seen = new Set([startKey]);
  let queue = [{ state: initial, key: startKey }];
  let nodes = 0;
  const nodeCap = 200000;
  const timeCapMs = 900;
  const t0 = Date.now();

  while (queue.length) {
    const next = [];
    for (const { state, key: k } of queue) {
      for (let a = 0; a < state.length; a++) {
        if (state[a].length === 0) continue;
        for (let b = 0; b < state.length; b++) {
          if (!canMoveOn(state, a, b)) continue;
          const ns = state.map((t) => t.slice());
          const item = ns[a].pop();
          ns[b].push(item);
          const nk = key(ns);
          if (seen.has(nk)) continue;
          seen.add(nk);
          cameFrom.set(nk, { prevKey: k, move: [a, b] });

          if (isSolved(ns)) {
            // 完成状態からスタート直後の1手まで、親をたどって逆算する
            let curKey = nk;
            let firstMove = cameFrom.get(curKey).move;
            while (cameFrom.get(curKey).prevKey !== startKey) {
              curKey = cameFrom.get(curKey).prevKey;
              firstMove = cameFrom.get(curKey).move;
            }
            return firstMove;
          }
          next.push({ state: ns, key: nk });
          nodes++;
          if (nodes > nodeCap || Date.now() - t0 > timeCapMs) return null;
        }
      }
    }
    queue = next;
    if (queue.length === 0) return null;
  }
  return null;
}

/* ヒントボタン：最初の1手を、移動元(青緑)→移動先(金)で光らせて教える */
function showHint() {
  if (locked) {
    shell.toast('「はじめから」でやり直しましょう');
    return;
  }
  const move = findHintMove(trays);
  if (!move) {
    shell.toast('ヒントが見つかりませんでした');
    return;
  }
  const [a, b] = move;
  activeHint = { a, b };
  const trayEls = trayAreaEl.querySelectorAll('.sort-tray');
  const fromEl = trayEls[a];
  const toEl = trayEls[b];
  fromEl.classList.add('sort-hint-from');
  toEl.classList.add('sort-hint-to');

  // 移動方向の矢印（右のトレイへ移動なら➡️、左のトレイへ移動なら⬅️）
  const arrow = document.createElement('div');
  const goesRight = b > a;
  arrow.className = `sort-hint-arrow ${goesRight ? 'sort-hint-arrow-right' : 'sort-hint-arrow-left'}`;
  arrow.textContent = goesRight ? '➡️' : '⬅️';
  fromEl.appendChild(arrow);

  shell.playTone(700, 0.1, 'triangle');
  setTimeout(() => {
    fromEl.classList.remove('sort-hint-from');
    toEl.classList.remove('sort-hint-to');
    arrow.remove();
    if (activeHint && activeHint.a === a && activeHint.b === b) activeHint = null;
  }, 1600);
}

/* ヒントと違う手を選んだ時の警告：shell.toast()は1.6秒で消えて読み切れないため、
   このゲーム専用にもっと長く表示される警告を用意する（約5秒、タップでも消せる） */
function showAlert(msg) {
  const el = document.createElement('div');
  el.className = 'sort-alert';
  el.textContent = msg;
  el.addEventListener('click', () => el.remove());
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 5200);
}

function canMove(a, b) {
  return canMoveOn(trays, a, b);
}

function buildPuzzle(speciesCount, emptyCount, capacity, minDepth) {
  solved = false;
  locked = false;
  activeHint = null;
  CAPACITY = capacity;
  trays = buildTrays(speciesCount, emptyCount, minDepth);
  initialTrays = trays.map((t) => t.slice());
  renderBoard();
}

/* 今回の問題を、最初に生成された配置まで戻す（「はじめから」ボタン用） */
function retryPuzzle() {
  if (!initialTrays) return;
  trays = initialTrays.map((t) => t.slice());
  solved = false;
  locked = false;
  activeHint = null;
  renderBoard();
  shell.toast('はじめの配置に戻しました');
}

function renderBoard() {
  shell.board.className = 's-board sort-board';
  shell.board.innerHTML = `
    <div class="sort-toolbar">
      <button class="s-icon-btn-text" id="sortHintBtn">💡 ヒント</button>
      <button class="s-icon-btn-text" id="sortRetryBtn">↩️ はじめから</button>
    </div>
    <div class="sort-tray-area" id="sortTrayArea"></div>
  `;
  trayAreaEl = shell.board.querySelector('#sortTrayArea');
  shell.board.querySelector('#sortHintBtn').addEventListener('click', showHint);
  shell.board.querySelector('#sortRetryBtn').addEventListener('click', retryPuzzle);

  trays.forEach((tray, idx) => {
    const trayEl = document.createElement('div');
    trayEl.className = 'sort-tray';
    trayEl.dataset.idx = idx;

    for (let slot = 0; slot < CAPACITY; slot++) {
      const slotEl = document.createElement('div');
      const filled = slot < tray.length;
      slotEl.className = `sort-slot ${filled ? 'sort-filled' : 'sort-empty'}`;
      if (filled) {
        const emoji = tray[slot];
        if (slot === tray.length - 1) slotEl.classList.add('sort-top');
        slotEl.style.background = TINTS[emoji] || '#f5faf9';
        slotEl.textContent = emoji;
      }
      trayEl.appendChild(slotEl);
    }

    trayEl.addEventListener('pointerdown', onTrayPointerDown);
    trayAreaEl.appendChild(trayEl);
  });
}

function onTrayPointerDown(e) {
  if (!shell.running || locked) return;
  const idx = Number(e.currentTarget.dataset.idx);
  if (trays[idx].length === 0) return;
  e.preventDefault();

  const emoji = trays[idx][trays[idx].length - 1];
  const ghost = document.createElement('div');
  ghost.className = 'sort-drag-ghost';
  ghost.textContent = emoji;
  document.body.appendChild(ghost);

  dragState = { sourceIndex: idx, ghost, hoverEl: null };
  moveGhost(e.clientX, e.clientY);

  document.addEventListener('pointermove', onPointerMove);
  document.addEventListener('pointerup', onPointerUp);
}

function moveGhost(x, y) {
  dragState.ghost.style.left = `${x}px`;
  dragState.ghost.style.top = `${y}px`;
}

function trayUnderPoint(x, y) {
  const el = document.elementFromPoint(x, y);
  return el ? el.closest('.sort-tray') : null;
}

function onPointerMove(e) {
  if (!dragState) return;
  moveGhost(e.clientX, e.clientY);

  const hoverEl = trayUnderPoint(e.clientX, e.clientY);
  if (dragState.hoverEl && dragState.hoverEl !== hoverEl) {
    dragState.hoverEl.classList.remove('sort-drag-over', 'sort-drag-invalid');
  }
  if (hoverEl) {
    const destIdx = Number(hoverEl.dataset.idx);
    const ok = canMove(dragState.sourceIndex, destIdx);
    hoverEl.classList.toggle('sort-drag-over', ok);
    hoverEl.classList.toggle('sort-drag-invalid', !ok && destIdx !== dragState.sourceIndex);
  }
  dragState.hoverEl = hoverEl;
}

function onPointerUp(e) {
  document.removeEventListener('pointermove', onPointerMove);
  document.removeEventListener('pointerup', onPointerUp);
  if (!dragState) return;

  dragState.ghost.remove();
  if (dragState.hoverEl) dragState.hoverEl.classList.remove('sort-drag-over', 'sort-drag-invalid');

  const dropEl = trayUnderPoint(e.clientX, e.clientY);
  const sourceIndex = dragState.sourceIndex;
  dragState = null;

  if (!dropEl) return;
  const destIndex = Number(dropEl.dataset.idx);
  if (!canMove(sourceIndex, destIndex)) {
    if (destIndex !== sourceIndex) shell.playTone(220, 0.1);
    return;
  }

  const item = trays[sourceIndex].pop();
  trays[destIndex].push(item);
  playCupChime();

  // 提示中のヒントと違う手を選んだ場合はその場で知らせる（方向の取り違え対策）
  if (activeHint && (activeHint.a !== sourceIndex || activeHint.b !== destIndex)) {
    showAlert('⚠️ ヒントと違う手です。向きが逆になっていませんか？');
  }
  activeHint = null;

  renderBoard();

  checkAfterMove();
}

/* 1手ごとに、まだ解ける状態かを裏で確認する。
   完全に詰んだ（このBFSで解なしと断定できた）場合だけゲーム終了にする。
   判定できない場合（時間切れ）は誤判定を避けるため何もしない。 */
function checkAfterMove() {
  if (isSolved(trays)) {
    solved = true;
    locked = true;
    playClear();
    return;
  }
  const result = minSolveDepth(trays, 200000, 900);
  if (result === -1) {
    locked = true;
    playStuck();
  }
}

function playStuck() {
  trayAreaEl.classList.add('sort-stuck');
  setTimeout(() => trayAreaEl.classList.remove('sort-stuck'), 450);
  shell.playTone(320, 0.18, 'square');
  setTimeout(() => shell.playTone(190, 0.32, 'square'), 150);
  setTimeout(() => shell.toast('これ以上動かせません…😢「はじめから」でやり直しましょう'), 350);
}

function playClear() {
  trayAreaEl.classList.add('sort-complete');

  // 光の帯を盤面に一閃させる
  const sweep = document.createElement('div');
  sweep.className = 'sort-light-sweep';
  trayAreaEl.appendChild(sweep);
  setTimeout(() => sweep.remove(), 1100);

  // トレイを左から順に光らせて波打たせる
  const trayEls = Array.from(trayAreaEl.querySelectorAll('.sort-tray'));
  trayEls.forEach((el, i) => {
    setTimeout(() => el.classList.add('sort-wave'), i * 70);
  });

  const notes = [659.25, 880, 1046.5, 1318.51];
  notes.forEach((freq, i) => setTimeout(() => shell.playTone(freq, 0.14, 'triangle'), i * 90));
  setTimeout(() => shell.playTone(1567.98, 0.35, 'triangle'), notes.length * 90);

  setTimeout(() => shell.end('かんせい！ぜんぶそろったよ🍹'), trayEls.length * 70 + 500);
}

function showPlaceholder() {
  shell.board.className = 's-board';
  shell.board.innerHTML = '<div class="sort-placeholder">「スタート」を押すとパズルが始まります</div>';
}

showPlaceholder();

/* ---- GameShellのライフサイクルに接続 ---- */
shell.onStart(() => {
  const setting = shell.hardMode ? HARD_SETTING : NORMAL_SETTING;
  buildPuzzle(setting.species, setting.empty, setting.capacity, setting.minDepth);
});
shell.onReset(() => {
  showPlaceholder();
});
