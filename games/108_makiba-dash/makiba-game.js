/* =========================================================
   まきばダッシュ🐑 固有ロジック
   共通土台(GameShell)のAPIだけを使い、自動スクロール＋タップジャンプの
   横スクロールアクションを実装。

   操作：画面タップ or ジャンプボタンでリスならぬ🐑がジャンプ。
   左右移動は自動スクロールのみ（操作はジャンプの1点に絞り、
   本シリーズの「リフレックス要素を排したゆったり操作」に寄せている）。

   コース生成：ワールド座標（worldX）上に岩・水たまり（障害物）と
   クローバー（収集物）をランダム間隔で事前配置し、画面はプレイヤーを
   固定してワールド全体を左へスクロールさせる方式（プレイヤー自身は
   左右に動かない）。

   接触時：残機制。当たると1回無敵時間（約1秒・点滅）が入り、
   その間は再度減点されない。残機0でゲーム終了。
   ゴール：コース終端（goalWorldX）に到達したらクリア演出。

   描画：物理演算とオブジェクト数が多いためCanvasを使用。
   devicePixelRatio（上限3）でスケーリングし、当たり判定や描画は
   すべて論理サイズ（LOGICAL_W/H）基準で行う。
   ========================================================= */

const shell = new GameShell({
  rootSelector: '#app',
  title: 'まきばダッシュ🐑',
  hint: '障害物を飛び越えて🍀を集めながら、全5ステージのゴールを目指しましょう。',
  hasScore: true,
  hasTimer: false,
});

/* ---------- レイアウト（画面幅に応じて可変。値は computeLayout() で決定） ---------- */
let LOGICAL_W = 380;
let LOGICAL_H = 210;
let GROUND_Y = 164;
let PLAYER_X = 54;
const PLAYER_SIZE = 34;

const GRAVITY = 0.72;
const JUMP_V = -14;
const MAX_FALL = 15;
const INVINCIBLE_FRAMES = 60; // 約1秒（60fps想定）
const HIT_PAD_X = 6; // 障害物の当たり判定を左右で少し甘くする（着地際の誤判定防止）
const HIT_PAD_Y = 4; // 上下方向にも少し余裕を持たせる

const NORMAL_MODE = { scrollSpeed: 2.4, gapMin: 140, gapMax: 220, lives: 3, courseLength: 1300 };
const HARD_MODE   = { scrollSpeed: 3.4, gapMin: 100, gapMax: 160, lives: 2, courseLength: 1500 };
const STAGE_COUNT = 5;

let baseMode = NORMAL_MODE;
let currentStage = 0; // 0〜STAGE_COUNT-1
let stageParams = NORMAL_MODE;
let transitioning = false; // ステージ間の演出中はジャンプ・当たり判定を停止
let canvas = null, ctx = null;
let obstacles = [];
let clovers = [];
let goalWorldX = 0;
let distanceScrolled = 0;
let playerY = 0, velocityY = 0, onGround = true;
let lives = 0, maxLives = 0, invincibleFrames = 0;
let cleared = false, gameOver = false;
let rafId = null;
let runFrame = 0;
let collectedCount = 0;

/* ---------- ユーティリティ ---------- */
function rand(min, max) { return min + Math.random() * (max - min); }

/* ---------- 画面幅に合わせてキャンバスの論理サイズを決定 ---------- */
function computeLayout() {
  const availW = shell.board.clientWidth || 380;
  LOGICAL_W = Math.max(280, Math.min(400, availW));
  LOGICAL_H = Math.round(LOGICAL_W * 0.56);
  GROUND_Y = Math.round(LOGICAL_H * 0.78);
  PLAYER_X = Math.round(LOGICAL_W * 0.14);
}

/* ---------- コース生成（ワールド座標上に障害物・クローバーを事前配置） ---------- */
function generateCourse(mode) {
  const obs = [];
  const clo = [];
  let x = 320; // スタート直後は安全地帯
  while (x < mode.courseLength - 320) { // ゴール手前も広めに安全地帯を確保
    const gap = rand(mode.gapMin, mode.gapMax);
    x += gap;
    const type = Math.random() < 0.5 ? 'rock' : 'puddle';
    const width = type === 'rock' ? 28 : 44;
    const height = type === 'rock' ? 26 : 14;
    obs.push({ worldX: x, type, width, height, hit: false });
    if (Math.random() < 0.75) {
      const cloverX = x - gap * 0.5 + rand(-14, 14);
      clo.push({ worldX: cloverX, collected: false });
    }
  }
  return { obs, clo };
}

