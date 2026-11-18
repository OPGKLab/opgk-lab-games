/* =========================================================
   たまごのゆくえ🐣 固有ロジック
   共通土台(GameShell)のAPIだけを使い、盤面はCanvasに自前の円物理で描画する。
   進化（11段階）: 🥚→🐣→🐤→🐔→🦆→🪿→🦃→🦢→🦩→🦚→🍳（🍳同士はぶつかると消えてボーナス）
   ========================================================= */

const shell = new GameShell({
  rootSelector: '#app',
  title: 'たまごのゆくえ🐣',
  hint: '同じたまごを合体させて進化させましょう。指を離すと落とせます。',
  hasScore: true,
  hasTimer: false,
});

/* ---------- 進化ステージ定義 ---------- */
const STAGES = [
  { emoji: '🥚', r: 14, color: '#f5e6c8' },
  { emoji: '🐣', r: 18, color: '#fff1b8' },
  { emoji: '🐤', r: 22, color: '#ffe9a8' },
  { emoji: '🐔', r: 27, color: '#ffd8a8' },
  { emoji: '🦆', r: 32, color: '#cfe8e0' },
  { emoji: '🪿', r: 37, color: '#e9e9e2' },
  { emoji: '🦃', r: 42, color: '#e8b98a' },
  { emoji: '🦢', r: 47, color: '#eef3f7' },
  { emoji: '🦩', r: 51, color: '#ffd6e0' },
  { emoji: '🦚', r: 55, color: '#bfe3d0' },
  { emoji: '🍳', r: 59, color: '#fff4d6' },
];
const MAX_STAGE = STAGES.length - 1;

/* ---------- 難易度別サイズ ---------- */
const NORMAL_SIZE = { w: 320, h: 420, lineY: 78 };
const HARD_SIZE = { w: 260, h: 420, lineY: 78 };

/* ---------- 出現する卵の重み（動的難易度） ----------
   直接落とせるのは 🥚🐣🐤🐔🦆🪿（stage 0〜5）まで。それより先（🦃🦢🦩🦚🍳）は
   合体でしか出会えない「奥に眠っている」枠として残す。
   スコア0の時点ではSPAWN_START_WEIGHTS、スコアがSCORE_RAMP_FULLに達すると
   SPAWN_END_WEIGHTSまで直線的に重みがシフトする。
   種類が11に増えたことで、同じ盤面上で1種類あたりの個体数が薄まり、
   「たまたま同じ種類が隣り合う」確率が下がる（本家すいかゲームの11段階構成を参考に調整）。
   激むずは同じスコアでも早めに難化するよう、進行度にHARD_PROGRESS_BONUSを上乗せする。 */
const SPAWN_START_WEIGHTS = [6, 3, 1, 0, 0, 0]; // 序盤：ほぼ🥚🐣
const SPAWN_END_WEIGHTS = [0, 0, 1, 2, 3, 4];   // 終盤：🦆🪿が主体に
const SCORE_RAMP_FULL = 200;   // このスコアで終盤の重みに到達（要調整）
const HARD_PROGRESS_BONUS = 0.25;

/* ---------- 物理パラメータ ---------- */
const GRAVITY = 1500;          // px/s^2
const RESTITUTION = 0.22;      // 円同士の反発係数
const WALL_RESTITUTION = 0.28; // 壁・床の反発係数
// 横方向の空気抵抗（毎サブステップ）＝滑りの主ノブ。1に近いほどよく滑る。
// 実測(小さい卵を少しずらして落とした時の移動量): 0.95=約35px(鉛) / 0.99=約60〜100px / 0.999=約80〜130px(滑り過ぎ)
const AIR_DAMPING = 0.99;
const MERGE_LOCK_MS = 250;     // 生成直後、この間は合体対象外
const OVER_LINE_LIMIT_MS = 2000; // 赤線超え継続でゲームオーバーになるまでの時間
const SUBSTEPS = 2;
const POSITION_ITERATIONS = 6; // 密集時の重なり解消を収束させるための反復回数
const MIN_BOUNCE_SPEED = 60;   // これ未満の衝突速度では跳ね返さず吸収する（微振動防止）
const SETTLE_ZERO_SPEED = 3;   // これ未満の速度は完全に0とみなす（数値ノイズ除去）

