/* =========================================================
   棒わたり🥷 固有ロジック
   共通土台(GameShell)のAPIだけを使い、盤面はCanvasに自前の
   タイミング判定で描画する。

   ルール：
   - 画面を押している間、足元の棒が上に伸びる
   - 離すと棒が90°倒れて水平な足場になる
   - 倒れた棒の先端が次の足場の範囲内なら成功（+1点）
   - 足場上に表示される📜マークにピッタリ合わせると+3点＆連続ボーナス
   - 短すぎ／長すぎで先端が足場からはみ出すと谷に落ちてゲームオーバー
   - 50個わたりきるとゴール（着地の余韻→紙吹雪→終了）

   状態遷移：idle → growing（伸長中） → falling（倒れる演出）
             → walking（渡る演出） → idle（成功） / dropping（失敗→終了）

   難易度：
   - 渡った数（crossCount）が増えるほど、間隔が広く・足場が狭く・
     棒の伸びる速度が速く・📜の許容誤差も厳しくなる（進行式）
   - 激むずはその厳しい方の範囲がさらに厳しくなる

   盤面サイズ：ねこ配置パズル(nyandoku)と同じ考え方で固定サイズ＋
   margin:0 autoにし、画面幅に応じて間延びしないようにしている。
   ========================================================= */

const shell = new GameShell({
  rootSelector: '#app',
  title: '棒わたり🥷',
  hint: 'タッチしている間、棒がのびます。離すと倒れて足場になります。📜に合わせるとスコアアップ！',
  hasScore: true,
  hasTimer: false,
});

const GOAL_COUNT = 50;
const MAX_LEN = 360;
const FALL_DURATION = 200; // ms
const WALK_SPEED = 0.32;   // px/ms
const CLEAR_DELAY_MS = 700; // 最後の着地から紙吹雪に切り替わるまでの余韻

// 盤面サイズ（固定）
const W = 300, H = 360, GROUND_Y = 259, PLAYER_X = 66;

// 進行式の難易度パラメータ（crossCount=0 → GOAL_COUNTで start→endへ補間）
// gap/widthの範囲を広めに取り、「近い島」と「すごく遠い島」の差がはっきり出るようにしている
const NORMAL_START = { gapMin: 40, gapMax: 140, widthMin: 34, widthMax: 80, growSpeed: 0.20, perfectTol: 8 };
const NORMAL_END   = { gapMin: 50, gapMax: 170, widthMin: 22, widthMax: 50, growSpeed: 0.27, perfectTol: 5 };
const HARD_START   = { gapMin: 55, gapMax: 170, widthMin: 26, widthMax: 55, growSpeed: 0.29, perfectTol: 4 };
const HARD_END     = { gapMin: 70, gapMax: 200, widthMin: 17, widthMax: 38, growSpeed: 0.38, perfectTol: 2.5 };

const CONFETTI_EMOJIS = ['🥷', '📜', '🏮', '✨', '🍥'];
const CONFETTI_DURATION_MS = 2600;

/* ---------- 遊び方図解（文章なし。絵とアイコンだけで伝える） ---------- */
const RULE_SVG_HOLD = `
<svg viewBox="0 0 90 90" width="72" height="72" aria-hidden="true">
  <rect x="8" y="64" width="26" height="18" rx="4" fill="#6c4a68"/>
  <text x="21" y="62" font-size="20" text-anchor="middle">🥷</text>
  <line x1="34" y1="66" x2="34" y2="26" stroke="#8a5a3c" stroke-width="6" stroke-linecap="round"/>
  <polygon points="34,12 27,26 41,26" fill="#8a5a3c"/>
  <circle cx="62" cy="70" r="5" fill="none" stroke="#6a5b8c" stroke-width="2"/>
  <circle cx="62" cy="70" r="10" fill="none" stroke="#6a5b8c" stroke-width="1.5" opacity="0.55"/>
  <circle cx="62" cy="70" r="15" fill="none" stroke="#6a5b8c" stroke-width="1.2" opacity="0.3"/>
</svg>`;

