/* =========================================================
   まよいみち🌲 固有ロジック
   共通土台(GameShell)のAPIだけを使い、迷路生成・スクロール移動・
   なかま収集（隊列演出）・バッドイベント・視界制限（激むず）・
   コンパス・ヒントを実装。

   迷路生成：バックトラック法（反復版）で一本道の迷路を作り、
   激むずのみランダムに壁を壊してループ（分岐）を追加する。
   なかま／バッドイベントは「行き止まり（枝分かれ1本のマス）」にのみ
   配置し、正解ルートを絶対に塞がないようにしている。

   操作：盤面をタップすると、リスから見てその方向へ1マス進む
   （十字キーは廃止。タップした方向＝進みたい方向、という直感的な操作に）。

   隊列演出：プレイヤーの移動履歴(trailHistory)と移動方向履歴(moveDirHistory)
   を記録し、なかまは「N歩前にリーダーがいた場所・向き」を追いかける
   （ドラクエ方式）。折り返しても履歴をそのまま辿るだけなので、
   Uターンで隊列が崩れることはない。移動が止まってしばらく経つと、
   なかまはリーダーの位置に吸収されて見えなくなる（再度動くと展開する）。

   カメラ：毎歩センタリングし直すと画面酔いしやすいため、
   プレイヤーが表示範囲の中央寄りにいる間はスクロールさせず、
   端に近づいた時だけ追従する「デッドゾーン」方式にしている。
   ========================================================= */

const shell = new GameShell({
  rootSelector: '#app',
  title: 'まよいみち🌲',
  hint: '盤面をタップすると、その方向へ🐿️が進みます。なかまを全員集めて巣穴🌲を目指しましょう',
  hasScore: false,
  hasTimer: false,
});

const DIRS = { N: [-1, 0], S: [1, 0], E: [0, 1], W: [0, -1] };
const OPPOSITE = { N: 'S', S: 'N', E: 'W', W: 'E' };
const DIR_LABEL = { N: '上', S: '下', E: '右', W: '左' };
const DIR_ARROW = { N: '▲', S: '▼', E: '▶', W: '◀' };

const CELL_PX = 46;
const VIEW_COLS = 5;
const VIEW_ROWS = 6;
const DEADZONE_COLS = 1; // カメラの「遊び」：この範囲内の移動では画面をスクロールしない（画面酔い対策）
const DEADZONE_ROWS = 1;
const LIGHT_DURATION = 16; // 歩数
const IDLE_ABSORB_MS = 1400; // これだけ止まっていたら、なかまがリーダーに吸収される
const TAP_DEADZONE_PX = 6;  // 自分自身の位置をタップした場合は無視する範囲

const NORMAL_MODE = { size: 11, friendCount: 2, badCount: 3, fog: false, includeLight: false, loopCount: 0 };
const HARD_MODE = {
  size: 17, friendCount: 3, badCount: 6, fog: true, includeLight: true,
  loopCount: 16, fogRadius: 2, lightBonusRadius: 2,
};

const FRIEND_POOL = [
  { emoji: '🦔', name: 'ハリネズミ' },
  { emoji: '🐇', name: 'うさぎ' },
  { emoji: '🦡', name: 'あなぐま' },
];
const BAD_EMOJI = '🦊'; // バッドイベントはキツネのみ

let SIZE = NORMAL_MODE.size;
let cellData = [];   // cellData[r][c] = { walls:{N,E,S,W}, type, emoji?, friendRef?, consumed?, decor? }
let cellEls = [];
let start = { r: 0, c: 0 };
let goal = { r: 0, c: 0 };
let friends = [];
let requiredFriendCount = 0;
let collectedFriends = [];
let hasCompass = false;
let lightStepsLeft = 0;
let playerPos = { r: 0, c: 0 };
let facingRight = true;
let seen = new Set();
let currentMode = NORMAL_MODE;
let gridEl = null;
let viewportEl = null;
let playerEl = null;
let followerEls = [];
let trailHistory = [];
let moveDirHistory = []; // 各歩の移動方向('N'/'E'/'S'/'W')。なかまごとの向き判定に使う
let idleTimer = null;
let hintTimeoutId = null;
let cleared = false;
let viewOffCol = 0, viewOffRow = 0; // カメラの現在位置（デッドゾーン方式のため状態を保持する）

