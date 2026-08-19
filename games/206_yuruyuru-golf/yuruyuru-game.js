/* =========================================================
   ゆるゆるゴルフ⛳ 固有ロジック（v3）
   -----------------------------------------------------------
   v2からの変更点：
   - 操作を2ステップ・タップ式からドラッグ式に戻した
     （ボールを狙いと反対方向にドラッグして離す、定番のゴルフゲームUI）
   - ドラッグはボールに正確に触れなくても盤面上どこからでも開始できる
     （50代以上ターゲットの精度負荷軽減）
   - 軌道プレビューは「先端に向かって小さくなるドット列＋矢印」のまま維持
   - 横長盤面（300×200）・砂地／水たまり・激むずのハチ🐝はそのまま維持

   衝突判定：矩形障害物・コース境界ともに「ボール中心から見た最近接点」
   を求める円対矩形の方式に統一。辺・角どちらでも破綻しない。
   ========================================================= */

const shell = new GameShell({
  rootSelector: '#app',
  title: 'ゆるゆるゴルフ⛳',
  hint: 'ボールを狙いと反対方向にドラッグして、離すと打てます（タイトル5回タップで激むず）',
  hasScore: true,
  hasTimer: false,
});

/* ---------- 物理パラメータ（デバッグで調整する前提の初期値） ---------- */
const BALL_R = 7;
const FRICTION = 0.985;
const FRICTION_SAND = 0.90;  // 砂地に入っている間の追加減速
const MIN_SPEED = 0.045;
const MAX_DRAG = 90;         // ドラッグ距離の上限（論理px）
const POWER_SCALE = 0.072;   // ドラッグ距離→初速への変換係数
const BOUNCE = 0.7;          // 壁・障害物での反発係数（1で完全弾性）
const DPR = Math.min(window.devicePixelRatio || 1, 3);

/* ---------- コース定義（5ホール。横長300×200前後、iPhone16e想定） ---------- */
const HOLES = [
  {
    w: 300, h: 200,
    start: { x: 35, y: 100 },
    hole: { x: 265, y: 100, r: 13 },
    walls: [],
    sand: [],
    water: [],
  },
  {
    w: 300, h: 200,
    start: { x: 35, y: 150 },
    hole: { x: 265, y: 50, r: 12 },
    walls: [
      { x: 140, y: 0, w: 18, h: 120 }, // 下側が通り道
    ],
    sand: [
      { x: 175, y: 130, w: 60, h: 40, shape: 'gourd' },
    ],
    water: [],
  },
  {
    w: 300, h: 200,
    start: { x: 30, y: 150 },
    hole: { x: 270, y: 50, r: 12 },
    walls: [
      { x: 95, y: 0, w: 18, h: 120 },   // 下が通り道
      { x: 185, y: 80, w: 18, h: 120 }, // 上が通り道（S字）
    ],
    sand: [
      { x: 95, y: 130, w: 70, h: 35, shape: 'oval' },
    ],
    water: [],
  },
  {
    w: 300, h: 200,
    start: { x: 30, y: 160 },
    hole: { x: 270, y: 40, r: 12 },
    walls: [
      { x: 85, y: 0, w: 18, h: 130 },   // 下が通り道
      { x: 185, y: 60, w: 18, h: 130 }, // 上が通り道
    ],
    sand: [],
    water: [
      { x: 120, y: 150, w: 50, h: 30, shape: 'gourd' },
    ],
  },
  {
    w: 300, h: 200,
    start: { x: 30, y: 150 },
    hole: { x: 270, y: 150, r: 12 },
    walls: [
      { x: 70, y: 70, w: 18, h: 130 },  // 上が通り道
      { x: 190, y: 0, w: 18, h: 130 },  // 下が通り道
    ],
    sand: [
      { x: 95, y: 15, w: 55, h: 35, shape: 'oval' },
    ],
    water: [
      { x: 195, y: 150, w: 55, h: 35, shape: 'gourd' },
    ],
    movingObstacles: [
      { cx: 80, cy: 35, r: 11, axis: 'x', range: 18, speed: 0.0022 },
      { cx: 210, cy: 165, r: 11, axis: 'x', range: 18, speed: 0.0024 },
    ],
  },
];

/* ---------- 状態 ---------- */
let canvas = null, ctx = null;
let course = null;
let currentHoleIndex = 0;
let holeStrokes = 0;
let ball = { x: 0, y: 0, vx: 0, vy: 0 };
let ballMoving = false;
let sunk = false;
let activeWalls = [], activeSand = [], activeWater = [], activeMoving = [];
let preShotPos = { x: 0, y: 0 };
let dragging = false;
let dragCurrent = { x: 0, y: 0 };
let ballTrail = [];   // ボールが転がっている間の残像用（{x,y}を新しい順に格納）
let particles = [];   // ホールイン時の紙吹雪演出用