let W = NORMAL_SIZE.w, H = NORMAL_SIZE.h, LINE_Y = NORMAL_SIZE.lineY;
let canvas, ctx, nextIconEl;
let sprites = [];      // ステージごとに1回だけ描いた球の画像（拡縮・演出用）
let spriteDpr = 1;
let effects = [];      // 合体演出（ゴースト・粒）
let frameNow = 0;
let particles = [];
let nextId = 1;
let currentPiece = null;   // まだ落としていない、プレイヤーが操作中の卵
let previewStage = null;   // 「つぎ」に表示中の、まだ確定していないステージ
let dropLocked = false;
let rafId = null;
let gameOverTriggered = false;
let dragging = false;

/* ---------- ユーティリティ ---------- */
// 0（序盤）〜1（終盤）の難易度進行度。スコアが伸びるほど1に近づく。
function difficultyProgress() {
  const raw = shell.getScore() / SCORE_RAMP_FULL;
  const bonus = shell.hardMode ? HARD_PROGRESS_BONUS : 0;
  return Math.min(1, raw + bonus);
}

function pickNextStage() {
  const t = difficultyProgress();
  const weights = SPAWN_START_WEIGHTS.map((w0, i) => w0 + (SPAWN_END_WEIGHTS[i] - w0) * t);
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
  // スマホ等の高精細ディスプレイでぼやけないよう、内部解像度をdevicePixelRatio倍にする。
  // 描画処理側は今まで通りW×Hの論理座標のまま使えるよう、ctx.scaleで補正する。
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  // 表示サイズをCanvasの実解像度(W:H)に合わせる。CSS側の固定値だと激むず(幅260)の時に
  // 320幅相当へ引き伸ばされてしまい、絵文字が横長に潰れて見えていた。
  canvas.style.maxWidth = `${W}px`;
  canvas.style.aspectRatio = `${W} / ${H}`;
  const toolbarEl = shell.board.querySelector('.tamago-toolbar');
  if (toolbarEl) toolbarEl.style.maxWidth = `${W}px`;
  ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  spriteDpr = dpr;
  bakeSprites();

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointerleave', onPointerUp);

  drawStatic();
}

/* ---------- 進化の輪（スタート前の図解。言語に依存せず伝わるよう文字は使わない） ---------- */
const RING_SIZE = 280;   // 表示コンテナの一辺(px)
const RING_CENTER = 140; // 中心座標
const RING_RADIUS = 100; // 円の半径
const RING_MIN_DISP = 14; // 一番小さい卵の表示半径
const RING_MAX_DISP = 28; // 一番大きい卵（❓含む）の表示半径
const RING_MYSTERY_BG = '#fff8ea'; // ❓専用の背景色（本来の色は隠す。視認性重視の明るい色）

function buildEvolutionRingHTML() {
  const n = STAGES.length;
  const items = STAGES.map((s, i) => {
    const isLast = i === n - 1;
    const angle = (i / n) * Math.PI * 2 - Math.PI / 2; // 上から時計回り
    const x = RING_CENTER + RING_RADIUS * Math.cos(angle);
    const y = RING_CENTER + RING_RADIUS * Math.sin(angle);
    const t = (s.r - MIN_R) / (MAX_R - MIN_R);
    const dispR = RING_MIN_DISP + t * (RING_MAX_DISP - RING_MIN_DISP);
    const emoji = isLast ? '❓' : s.emoji;
    const bg = isLast ? RING_MYSTERY_BG : s.color;
    const border = isLast ? 'box-shadow:0 0 0 2px #e0a52c, 0 1px 3px rgba(0,0,0,0.15);' : '';
    return `<div class="tamago-ring-item" style="left:${x}px;top:${y}px;width:${dispR * 2}px;height:${dispR * 2}px;background:${bg};font-size:${dispR * 1.15}px;${border}">${emoji}</div>`;
  }).join('');
  return `
    <div class="tamago-ring" style="width:${RING_SIZE}px;height:${RING_SIZE}px;">
      <div class="tamago-ring-arrow">↻</div>
      ${items}
    </div>
  `;
}