/* ---------- ステージごとの難易度パラメータ（徐々に厳しくする） ---------- */
function getStageParams(mode, stageIndex) {
  const t = stageIndex; // 0〜4
  return {
    scrollSpeed: mode.scrollSpeed * (1 + t * 0.1),
    gapMin: Math.max(85, mode.gapMin - t * 12),
    gapMax: Math.max(130, mode.gapMax - t * 14),
    courseLength: mode.courseLength + t * 120,
  };
}

/* ---------- ラウンド初期化（1プレイ＝5ステージ通し） ---------- */
function setupRound() {
  baseMode = shell.hardMode ? HARD_MODE : NORMAL_MODE;
  currentStage = 0;
  lives = baseMode.lives;
  maxLives = baseMode.lives;
  collectedCount = 0;
  cleared = false;
  gameOver = false;
  transitioning = false;
  setupStage(0);
}

/* ---------- ステージ初期化（残機・スコアは持ち越し、コースだけ作り直す） ---------- */
function setupStage(stageIndex) {
  stageParams = getStageParams(baseMode, stageIndex);
  const { obs, clo } = generateCourse(stageParams);
  obstacles = obs;
  clovers = clo;
  goalWorldX = stageParams.courseLength;
  distanceScrolled = 0;
  playerY = GROUND_Y - PLAYER_SIZE;
  velocityY = 0;
  onGround = true;
  invincibleFrames = 0;
  runFrame = 0;
  renderStageLabel();
  renderProgress();
}

