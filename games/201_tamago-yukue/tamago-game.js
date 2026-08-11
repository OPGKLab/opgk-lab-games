/* =========================================================
   たまごのゆくえ🐣 固有ロジック
   共通土台(GameShell)のAPIだけを使い、盤面はCanvasに自前の円物理で描画する。
   進化: 🥚→🐣→🐔→🦃→🦢→🦚→🍳
   ========================================================= */

const shell = new GameShell({
  rootSelector: '#app',
  title: 'たまごのゆくえ🐣',
  hint: '画面をなぞってたまごを動かし、指を離すと落とせます（タイトル5回タップで激むず）',
  hasScore: true,
  hasTimer: false,
});

/* ---------- 進化ステージ定義 ---------- */
const STAGES = [
  { emoji: '🥚', r: 18, color: '#f5e6c8' },
  { emoji: '🐣', r: 24, color: '#fff1b8' },
  { emoji: '🐔', r: 30, color: '#ffd8a8' },
  { emoji: '🦃', r: 37, color: '#e8b98a' },
  { emoji: '🦢', r: 44, color: '#eef3f7' },
  { emoji: '🦚', r: 50, color: '#bfe3d0' },
  { emoji: '🍳', r: 55, color: '#fff4d6' },
];
const MAX_STAGE = STAGES.length - 1;

/* ---------- 難易度別サイズ ---------- */
const NORMAL_SIZE = { w: 320, h: 420, lineY: 78 };
const HARD_SIZE = { w: 260, h: 420, lineY: 78 };
const NEXT_WEIGHTS_NORMAL = [5, 3, 1];
const NEXT_WEIGHTS_HARD = [3, 3, 2];

/* ---------- 物理パラメータ ---------- */
const GRAVITY = 1500;          // px/s^2
const RESTITUTION = 0.22;      // 円同士の反発係数
const WALL_RESTITUTION = 0.28; // 壁・床の反発係数
const AIR_DAMPING = 0.999;
const GROUND_FRICTION = 0.96;
const MERGE_LOCK_MS = 250;     // 生成直後、この間は合体対象外
const OVER_LINE_LIMIT_MS = 2000; // 赤線超え継続でゲームオーバーになるまでの時間
const SUBSTEPS = 2;
const POSITION_ITERATIONS = 6; // 密集時の重なり解消を収束させるための反復回数
const MIN_BOUNCE_SPEED = 60;   // これ未満の衝突速度では跳ね返さず吸収する（微振動防止）
const SETTLE_ZERO_SPEED = 3;   // これ未満の速度は完全に0とみなす（数値ノイズ除去）

let W = NORMAL_SIZE.w, H = NORMAL_SIZE.h, LINE_Y = NORMAL_SIZE.lineY;
let canvas, ctx, nextIconEl;
let particles = [];
let nextId = 1;
let currentPiece = null;   // まだ落としていない、プレイヤーが操作中の卵
let previewStage = null;   // 「つぎ」に表示中の、まだ確定していないステージ
let dropLocked = false;
let rafId = null;
let gameOverTriggered = false;
let dragging = false;

/* ---------- ユーティリティ ---------- */
function pickNextStage() {
  const weights = shell.hardMode ? NEXT_WEIGHTS_HARD : NEXT_WEIGHTS_NORMAL;
  const total = weights.reduce((s, w) => s + w, 0);
  let r = Math.random() * total;
  for (let i = 0; i < weights.length; i++) {
    if (r < weights[i]) return i;
    r -= weights[i];
  }
  return 0;
}

function makeParticle(stage, x, y, vx = 0, vy = 0) {
  return {
    id: nextId++,
    stage, r: STAGES[stage].r,
    x, y, vx, vy,
    mass: STAGES[stage].r * STAGES[stage].r,
    bornAt: Date.now(),
    overSince: null,
    merging: false,
  };
}