const RULE_SVG_RELEASE = `
<svg viewBox="0 0 90 90" width="72" height="72" aria-hidden="true">
  <rect x="8" y="64" width="20" height="18" rx="4" fill="#6c4a68"/>
  <line x1="18" y1="66" x2="18" y2="40" stroke="#8a5a3c" stroke-width="6" stroke-linecap="round" opacity="0.35"/>
  <line x1="18" y1="66" x2="62" y2="66" stroke="#8a5a3c" stroke-width="6" stroke-linecap="round"/>
  <path d="M18,40 Q46,40 58,58" fill="none" stroke="#6a5b8c" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="4 4"/>
  <rect x="62" y="64" width="20" height="18" rx="4" fill="#6c4a68"/>
  <text x="72" y="58" font-size="15" text-anchor="middle">📜</text>
</svg>`;

const RULE_SVG_CROSS = `
<svg viewBox="0 0 90 90" width="72" height="72" aria-hidden="true">
  <rect x="6" y="64" width="18" height="18" rx="4" fill="#6c4a68"/>
  <line x1="24" y1="66" x2="66" y2="66" stroke="#8a5a3c" stroke-width="6" stroke-linecap="round"/>
  <rect x="66" y="64" width="18" height="18" rx="4" fill="#6c4a68"/>
  <text x="45" y="60" font-size="18" text-anchor="middle">🥷</text>
</svg>`;

let canvas, ctx;
let playerSprite, targetSprite;
let rafId = null;
let state = 'idle'; // idle | growing | falling | walking | dropping

let standing = null;   // { x0, x1 } 現在プレイヤーが立っている足場
let target = null;     // { x0, x1, target, hit } 次の足場

let throwBaseX = 0;    // 今回の一投で棒が生えた根本のワールドX（固定）
let charX = 0;         // キャラクターの現在ワールドX（カメラ基準）
let charDropY = GROUND_Y;

let stickLen = 0;
let growStart = 0;

let fallStart = 0;
let fallLen = 0;
let fallAngle = Math.PI / 2;
let fallTipX = 0, fallTipY = GROUND_Y;

let walkStart = 0;
let walkFromX = 0;
let walkTargetX = 0;
let walkDuration = 1;
let walkOutcome = null; // 'success' | 'short' | 'long'

let dropStart = 0;
let score = 0;
let combo = 0;
let crossCount = 0;
let awaitingClear = false; // ゴール到達後、紙吹雪に切り替わるまでの間、入力を止める

/* ---------- ユーティリティ ---------- */
function lerp(a, b, t) { return a + (b - a) * t; }
function rand(min, max) { return min + Math.random() * (max - min); }

function pickParams() {
  const base = shell.hardMode ? HARD_START : NORMAL_START;
  const end = shell.hardMode ? HARD_END : NORMAL_END;
  const t = Math.min(1, crossCount / GOAL_COUNT);
  return {
    gapMin: lerp(base.gapMin, end.gapMin, t),
    gapMax: lerp(base.gapMax, end.gapMax, t),
    widthMin: lerp(base.widthMin, end.widthMin, t),
    widthMax: lerp(base.widthMax, end.widthMax, t),
    growSpeed: lerp(base.growSpeed, end.growSpeed, t),
    perfectTol: lerp(base.perfectTol, end.perfectTol, t),
  };
}

function makeNextPlatform(fromX) {
  const m = pickParams();
  const gap = rand(m.gapMin, m.gapMax);
  const width = rand(m.widthMin, m.widthMax);
  const x0 = fromX + gap;
  const x1 = x0 + width;
  const margin = Math.min(16, width * 0.28);
  const t = rand(x0 + margin, x1 - margin);
  return { x0, x1, target: t, hit: false };
}

/* ---------- 盤面構築 ---------- */
function buildBoard() {
  shell.board.className = 's-board bou-board';
  shell.board.innerHTML = `
    <div class="bou-toolbar">
      <span class="bou-progress">🏁 <b id="bouProgress">0</b> / ${GOAL_COUNT}</span>
    </div>
    <div class="bou-canvas-wrap">
      <canvas id="bouCanvas"></canvas>
      <div class="bou-sprite bou-sprite-target" id="bouTargetSprite">📜</div>
      <div class="bou-sprite bou-sprite-player" id="bouPlayerSprite">🥷</div>
    </div>
    <p class="bou-tap-hint">画面を押している間、棒がのびます。離すと倒れます</p>
  `;
  canvas = shell.board.querySelector('#bouCanvas');
  playerSprite = shell.board.querySelector('#bouPlayerSprite');
  targetSprite = shell.board.querySelector('#bouTargetSprite');
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);
}