/* ---------- ユーティリティ ---------- */
function key(r, c) { return r + ',' + c; }
function inBounds(r, c) { return r >= 0 && r < SIZE && c >= 0 && c < SIZE; }
function shuffleArr(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
function degree(r, c) {
  const w = cellData[r][c].walls;
  return ['N', 'E', 'S', 'W'].filter((d) => w[d]).length;
}

/* ---------- 迷路生成（バックトラック法・反復版） ---------- */
function generateMaze(size) {
  const cells = Array.from({ length: size }, () =>
    Array.from({ length: size }, () => ({ N: false, E: false, S: false, W: false }))
  );
  const visited = Array.from({ length: size }, () => Array(size).fill(false));
  const stack = [[0, 0]];
  visited[0][0] = true;

  while (stack.length) {
    const [r, c] = stack[stack.length - 1];
    const dirs = shuffleArr(['N', 'E', 'S', 'W']);
    let advanced = false;
    for (const d of dirs) {
      const nr = r + DIRS[d][0], nc = c + DIRS[d][1];
      if (nr < 0 || nr >= size || nc < 0 || nc >= size || visited[nr][nc]) continue;
      cells[r][c][d] = true;
      cells[nr][nc][OPPOSITE[d]] = true;
      visited[nr][nc] = true;
      stack.push([nr, nc]);
      advanced = true;
      break;
    }
    if (!advanced) stack.pop();
  }
  return cells;
}

/* 激むず：壁をランダムに壊してループ（分岐）を増やし、迷いやすくする */
function addLoops(cells, size, count) {
  let added = 0, guard = 0;
  while (added < count && guard < count * 20) {
    guard++;
    const r = (Math.random() * size) | 0;
    const c = (Math.random() * size) | 0;
    const dirs = shuffleArr(['N', 'E', 'S', 'W']);
    for (const d of dirs) {
      const nr = r + DIRS[d][0], nc = c + DIRS[d][1];
      if (nr < 0 || nr >= size || nc < 0 || nc >= size) continue;
      if (cells[r][c][d]) continue;
      cells[r][c][d] = true;
      cells[nr][nc][OPPOSITE[d]] = true;
      added++;
      break;
    }
  }
}

/* スタートから最も遠いマスをゴール候補にする（ループを入れる前の一本道状態で計測） */
function bfsFarthest(cells, size, startPos) {
  const dist = Array.from({ length: size }, () => Array(size).fill(-1));
  dist[startPos.r][startPos.c] = 0;
  const queue = [startPos];
  let far = startPos;
  while (queue.length) {
    const cur = queue.shift();
    for (const d of ['N', 'E', 'S', 'W']) {
      if (!cells[cur.r][cur.c][d]) continue;
      const nr = cur.r + DIRS[d][0], nc = cur.c + DIRS[d][1];
      if (dist[nr][nc] !== -1) continue;
      dist[nr][nc] = dist[cur.r][cur.c] + 1;
      if (dist[nr][nc] > dist[far.r][far.c]) far = { r: nr, c: nc };
      queue.push({ r: nr, c: nc });
    }
  }
  return far;
}

/* ---------- パズル生成（迷路＋なかま／バッドイベント／アイテム配置） ---------- */
function buildPuzzle() {
  currentMode = shell.hardMode ? HARD_MODE : NORMAL_MODE;
  SIZE = currentMode.size;

  const rawCells = generateMaze(SIZE);
  start = { r: 0, c: 0 };
  goal = bfsFarthest(rawCells, SIZE, start);
  if (currentMode.loopCount) addLoops(rawCells, SIZE, currentMode.loopCount);

  cellData = rawCells.map((row) => row.map((walls) => ({ walls, type: 'empty' })));

  const usedSet = new Set([key(start.r, start.c), key(goal.r, goal.c)]);
  const leaves = [];
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      if (usedSet.has(key(r, c))) continue;
      if (degree(r, c) === 1) leaves.push({ r, c });
    }
  }
  shuffleArr(leaves);

  function takeFromLeaves(n) {
    const res = [];
    while (res.length < n && leaves.length) {
      const p = leaves.pop();
      if (usedSet.has(key(p.r, p.c))) continue;
      usedSet.add(key(p.r, p.c));
      res.push(p);
    }
    return res;
  }
  function randomFreeCell() {
    for (let tries = 0; tries < 500; tries++) {
      const r = (Math.random() * SIZE) | 0, c = (Math.random() * SIZE) | 0;
      if (!usedSet.has(key(r, c))) { usedSet.add(key(r, c)); return { r, c }; }
    }
    return { ...start };
  }

  // バッドイベント（キツネ）：行き止まりだけに置き、正解ルートを絶対に塞がないようにする
  const badPositions = takeFromLeaves(currentMode.badCount);
  badPositions.forEach((p) => {
    cellData[p.r][p.c] = { ...cellData[p.r][p.c], type: 'bad', emoji: BAD_EMOJI };
  });

  // なかま
  const chosenFriends = shuffleArr(FRIEND_POOL.slice()).slice(0, currentMode.friendCount);
  let friendPositions = takeFromLeaves(currentMode.friendCount);
  while (friendPositions.length < currentMode.friendCount) friendPositions.push(randomFreeCell());
  friends = friendPositions.map((p, i) => ({
    r: p.r, c: p.c, emoji: chosenFriends[i].emoji, name: chosenFriends[i].name, collected: false,
  }));
  friends.forEach((f) => {
    cellData[f.r][f.c] = { ...cellData[f.r][f.c], type: 'friend', emoji: f.emoji, friendRef: f };
  });
  requiredFriendCount = friends.length;

  // コンパス（常時）・ライト（激むずのみ）
  const compassPos = takeFromLeaves(1)[0] || randomFreeCell();
  cellData[compassPos.r][compassPos.c] = { ...cellData[compassPos.r][compassPos.c], type: 'compass' };

  if (currentMode.includeLight) {
    const lightPos = takeFromLeaves(1)[0] || randomFreeCell();
    cellData[lightPos.r][lightPos.c] = { ...cellData[lightPos.r][lightPos.c], type: 'light' };
  }

  // ゴール（森の巣穴）＋周囲の装飾
  cellData[goal.r][goal.c] = { ...cellData[goal.r][goal.c], type: 'goal' };
  ['N', 'E', 'S', 'W'].forEach((d) => {
    const nr = goal.r + DIRS[d][0], nc = goal.c + DIRS[d][1];
    if (inBounds(nr, nc) && cellData[nr][nc].type === 'empty') {
      cellData[nr][nc] = { ...cellData[nr][nc], decor: '🌳' };
    }
  });

  // 状態初期化（リスはスタート地点で反転した状態から始める）
  playerPos = { ...start };
  facingRight = true;
  collectedFriends = [];
  followerEls = [];
  trailHistory = [];
  moveDirHistory = [];
  hasCompass = false;
  lightStepsLeft = 0;
  seen = new Set();
  cleared = false;
  viewOffCol = 0;
  viewOffRow = 0;
}