function showPlaceholder() {
  shell.board.className = 's-board tamago-board';
  shell.board.innerHTML = buildEvolutionRingHTML();
}

/* ---------- 座標変換（表示サイズとCanvas内部解像度のズレを吸収） ---------- */
function getCanvasPos(evt) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = W / rect.width;
  const scaleY = H / rect.height;
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
// 合体判定は物理的な当たり判定より少し広めにする（隙間が少し空いていても合体できるように）
const MERGE_TOLERANCE = 1.18;

function resolveVelocitiesAndMerges() {
  const mergeQueue = [];
  const now = Date.now();
  for (let i = 0; i < particles.length; i++) {
    for (let j = i + 1; j < particles.length; j++) {
      const a = particles[i], b = particles[j];
      const dx = b.x - a.x, dy = b.y - a.y;
      const dist = Math.hypot(dx, dy);
      const minDist = a.r + b.r;
      const mergeDist = minDist * MERGE_TOLERANCE;
      if (dist === 0 || dist >= mergeDist) continue;

      // 物理的な反発（跳ね返り）は実際に重なっている時だけ計算する
      if (dist < minDist) {
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
      }

      // 合体判定はmergeDist（少し広め）で成立させる
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

// これ未満の縦速度なら「もう落下していない＝着地/支えられている」とみなす
const REST_VY_SPEED = 20;

// 着地後の横方向の転がりやすさ（サイズ依存）。値が1に近いほど減衰が弱く長く転がる。
const MIN_R = STAGES[0].r;
const MAX_R = STAGES[MAX_STAGE].r;
// 着地後（縦速度がほぼ0の時）の摩擦（1フレームあたりの残存率）。サイズ依存の微調整用。
// 滑りの大枠は AIR_DAMPING のほうが支配的で、こちらは「止まるまでの時間」に効く。
const SMALL_REST_FRICTION = 0.96;  // 一番小さい卵：よく転がる
const LARGE_REST_FRICTION = 0.88;  // 一番大きい卵：あまり転がらない（少しだけ動く）
function restFrictionFor(r) {
  const t = (r - MIN_R) / (MAX_R - MIN_R); // 0(小)〜1(大)
  return SMALL_REST_FRICTION + (LARGE_REST_FRICTION - SMALL_REST_FRICTION) * t;
}

// 数値誤差で残るごく小さい速度を完全に0へスナップする（見た目の微振動と誤判定を防ぐ）
function settleSlowParticles() {
  particles.forEach((p) => {
    // 縦方向が止まっている＝着地している卵は、横方向にサイズなりの摩擦をかけて減速させる。
    // 即ゼロにすると「ドスッ」と砂袋が落ちたような動きになるため、少し転がってから止まるようにする。
    if (Math.abs(p.vy) < REST_VY_SPEED) {
      p.vx *= restFrictionFor(p.r);
    }
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
  p.popAt = Date.now();
  const isFinal = newStage === MAX_STAGE && FX.final;
  if (isFinal) p.reveal = true; // ❓→🍳の正体公開
  particles.push(p);
  spawnMergeFx(a, b, mx, my, newStage);
  shell.addScore(newStage * 10);
  if (isFinal) playFinalFanfare();
  else shell.playTone(600 + newStage * 60, 0.12, newStage === MAX_STAGE ? 'triangle' : 'sine');
  showMergePopup(mx, my, `+${newStage * 10}`, newStage === MAX_STAGE ? 'bonus' : 'good');
}

// 最終形(🍳)同士がぶつかった時：新しい駒は作らず両方消し、大きめのボーナスを入れる
const FINAL_VANISH_BONUS = 200;
function doVanish(a, b) {
  particles = particles.filter((p) => p.id !== a.id && p.id !== b.id);
  const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
  spawnVanishFx(a, b, mx, my);
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
  effects = []; // 演出が途中で止まった絵が残らないように
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

  frameNow = Date.now();
  drawEffects('ghost');
  particles.forEach((p) => drawParticle(p));
  drawEffects('spark');

  if (currentPiece) {
    ctx.globalAlpha = 0.9;
    drawSprite(currentPiece.stage, currentPiece.x, currentPiece.y);
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
  effects = effects.filter((e) => frameNow - e.t0 < (e.dur || e.life)); // 終わった演出を片付ける
}

function drawParticle(p) {
  if (!p.popAt) { drawSprite(p.stage, p.x, p.y); return; }
  const age = frameNow - p.popAt;
  const sc = p.reveal ? popScale(age, FINAL_POP.ms, FINAL_POP.from, FINAL_POP.over) : popScale(age);
  if (p.reveal && age < REVEAL_END) {
    // ❓→🍳：どちらも不透明な円なので、🍳を下に敷いて❓を薄くしていけば、途中で透けずに切り替わる
    const u = Math.min(1, Math.max(0, (age - REVEAL_FROM) / (REVEAL_END - REVEAL_FROM)));
    if (u > 0) drawSprite(p.stage, p.x, p.y, sc);
    if (u < 1) drawSpriteObj(mysterySprite, p.x, p.y, sc, 1 - u);
    return;
  }
  drawSprite(p.stage, p.x, p.y, sc);
}

function circlePath(x, y, r) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
}

function radialFill(cx, cy, r0, r1, stops, x, y, r) {
  const g = ctx.createRadialGradient(cx, cy, r0, cx, cy, r1);
  stops.forEach(([o, c]) => g.addColorStop(o, c));
  ctx.fillStyle = g;
  ctx.fillRect(x - r, y - r, r * 2, r * 2);
}

/* ---- 球の配色：影と輪郭を「その球自身の色の濃い版」にする ----
   以前の茶色/黒の影は、白系の球が灰色にくすむ原因だった。色付きの影にすると、暗い印象が消えて明るく見える。 */
const BALL_LIFT = 0; // 下地を白へ寄せる割合（0〜0.4）。0=元の色のまま。もっと明るくしたい時だけ上げる（0.2前後）

function hexToRgb(h) {
  const v = h.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16));
}
function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  const l = (mx + mn) / 2;
  let h = 0, s = 0;
  if (d) {
    s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    if (mx === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (mx === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  return [h, s, l];
}
function hslToRgb(h, s, l) {
  h = (((h % 360) + 360) % 360) / 360;
  if (!s) { const v = Math.round(l * 255); return [v, v, v]; }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const f = (t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [f(h + 1 / 3), f(h), f(h - 1 / 3)].map((v) => Math.round(v * 255));
}
function rgba(c, a) { return `rgba(${c[0]},${c[1]},${c[2]},${a})`; }

// 影色：色相はそのまま彩度を上げて暗くする。白・灰系（彩度が低い）は暖色寄りに振る
function shadowTone(hex) {
  const [r, g, b] = hexToRgb(hex);
  let [h, s, l] = rgbToHsl(r, g, b);
  if (s < 0.2) h = 28;
  return hslToRgb(h, Math.max(s * 1.25, 0.42), Math.max(l - 0.2, 0.42));
}
function liftTone(hex, t) {
  const [r, g, b] = hexToRgb(hex);
  const [h, s, l] = rgbToHsl(r, g, b);
  return hslToRgb(h, Math.min(1, s * 1.08), l + (1 - l) * t);
}
STAGES[MAX_STAGE].rim = '#e0a52c'; // 🍳だけ金の縁（FINAL_RIMと同じ色）
// 毎フレームの計算を避けるため、各ステージの色を最初に一度だけ求めておく
STAGES.forEach((st) => {
  st.shade = shadowTone(st.color);
  st.base = BALL_LIFT > 0 ? liftTone(st.color, BALL_LIFT) : hexToRgb(st.color);
});

// 球体シェーディング。ツヤは弱めにして絵文字の「下」に敷く（絵文字は最後に描く）。
function shadeSphere(x, y, r, shade) {
  ctx.save();
  circlePath(x, y, r);
  ctx.clip();
  // 光源側から遠い縁を、その球の色の影で暗く（球の丸み）
  radialFill(x - 0.25 * r, y - 0.3 * r, 0, 1.35 * r,
    [[0, rgba(shade, 0)], [0.5, rgba(shade, 0)], [1, rgba(shade, 0.5)]], x, y, r);
  // 左上のツヤ（弱め）
  radialFill(x - 0.4 * r, y - 0.46 * r, 0, 0.55 * r,
    [[0, 'rgba(255,255,255,0.35)'], [1, 'rgba(255,255,255,0)']], x, y, r);
  ctx.restore();
}

function drawEmoji(x, y, r, emoji) {
  ctx.font = `${Math.floor(r * 1.3)}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(emoji, x, y + 1);
}

function drawCircleWithEmoji(x, y, r, stageDef) {
  circlePath(x, y, r);
  ctx.fillStyle = rgba(stageDef.base, 1);
  ctx.fill();

  shadeSphere(x, y, r, stageDef.shade);
  drawEmoji(x, y, r, stageDef.emoji);

  if (stageDef.rim) { // 🍳と❓の球：金の縁
    circlePath(x, y, r - 1.3);
    ctx.lineWidth = 2.6;
    ctx.strokeStyle = stageDef.rim;
  } else {
    circlePath(x, y, r - 0.6);
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = rgba(stageDef.shade, 0.55);
  }
  ctx.stroke();
}

/* ---------- 合体演出 ----------
   ・ポン：新しい球が小さい状態から弾んで定位置へ（見た目だけ。物理の大きさは最初から最終サイズ）
   ・ゴースト：合体前の2つが中心へ吸い込まれて消える
   ・粒：合体位置からパールの粒がパッと散る（静止中は一切動かさず、合体の一瞬だけ）
   絵文字は「フォントサイズを変えながら描く」とiOS Safariで不安定になるため、
   球の絵をステージごとに1回だけ描いて保存し、拡縮は画像の拡縮で行う。 */
const FX = { pop: true, ghost: true, spark: true, final: true }; // 演出ごとのON/OFF（確認用）。finalは🍳が生まれる瞬間の特別演出
const POP_MS = 300, POP_FROM = 0.7, POP_OVER = 1.12;
const GHOST_MS = 140;
// 🍳（最終形態）が生まれる瞬間だけの特別演出：ポンを大きくゆっくりにして、その中で❓が🍳に切り替わる
const FINAL_POP = { ms: 520, from: 0.5, over: 1.18 };
const REVEAL_FROM = 260, REVEAL_END = 360; // この間に❓→🍳へ切り替える（ポンの頂点付近）
const FINAL_RIM = '#e0a52c'; // 🍳の金の縁（スタート前の輪の❓と同じ色）
let mysterySprite = null;
const SPARK_DRAG = 3.2; // 粒の減速の強さ（大きいほど早く止まる）
// 盤面の背景がクリーム色（ほぼ白）なので、白や淡い色の粒は溶けて見えない。金・ピンク・ミントなど背景に映える色にする
const SPARK_COLORS = ['255,196,64', '255,150,180', '120,210,180', '255,255,255'];
const SPARK_COLORS_GOLD = ['255,196,64', '255,222,130', '255,150,180', '255,255,255'];
const GLINT_COLOR = '255,206,84';

function bakeSprites() {
  const saved = ctx;
  sprites = STAGES.map((st) => {
    const half = st.r + 2;
    const size = Math.ceil(half * 2 * spriteDpr);
    const cv = document.createElement('canvas');
    cv.width = size;
    cv.height = size;
    const g = cv.getContext('2d');
    g.scale(size / (half * 2), size / (half * 2));
    ctx = g; // 既存の描画関数をそのまま使うため、描画先を一時的に差し替える
    drawCircleWithEmoji(half, half, st.r, st);
    return { cv, half };
  });
  // 🍳が生まれる瞬間に先に見せる「❓の球」。スタート前の輪の❓と同じ色・同じ金の縁にして伏線を回収する
  const mr = STAGES[MAX_STAGE].r, mhalf = mr + 2, msize = Math.ceil(mhalf * 2 * spriteDpr);
  const mcv = document.createElement('canvas');
  mcv.width = msize;
  mcv.height = msize;
  const mg = mcv.getContext('2d');
  mg.scale(msize / (mhalf * 2), msize / (mhalf * 2));
  ctx = mg;
  drawCircleWithEmoji(mhalf, mhalf, mr, {
    emoji: '❓', color: RING_MYSTERY_BG, base: hexToRgb(RING_MYSTERY_BG), shade: shadowTone(RING_MYSTERY_BG), rim: FINAL_RIM,
  });
  mysterySprite = { cv: mcv, half: mhalf };
  ctx = saved;
}

function drawSprite(stage, x, y, scale = 1, alpha = 1) {
  drawSpriteObj(sprites[stage], x, y, scale, alpha);
}

function drawSpriteObj(sp, x, y, scale = 1, alpha = 1) {
  const w = sp.half * 2 * scale;
  let dx = x - w / 2, dy = y - w / 2;
  if (scale === 1) { // 等倍のときは画素にそろえて、ぼやけを防ぐ
    dx = Math.round(dx * spriteDpr) / spriteDpr;
    dy = Math.round(dy * spriteDpr) / spriteDpr;
  }
  if (alpha !== 1) ctx.globalAlpha = alpha;
  ctx.drawImage(sp.cv, dx, dy, w, w);
  if (alpha !== 1) ctx.globalAlpha = 1;
}

function popScale(age, ms = POP_MS, from = POP_FROM, over = POP_OVER) {
  if (!FX.pop || age >= ms) return 1;
  const x = age / ms;
  if (x < 0.55) { // from → over へ一気に膨らむ
    const u = x / 0.55;
    return from + (over - from) * (1 - Math.pow(1 - u, 3));
  }
  const u = (x - 0.55) / 0.45; // over → 1.0 へ戻る
  return over - (over - 1) * (0.5 - 0.5 * Math.cos(Math.PI * u));
}

function pushSparks(mx, my, n, d0Base, speedBase, speedRange, lifeBase, lifeRange, sizeBase, sizeRange, star, cols, drag = SPARK_DRAG) {
  const now = Date.now();
  for (let i = 0; i < n; i++) {
    const ang = Math.random() * Math.PI * 2;
    const sp = speedBase + Math.random() * speedRange;
    const d0 = d0Base * (0.6 + Math.random() * 0.4);
    effects.push({
      kind: 'spark', t0: now, star, drag,
      x: mx + Math.cos(ang) * d0, y: my + Math.sin(ang) * d0,
      vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp,
      life: lifeBase + Math.random() * lifeRange,
      size: sizeBase + Math.random() * sizeRange,
      col: star ? GLINT_COLOR : cols[(Math.random() * cols.length) | 0],
    });
  }
}

// 🍳が生まれる瞬間：金の粒と星を画面の広い範囲へ、約1.5秒かけて飛ばす（操作は止めない）
function spawnFinalFx(a, b, mx, my) {
  const now = Date.now();
  if (FX.ghost) {
    [a, b].forEach((q) => effects.push({ kind: 'ghost', stage: q.stage, x0: q.x, y0: q.y, x1: mx, y1: my, t0: now, dur: 220, end: 0.8 }));
  }
  if (FX.spark) {
    const r = STAGES[MAX_STAGE].r;
    pushSparks(mx, my, 90, r, 150, 230, 900, 600, 2, 2, false, SPARK_COLORS_GOLD, 1.7);
    pushSparks(mx, my, 16, r, 70, 120, 1000, 500, 4.5, 3.5, true, SPARK_COLORS_GOLD, 1.7);
  }
}

// 専用の効果音：ソから駆け上がる音のあと、和音を長く響かせ、高い音をきらきらと重ねる
function playFinalFanfare() {
  const run = [392, 493.88, 587.33, 783.99, 987.77, 1174.66];
  run.forEach((f, i) => setTimeout(() => shell.playTone(f, 0.13, 'triangle'), i * 75));
  const t = run.length * 75;
  setTimeout(() => [783.99, 987.77, 1174.66].forEach((f) => shell.playTone(f, 0.8, 'sine')), t);
  [2093, 2349.32, 2637.02].forEach((f, i) => setTimeout(() => shell.playTone(f, 0.2, 'sine'), t + 120 + i * 110));
}

function spawnMergeFx(a, b, mx, my, newStage) {
  if (newStage === MAX_STAGE && FX.final) { spawnFinalFx(a, b, mx, my); return; }
  const now = Date.now();
  if (FX.ghost) {
    [a, b].forEach((q) => effects.push({ kind: 'ghost', stage: q.stage, x0: q.x, y0: q.y, x1: mx, y1: my, t0: now, dur: GHOST_MS, end: 0.8 }));
  }
  if (FX.spark) {
    const r = STAGES[newStage].r;
    const k = 1 + newStage * 0.04;
    const sh = STAGES[newStage].shade; // 合体した球自身の色も混ぜて、球ごとに少し色合いが変わるように
    const cols = SPARK_COLORS.concat([`${sh[0]},${sh[1]},${sh[2]}`]);
    pushSparks(mx, my, Math.round(6 + newStage * 2.2), r, 90 * k, 90 * k, 380, 260, 1.9, 1.6, false, cols);
    if (newStage >= 5) pushSparks(mx, my, 3, r, 35, 30, 450, 200, 3.2, 2, true, cols); // 大きい進化には星のきらめきも
  }
}

function spawnVanishFx(a, b, mx, my) {
  const now = Date.now();
  if (FX.ghost) {
    [a, b].forEach((q) => effects.push({ kind: 'ghost', stage: q.stage, x0: q.x, y0: q.y, x1: mx, y1: my, t0: now, dur: 280, end: 1.15 }));
  }
  if (FX.spark) {
    const r = STAGES[MAX_STAGE].r;
    pushSparks(mx, my, 60, r, 120, 180, 700, 300, 2, 1.8, false, SPARK_COLORS_GOLD);
    pushSparks(mx, my, 10, r, 50, 60, 800, 300, 4.5, 3, true, SPARK_COLORS_GOLD);
  }
}

function glintPath(L) {
  ctx.beginPath();
  ctx.moveTo(0, -L);
  ctx.quadraticCurveTo(0.12 * L, -0.12 * L, L, 0);
  ctx.quadraticCurveTo(0.12 * L, 0.12 * L, 0, L);
  ctx.quadraticCurveTo(-0.12 * L, 0.12 * L, -L, 0);
  ctx.quadraticCurveTo(-0.12 * L, -0.12 * L, 0, -L);
}
// 4方向の星。金色の星の中心に小さな白い星を重ねて、背景がクリーム色でも見えるようにする
function drawGlint(x, y, L, alpha, rgb) {
  const a = alpha.toFixed(3);
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = `rgba(${rgb},${a})`;
  glintPath(L);
  ctx.fill();
  ctx.fillStyle = `rgba(255,255,255,${a})`;
  glintPath(L * 0.5);
  ctx.fill();
  ctx.restore();
}

function drawEffects(kind) {
  effects.forEach((e) => {
    const age = frameNow - e.t0;
    if (e.kind !== kind) return;
    if (kind === 'ghost') {
      const u = age / e.dur;
      if (u >= 1) return;
      const k = u * u; // 後半ほど速く中心へ吸い込まれる
      drawSprite(e.stage, e.x0 + (e.x1 - e.x0) * k, e.y0 + (e.y1 - e.y0) * k, 1 + (e.end - 1) * u, 1 - u);
      return;
    }
    if (age >= e.life) return;
    const u = age / e.life;
    const t = age / 1000;
    const k = e.drag || SPARK_DRAG;
    const slide = (1 - Math.exp(-k * t)) / k; // 空気抵抗つきの移動距離（フレームレートに依存しない）
    const x = e.x + e.vx * slide;
    const y = e.y + e.vy * slide - 14 * t; // ふわっと上へ
    const alpha = Math.pow(1 - u, 1.4);
    if (e.star) {
      drawGlint(x, y, e.size * 1.6 * (1 - 0.4 * u), alpha, e.col);
    } else {
      ctx.fillStyle = `rgba(${e.col},${alpha.toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(x, y, e.size * (1 - 0.5 * u), 0, Math.PI * 2);
      ctx.fill();
    }
  });
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
  effects = [];
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
  effects = [];
  currentPiece = null;
  previewStage = null;
  gameOverTriggered = false;
  showPlaceholder();
});

shell.onHardModeChange(() => {
  // running中は呼ばれない（GameShell側で保証）。次回スタート時にサイズへ反映される。
});

showPlaceholder();