/* ---------- Canvas準備（高DPI対応。以降の描画・当たり判定は論理サイズ基準） ---------- */
function setupCanvas() {
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  canvas.width = LOGICAL_W * dpr;
  canvas.height = LOGICAL_H * dpr;
  canvas.style.width = LOGICAL_W + 'px';
  canvas.style.height = LOGICAL_H + 'px';
  ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

/* ---------- DOM構築 ---------- */
function buildDom() {
  shell.board.className = 's-board mk-board';
  shell.board.innerHTML = `
    <div class="mk-toolbar">
      <span class="mk-lives" id="mkLives"></span>
      <span class="mk-stage" id="mkStage"></span>
      <span class="mk-progress-wrap"><span class="mk-progress-bar" id="mkProgress"></span></span>
    </div>
    <div class="mk-canvas-wrap" style="width:${LOGICAL_W}px;height:${LOGICAL_H}px;">
      <canvas id="mkCanvas"></canvas>
    </div>
    <div class="mk-jump-row">
      <button class="mk-jump-btn" id="mkJumpBtn">⬆ ジャンプ</button>
    </div>
    <p class="mk-tap-hint">画面タップ、またはジャンプボタンで🐑がジャンプします</p>
  `;
  canvas = shell.board.querySelector('#mkCanvas');
  setupCanvas();
  renderLives();
  renderStageLabel();
  renderProgress();

  canvas.addEventListener('pointerdown', (e) => { e.preventDefault(); tryJump(); });
  shell.board.querySelector('#mkJumpBtn').addEventListener('click', tryJump);

  startLoop();
}

function showPlaceholder() {
  shell.board.className = 's-board mk-board';
  shell.board.innerHTML = `
    <div class="mk-placeholder">
      <p>🐑をタップでジャンプさせて、障害物を飛び越えましょう。</p>
      <p>🍀クローバーを集めながら、全5ステージのゴールを目指します。</p>
      <p>ぶつかると<b>ライフ</b>が減ります。0になると終了です。</p>
      <p>「スタート」を押すとはじまります</p>
    </div>
  `;
}

/* ---------- 残機・進捗表示 ---------- */
function renderLives() {
  const el = shell.board.querySelector('#mkLives');
  if (!el) return;
  let html = '';
  for (let i = 0; i < maxLives; i++) {
    html += `<span class="${i < lives ? '' : 'mk-life-lost'}">❤️</span>`;
  }
  el.innerHTML = html;
}

function renderStageLabel() {
  const el = shell.board.querySelector('#mkStage');
  if (!el) return;
  el.textContent = `ステージ ${currentStage + 1}/${STAGE_COUNT}`;
}

function renderProgress() {
  const el = shell.board.querySelector('#mkProgress');
  if (!el) return;
  const pct = Math.min(100, (distanceScrolled / goalWorldX) * 100);
  el.style.width = pct + '%';
}

/* ---------- 操作 ---------- */
function tryJump() {
  if (!shell.running || cleared || gameOver || transitioning) return;
  if (onGround) {
    velocityY = JUMP_V;
    onGround = false;
    shell.playTone(700, 0.08, 'sine');
  }
}
document.addEventListener('keydown', (e) => {
  if (!shell.running) return;
  if (e.key === ' ' || e.key === 'ArrowUp') { tryJump(); e.preventDefault(); }
});

/* ---------- ワールド座標→画面座標 ---------- */
function screenXOf(worldX) { return PLAYER_X + (worldX - distanceScrolled); }

/* ---------- 被弾・収集・ゴール ---------- */
function loseLife() {
  lives--;
  renderLives();
  invincibleFrames = INVINCIBLE_FRAMES;
  // ペナルティ音：ノコギリ波を避け、triangle波の柔らかい2段トーン
  shell.playTone(392, 0.12, 'triangle');
  setTimeout(() => shell.playTone(311, 0.16, 'triangle'), 110);
  if (lives <= 0) {
    gameOver = true;
    cancelAnimationFrame(rafId);
    shell.toast('とまってしまいました…');
    shell.end(`🐑 ${collectedCount}個の🍀を集めました。またチャレンジしよう！`);
  }
}

function collectClover(clo) {
  clo.collected = true;
  collectedCount++;
  shell.addScore(1);
  shell.playTone(880, 0.09);
  setTimeout(() => shell.playTone(1174, 0.1), 70);
}

function playStageClearJingle() {
  // 中間ステージクリア音：短め・上昇2音（triangle波）
  [659.25, 880].forEach((f, i) =>
    setTimeout(() => shell.playTone(f, 0.13, 'triangle'), i * 90)
  );
}

function playFinalClearJingle() {
  // 全ステージクリア音：上昇アルペジオ（triangle波）
  [523.25, 659.25, 783.99, 1046.5, 1318.51].forEach((f, i) =>
    setTimeout(() => shell.playTone(f, 0.15, 'triangle'), i * 100)
  );
}

function stageComplete() {
  cancelAnimationFrame(rafId);
  transitioning = true;
  if (currentStage < STAGE_COUNT - 1) {
    // 中間ステージクリア：短い演出をはさんで次ステージへ自動的に進む
    playStageClearJingle();
    shell.toast(`ステージ${currentStage + 1}クリア！`);
    currentStage++;
    setTimeout(() => {
      setupStage(currentStage);
      transitioning = false;
      startLoop();
    }, 1300);
  } else {
    // 最終ステージクリア：ゲーム終了
    cleared = true;
    playFinalClearJingle();
    shell.end(`全5ステージクリア！🍀${collectedCount}個集めました🐑`);
  }
}

/* ---------- 物理・更新 ---------- */
function update() {
  runFrame++;
  distanceScrolled += stageParams.scrollSpeed;
  renderProgress();

  velocityY = Math.min(velocityY + GRAVITY, MAX_FALL);
  playerY += velocityY;
  const groundLevel = GROUND_Y - PLAYER_SIZE;
  if (playerY >= groundLevel) {
    playerY = groundLevel;
    velocityY = 0;
    onGround = true;
  }
  if (invincibleFrames > 0) invincibleFrames--;

  obstacles.forEach((ob) => {
    if (ob.hit) return;
    const sx = screenXOf(ob.worldX);
    if (sx + ob.width < PLAYER_X - 4) { ob.hit = true; return; } // 通過済み
    const overlapX = sx + HIT_PAD_X < PLAYER_X + PLAYER_SIZE - HIT_PAD_X && sx + ob.width - HIT_PAD_X > PLAYER_X + HIT_PAD_X;
    const overlapY = playerY + PLAYER_SIZE > GROUND_Y - ob.height + HIT_PAD_Y;
    if (overlapX && overlapY) {
      ob.hit = true;
      if (invincibleFrames <= 0) loseLife();
    }
  });

  clovers.forEach((clo) => {
    if (clo.collected) return;
    const sx = screenXOf(clo.worldX);
    if (sx + 12 < PLAYER_X - 4) { clo.collected = true; return; } // 通過済み
    if (sx < PLAYER_X + PLAYER_SIZE && sx + 18 > PLAYER_X) {
      collectClover(clo);
    }
  });

  if (!cleared && !gameOver && !transitioning && distanceScrolled >= goalWorldX) {
    stageComplete();
  }
}

/* ---------- 描画 ---------- */
function draw() {
  ctx.clearRect(0, 0, LOGICAL_W, LOGICAL_H);

  // 空
  const skyGrad = ctx.createLinearGradient(0, 0, 0, GROUND_Y);
  skyGrad.addColorStop(0, '#cdeaf0');
  skyGrad.addColorStop(1, '#eef8ee');
  ctx.fillStyle = skyGrad;
  ctx.fillRect(0, 0, LOGICAL_W, GROUND_Y);

  // 雲（ゆったり流れる背景演出）
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  for (let i = 0; i < 3; i++) {
    const span = LOGICAL_W + 120;
    const cx = (((i * 180 - distanceScrolled * 0.3) % span) + span) % span - 60;
    ctx.beginPath();
    ctx.ellipse(cx, 30 + i * 16, 24, 11, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // 地面
  ctx.fillStyle = '#cdeaa0';
  ctx.fillRect(0, GROUND_Y, LOGICAL_W, LOGICAL_H - GROUND_Y);
  ctx.fillStyle = '#a9cf7c';
  for (let i = 0; i < 14; i++) {
    const span = LOGICAL_W + 40;
    const gx = (((i * 40 - distanceScrolled) % span) + span) % span - 40;
    ctx.fillRect(gx, GROUND_Y, 20, 5);
  }

  // 障害物
  obstacles.forEach((ob) => {
    const sx = screenXOf(ob.worldX);
    if (sx < -60 || sx > LOGICAL_W + 20) return;
    if (ob.type === 'rock') {
      ctx.fillStyle = '#9a8f80';
      ctx.beginPath();
      ctx.moveTo(sx, GROUND_Y);
      ctx.lineTo(sx + 4, GROUND_Y - ob.height);
      ctx.lineTo(sx + ob.width - 4, GROUND_Y - ob.height);
      ctx.lineTo(sx + ob.width, GROUND_Y);
      ctx.closePath();
      ctx.fill();
    } else {
      ctx.fillStyle = '#7fb3d9';
      ctx.beginPath();
      ctx.ellipse(sx + ob.width / 2, GROUND_Y - ob.height / 2 + 4, ob.width / 2, ob.height / 2, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  });

  // クローバー・ゴール・プレイヤー（絵文字描画）
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  ctx.font = '18px sans-serif';
  clovers.forEach((clo) => {
    if (clo.collected) return;
    const sx = screenXOf(clo.worldX);
    if (sx < -20 || sx > LOGICAL_W + 20) return;
    ctx.fillText('🍀', sx, GROUND_Y - 14);
  });

  const goalSx = screenXOf(goalWorldX);
  if (goalSx < LOGICAL_W + 40) {
    // ゴール：仲間のひつじたちが群れて待っている演出（大きさ・位置をずらして群れ感を出す）
    const flock = [
      { dx: -16, dy: -2, size: 20 },
      { dx: 4, dy: -14, size: 25 },
      { dx: 20, dy: 0, size: 19 },
    ];
    flock.forEach((f) => {
      ctx.font = `${f.size}px sans-serif`;
      ctx.fillText('🐑', goalSx + f.dx, GROUND_Y - 14 + f.dy);
    });
  }

  const blinking = invincibleFrames > 0 && Math.floor(runFrame / 4) % 2 === 0;
  ctx.globalAlpha = blinking ? 0.35 : 1;
  const bob = onGround ? Math.sin(runFrame * 0.35) * 2 : 0;
  const playerCx = PLAYER_X + PLAYER_SIZE / 2;
  const playerCy = playerY + PLAYER_SIZE / 2 + bob;
  ctx.font = `${PLAYER_SIZE}px sans-serif`;
  ctx.save();
  ctx.translate(playerCx, playerCy);
  ctx.scale(-1, 1); // 🐑のデフォルト向きが進行方向と逆なので反転
  ctx.fillText('🐑', 0, 0);
  ctx.restore();
  ctx.globalAlpha = 1;
}

/* ---------- メインループ ---------- */
function loop() {
  if (!shell.running || cleared || gameOver || transitioning) return;
  update();
  draw();
  rafId = requestAnimationFrame(loop);
}
function startLoop() {
  cancelAnimationFrame(rafId);
  draw();
  rafId = requestAnimationFrame(loop);
}

showPlaceholder();

/* ---- GameShellのライフサイクルに接続 ---- */
shell.onStart(() => {
  computeLayout();
  setupRound();
  buildDom();
});
shell.onReset(() => {
  cancelAnimationFrame(rafId);
  showPlaceholder();
});
shell.onHardModeChange(() => {
  // running中は呼ばれない（GameShell側で保証）。次回スタート時のコースに反映される。
});
