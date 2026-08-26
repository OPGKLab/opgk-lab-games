/* =========================================================
   つみつみタワー🧱 固有ロジック
   共通土台(GameShell)のAPIだけを使い、クレーン揺れ・落下・重なり判定・
   カメラスクロール（盤面内でtranslateY）・マイルストーンでのテーマ切替を実装。
   ========================================================= */

const shell = new GameShell({
  rootSelector: '#app',
  title: 'つみつみタワー🧱',
  hint: 'タイミングよくボタンを押して、ブロックを積み上げましょう',
  hasScore: true,
  hasTimer: false,
});

/* ---- 盤面の内部座標系（固定px、DOM実測に依存しない） ---- */
const VIEW_W = 260;
const VIEW_H = 280;
const CRANE_AREA = 60;   // クレーンが動く上部の余白
const RESERVED = VIEW_H - CRANE_AREA; // カメラスクロール前に見える塔の高さ
const BLOCK_H = 20;

const NORMAL_START_W = 80;
const HARD_START_W = 115; // 激むず＝幅広スタート（集中力の長期戦モード）
const CRANE_CENTER = VIEW_W / 2;
const CRANE_AMP = 80; // クレーンの振れ幅（左右のみ）

// 激むずは序盤やさしく、通常レンジ＋「高速レンジを引く確率」が段を重ねるごとに上がる
const NORMAL_SPEED_RANGE = [1.0, 1.9];
const HARD_SPEED_BASE = [0.8, 1.5];
const HARD_SPEED_FAST = [1.6, 2.6];
const HARD_FAST_CHANCE_STEP = 0.08;
const HARD_FAST_CHANCE_MAX = 0.6;
let hardRampStep = 0;
let hardFastChance = 0;

const MILESTONE_INTERVAL = 15;
// テーマ柄セット：見た目だけの節目演出。増やす場合はここにクラス名を追記するだけでOK。
const THEMES = ['wood', 'candy', 'stone', 'gem'];

let stack = [];        // { x, w } … 台座を含む積み上げ済みブロック
let craneX = CRANE_CENTER;
let craneWidth = NORMAL_START_W;
let craneSpeed = 1.3;
let craneTargetSpeed = 1.3;
let cranePhase = 0;
let lastSpeedChange = 0;
let lastTs = 0;
let craneRaf = null;
let canDrop = false;
let gameOverTimer = null;

function randRange([a, b]) { return a + Math.random() * (b - a); }
function trackOffset(heightPx) { return Math.max(0, heightPx - RESERVED); }
function themeAt(index) { return THEMES[Math.floor(index / MILESTONE_INTERVAL) % THEMES.length]; }

function showPlaceholder() {
  shell.board.className = 's-board';
  shell.board.innerHTML = '<div class="tower-placeholder">「スタート」を押すとクレーンが動き出します</div>';
}
showPlaceholder();

function buildBoardDom() {
  shell.board.className = 's-board tower-board';
  shell.board.innerHTML = `
    <div class="tower-viewport" id="towerViewport" style="width:${VIEW_W}px;height:${VIEW_H}px;">
      <div class="tower-track" id="towerTrack"></div>
      <div class="crane-rail"></div>
      <div class="crane-block" id="craneBlock"></div>
    </div>
    <button class="tower-drop-btn" id="dropBtn">📦 つみつみ</button>
  `;
  document.getElementById('dropBtn').addEventListener('click', onDrop);
}

/* ---- 進行 ---- */
function startGame() {
  stack = [];
  craneWidth = shell.hardMode ? HARD_START_W : NORMAL_START_W;
  hardRampStep = 0;
  hardFastChance = 0;
  craneSpeed = craneTargetSpeed = shell.hardMode ? randRange(HARD_SPEED_BASE) : randRange(NORMAL_SPEED_RANGE);
  cranePhase = 0;
  lastSpeedChange = 0;

  buildBoardDom();
  stack.push({ x: CRANE_CENTER, w: craneWidth }); // 台座
  renderTrack();
  spawnCraneBlock();

  lastTs = performance.now();
  craneRaf = requestAnimationFrame(craneLoop);
}