/* ---------- 描画：迷路本体 ---------- */
function wallHedgesHTML(r, c) {
  const w = cellData[r][c].walls;
  let html = '';
  if (!w.N) html += '<span class="mz-hedge mz-hedge-n"></span>';
  if (!w.E) html += '<span class="mz-hedge mz-hedge-e"></span>';
  if (!w.S) html += '<span class="mz-hedge mz-hedge-s"></span>';
  if (!w.W) html += '<span class="mz-hedge mz-hedge-w"></span>';
  return html;
}

function cellInnerHTML(r, c) {
  const cell = cellData[r][c];
  if (cell.type === 'bad') return `<span class="mz-emoji mz-emoji-actor">${cell.emoji}</span>`;
  if (cell.type === 'friend') {
    return cell.friendRef.collected
      ? '<span class="mz-emoji mz-friend-done">✅</span>'
      : `<span class="mz-emoji mz-emoji-actor">${cell.emoji}</span>`;
  }
  if (cell.type === 'compass') return cell.consumed ? '' : '<span class="mz-emoji">🧭</span>';
  if (cell.type === 'light') return cell.consumed ? '' : '<span class="mz-emoji">💡</span>';
  if (cell.type === 'goal') return '<span class="mz-emoji mz-goal-emoji">🌲</span>';
  if (cell.decor) return `<span class="mz-emoji mz-decor">${cell.decor}</span>`;
  return '';
}