function showPlaceholder() {
  shell.board.className = 's-board';
  shell.board.innerHTML = `
    <div class="bou-start-screen">
      <div class="bou-rule-row">
        <div class="bou-rule-card">${RULE_SVG_HOLD}<div class="bou-rule-caption">長押し</div></div>
        <div class="bou-rule-card">${RULE_SVG_RELEASE}<div class="bou-rule-caption">はなす</div></div>
        <div class="bou-rule-card">${RULE_SVG_CROSS}<div class="bou-rule-caption">わたる</div></div>
      </div>
      <p class="bou-goal-line">🏁 <b>${GOAL_COUNT}</b></p>
    </div>
  `;
}

function updateProgress() {
  const el = shell.board.querySelector('#bouProgress');
  if (el) el.textContent = crossCount;
}

function resetState() {
  const startX1 = PLAYER_X + 20;
  standing = { x0: 0, x1: startX1 };
  charX = startX1;
  throwBaseX = charX;
  crossCount = 0;
  target = makeNextPlatform(charX);
  state = 'idle';
  stickLen = 0;
  score = 0;
  combo = 0;
  awaitingClear = false;
  shell.setScore(0);
  updateProgress();
}

/* ---------- 入力 ---------- */
function onDown(e) {
  if (!shell.running || state !== 'idle' || awaitingClear) return;
  e.preventDefault();
  state = 'growing';
  throwBaseX = charX;
  stickLen = 0;
  growStart = performance.now();
  shell.playTone(360, 0.04);
}
function onUp(e) {
  if (!shell.running || state !== 'growing') return;
  e.preventDefault();
  fallLen = stickLen;
  fallStart = performance.now();
  state = 'falling';
  shell.playTone(520, 0.05);
}
// キャンバス外で指を離した場合の保険（キャンバスの祖先でない要素で発火するとキャンバス側のリスナーが拾えないため）
window.addEventListener('pointerup', (e) => { if (state === 'growing') onUp(e); });

/* ---------- 判定・進行 ---------- */
function resolveFall() {
  const finalTipX = throwBaseX + fallLen;
  let outcome = 'success';
  if (finalTipX < target.x0) outcome = 'short';
  else if (finalTipX > target.x1) outcome = 'long';

  walkOutcome = outcome;
  walkFromX = throwBaseX;
  walkTargetX = finalTipX;
  walkDuration = Math.max(120, Math.abs(walkTargetX - walkFromX) / WALK_SPEED);
  walkStart = performance.now();
  state = 'walking';
}

function finishWalk() {
  if (walkOutcome === 'success') {
    const m = pickParams();
    const isPerfect = Math.abs(walkTargetX - target.target) <= m.perfectTol;
    target.hit = true;
    crossCount++;
    updateProgress();

    if (isPerfect) {
      combo++;
      score += 3;
      shell.setScore(score);
      shell.playTone(880, 0.12, 'triangle');
      showPopupAt(PLAYER_X, GROUND_Y - 60, combo >= 2 ? `📜ピッタリ!+3 🔥${combo}連続` : '📜ピッタリ!+3', 'bonus');
    } else {
      combo = 0;
      score += 1;
      shell.setScore(score);
      shell.playTone(680, 0.08);
      showPopupAt(PLAYER_X, GROUND_Y - 60, '+1', 'good');
    }

    standing = target;
    charX = walkTargetX;
    state = 'idle';

    if (crossCount >= GOAL_COUNT) {
      awaitingClear = true;
      setTimeout(() => triggerClear(), CLEAR_DELAY_MS);
      return;
    }

    target = makeNextPlatform(charX);
  } else {
    combo = 0;
    state = 'dropping';
    dropStart = performance.now();
    charDropY = GROUND_Y;
    shell.playTone(220, 0.25, 'sawtooth');
  }
}

