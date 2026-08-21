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
const HARD_START_W = 56;
const CRANE_CENTER = VIEW_W / 2;
const CRANE_AMP = 80; // クレーンの振れ幅（左右のみ）

const MILESTONE_INTERVAL = 15;
// テーマ柄セット：見た目だけの節目演出。増やす場合はここにクラス名を追記するだけでOK。
const THEMES = ['wood', 'candy', 'stone', 'gem'];

let stack = [];        // { x, w } … 台座を含む積み上げ済みブロック
let craneX = CRANE_CENTER;
let craneWidth = NORMAL_START_W;
let craneSpeed = 1.3;
let craneTargetSpeed = 1.3;
let cranePhase = 0;
let speedRange = [1.0, 1.9];
let lastSpeedChange = 0;
let lastTs = 0;
let craneRaf = null;
let canDrop = false;

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
  speedRange = shell.hardMode ? [1.7, 3.0] : [1.0, 1.9];
  craneSpeed = craneTargetSpeed = randRange(speedRange);
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
    craneTargetSpeed = randRange(speedRange);
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
    gameOver();
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
  }

  craneWidth = overlapW; // 次のブロックは今の重なり幅を引き継ぐ
  spawnCraneBlock();
}

function gameOver() {
  if (craneRaf) cancelAnimationFrame(craneRaf);
  const viewport = document.getElementById('towerViewport');
  if (viewport) viewport.classList.add('tower-miss');
  shell.playTone(200, 0.3, 'sawtooth');
  const placedCount = stack.length - 1;
  shell.end(`ゲームオーバー！ ${placedCount}段まで積めました`);
}

/* ---- GameShellのライフサイクルに接続 ---- */
shell.onStart(() => {
  startGame();
});
shell.onReset(() => {
  if (craneRaf) cancelAnimationFrame(craneRaf);
  showPlaceholder();
});