function renderAllCells() {
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const el = cellEls[r][c];
      el.className = 'maze-cell';
      el.innerHTML = wallHedgesHTML(r, c) + cellInnerHTML(r, c);
    }
  }
  applyVisibility();
}

function currentFogRadius() {
  return currentMode.fogRadius + (lightStepsLeft > 0 ? currentMode.lightBonusRadius : 0);
}

function updateSeen() {
  if (!currentMode.fog) return;
  const radius = currentFogRadius();
  for (let dr = -radius; dr <= radius; dr++) {
    for (let dc = -radius; dc <= radius; dc++) {
      const nr = playerPos.r + dr, nc = playerPos.c + dc;
      if (inBounds(nr, nc)) seen.add(key(nr, nc));
    }
  }
}

function applyVisibility() {
  if (!currentMode.fog) return;
  const radius = currentFogRadius();
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const el = cellEls[r][c];
      const wasSeen = seen.has(key(r, c));
      const inRadius = Math.max(Math.abs(r - playerPos.r), Math.abs(c - playerPos.c)) <= radius;
      el.classList.toggle('mz-hidden', !wasSeen && !inRadius);
      el.classList.toggle('mz-dim', wasSeen && !inRadius);
    }
  }
}

/* ---------- 描画：プレイヤー＆隊列 ---------- */
function renderPlayer() {
  playerEl.style.left = `${playerPos.c * CELL_PX}px`;
  playerEl.style.top = `${playerPos.r * CELL_PX}px`;
  playerEl.classList.toggle('mz-flip', facingRight);
}

/* なかまi番目が「今いる場所」に来た時点で、直近に横移動していたのはどちら向きか。
   縦移動中は向きを維持する（リーダーの facingRight と同じ考え方）ため、
   同じ歩数以降を遡って直近のE/Wを探す。見つからなければ現在のリーダーの向きに合わせる。 */
function facingRightAt(idx) {
  for (let k = idx; k < moveDirHistory.length; k++) {
    if (moveDirHistory[k] === 'E') return true;
    if (moveDirHistory[k] === 'W') return false;
  }
  return facingRight;
}

/* なかまを、リーダーの移動履歴(N歩前の位置)に沿って並べて表示する */
function showFollowersTrail() {
  clearTimeout(idleTimer);
  collectedFriends.forEach((_, i) => {
    const pos = trailHistory[i] || playerPos;
    const el = followerEls[i];
    if (!el) return;
    el.classList.remove('mz-follower-hidden');
    el.classList.toggle('mz-flip', facingRightAt(i));
    el.style.left = `${pos.c * CELL_PX}px`;
    el.style.top = `${pos.r * CELL_PX}px`;
  });
  idleTimer = setTimeout(absorbFollowers, IDLE_ABSORB_MS);
}

/* 止まってしばらく経つと、なかま達をリーダーの位置に集めて見た目をすっきりさせる */
function absorbFollowers() {
  followerEls.forEach((el) => {
    el.classList.add('mz-follower-hidden');
    el.style.left = `${playerPos.c * CELL_PX}px`;
    el.style.top = `${playerPos.r * CELL_PX}px`;
  });
}

/* カメラ：デッドゾーン方式。recenter=trueの時だけ画面中央に合わせ直し、
   それ以外は「表示範囲の端に近づいた時だけ」必要な分だけ追従する（画面酔い対策）。 */