/* ---------- 盤面構築 ---------- */
function buildBoard() {
  const size = shell.hardMode ? HARD_SIZE : NORMAL_SIZE;
  W = size.w; H = size.h; LINE_Y = size.lineY;

  shell.board.className = 's-board tamago-board';
  shell.board.innerHTML = `
    <div class="tamago-toolbar">
      <span class="tamago-next-label">つぎ</span>
      <span class="tamago-next-icon" id="tamagoNextIcon"></span>
    </div>
    <canvas id="tamagoCanvas"></canvas>
  `;
  nextIconEl = shell.board.querySelector('#tamagoNextIcon');
  canvas = shell.board.querySelector('#tamagoCanvas');
  canvas.width = W;
  canvas.height = H;
  // 表示サイズをCanvasの実解像度(W:H)に合わせる。CSS側の固定値だと激むず(幅260)の時に
  // 320幅相当へ引き伸ばされてしまい、絵文字が横長に潰れて見えていた。
  canvas.style.maxWidth = `${W}px`;
  canvas.style.aspectRatio = `${W} / ${H}`;
  const toolbarEl = shell.board.querySelector('.tamago-toolbar');
  if (toolbarEl) toolbarEl.style.maxWidth = `${W}px`;
  ctx = canvas.getContext('2d');

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointerleave', onPointerUp);

  drawStatic();
}

function showPlaceholder() {
  shell.board.className = 's-board tamago-board';
  shell.board.innerHTML = '<div class="tamago-placeholder">「スタート」を押すとたまごが落ちてきます</div>';
}

/* ---------- 座標変換（表示サイズとCanvas内部解像度のズレを吸収） ---------- */
function getCanvasPos(evt) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  return {
    x: (evt.clientX - rect.left) * scaleX,
    y: (evt.clientY - rect.top) * scaleY,
  };
}

/* ---------- 操作（なぞって移動→離して落下） ---------- */
function spawnCurrentPiece() {
  const stage = previewStage !== null ? previewStage : pickNextStage();
  const r = STAGES[stage].r;
  currentPiece = { stage, r, x: W / 2, y: Math.max(r + 6, LINE_Y - 20) };
  decideNextPreview();
}

function decideNextPreview() {
  previewStage = pickNextStage();
  if (nextIconEl) nextIconEl.textContent = STAGES[previewStage].emoji;
}

function onPointerDown(evt) {
  if (!shell.running || !currentPiece || dropLocked) return;
  dragging = true;
  moveCurrentTo(evt);
}
function onPointerMove(evt) {
  if (!dragging || !currentPiece) return;
  moveCurrentTo(evt);
}
function moveCurrentTo(evt) {
  const pos = getCanvasPos(evt);
  const r = currentPiece.r;
  currentPiece.x = Math.min(W - r, Math.max(r, pos.x));
}
function onPointerUp() {
  if (!dragging || !currentPiece) { dragging = false; return; }
  dragging = false;
  dropCurrentPiece();
}

function dropCurrentPiece() {
  if (!currentPiece || dropLocked) return;
  const p = makeParticle(currentPiece.stage, currentPiece.x, currentPiece.y, 0, 0);
  particles.push(p);
  shell.playTone(500 + currentPiece.stage * 40, 0.08);
  currentPiece = null;
  dropLocked = true;
  setTimeout(() => {
    if (!shell.running) return;
    spawnCurrentPiece();
    dropLocked = false;
  }, 300);
}

/* ---------- 物理更新 ---------- */
function applyGravity(dt) {
  particles.forEach((p) => {
    p.vy += GRAVITY * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vx *= AIR_DAMPING;
  });
}

function resolveWalls() {
  particles.forEach((p) => {
    if (p.x - p.r < 0) { p.x = p.r; p.vx = -p.vx * WALL_RESTITUTION; }
    if (p.x + p.r > W) { p.x = W - p.r; p.vx = -p.vx * WALL_RESTITUTION; }
    if (p.y + p.r > H) {
      p.y = H - p.r;
      p.vy = Math.abs(p.vy) < MIN_BOUNCE_SPEED ? 0 : -p.vy * WALL_RESTITUTION;
      p.vx *= GROUND_FRICTION;
    }
  });
}

