/* =========================================================
   ブロックくずし🧱 固有ロジック
   共通土台(GameShell)のAPIだけを使い、盤面はCanvasに自前の物理で描画する。
   ステージクリア毎に段数・速度が上がり、ライフを落としきるまで続く。
   ========================================================= */

const shell = new GameShell({
  rootSelector: '#app',
  title: 'ブロックくずし🧱',
  hint: 'バーを指でなぞって動かし、「🚀 うちだす」でボールを発射（タイトル5回タップで激むず）',
  hasScore: true,
  hasTimer: false,
});

/* ---------- 固定パラメータ ---------- */
const W = 300, H = 420;
const COLS = 7;
const BRICK_MARGIN_TOP = 34, BRICK_GAP = 4, BRICK_H = 16, SIDE_MARGIN = 10;
const PADDLE_Y_OFFSET = 18, PADDLE_H = 12;
const BALL_R = 6;
const NORMAL_PADDLE_W = 76, HARD_PADDLE_W = 58;
const START_ROWS = 3, MAX_ROWS = 6;
const BASE_SPEED = 190, SPEED_STEP = 14, MAX_SPEED = 360;
const LIVES_START = 3;
const ROW_COLORS = ['#f0b8c6', '#f5d9a8', '#cbe8b0', '#b7dede', '#c3cdf0', '#dcc3ee'];

let canvas, ctx, boardEl, livesEl, launchBtn;
let paddle, ball, bricks;
let ballLaunched = false;
let stageClearing = false;
let stage = 1;
let lives = LIVES_START;
let ballSpeed = BASE_SPEED;
let rafId = null;
let lastTs = 0;
let dragging = false;

/* ---------- ステージ設定 ---------- */
function stageConfig(n) {
  const rows = Math.min(START_ROWS + (n - 1), MAX_ROWS);
  const speed = Math.min(BASE_SPEED + (n - 1) * SPEED_STEP, MAX_SPEED);
  return { rows, speed };
}

function buildStageBricks() {
  const cfg = stageConfig(stage);
  const brickW = (W - SIDE_MARGIN * 2 - (COLS - 1) * BRICK_GAP) / COLS;
  bricks = [];
  for (let r = 0; r < cfg.rows; r++) {
    for (let c = 0; c < COLS; c++) {
      bricks.push({
        x: SIDE_MARGIN + c * (brickW + BRICK_GAP),
        y: BRICK_MARGIN_TOP + r * (BRICK_H + BRICK_GAP),
        w: brickW, h: BRICK_H,
        color: ROW_COLORS[r % ROW_COLORS.length],
        points: (r + 1) * 10,
        alive: true,
      });
    }
  }
  ballSpeed = cfg.speed;
}

/* ---------- 盤面構築 ---------- */
function buildBoard() {
  const paddleW = shell.hardMode ? HARD_PADDLE_W : NORMAL_PADDLE_W;
  stage = 1;
  lives = LIVES_START;

  shell.board.className = 's-board block-board';
  shell.board.innerHTML = `
    <div class="block-toolbar">
      <span>ステージ <b id="blockStage">1</b></span>
      <span class="block-lives" id="blockLives"></span>
    </div>
    <div class="block-canvas-wrap"><canvas id="blockCanvas"></canvas></div>
    <div class="block-launch-row">
      <button class="s-btn block-launch-btn" id="blockLaunchBtn">🚀 うちだす</button>
    </div>
  `;
  boardEl = shell.board;
  canvas = shell.board.querySelector('#blockCanvas');
  canvas.width = W; canvas.height = H;
  ctx = canvas.getContext('2d');
  livesEl = shell.board.querySelector('#blockLives');
  launchBtn = shell.board.querySelector('#blockLaunchBtn');

  paddle = { x: (W - paddleW) / 2, y: H - PADDLE_Y_OFFSET - PADDLE_H, w: paddleW, h: PADDLE_H };
  buildStageBricks();
  resetBallOnPaddle();
  updateLivesDisplay();

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
  launchBtn.addEventListener('click', launchBall);
}

function showPlaceholder() {
  shell.board.className = 's-board block-board';
  shell.board.innerHTML = '<div class="block-placeholder">「スタート」を押すとブロックが並びます</div>';
}

/* ---------- 座標変換 ---------- */
function getCanvasX(evt) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  return (evt.clientX - rect.left) * scaleX;
}

/* ---------- 操作 ---------- */
function onPointerDown(evt) {
  if (!shell.running) return;
  dragging = true;
  movePaddleTo(getCanvasX(evt));
}
function onPointerMove(evt) {
  if (!dragging) return;
  movePaddleTo(getCanvasX(evt));
}
function onPointerUp() { dragging = false; }

function movePaddleTo(x) {
  paddle.x = Math.min(W - paddle.w, Math.max(0, x - paddle.w / 2));
  if (!ballLaunched) ball.x = paddle.x + paddle.w / 2;
}

function resetBallOnPaddle() {
  ball = {
    x: paddle.x + paddle.w / 2,
    y: paddle.y - BALL_R - 1,
    vx: 0, vy: 0,
  };
  ballLaunched = false;
  if (launchBtn) launchBtn.disabled = false;
}

function launchBall() {
  if (!shell.running || ballLaunched || stageClearing) return;
  const angle = (Math.random() * 80 - 40) * Math.PI / 180;
  ball.vx = ballSpeed * Math.sin(angle);
  ball.vy = -ballSpeed * Math.cos(angle);
  ballLaunched = true;
  launchBtn.disabled = true;
  shell.playTone(520, 0.08);
}