function updateViewport(recenter) {
  const maxOffCol = Math.max(0, SIZE - VIEW_COLS);
  const maxOffRow = Math.max(0, SIZE - VIEW_ROWS);

  if (recenter) {
    viewOffCol = Math.min(maxOffCol, Math.max(0, playerPos.c - ((VIEW_COLS - 1) >> 1)));
    viewOffRow = Math.min(maxOffRow, Math.max(0, playerPos.r - ((VIEW_ROWS - 1) >> 1)));
  } else {
    const relC = playerPos.c - viewOffCol;
    const relR = playerPos.r - viewOffRow;
    if (relC < DEADZONE_COLS) viewOffCol = Math.max(0, playerPos.c - DEADZONE_COLS);
    else if (relC > VIEW_COLS - 1 - DEADZONE_COLS) viewOffCol = Math.min(maxOffCol, playerPos.c - (VIEW_COLS - 1 - DEADZONE_COLS));
    if (relR < DEADZONE_ROWS) viewOffRow = Math.max(0, playerPos.r - DEADZONE_ROWS);
    else if (relR > VIEW_ROWS - 1 - DEADZONE_ROWS) viewOffRow = Math.min(maxOffRow, playerPos.r - (VIEW_ROWS - 1 - DEADZONE_ROWS));
  }
  gridEl.style.transform = `translate(${-viewOffCol * CELL_PX}px, ${-viewOffRow * CELL_PX}px)`;
}

function renderFriendIcons() {
  const el = shell.board.querySelector('#mazeFriendIcons');
  if (!el) return;
  el.innerHTML = friends.map((f) =>
    `<span class="mz-friend-icon${f.collected ? ' mz-found' : ''}">${f.emoji}</span>`
  ).join('');
}

function arrowFor(dx, dy) {
  if (dx === 0 && dy === 0) return '🌲';
  const arrows = ['→', '↘', '↓', '↙', '←', '↖', '↑', '↗'];
  const angle = Math.atan2(dy, dx);
  const idx = (Math.round(angle / (Math.PI / 4)) + 8) % 8;
  return arrows[idx];
}

function updateCompassDisplay() {
  const el = shell.board.querySelector('#mazeCompass');
  if (!el) return;
  if (!hasCompass) { el.textContent = '🧭？'; return; }
  let target = null, bestD = Infinity;
  friends.forEach((f) => {
    if (f.collected) return;
    const d = Math.abs(f.r - playerPos.r) + Math.abs(f.c - playerPos.c);
    if (d < bestD) { bestD = d; target = f; }
  });
  if (!target) target = goal;
  el.textContent = `🧭 ${arrowFor(target.c - playerPos.c, target.r - playerPos.r)}`;
}

/* 迷路の座標を基準に、その場でふわっと出て消えるメッセージ（スクロールしても位置がズレない） */
function showGridMessage(r, c, text, type) {
  const msg = document.createElement('div');
  msg.className = `mz-msg mz-msg-${type}`;
  msg.textContent = text;
  msg.style.left = `${c * CELL_PX + CELL_PX / 2}px`;
  msg.style.top = `${r * CELL_PX - 4}px`;
  gridEl.appendChild(msg);
  setTimeout(() => msg.remove(), 700);
}