function triggerGameOver() {
  cancelAnimationFrame(rafId);
  playerSprite.style.display = 'none';
  targetSprite.style.display = 'none';
  shell.end(`ゲームオーバー！${crossCount}個わたりました（スコア${score}）`);
}

function triggerClear() {
  cancelAnimationFrame(rafId);
  playerSprite.style.display = 'none';
  targetSprite.style.display = 'none';
  runConfetti(() => {
    shell.end(`🎉 ゴール！${GOAL_COUNT}個の足場をわたりきりました（スコア${score}）`);
  });
}

/* ---------- ゴール演出（紙吹雪） ---------- */
function runConfetti(onDone) {
  const particles = [];
  for (let i = 0; i < 24; i++) {
    particles.push({
      x: Math.random() * W,
      y: -20 - Math.random() * 200,
      vy: 90 + Math.random() * 70,
      vx: (Math.random() - 0.5) * 40,
      rot: Math.random() * Math.PI * 2,
      vrot: (Math.random() - 0.5) * 3,
      emoji: CONFETTI_EMOJIS[(Math.random() * CONFETTI_EMOJIS.length) | 0],
      size: 16 + Math.random() * 14,
    });
  }
  const startTs = performance.now();
  let last = startTs;
  function frame(ts) {
    const dt = Math.min((ts - last) / 1000, 0.032);
    last = ts;

    ctx.clearRect(0, 0, W, H);
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, '#fff0e0');
    grad.addColorStop(1, '#d9c2f0');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#6a5b8c';
    ctx.font = 'bold 22px sans-serif';
    ctx.fillText('🎉 ゴール！🎉', W / 2, 70);
    ctx.font = '52px sans-serif';
    ctx.fillText('🥷🦯', W / 2, H / 2);
    ctx.font = 'bold 15px sans-serif';
    ctx.fillStyle = '#4a3f5c';
    ctx.fillText(`${GOAL_COUNT}個わたりきりました！`, W / 2, H / 2 + 60);

    particles.forEach((p) => {
      p.y += p.vy * dt;
      p.x += p.vx * dt;
      p.rot += p.vrot * dt;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.font = `${p.size}px sans-serif`;
      ctx.fillText(p.emoji, 0, 0);
      ctx.restore();
    });

    if (ts - startTs < CONFETTI_DURATION_MS) {
      requestAnimationFrame(frame);
    } else {
      onDone();
    }
  }
  requestAnimationFrame(frame);
}

/* ---------- 描画ヘルパー ---------- */
function roundRectTop(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h);
  ctx.lineTo(x, y + h);
  ctx.closePath();
}

function drawSky() {
  const g = ctx.createLinearGradient(0, 0, 0, GROUND_Y);
  g.addColorStop(0, '#5f5f9e');
  g.addColorStop(1, '#98a8db');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, GROUND_Y);
}

