/* =========================================================
   ゆるゆるゴルフ⛳ 固有ロジック（v4）
   -----------------------------------------------------------
   v3からの変更点：
   - コースを「毎回スタート時にランダム生成」する方式に変更
     （壁のゲート位置・砂地／水たまりの位置形状・スタート/ホール位置を
     　都度ランダム化し、周回プレイでの飽きを防ぐ）
   - 完全な自動生成だが、迷路/パイプパズルのような厳密な解探索検証は
     行っていない（連続空間＋反射物理のため経路の解けなさをアルゴリズムで
     保証するのが難しい）。代わりに「ゲート幅は常にボール直径の5倍以上」
     「障害物は壁ゲートに重ねない」といった余裕を持った制約でランダム化し、
     現実的にどんな狙い方でも通過できる範囲に収めている
   - 盤面は300×240（比率0.8）に変更。真の縦長（比率1.3〜1.6）は
     iPhone16eでスクロールが発生してしまうため不可（実測済みの反省点）。
     一方で前バージョンの300×200（比率0.667）は縦方向のドラッグ量が
     窮屈だったため、安全上限ぎりぎりまで縦を伸ばして両立させている

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

/* ---------- コース手続き生成（5ホール、盤面は共通300×240） ---------- */
const COURSE_W = 300;
const COURSE_H = 240;
const HOLE_COUNT = 5;
const GATE_COUNT_BY_HOLE = [0, 1, 2, 2, 3]; // ホールごとの壁ゲート数（難易度カーブ）
const GAP_MIN = 78;  // 壁ゲートの最小開口（ボール直径14の5倍以上を確保）
const GAP_MAX = 118;

function randRange(min, max) { return min + Math.random() * (max - min); }

function rectsOverlap(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

// 壁ゲート1本を生成（gapSide側が通り道として空く）
function makeWallGate(x, gapSide, gapSize) {
  const barW = 18;
  if (gapSide === 'top') {
    return { x, y: gapSize, w: barW, h: COURSE_H - gapSize }; // 上側が通り道
  }
  return { x, y: 0, w: barW, h: COURSE_H - gapSize }; // 下側が通り道
}

// 砂地／水たまりを1つ生成。壁ゲートと重ならない位置を探す（最大12回試行）
function randomPatch(walls) {
  const pw = randRange(45, 65);
  const ph = randRange(26, 40);
  const shape = Math.random() < 0.5 ? 'gourd' : 'oval';
  for (let attempt = 0; attempt < 12; attempt++) {
    const x = randRange(85, COURSE_W - 85 - pw);
    const y = randRange(18, COURSE_H - 18 - ph);
    const rect = { x, y, w: pw, h: ph, shape };
    const overlapsWall = walls.some((wall) =>
      rectsOverlap(rect, { x: wall.x - 10, y: wall.y - 10, w: wall.w + 20, h: wall.h + 20 })
    );
    if (!overlapsWall) return rect;
  }
  return { x: COURSE_W * 0.5 - pw / 2, y: COURSE_H * 0.5 - ph / 2, w: pw, h: ph, shape };
}

// ホール1つ分のコースをランダム生成する
function generateHole(index) {
  const margin = 30;
  const start = { x: 34, y: randRange(margin, COURSE_H - margin) };
  const hole = { x: COURSE_W - 34, y: randRange(margin, COURSE_H - margin), r: 12 };

  const gateCount = GATE_COUNT_BY_HOLE[index];
  const walls = [];
  let side = Math.random() < 0.5 ? 'top' : 'bottom';
  for (let i = 0; i < gateCount; i++) {
    const x = COURSE_W * ((i + 1) / (gateCount + 1)) + randRange(-14, 14);
    const gapSize = randRange(GAP_MIN, GAP_MAX);
    side = side === 'top' ? 'bottom' : 'top'; // ジグザグに開口を交互配置
    walls.push(makeWallGate(x, side, gapSize));
  }

  const sand = [];
  const water = [];
  if (index >= 1 && Math.random() < 0.85) sand.push(randomPatch(walls));
  if (index >= 3) water.push(randomPatch(walls));

  const movingObstacles = [];
  if (index === HOLE_COUNT - 1) {
    for (let i = 0; i < 2; i++) {
      movingObstacles.push({
        cx: randRange(70, COURSE_W - 70),
        cy: randRange(40, COURSE_H - 40),
        r: 11,
        axis: Math.random() < 0.5 ? 'x' : 'y',
        range: 18,
        speed: 0.002 + Math.random() * 0.0007,
      });
    }
  }

  return { w: COURSE_W, h: COURSE_H, start, hole, walls, sand, water, movingObstacles };
}

/* ---------- 状態 ---------- */
let canvas = null, ctx = null;
let course = null;
let currentHoles = [];   // このプレイで生成された5ホール分のコースデータ
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
  course = currentHoles[index];
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
  if (elHoleNum) elHoleNum.textContent = `${currentHoleIndex + 1} / ${HOLE_COUNT}`;
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
    if (currentHoleIndex >= HOLE_COUNT) {
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
  shell.end(`全${HOLE_COUNT}ホール終了！合計 ${total}打でまわりきりました⛳`);
}

/* ---------- DOM構築 ---------- */
function buildDom() {
  shell.board.className = 's-board golf-board';
  shell.board.innerHTML = `
    <div class="golf-toolbar">
      <span class="golf-badge">⛳ <b id="golfHoleNum">1 / ${HOLE_COUNT}</b></span>
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

  currentHoles = Array.from({ length: HOLE_COUNT }, (_, i) => generateHole(i));
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