/* ---------- DOM構築 ---------- */
function buildDom() {
  shell.board.className = 's-board maze-board';
  shell.board.innerHTML = `
    <div class="maze-toolbar">
      <span class="maze-friend-icons" id="mazeFriendIcons"></span>
      <span class="maze-compass" id="mazeCompass">🧭？</span>
      <button class="s-icon-btn-text" id="mazeHintBtn">💡 ヒント</button>
    </div>
    <div class="maze-viewport" id="mazeViewport" style="width:${VIEW_COLS * CELL_PX}px;height:${VIEW_ROWS * CELL_PX}px;">
      <div class="maze-grid" id="mazeGrid" style="width:${SIZE * CELL_PX}px;height:${SIZE * CELL_PX}px;"></div>
    </div>
    <div class="maze-dpad-row">
      <button class="maze-dpad-btn" data-dir="W">◀</button>
      <button class="maze-dpad-btn" data-dir="N">▲</button>
      <button class="maze-dpad-btn" data-dir="S">▼</button>
      <button class="maze-dpad-btn" data-dir="E">▶</button>
    </div>
    <p class="maze-tap-hint">画面タップ、または上のボタンで移動できます</p>
  `;
  gridEl = shell.board.querySelector('#mazeGrid');
  viewportEl = shell.board.querySelector('#mazeViewport');

  cellEls = [];
  for (let r = 0; r < SIZE; r++) {
    cellEls.push([]);
    for (let c = 0; c < SIZE; c++) {
      const el = document.createElement('div');
      el.className = 'maze-cell';
      el.style.left = `${c * CELL_PX}px`;
      el.style.top = `${r * CELL_PX}px`;
      el.style.width = `${CELL_PX}px`;
      el.style.height = `${CELL_PX}px`;
      gridEl.appendChild(el);
      cellEls[r].push(el);
    }
  }

  playerEl = document.createElement('div');
  playerEl.className = 'maze-player';
  playerEl.style.width = `${CELL_PX}px`;
  playerEl.style.height = `${CELL_PX}px`;
  playerEl.textContent = '🐿️';
  gridEl.appendChild(playerEl);

  viewportEl.addEventListener('pointerdown', onViewportTap);
  viewportEl.addEventListener('touchend', (e) => {
    const now = Date.now();
    if (now - lastTouchEndTs <= 300) e.preventDefault();
    lastTouchEndTs = now;
  }, { passive: false });
  shell.board.querySelector('#mazeHintBtn').addEventListener('click', showHint);
  shell.board.querySelectorAll('.maze-dpad-btn').forEach((btn) => {
    btn.addEventListener('click', () => attemptMove(btn.dataset.dir));
  });

  renderFriendIcons();
  updateSeen();
  renderAllCells();
  renderPlayer();
  updateViewport(true);
  updateCompassDisplay();
}

function showPlaceholder() {
  shell.board.className = 's-board maze-board';
  shell.board.innerHTML = `
    <div class="maze-placeholder">
      <p>なかまを全員見つけて、みんなで巣穴🌲を目指しましょう。</p>
      <p>🦊がいる道は通れません。</p>
      <p>🧭道しるべや💡ライトのヒントアイテムあり。</p>
      <p>「スタート」を押すとはじまります</p>
    </div>
  `;
}

/* ---------- 操作：盤面タップで方向を決める ---------- */
function onViewportTap(e) {
  if (!shell.running || cleared) return;
  e.preventDefault();
  const rect = viewportEl.getBoundingClientRect();
  const tapX = e.clientX - rect.left;
  const tapY = e.clientY - rect.top;
  const playerScreenX = (playerPos.c - viewOffCol) * CELL_PX + CELL_PX / 2;
  const playerScreenY = (playerPos.r - viewOffRow) * CELL_PX + CELL_PX / 2;
  const dx = tapX - playerScreenX;
  const dy = tapY - playerScreenY;
  if (Math.abs(dx) < TAP_DEADZONE_PX && Math.abs(dy) < TAP_DEADZONE_PX) return;
  const dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'E' : 'W') : (dy > 0 ? 'S' : 'N');
  attemptMove(dir);
}