function renderTrack() {
  const track = document.getElementById('towerTrack');
  const h = stack.length * BLOCK_H;
  track.style.height = h + 'px';
  track.style.transform = `translateY(${trackOffset(h)}px)`;
  track.innerHTML = stack.map((b, i) => (
    `<div class="tower-block theme-${themeAt(i)}" style="left:${b.x - b.w / 2}px;width:${b.w}px;bottom:${i * BLOCK_H}px;height:${BLOCK_H}px;"></div>`
  )).join('');
}

function spawnCraneBlock() {
  canDrop = true;
  const btn = document.getElementById('dropBtn');
  if (btn) btn.disabled = false;
  const el = document.getElementById('craneBlock');
  el.className = `crane-block theme-${themeAt(stack.length)}`;
  el.style.width = craneWidth + 'px';
  el.style.height = BLOCK_H + 'px';
  el.style.top = (CRANE_AREA - BLOCK_H - 6) + 'px';
}

function craneLoop(ts) {
  const dt = Math.min((ts - lastTs) / 1000, 0.05);
  lastTs = ts;
  lastSpeedChange += dt;
  if (lastSpeedChange > 0.9 + Math.random() * 0.8) {
    if (shell.hardMode) {
      craneTargetSpeed = Math.random() < hardFastChance ? randRange(HARD_SPEED_FAST) : randRange(HARD_SPEED_BASE);
    } else {
      craneTargetSpeed = randRange(NORMAL_SPEED_RANGE);
    }
    lastSpeedChange = 0;
  }
  craneSpeed += (craneTargetSpeed - craneSpeed) * Math.min(1, dt * 1.5);
  cranePhase += craneSpeed * dt;
  craneX = CRANE_CENTER + CRANE_AMP * Math.sin(cranePhase);

  if (canDrop) {
    const el = document.getElementById('craneBlock');
    if (el) el.style.left = (craneX - craneWidth / 2) + 'px';
  }
  craneRaf = requestAnimationFrame(craneLoop);
}

/* ---- 落下・判定 ---- */
function onDrop() {
  if (!canDrop || !shell.running) return;
  canDrop = false;
  document.getElementById('dropBtn').disabled = true;

  const dropX = craneX;
  const dropW = craneWidth;
  const topBlock = stack[stack.length - 1];

  const postH = (stack.length + 1) * BLOCK_H;
  const offset = trackOffset(postH);
  document.getElementById('towerTrack').style.transform = `translateY(${offset}px)`;
  const landingY = VIEW_H - postH + offset;

  animateFallAndPlace(dropX, dropW, landingY, topBlock);
}

function animateFallAndPlace(x, w, landingY, topBlock) {
  const viewport = document.getElementById('towerViewport');
  const craneEl = document.getElementById('craneBlock');
  const fallEl = document.createElement('div');
  fallEl.className = craneEl.className;
  fallEl.style.position = 'absolute';
  fallEl.style.width = w + 'px';
  fallEl.style.height = BLOCK_H + 'px';
  fallEl.style.left = (x - w / 2) + 'px';
  fallEl.style.top = craneEl.style.top;
  fallEl.style.transition = 'top 0.26s cubic-bezier(.4,.6,.6,1)';
  viewport.appendChild(fallEl);
  craneEl.style.display = 'none';

  requestAnimationFrame(() => { fallEl.style.top = landingY + 'px'; });

  setTimeout(() => {
    fallEl.remove();
    craneEl.style.display = '';
    resolveDrop(x, w, topBlock);
  }, 280);
}