// 位置補正のみを行う（速度は変えない）。3個以上が密集した状態は1回では解消しきれないため、
// 呼び出し側で複数回反復することで重なりを収束させる。
function resolveOverlapsOnce() {
  let maxOverlap = 0;
  for (let i = 0; i < particles.length; i++) {
    for (let j = i + 1; j < particles.length; j++) {
      const a = particles[i], b = particles[j];
      const dx = b.x - a.x, dy = b.y - a.y;
      const dist = Math.hypot(dx, dy);
      const minDist = a.r + b.r;
      if (dist === 0 || dist >= minDist) continue;

      const nx = dx / dist, ny = dy / dist;
      const overlap = minDist - dist;
      maxOverlap = Math.max(maxOverlap, overlap);
      const totalMass = a.mass + b.mass;
      a.x -= nx * overlap * (b.mass / totalMass);
      a.y -= ny * overlap * (b.mass / totalMass);
      b.x += nx * overlap * (a.mass / totalMass);
      b.y += ny * overlap * (a.mass / totalMass);
    }
  }
  return maxOverlap;
}

// 速度の解決（反発）と合体判定。位置補正が済んだ後の最終的な重なり状態を見て判定する。
function resolveVelocitiesAndMerges() {
  const mergeQueue = [];
  const now = Date.now();
  for (let i = 0; i < particles.length; i++) {
    for (let j = i + 1; j < particles.length; j++) {
      const a = particles[i], b = particles[j];
      const dx = b.x - a.x, dy = b.y - a.y;
      const dist = Math.hypot(dx, dy);
      const minDist = a.r + b.r;
      if (dist === 0 || dist >= minDist) continue;

      const nx = dx / dist, ny = dy / dist;
      const rvx = b.vx - a.vx, rvy = b.vy - a.vy;
      const velAlongNormal = rvx * nx + rvy * ny;
      if (velAlongNormal < 0) {
        // 衝突速度が小さい（=ほぼ静止して押し合っているだけ）場合は跳ね返さず吸収する。
        // これをやらないと接触状態のまま永久に微振動し続け、静止判定に到達できない。
        const usedRestitution = Math.abs(velAlongNormal) < MIN_BOUNCE_SPEED ? 0 : RESTITUTION;
        const jImpulse = (-(1 + usedRestitution) * velAlongNormal) / (1 / a.mass + 1 / b.mass);
        a.vx -= (jImpulse * nx) / a.mass;
        a.vy -= (jImpulse * ny) / a.mass;
        b.vx += (jImpulse * nx) / b.mass;
        b.vy += (jImpulse * ny) / b.mass;
      }

      if (!a.merging && !b.merging && now - a.bornAt > MERGE_LOCK_MS && now - b.bornAt > MERGE_LOCK_MS) {
        if (a.stage === b.stage && a.stage < MAX_STAGE) {
          a.merging = true; b.merging = true;
          mergeQueue.push({ type: 'evolve', a, b });
        } else if (a.stage === MAX_STAGE && b.stage === MAX_STAGE) {
          // 最終形(🍳)同士は進化先がないため、ぶつかったらボーナス加点して両方消える
          a.merging = true; b.merging = true;
          mergeQueue.push({ type: 'vanish', a, b });
        }
      }
    }
  }
  mergeQueue.forEach(({ type, a, b }) => (type === 'evolve' ? doMerge(a, b) : doVanish(a, b)));
}

// 数値誤差で残るごく小さい速度を完全に0へスナップする（見た目の微振動と誤判定を防ぐ）
function settleSlowParticles() {
  particles.forEach((p) => {
    if (Math.hypot(p.vx, p.vy) < SETTLE_ZERO_SPEED) {
      p.vx = 0; p.vy = 0;
    }
  });
}

function doMerge(a, b) {
  particles = particles.filter((p) => p.id !== a.id && p.id !== b.id);
  const newStage = a.stage + 1;
  const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
  const p = makeParticle(newStage, mx, my, (a.vx + b.vx) / 4, (a.vy + b.vy) / 4);
  particles.push(p);
  shell.addScore(newStage * 10);
  shell.playTone(600 + newStage * 60, 0.12, newStage === MAX_STAGE ? 'triangle' : 'sine');
  showMergePopup(mx, my, `+${newStage * 10}`, newStage === MAX_STAGE ? 'bonus' : 'good');
}

// 最終形(🍳)同士がぶつかった時：新しい駒は作らず両方消し、大きめのボーナスを入れる
const FINAL_VANISH_BONUS = 200;
function doVanish(a, b) {
  particles = particles.filter((p) => p.id !== a.id && p.id !== b.id);
  const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
  shell.addScore(FINAL_VANISH_BONUS);
  [523.25, 659.25, 783.99, 1046.5, 1318.51].forEach((freq, i) =>
    setTimeout(() => shell.playTone(freq, 0.14, 'triangle'), i * 90)
  );
  showMergePopup(mx, my, `+${FINAL_VANISH_BONUS}`, 'bonus');
}