/* ---------- 描画 ---------- */
function updateLivesDisplay() {
  if (livesEl) livesEl.textContent = '❤️'.repeat(Math.max(lives, 0));
  const stageEl = shell.board.querySelector('#blockStage');
  if (stageEl) stageEl.textContent = stage;
}

function draw() {
  ctx.clearRect(0, 0, W, H);

  bricks.forEach((b) => {
    if (!b.alive) return;
    ctx.fillStyle = b.color;
    roundRect(b.x, b.y, b.w, b.h, 4);
  });

  ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--paddle-color') || '#6c7fd8';
  roundRect(paddle.x, paddle.y, paddle.w, paddle.h, 6);

  ctx.beginPath();
  ctx.arc(ball.x, ball.y, BALL_R, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = '#4a5bb0';
  ctx.stroke();
}

function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
  ctx.fill();
}

/* ---------- 得点ポップアップ（Canvas座標にマーカーを重ねて表示） ---------- */
function showScorePopup(x, y, text) {
  const marker = document.createElement('div');
  marker.style.position = 'absolute';
  marker.style.left = `${x}px`;
  marker.style.top = `${y}px`;
  marker.style.width = '0px';
  marker.style.height = '0px';
  shell.board.appendChild(marker);
  shell.showPopup(marker, text, 'good');
  setTimeout(() => marker.remove(), 750);
}

/* ---------- 衝突判定 ---------- */
function resolveBrickCollision(brick) {
  const overlapX = Math.min(ball.x + BALL_R - brick.x, brick.x + brick.w - (ball.x - BALL_R));
  const overlapY = Math.min(ball.y + BALL_R - brick.y, brick.y + brick.h - (ball.y - BALL_R));
  if (overlapX < overlapY) ball.vx = -ball.vx;
  else ball.vy = -ball.vy;
}

function checkStageClear() {
  if (bricks.some((b) => b.alive)) return;
  stageClearing = true;
  ballLaunched = false;
  [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => setTimeout(() => shell.playTone(f, 0.14, 'triangle'), i * 90));
  shell.toast(`ステージ${stage}クリア！`);
  stage++;
  setTimeout(() => {
    buildStageBricks();
    resetBallOnPaddle();
    updateLivesDisplay();
    stageClearing = false;
  }, 900);
}

function loseLife() {
  lives--;
  updateLivesDisplay();
  if (lives <= 0) {
    triggerGameOver();
  } else {
    shell.playTone(280, 0.2, 'sawtooth');
    resetBallOnPaddle();
  }
}

function triggerGameOver() {
  cancelAnimationFrame(rafId);
  shell.playTone(180, 0.3, 'sawtooth');
  shell.end(`ゲームオーバー…ステージ${stage} スコア: ${shell.getScore()}`);
}

/* ---------- メインループ ---------- */
function loop(ts) {
  if (!lastTs) lastTs = ts;
  const dt = Math.min((ts - lastTs) / 1000, 0.032);
  lastTs = ts;

  if (ballLaunched && !stageClearing) {
    ball.x += ball.vx * dt;
    ball.y += ball.vy * dt;

    if (ball.x - BALL_R < 0) { ball.x = BALL_R; ball.vx = -ball.vx; shell.playTone(420, 0.05); }
    if (ball.x + BALL_R > W) { ball.x = W - BALL_R; ball.vx = -ball.vx; shell.playTone(420, 0.05); }
    if (ball.y - BALL_R < 0) { ball.y = BALL_R; ball.vy = -ball.vy; shell.playTone(420, 0.05); }

    // パドル判定（上から落ちてくる時のみ）
    if (ball.vy > 0 &&
        ball.y + BALL_R >= paddle.y && ball.y - BALL_R <= paddle.y + paddle.h &&
        ball.x >= paddle.x && ball.x <= paddle.x + paddle.w) {
      const hit = (ball.x - (paddle.x + paddle.w / 2)) / (paddle.w / 2); // -1〜1
      const angle = hit * 60 * Math.PI / 180;
      ball.vx = ballSpeed * Math.sin(angle);
      ball.vy = -ballSpeed * Math.cos(angle);
      ball.y = paddle.y - BALL_R;
      shell.playTone(600, 0.07);
    }

    // ブロック判定
    for (const b of bricks) {
      if (!b.alive) continue;
      if (ball.x + BALL_R > b.x && ball.x - BALL_R < b.x + b.w &&
          ball.y + BALL_R > b.y && ball.y - BALL_R < b.y + b.h) {
        b.alive = false;
        resolveBrickCollision(b);
        shell.addScore(b.points);
        shell.playTone(700 + b.points * 4, 0.06);
        showScorePopup(b.x + b.w / 2, b.y, `+${b.points}`);
        break;
      }
    }

    if (ball.y - BALL_R > H) {
      loseLife();
    } else {
      checkStageClear();
    }
  }

  draw();
  if (shell.running) rafId = requestAnimationFrame(loop);
}

/* ---- GameShellのライフサイクルに接続 ---- */
shell.onStart(() => {
  buildBoard();
  lastTs = 0;
  cancelAnimationFrame(rafId);
  rafId = requestAnimationFrame(loop);
});

shell.onReset(() => {
  cancelAnimationFrame(rafId);
  showPlaceholder();
});

shell.onHardModeChange(() => {
  // running中は呼ばれない（GameShell側で保証）。次回スタート時のパドル幅に反映される。
});

showPlaceholder();