let rafRunning = false;
let elHoleNum = null, elStrokeNum = null;

/* ---------- ユーティリティ ---------- */
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function isInRect(pt, r) { return pt.x >= r.x && pt.x <= r.x + r.w && pt.y >= r.y && pt.y <= r.y + r.h; }

function roundRectPath(c, x, y, w, h, r) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

/* ---------- 障害物・地形の描画ヘルパー ---------- */

// 砂地・水たまり：矩形の当たり判定はそのまま、見た目だけ楕円／ひょうたん型にする
function drawBlob(rect, shape) {
  const cx = rect.x + rect.w / 2, cy = rect.y + rect.h / 2;
  if (shape === 'gourd') {
    const offset = rect.w * 0.22;
    ctx.beginPath();
    ctx.ellipse(cx - offset * 0.55, cy, rect.w * 0.34, rect.h * 0.44, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(cx + offset * 0.85, cy - rect.h * 0.04, rect.w * 0.24, rect.h * 0.32, 0, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.beginPath();
    ctx.ellipse(cx, cy, rect.w * 0.48, rect.h * 0.46, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}

// 岩の障害物：台形寄りの多角形（角を落とした六角形）を濃いグレー1色で
function drawBoulders(rect) {
  const bevel = Math.min(rect.w, rect.h) * 0.32;
  ctx.beginPath();
  ctx.moveTo(rect.x + bevel, rect.y);
  ctx.lineTo(rect.x + rect.w - bevel, rect.y);
  ctx.lineTo(rect.x + rect.w, rect.y + bevel);
  ctx.lineTo(rect.x + rect.w, rect.y + rect.h - bevel);
  ctx.lineTo(rect.x + rect.w - bevel, rect.y + rect.h);
  ctx.lineTo(rect.x + bevel, rect.y + rect.h);
  ctx.lineTo(rect.x, rect.y + rect.h - bevel);
  ctx.lineTo(rect.x, rect.y + bevel);
  ctx.closePath();
  ctx.fillStyle = '#5a5a56';
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.25)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
}

function powerColor(ratio) {
  if (ratio < 0.4) return '#3f9d63';
  if (ratio < 0.75) return '#e0a52c';
  return '#e2574c';
}

/* ---------- 衝突解決（円 対 矩形／円 対 円、どちらも最近接点方式） ---------- */
function resolveRectCollision(rect) {
  const cx = clamp(ball.x, rect.x, rect.x + rect.w);
  const cy = clamp(ball.y, rect.y, rect.y + rect.h);
  const dx = ball.x - cx, dy = ball.y - cy;
  const distSq = dx * dx + dy * dy;
  if (distSq >= BALL_R * BALL_R || distSq === 0) return;
  const dist = Math.sqrt(distSq);
  const nx = dx / dist, ny = dy / dist;
  const overlap = BALL_R - dist;
  ball.x += nx * overlap;
  ball.y += ny * overlap;
  const dot = ball.vx * nx + ball.vy * ny;
  ball.vx -= (1 + BOUNCE) * dot * nx;
  ball.vy -= (1 + BOUNCE) * dot * ny;
}

function resolveCircleCollision(o) {
  const dx = ball.x - o.x, dy = ball.y - o.y;
  const dist = Math.hypot(dx, dy) || 0.0001;
  const minDist = BALL_R + o.r;
  if (dist >= minDist) return;
  const nx = dx / dist, ny = dy / dist;
  const overlap = minDist - dist;
  ball.x += nx * overlap;
  ball.y += ny * overlap;
  const dot = ball.vx * nx + ball.vy * ny;
  ball.vx -= (1 + BOUNCE) * dot * nx;
  ball.vy -= (1 + BOUNCE) * dot * ny;
  ball.vx += nx * 0.6;
  ball.vy += ny * 0.6;
  shell.playTone(360, 0.06, 'triangle');
}

/* ---------- 物理ステップ ---------- */
function stepPhysics() {
  ballTrail.unshift({ x: ball.x, y: ball.y });
  if (ballTrail.length > 7) ballTrail.length = 7;

  ball.x += ball.vx;
  ball.y += ball.vy;

  const inSand = activeSand.some((s) => isInRect(ball, s));
  const f = inSand ? FRICTION_SAND : FRICTION;
  ball.vx *= f;
  ball.vy *= f;

  if (ball.x - BALL_R < 0) { ball.x = BALL_R; ball.vx = -ball.vx * BOUNCE; }
  if (ball.x + BALL_R > course.w) { ball.x = course.w - BALL_R; ball.vx = -ball.vx * BOUNCE; }
  if (ball.y - BALL_R < 0) { ball.y = BALL_R; ball.vy = -ball.vy * BOUNCE; }
  if (ball.y + BALL_R > course.h) { ball.y = course.h - BALL_R; ball.vy = -ball.vy * BOUNCE; }

  activeWalls.forEach(resolveRectCollision);
  if (shell.hardMode) activeMoving.forEach(resolveCircleCollision);

  if (activeWater.some((w) => isInRect(ball, w))) {
    splashBall();
    return;
  }

  const dist = Math.hypot(ball.x - course.hole.x, ball.y - course.hole.y);
  if (dist < course.hole.r - 2) {
    sinkBall();
    return;
  }

  const speed = Math.hypot(ball.vx, ball.vy);
  if (speed < MIN_SPEED) {
    ball.vx = 0; ball.vy = 0;
    ballMoving = false;
  }
}

function spawnConfetti(x, y) {
  const colors = ['#e2574c', '#e0a52c', '#14966b', '#3d6bd1', '#ffffff'];
  particles = [];
  for (let i = 0; i < 16; i++) {
    const angle = (Math.PI * 2 * i) / 16 + Math.random() * 0.4;
    const speed = 1.4 + Math.random() * 1.8;
    particles.push({
      x, y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 0.8,
      life: 1,
      color: colors[i % colors.length],
    });
  }
}

function updateParticles() {
  particles.forEach((p) => {
    p.x += p.vx;
    p.y += p.vy;
    p.vy += 0.09; // 重力
    p.vx *= 0.96;
    p.life -= 0.028;
  });
  particles = particles.filter((p) => p.life > 0);
}

function updateMovingObstacles(ts) {
  activeMoving.forEach((o) => {
    const offset = Math.sin(ts * o.speed) * o.range;
    if (o.axis === 'x') { o.x = o.cx + offset; o.y = o.cy; }
    else { o.x = o.cx; o.y = o.cy + offset; }
  });
}

function splashBall() {
  ballMoving = false;
  ball.x = preShotPos.x;
  ball.y = preShotPos.y;
  ball.vx = 0; ball.vy = 0;
  shell.playTone(300, 0.08, 'sine');
  setTimeout(() => shell.playTone(220, 0.1, 'sine'), 70);
  shell.toast('ポチャン💦 元の位置からもう一度');
}

/* ---------- ドラッグ操作 ---------- */
function getLogicalPos(e) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: (e.clientX - rect.left) * (course.w / rect.width),
    y: (e.clientY - rect.top) * (course.h / rect.height),
  };
}

function onPointerDown(e) {
  if (!shell.running || ballMoving || sunk) return;
  e.preventDefault();
  dragging = true;
  dragCurrent = getLogicalPos(e);
  canvas.setPointerCapture(e.pointerId);
  render();
}
function onPointerMove(e) {
  if (!dragging) return;
  e.preventDefault();
  dragCurrent = getLogicalPos(e);
  render();
}
function onPointerUp() {
  if (!dragging) return;
  dragging = false;
  const dx = ball.x - dragCurrent.x;
  const dy = ball.y - dragCurrent.y;
  const dist = clamp(Math.hypot(dx, dy), 0, MAX_DRAG);
  if (dist < 8) { render(); return; } // 小さすぎる動きはショットとして扱わない
  const angle = Math.atan2(dy, dx);
  launchShot(angle, dist * POWER_SCALE);
  render();
}

function launchShot(angle, power) {
  preShotPos = { x: ball.x, y: ball.y };
  ballTrail = [];
  ball.vx = Math.cos(angle) * power;
  ball.vy = Math.sin(angle) * power;
  ballMoving = true;
  holeStrokes++;
  shell.addScore(1);
  updateBadges();
  shell.playTone(500, 0.05, 'triangle');

  // 強めのショットは盤面をキュッと弾ませて手応えを出す
  if (power > MAX_DRAG * POWER_SCALE * 0.7) {
    const wrap = canvas.parentElement;
    wrap.classList.remove('golf-punch');
    void wrap.offsetWidth;
    wrap.classList.add('golf-punch');
  }
}

/* ---------- 描画 ---------- */
function drawAimTrail(x, y, angle, ratio, color) {
  const len = 22 + ratio * 70;
  const dots = 6;
  for (let i = 1; i <= dots; i++) {
    const t = i / dots;
    const r = t * len;
    const size = 5 * (1 - t * 0.55);
    ctx.globalAlpha = 0.3 + 0.7 * t;
    ctx.beginPath();
    ctx.arc(x + Math.cos(angle) * r, y + Math.sin(angle) * r, size, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  const tipX = x + Math.cos(angle) * len;
  const tipY = y + Math.sin(angle) * len;
  const ah = 7;
  const a1 = angle + Math.PI * 0.8, a2 = angle - Math.PI * 0.8;
  ctx.beginPath();
  ctx.moveTo(tipX, tipY);
  ctx.lineTo(tipX + Math.cos(a1) * ah, tipY + Math.sin(a1) * ah);
  ctx.lineTo(tipX + Math.cos(a2) * ah, tipY + Math.sin(a2) * ah);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

function render() {
  ctx.clearRect(0, 0, course.w, course.h);

  // 芝生ストライプ
  const stripeH = 26;
  let i = 0;
  for (let y = 0; y < course.h; y += stripeH, i++) {
    ctx.fillStyle = i % 2 === 0 ? '#bfe6cf' : '#addcbf';
    ctx.fillRect(0, y, course.w, stripeH);
  }
  ctx.strokeStyle = 'rgba(0,0,0,0.12)';
  ctx.lineWidth = 3;
  ctx.strokeRect(1.5, 1.5, course.w - 3, course.h - 3);

  // 砂地（ひょうたん型・楕円）
  ctx.fillStyle = '#dfc98a';
  activeSand.forEach((s) => drawBlob(s, s.shape));

  // 水たまり（ひょうたん型・楕円＋波模様）
  activeWater.forEach((w) => {
    ctx.fillStyle = '#4fa3d9';
    drawBlob(w, w.shape);
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(w.x + 6, w.y + w.h * 0.5);
    ctx.quadraticCurveTo(w.x + w.w * 0.25, w.y + w.h * 0.28, w.x + w.w * 0.5, w.y + w.h * 0.5);
    ctx.quadraticCurveTo(w.x + w.w * 0.75, w.y + w.h * 0.72, w.x + w.w - 6, w.y + w.h * 0.5);
    ctx.stroke();
  });

  // 障害物（岩の群れ・苔つき）
  activeWalls.forEach(drawBoulders);

  // 動く障害物（激むずのみ・ハチ）
  if (shell.hardMode && activeMoving.length) {
    ctx.font = '22px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    activeMoving.forEach((o) => ctx.fillText('🐝', o.x, o.y));
  }

  // ホール（影＋穴）と旗
  ctx.beginPath();
  ctx.ellipse(course.hole.x, course.hole.y + course.hole.r * 0.3, course.hole.r, course.hole.r * 0.55, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(0,0,0,0.16)';
  ctx.fill();
  ctx.beginPath();
  ctx.arc(course.hole.x, course.hole.y, course.hole.r * 0.7, 0, Math.PI * 2);
  ctx.fillStyle = '#20241f';
  ctx.fill();
  ctx.strokeStyle = '#5c4a32';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(course.hole.x, course.hole.y);
  ctx.lineTo(course.hole.x, course.hole.y - 40);
  ctx.stroke();
  ctx.fillStyle = '#e2574c';
  ctx.beginPath();
  ctx.moveTo(course.hole.x, course.hole.y - 40);
  ctx.lineTo(course.hole.x + 16, course.hole.y - 34);
  ctx.lineTo(course.hole.x, course.hole.y - 28);
  ctx.closePath();
  ctx.fill();

  // ドラッグ中の軌道プレビュー（狙いと反対方向にドット列＋矢印）
  if (dragging) {
    const dx = ball.x - dragCurrent.x;
    const dy = ball.y - dragCurrent.y;
    const dist = clamp(Math.hypot(dx, dy), 0, MAX_DRAG);
    const angle = Math.atan2(dy, dx);
    drawAimTrail(ball.x, ball.y, angle, dist / MAX_DRAG, powerColor(dist / MAX_DRAG));
  }

  // ボールの残像（転がるスピード感を出す）
  ballTrail.forEach((p, i) => {
    const t = 1 - i / ballTrail.length;
    ctx.globalAlpha = t * 0.35;
    ctx.beginPath();
    ctx.arc(p.x, p.y, BALL_R * (0.55 + t * 0.35), 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
  });
  ctx.globalAlpha = 1;

  // ボール
  ctx.beginPath();
  ctx.arc(ball.x, ball.y, BALL_R, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(0,0,0,0.2)';
  ctx.stroke();

  // 紙吹雪（ホールイン演出）
  particles.forEach((p) => {
    ctx.globalAlpha = clamp(p.life, 0, 1);
    ctx.fillStyle = p.color;
    ctx.fillRect(p.x - 3, p.y - 3, 6, 6);
  });
  ctx.globalAlpha = 1;
}

/* ---------- メインループ ---------- */
function loop(ts) {
  if (!shell.running) { rafRunning = false; return; }
  if (shell.hardMode && activeMoving.length) updateMovingObstacles(ts);
  if (ballMoving) stepPhysics();
  if (particles.length) updateParticles();
  render();
  requestAnimationFrame(loop);
}
function ensureLoop() {
  if (rafRunning) return;
  rafRunning = true;
  requestAnimationFrame(loop);
}

/* ---------- ホール進行 ---------- */
function setupCanvasSize() {
  canvas.width = course.w * DPR;
  canvas.height = course.h * DPR;
  canvas.style.aspectRatio = `${course.w} / ${course.h}`;
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
}

function loadHole(index) {
  course = HOLES[index];
  ball = { x: course.start.x, y: course.start.y, vx: 0, vy: 0 };
  ballMoving = false;
  sunk = false;
  holeStrokes = 0;
  activeWalls = course.walls || [];
  activeSand = course.sand || [];
  activeWater = course.water || [];
  activeMoving = (shell.hardMode && course.movingObstacles)
    ? course.movingObstacles.map((o) => ({ ...o, x: o.cx, y: o.cy }))
    : [];
  setupCanvasSize();
  updateBadges();
  render();
}

function updateBadges() {
  if (elHoleNum) elHoleNum.textContent = `${currentHoleIndex + 1} / ${HOLES.length}`;
  if (elStrokeNum) elStrokeNum.textContent = holeStrokes;
}

function sinkBall() {
  ballMoving = false;
  ball.vx = 0; ball.vy = 0;
  sunk = true;
  ballTrail = [];
  spawnConfetti(course.hole.x, course.hole.y);
  shell.playTone(700, 0.08, 'sine');
  setTimeout(() => shell.playTone(900, 0.1, 'sine'), 90);
  setTimeout(() => shell.playTone(1100, 0.12, 'sine'), 180);
  shell.toast(`ホール${currentHoleIndex + 1} クリア！ ${holeStrokes}打`);
  setTimeout(() => {
    currentHoleIndex++;
    if (currentHoleIndex >= HOLES.length) {
      finishGame();
    } else {
      loadHole(currentHoleIndex);
    }
  }, 900);
}

function finishGame() {
  const total = shell.getScore();
  [523.25, 659.25, 783.99, 1046.5, 1318.51].forEach((f, i) =>
    setTimeout(() => shell.playTone(f, 0.15, 'triangle'), i * 100)
  );
  shell.end(`全${HOLES.length}ホール終了！合計 ${total}打でまわりきりました⛳`);
}

/* ---------- DOM構築 ---------- */
function buildDom() {
  shell.board.className = 's-board golf-board';
  shell.board.innerHTML = `
    <div class="golf-toolbar">
      <span class="golf-badge">⛳ <b id="golfHoleNum">1 / ${HOLES.length}</b></span>
      <span class="golf-badge">打数 <b id="golfStrokeNum">0</b></span>
    </div>
    <div class="golf-canvas-wrap">
      <canvas id="golfCanvas"></canvas>
    </div>
    <p class="golf-tap-hint">ボールを狙いと反対方向にドラッグして、離すと打てます</p>
  `;
  canvas = shell.board.querySelector('#golfCanvas');
  ctx = canvas.getContext('2d');
  elHoleNum = shell.board.querySelector('#golfHoleNum');
  elStrokeNum = shell.board.querySelector('#golfStrokeNum');

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerUp);

  currentHoleIndex = 0;
  loadHole(0);
  ensureLoop();
}

function showPlaceholder() {
  shell.board.className = 's-board golf-board';
  shell.board.innerHTML = `
    <div class="golf-placeholder">
      <p>⛳全5ホールをまわって、ボールをホールに沈めましょう。</p>
      <p>ボールを狙いたい方向と<b>反対</b>にドラッグして指を離すと打てます。</p>
      <p>砂地はボールが減速、水たまりは打つ前の位置に戻ります。</p>
      <p>「スタート」を押すとはじまります</p>
    </div>
  `;
}

showPlaceholder();

/* ---- GameShellのライフサイクルに接続 ---- */
shell.onStart(() => {
  buildDom();
});
shell.onReset(() => {
  showPlaceholder();
});
shell.onHardModeChange(() => {
  // running中は呼ばれない（GameShell側で保証）。次回スタート時のホール5に反映される。
});