/* ---------- 移動 ---------- */
function attemptMove(dir) {
  if (!shell.running || cleared) return;
  const { r, c } = playerPos;
  if (!cellData[r][c].walls[dir]) {
    bumpWall(dir);
    return;
  }
  const nr = r + DIRS[dir][0], nc = c + DIRS[dir][1];
  const target = cellData[nr][nc];
  if (target.type === 'bad') {
    flinchAt(dir);
    shell.playTone(260, 0.14, 'sawtooth');
    return;
  }

  if (dir === 'E') facingRight = true;
  else if (dir === 'W') facingRight = false;

  trailHistory.unshift({ r, c });
  if (trailHistory.length > 300) trailHistory.length = 300;
  moveDirHistory.unshift(dir);
  if (moveDirHistory.length > 300) moveDirHistory.length = 300;

  playerPos = { r: nr, c: nc };
  if (lightStepsLeft > 0) {
    lightStepsLeft--;
    if (lightStepsLeft === 0) shell.toast('💡 ライトが消えました');
  }
  shell.playTone(520, 0.045);
  handleArrival(target, nr, nc);
  updateSeen();
  renderAllCells();
  renderPlayer();
  showFollowersTrail();
  updateViewport(false);
  updateCompassDisplay();
}

function bumpWall(dir) {
  shell.playTone(300, 0.05, 'triangle');
  playerEl.style.setProperty('--bump-x', `${DIRS[dir][1] * 6}px`);
  playerEl.style.setProperty('--bump-y', `${DIRS[dir][0] * 6}px`);
  playerEl.classList.remove('mz-bump');
  void playerEl.offsetWidth;
  playerEl.classList.add('mz-bump');
}

function flinchAt(dir) {
  playerEl.style.setProperty('--bump-x', `${DIRS[dir][1] * 14}px`);
  playerEl.style.setProperty('--bump-y', `${DIRS[dir][0] * 14}px`);
  playerEl.classList.remove('mz-flinch');
  void playerEl.offsetWidth;
  playerEl.classList.add('mz-flinch');
  showGridMessage(playerPos.r, playerPos.c, 'ぴゃっ💦', 'bad');
}

function addFollowerEl(emoji) {
  const el = document.createElement('div');
  el.className = 'maze-follower';
  el.style.width = `${CELL_PX}px`;
  el.style.height = `${CELL_PX}px`;
  el.style.left = `${playerPos.c * CELL_PX}px`;
  el.style.top = `${playerPos.r * CELL_PX}px`;
  el.textContent = emoji;
  gridEl.appendChild(el);
  followerEls.push(el);
}

function handleArrival(cell, r, c) {
  if (cell.type === 'friend' && cell.friendRef && !cell.friendRef.collected) {
    cell.friendRef.collected = true;
    collectedFriends.push(cell.friendRef.emoji);
    addFollowerEl(cell.friendRef.emoji);
    shell.playTone(760, 0.1);
    setTimeout(() => shell.playTone(980, 0.12), 100);
    showGridMessage(r, c, `${cell.friendRef.emoji} なかまになった！`, 'good');
    renderFriendIcons();
  } else if (cell.type === 'compass' && !cell.consumed) {
    cell.consumed = true;
    hasCompass = true;
    shell.playTone(880, 0.12);
    shell.toast('🧭 コンパスを見つけました！');
  } else if (cell.type === 'light' && !cell.consumed) {
    cell.consumed = true;
    lightStepsLeft = LIGHT_DURATION;
    shell.playTone(950, 0.1);
    shell.toast('💡 ライトを見つけました！しばらく足元が明るくなります');
  } else if (cell.type === 'goal') {
    if (collectedFriends.length >= requiredFriendCount) {
      triggerClear();
    } else {
      shell.toast(`まだなかまが ${requiredFriendCount - collectedFriends.length}匹います`);
    }
  }
}

function triggerClear() {
  cleared = true;
  clearTimeout(idleTimer);
  showFollowersTrail();
  [523.25, 659.25, 783.99, 1046.5, 1318.51].forEach((f, i) =>
    setTimeout(() => shell.playTone(f, 0.15, 'triangle'), i * 100)
  );
  shell.end(`やったね！みんなで巣穴に帰れました🌲 🐿️${collectedFriends.join('')}`);
}