function showMergePopup(x, y, text, type) {
  const marker = document.createElement('div');
  marker.style.position = 'absolute';
  marker.style.left = `${x}px`;
  marker.style.top = `${y}px`;
  marker.style.width = '0px';
  marker.style.height = '0px';
  shell.board.appendChild(marker);
  shell.showPopup(marker, text, type);
  setTimeout(() => marker.remove(), 750);
}

/* ---------- ゲームオーバー判定 ---------- */
function checkGameOver() {
  if (gameOverTriggered) return;
  const now = Date.now();
  for (const p of particles) {
    // 速度は見ない。山のどこかが揺れるたびに毎回リセットされてしまい判定が働かなくなるため、
    // 「赤線より上に位置し続けているか」だけをシンプルに時間計測する。
    const overLine = p.y - p.r < LINE_Y;
    if (overLine) {
      if (!p.overSince) p.overSince = now;
      else if (now - p.overSince > OVER_LINE_LIMIT_MS) {
        triggerGameOver();
        return;
      }
    } else {
      p.overSince = null;
    }
  }
}

function triggerGameOver() {
  gameOverTriggered = true;
  currentPiece = null;
  shell.playTone(220, 0.3, 'sawtooth');
  shell.end(`ゲームオーバー！スコア: ${shell.getScore()}`);
}

/* ---------- 描画 ---------- */
function drawStatic() {
  ctx.clearRect(0, 0, W, H);
}

function render() {
  ctx.clearRect(0, 0, W, H);

  // ゲームオーバー判定ライン
  ctx.save();
  ctx.setLineDash([6, 6]);
  ctx.strokeStyle = '#e2574c';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, LINE_Y);
  ctx.lineTo(W, LINE_Y);
  ctx.stroke();
  ctx.restore();

  particles.forEach((p) => drawParticle(p));

  if (currentPiece) {
    ctx.globalAlpha = 0.9;
    drawCircleWithEmoji(currentPiece.x, currentPiece.y, currentPiece.r, STAGES[currentPiece.stage]);
    ctx.globalAlpha = 1;
    // ガイド線
    ctx.save();
    ctx.strokeStyle = 'rgba(0,0,0,0.15)';
    ctx.setLineDash([2, 4]);
    ctx.beginPath();
    ctx.moveTo(currentPiece.x, currentPiece.y + currentPiece.r);
    ctx.lineTo(currentPiece.x, H);
    ctx.stroke();
    ctx.restore();
  }
}

function drawParticle(p) {
  drawCircleWithEmoji(p.x, p.y, p.r, STAGES[p.stage]);
}

function drawCircleWithEmoji(x, y, r, stageDef) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = stageDef.color;
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = 'rgba(0,0,0,0.12)';
  ctx.stroke();

  ctx.font = `${Math.floor(r * 1.3)}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(stageDef.emoji, x, y + 1);
}

/* ---------- メインループ ---------- */
function loop() {
  const dt = 1 / 60 / SUBSTEPS;
  for (let s = 0; s < SUBSTEPS; s++) {
    applyGravity(dt);
    resolveWalls();
    for (let it = 0; it < POSITION_ITERATIONS; it++) {
      resolveOverlapsOnce();
      resolveWalls();
    }
    resolveVelocitiesAndMerges();
  }
  settleSlowParticles();
  checkGameOver();
  render();
  if (shell.running) rafId = requestAnimationFrame(loop);
}

/* ---- GameShellのライフサイクルに接続 ---- */
shell.onStart(() => {
  buildBoard();
  particles = [];
  gameOverTriggered = false;
  dropLocked = false;
  previewStage = null;
  spawnCurrentPiece();
  cancelAnimationFrame(rafId);
  rafId = requestAnimationFrame(loop);
});

shell.onReset(() => {
  cancelAnimationFrame(rafId);
  particles = [];
  currentPiece = null;
  previewStage = null;
  gameOverTriggered = false;
  showPlaceholder();
});

shell.onHardModeChange(() => {
  // running中は呼ばれない（GameShell側で保証）。次回スタート時にサイズへ反映される。
});

showPlaceholder();