function drawClouds(camX) {
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  for (let i = 0; i < 5; i++) {
    const span = 620;
    const raw = i * 130 - camX * 0.12;
    const x = ((raw % span) + span) % span - 60;
    const y = 36 + (i % 3) * 26;
    ctx.beginPath();
    ctx.ellipse(x, y, 24, 10, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawPlatform(p, camX) {
  const sx0 = p.x0 - camX, sx1 = p.x1 - camX;
  if (sx1 < -30 || sx0 > W + 30) return;
  const g = ctx.createLinearGradient(0, GROUND_Y, 0, H);
  g.addColorStop(0, '#6c4a68');
  g.addColorStop(1, '#3a2440');
  ctx.fillStyle = g;
  roundRectTop(sx0, GROUND_Y, sx1 - sx0, H - GROUND_Y, 8);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.16)';
  ctx.fillRect(sx0, GROUND_Y, sx1 - sx0, 4);
}

function drawTargetMarker(p, camX, now) {
  if (p.hit) { targetSprite.style.display = 'none'; return; }
  const sx = p.target - camX;
  if (sx < -20 || sx > W + 20) { targetSprite.style.display = 'none'; return; }
  const bob = Math.sin(now * 0.004) * 3;
  const sy = GROUND_Y - 16 + bob;

  const glow = ctx.createRadialGradient(sx, sy, 0, sx, sy, 16);
  glow.addColorStop(0, 'rgba(255,210,63,0.45)');
  glow.addColorStop(1, 'rgba(255,210,63,0)');
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(sx, sy, 16, 0, Math.PI * 2);
  ctx.fill();

  targetSprite.style.display = 'block';
  targetSprite.style.left = `${(sx / W) * 100}%`;
  targetSprite.style.top = `${(sy / H) * 100}%`;
}

function drawStick(camX) {
  ctx.strokeStyle = '#8a5a3c';
  ctx.lineWidth = 5;
  ctx.lineCap = 'round';
  if (state === 'growing') {
    const bx = throwBaseX - camX;
    ctx.beginPath();
    ctx.moveTo(bx, GROUND_Y);
    ctx.lineTo(bx, GROUND_Y - stickLen);
    ctx.stroke();
  } else if (state === 'falling') {
    const bx = throwBaseX - camX;
    ctx.beginPath();
    ctx.moveTo(bx, GROUND_Y);
    ctx.lineTo(fallTipX - camX, fallTipY);
    ctx.stroke();
  } else if (state === 'walking') {
    const bx = walkFromX - camX;
    ctx.beginPath();
    ctx.moveTo(bx, GROUND_Y);
    ctx.lineTo(walkTargetX - camX, GROUND_Y);
    ctx.stroke();
  }
}

function drawCharacter(camX, now) {
  let sx, sy, alpha = 1;
  if (state === 'dropping') {
    sx = walkTargetX - camX;
    sy = charDropY;
    alpha = Math.max(0, 1 - (charDropY - GROUND_Y) / 220);
  } else {
    sx = charX - camX;
    sy = GROUND_Y + (state === 'idle' ? Math.sin(now * 0.005) * 2 : 0);
  }
  playerSprite.style.left = `${(sx / W) * 100}%`;
  playerSprite.style.top = `${((sy + 4) / H) * 100}%`;
  playerSprite.style.opacity = alpha;
}

/* ---------- ポップアップ（Canvas座標にマーカーを重ねて表示） ---------- */
function showPopupAt(x, y, text, type) {
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

/* ---------- メインループ ---------- */
function loop(now) {
  if (!shell.running) return;

  if (state === 'growing') {
    const m = pickParams();
    stickLen = Math.min(MAX_LEN, (now - growStart) * m.growSpeed);
  } else if (state === 'falling') {
    const t = Math.min(1, (now - fallStart) / FALL_DURATION);
    const eased = 1 - Math.pow(1 - t, 2);
    fallAngle = (Math.PI / 2) * (1 - eased);
    fallTipX = throwBaseX + fallLen * Math.cos(fallAngle);
    fallTipY = GROUND_Y - fallLen * Math.sin(fallAngle);
    if (t >= 1) resolveFall();
  } else if (state === 'walking') {
    const t = Math.min(1, (now - walkStart) / walkDuration);
    charX = walkFromX + (walkTargetX - walkFromX) * t;
    if (t >= 1) finishWalk();
  } else if (state === 'dropping') {
    const t = (now - dropStart) / 500;
    charDropY = GROUND_Y + t * t * 300;
    if (t >= 1) { triggerGameOver(); return; }
  }

  const camX = charX - PLAYER_X;
  ctx.clearRect(0, 0, W, H);
  drawSky();
  drawClouds(camX);
  drawPlatform(standing, camX);
  drawPlatform(target, camX);
  drawTargetMarker(target, camX, now);
  drawStick(camX);
  drawCharacter(camX, now);

  rafId = requestAnimationFrame(loop);
}

showPlaceholder();

/* ---- GameShellのライフサイクルに接続 ---- */
shell.onStart(() => {
  buildBoard();
  resetState();
  cancelAnimationFrame(rafId);
  rafId = requestAnimationFrame(loop);
});
shell.onReset(() => {
  cancelAnimationFrame(rafId);
  state = 'idle';
  showPlaceholder();
});
shell.onHardModeChange(() => {
  // running中は呼ばれない（GameShell側で保証）。次回の一投から難易度パラメータに反映される。
});