/* ---------- ヒント（BFSで次の一歩の方向だけ教える。盤面上に矢印表示） ---------- */
function bfsFrom(startPos) {
  const dist = {}; const parent = {};
  const sk = key(startPos.r, startPos.c);
  dist[sk] = 0;
  const queue = [startPos];
  while (queue.length) {
    const cur = queue.shift();
    const ck = key(cur.r, cur.c);
    for (const d of ['N', 'E', 'S', 'W']) {
      if (!cellData[cur.r][cur.c].walls[d]) continue;
      const nr = cur.r + DIRS[d][0], nc = cur.c + DIRS[d][1];
      const nk = key(nr, nc);
      if (dist[nk] !== undefined) continue;
      dist[nk] = dist[ck] + 1;
      parent[nk] = { from: ck, dir: d };
      queue.push({ r: nr, c: nc });
    }
  }
  return { dist, parent };
}

function showHintArrow(dir) {
  const arrow = document.createElement('div');
  arrow.className = 'mz-hint-arrow';
  arrow.textContent = DIR_ARROW[dir];
  arrow.style.left = `${playerPos.c * CELL_PX + CELL_PX / 2 + DIRS[dir][1] * CELL_PX * 0.9}px`;
  arrow.style.top = `${playerPos.r * CELL_PX + CELL_PX / 2 + DIRS[dir][0] * CELL_PX * 0.9}px`;
  gridEl.appendChild(arrow);
  return arrow;
}

function showHint() {
  if (!shell.running || cleared) return;
  const { dist, parent } = bfsFrom(playerPos);

  let target = null, bestD = Infinity;
  friends.forEach((f) => {
    if (f.collected) return;
    const dk = key(f.r, f.c);
    if (dist[dk] !== undefined && dist[dk] < bestD) { bestD = dist[dk]; target = f; }
  });
  const targetIsGoal = !target;
  if (targetIsGoal) target = goal;

  const tk = key(target.r, target.c);
  if (dist[tk] === undefined || dist[tk] === 0) { shell.toast('もうすぐです！'); return; }

  let curKey = tk;
  const sk = key(playerPos.r, playerPos.c);
  while (parent[curKey].from !== sk) curKey = parent[curKey].from;
  const dir = parent[curKey].dir;

  clearTimeout(hintTimeoutId);
  const prevArrow = gridEl.querySelector('.mz-hint-arrow');
  if (prevArrow) prevArrow.remove();
  const arrowEl = showHintArrow(dir);
  const btnEl = shell.board.querySelector(`.maze-dpad-btn[data-dir="${dir}"]`);
  if (btnEl) btnEl.classList.add('mz-dpad-hint');
  shell.playTone(600, 0.08);
  const who = targetIsGoal ? '🌲巣穴を探して' : `${target.emoji}を探して`;
  shell.toast(`${who}「${DIR_LABEL[dir]}」に進んでみましょう`);
  hintTimeoutId = setTimeout(() => {
    arrowEl.remove();
    if (btnEl) btnEl.classList.remove('mz-dpad-hint');
  }, 1800);
}

/* ---------- キーボード操作（PC向け） ---------- */
document.addEventListener('keydown', (e) => {
  if (!shell.running) return;
  if (e.key === 'ArrowUp') { attemptMove('N'); e.preventDefault(); }
  else if (e.key === 'ArrowDown') { attemptMove('S'); e.preventDefault(); }
  else if (e.key === 'ArrowLeft') { attemptMove('W'); e.preventDefault(); }
  else if (e.key === 'ArrowRight') { attemptMove('E'); e.preventDefault(); }
});

/* ダブルタップでの拡大防止用タイムスタンプ（リスナーはbuildDomでビューポートに限定して登録する。
   document全体に付けるとタイトル5回タップ（激むず切替）まで巻き込んでしまうため注意） */
let lastTouchEndTs = 0;

showPlaceholder();

/* ---- GameShellのライフサイクルに接続 ---- */
shell.onStart(() => {
  buildPuzzle();
  buildDom();
});
shell.onReset(() => {
  clearTimeout(hintTimeoutId);
  clearTimeout(idleTimer);
  showPlaceholder();
});
shell.onHardModeChange(() => {
  // running中は呼ばれない（GameShell側で保証）。次回スタート時の迷路サイズ・霧に反映される。
});