function resolveDrop(x, w, topBlock) {
  const left = x - w / 2, right = x + w / 2;
  const belowLeft = topBlock.x - topBlock.w / 2, belowRight = topBlock.x + topBlock.w / 2;
  const overlapLeft = Math.max(left, belowLeft);
  const overlapRight = Math.min(right, belowRight);
  const overlapW = overlapRight - overlapLeft;

  if (overlapW <= 1) {
    gameOver(x, w);
    return;
  }

  stack.push({ x: (overlapLeft + overlapRight) / 2, w: overlapW });
  renderTrack();
  shell.playTone(520, 0.05);
  shell.addScore(1);

  const placedCount = stack.length - 1; // 台座を除く積んだ数
  if (placedCount > 0 && placedCount % MILESTONE_INTERVAL === 0) {
    shell.toast(`✨ ${placedCount}段達成！見た目がチェンジしました`);
    shell.playTone(880, 0.14, 'triangle');
    if (shell.hardMode) {
      hardRampStep++;
      hardFastChance = Math.min(HARD_FAST_CHANCE_STEP * hardRampStep, HARD_FAST_CHANCE_MAX);
    }
  }

  craneWidth = overlapW; // 次のブロックは今の重なり幅を引き継ぐ
  spawnCraneBlock();
}

function gameOver(failX, failW) {
  if (craneRaf) cancelAnimationFrame(craneRaf);
  shell.playTone(200, 0.3, 'sawtooth');
  const placedCount = stack.length - 1;

  shell.board.classList.add('tower-miss');
  gameOverTimer = setTimeout(() => {
    shell.board.classList.remove('tower-miss');
    buildReviewDom(failX, failW, placedCount);
    gameOverTimer = null;
  }, 260);

  shell.end(`ゲームオーバー！ ${placedCount}段まで積めました`);
}

/* 台座〜失敗地点までスクロールで見返せる、ふりかえり画面を組み立てる */
function buildReviewDom(failX, failW, placedCount) {
  const trackH = (stack.length + 1) * BLOCK_H; // 成功ブロック＋失敗ブロック分

  const blocksHtml = stack.map((b, i) => (
    `<div class="tower-block theme-${themeAt(i)}" style="left:${b.x - b.w / 2}px;width:${b.w}px;bottom:${i * BLOCK_H}px;height:${BLOCK_H}px;"></div>`
  )).join('');
  const failHtml = `<div class="tower-block tower-block-fail" style="left:${failX - failW / 2}px;width:${failW}px;bottom:${stack.length * BLOCK_H}px;height:${BLOCK_H}px;"></div>`;

  shell.board.className = 's-board tower-board';
  shell.board.innerHTML = `
    <div class="tower-review-score">🏆 ${placedCount}段まで積みました</div>
    <div class="tower-review-viewport" id="towerReviewViewport" style="width:${VIEW_W}px;height:${VIEW_H}px;">
      <div class="tower-review-track" id="towerReviewTrack" style="height:${trackH}px;">
        ${blocksHtml}
        ${failHtml}
      </div>
    </div>
    <div class="tower-review-toolbar">
      <button type="button" id="towerReviewTop">⬆ 失敗地点</button>
      <button type="button" id="towerReviewBottom">⬇ 台座</button>
    </div>
  `;

  const vp = document.getElementById('towerReviewViewport');
  vp.scrollTop = 0; // 最初から失敗地点（一番上）が見える状態にする
  document.getElementById('towerReviewTop').addEventListener('click', () => { vp.scrollTop = 0; });
  document.getElementById('towerReviewBottom').addEventListener('click', () => { vp.scrollTop = vp.scrollHeight; });
}

/* ---- GameShellのライフサイクルに接続 ---- */
shell.onStart(() => {
  startGame();
});
shell.onReset(() => {
  if (craneRaf) cancelAnimationFrame(craneRaf);
  if (gameOverTimer) { clearTimeout(gameOverTimer); gameOverTimer = null; }
  showPlaceholder();
});
