/* =========================================================
   ハムスターのチーズ集め🧀 固有ロジック
   共通土台(GameShell)のAPIだけを使い、盤面はCanvasに自前の物理で描画する。
   🧀に触れたら即クリア（全消し不要）。ブロックは耐久1〜3。
   🐰を床でキャッチすると一定時間バーが伸びる。全50ステージ程度を想定した自動生成。
   ========================================================= */

const shell = new GameShell({
  rootSelector: '#app',
  title: 'ハムスターのチーズ集め🧀',
  hint: 'バーを動かしてハムスターを跳ね返そう。🧀に当たればクリア！（指操作／十字キー対応、タイトル5回タップで激むず）',
  hasScore: true,
  hasTimer: false,
});

/* ---------- 固定パラメータ ---------- */
const W = 300, H = 420;
const COLS = 7;
const BRICK_MARGIN_TOP = 34, BRICK_GAP = 4, BRICK_H = 18, SIDE_MARGIN = 10;
const PADDLE_Y_OFFSET = 18, PADDLE_H = 12;
const BALL_R = 10;
const NORMAL_PADDLE_W = 76, HARD_PADDLE_W = 58;
const LIVES_START = 3;
const LONGBAR_MULT = 1.5, LONGBAR_MS = 8000;
const PICKUP_DROP_CHANCE = 0.1, PICKUP_FALL_SPEED = 105, PICKUP_R = 11;
const KEY_PADDLE_SPEED = 260;
const HP_COLORS = { 1: '#f7d9c4', 2: '#e8a97a', 3: '#c97b4a' };
const FINAL_STAGE = 50;
const CONFETTI_EMOJIS = ['🎉', '✨', '🧀', '🐰', '⭐'];
const CONFETTI_DURATION_MS = 2600;

let canvas, ctx, livesEl, launchBtn, pauseBtn, stageEl;
let paddle, ball, bricks, pickups;
let ballLaunched = false;
let stageClearing = false;
let paused = false;
let stage = 1;
let lives = LIVES_START;
let ballSpeed = 190;
let rafId = null;
let confettiRafId = null;
let lastTs = 0;
let dragging = false;
let keyLeft = false, keyRight = false;

/* ---------- ステージ自動生成パラメータ ---------- */
function stageConfig(n) {
  const rows = Math.min(3 + Math.floor(n / 10), 7);
  const density = Math.min(0.55 + n * 0.006, 0.85);
  const speed = Math.min(180 + n * 3, 340);
  return { rows, density, speed };
}
function pickDurability(n) {
  if (n < 8) return 1;
  if (n < 20) return Math.random() < 0.3 ? 2 : 1;
  const r = Math.random();
  if (r < 0.45) return 1;
  if (r < 0.8) return 2;
  return 3;
}

function buildStageBricks() {
  const cfg = stageConfig(stage);
  const brickW = (W - SIDE_MARGIN * 2 - (COLS - 1) * BRICK_GAP) / COLS;
  const cells = [];
  for (let r = 0; r < cfg.rows; r++) for (let c = 0; c < COLS; c++) cells.push({ r, c });
  let filled = cells.filter(() => Math.random() < cfg.density);
  if (filled.length === 0) filled = [cells[(Math.random() * cells.length) | 0]];

  const cheeseCell = filled[(Math.random() * filled.length) | 0];

  bricks = filled.map(({ r, c }) => {
    const isCheese = r === cheeseCell.r && c === cheeseCell.c;
    const hp = isCheese ? 1 : pickDurability(stage);
    return {
      x: SIDE_MARGIN + c * (brickW + BRICK_GAP),
      y: BRICK_MARGIN_TOP + r * (BRICK_H + BRICK_GAP),
      w: brickW, h: BRICK_H,
      hp, maxHp: hp,
      isCheese,
      alive: true,
    };
  });
  ballSpeed = cfg.speed;
  pickups = [];
}

/* ---------- 盤面構築 ---------- */
function buildBoard() {
  const baseW = shell.hardMode ? HARD_PADDLE_W : NORMAL_PADDLE_W;
  stage = 1;
  lives = LIVES_START;

  shell.board.className = 's-board hamu-board';
  shell.board.innerHTML = `
    <div class="hamu-toolbar">
      <span>ステージ <b id="hamuStage">1</b></span>
      <span class="hamu-lives" id="hamuLives"></span>
      <button class="hamu-pause-btn" id="hamuPauseBtn">⏸ 一時停止</button>
    </div>
    <div class="hamu-board-wrap" id="hamuBoardWrap">
      <canvas id="hamuCanvas"></canvas>
      <div class="hamu-pause-label" id="hamuPauseLabel">⏸ 一時停止中<br><span class="hamu-pause-sub">タップで再開</span></div>
    </div>
    <div class="hamu-launch-row">
      <button class="s-btn hamu-launch-btn" id="hamuLaunchBtn">🐹 それ行け！</button>
    </div>
  `;
  canvas = shell.board.querySelector('#hamuCanvas');
  canvas.width = W; canvas.height = H;
  ctx = canvas.getContext('2d');
  livesEl = shell.board.querySelector('#hamuLives');
  stageEl = shell.board.querySelector('#hamuStage');
  launchBtn = shell.board.querySelector('#hamuLaunchBtn');
  pauseBtn = shell.board.querySelector('#hamuPauseBtn');
  paused = false;

  paddle = { cx: W / 2, y: H - PADDLE_Y_OFFSET - PADDLE_H, w: baseW, baseW, h: PADDLE_H, boostUntil: 0 };
  buildStageBricks();
  resetBallOnPaddle();
  updateToolbar();

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
  launchBtn.addEventListener('click', launchBall);
  pauseBtn.addEventListener('click', togglePause);
  shell.board.querySelector('#hamuBoardWrap').addEventListener('click', () => { if (paused) togglePause(); });
}

function showPlaceholder() {
  shell.board.className = 's-board hamu-board';
  shell.board.innerHTML = `
    <div class="hamu-placeholder">
      <p>🐹を床で跳ね返して、<b>🧀</b>にタッチすればステージクリアです。</p>
      <p>ブロックは1〜3回当てると壊れます。たまに<b>🐰</b>が降ってきたら床でキャッチ！しばらく床が伸びます。</p>
      <p>「スタート」を押すと始まります</p>
    </div>
  `;
}

/* ---------- 一時停止 ---------- */
function togglePause() {
  if (!shell.running) return;
  paused = !paused;
  const label = shell.board.querySelector('#hamuPauseLabel');
  if (paused) {
    canvas.classList.add('hamu-dimmed');
    if (label) label.style.display = 'block';
    if (pauseBtn) pauseBtn.textContent = '▶ 再開';
  } else {
    canvas.classList.remove('hamu-dimmed');
    if (label) label.style.display = 'none';
    if (pauseBtn) pauseBtn.textContent = '⏸ 一時停止';
    lastTs = 0;
  }
}

/* ---------- 座標変換・操作 ---------- */
function getCanvasX(evt) {
  const rect = canvas.getBoundingClientRect();
  return (evt.clientX - rect.left) * (canvas.width / rect.width);
}
function onPointerDown(evt) {
  if (!shell.running || paused) return;
  dragging = true;
  movePaddleTo(getCanvasX(evt));
}
function onPointerMove(evt) {
  if (!dragging) return;
  movePaddleTo(getCanvasX(evt));
}
function onPointerUp() { dragging = false; }

function movePaddleTo(x) {
  paddle.cx = Math.min(W - paddle.w / 2, Math.max(paddle.w / 2, x));
  if (!ballLaunched) ball.x = paddle.cx;
}

document.addEventListener('keydown', (e) => {
  if (!shell.running) return;
  if (e.key === 'ArrowLeft') { keyLeft = true; e.preventDefault(); }
  else if (e.key === 'ArrowRight') { keyRight = true; e.preventDefault(); }
  else if (e.key === 'ArrowUp' || e.key === ' ') { launchBall(); e.preventDefault(); }
});
document.addEventListener('keyup', (e) => {
  if (e.key === 'ArrowLeft') keyLeft = false;
  else if (e.key === 'ArrowRight') keyRight = false;
});

/* ---------- ボール ---------- */
function resetBallOnPaddle() {
  ball = { x: paddle.cx, y: paddle.y - BALL_R - 1, vx: 0, vy: 0 };
  ballLaunched = false;
  if (launchBtn) launchBtn.disabled = false;
}
function launchBall() {
  if (!shell.running || paused || ballLaunched || stageClearing) return;
  const angle = (Math.random() * 80 - 40) * Math.PI / 180;
  ball.vx = ballSpeed * Math.sin(angle);
  ball.vy = -ballSpeed * Math.cos(angle);
  ballLaunched = true;
  launchBtn.disabled = true;
  shell.playTone(520, 0.08);
}

/* ---------- 表示更新 ---------- */
function updateToolbar() {
  if (livesEl) livesEl.textContent = '❤️'.repeat(Math.max(lives, 0));
  if (stageEl) stageEl.textContent = stage;
}

/* ---------- 描画 ---------- */
function currentPaddleX() { return paddle.cx - paddle.w / 2; }

function draw() {
  ctx.clearRect(0, 0, W, H);

  bricks.forEach((b) => {
    if (!b.alive) return;
    if (b.isCheese) {
      ctx.font = `${b.h + 6}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('🧀', b.x + b.w / 2, b.y + b.h / 2 + 1);
      return;
    }
    ctx.fillStyle = HP_COLORS[b.hp] || HP_COLORS[1];
    roundRect(b.x, b.y, b.w, b.h, 4);
    if (b.maxHp > 1) {
      ctx.fillStyle = '#5c3d3a';
      ctx.font = 'bold 11px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(b.hp, b.x + b.w / 2, b.y + b.h / 2 + 1);
    }
  });

  pickups.forEach((p) => {
    ctx.font = `${PICKUP_R * 2}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('🐰', p.x, p.y);
  });

  ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--paddle-color') || '#8a5a3c';
  roundRect(currentPaddleX(), paddle.y, paddle.w, paddle.h, 6);

  ctx.font = `${BALL_R * 2.4}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('🐹', ball.x, ball.y);
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

/* ---------- ポップアップ（Canvas座標にマーカーを重ねて表示） ---------- */
function showPopupAt(x, y, text, type = 'good') {
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

/* ---------- 衝突判定 ---------- */
function resolveBounce(obj) {
  const overlapX = Math.min(ball.x + BALL_R - obj.x, obj.x + obj.w - (ball.x - BALL_R));
  const overlapY = Math.min(ball.y + BALL_R - obj.y, obj.y + obj.h - (ball.y - BALL_R));
  if (overlapX < overlapY) ball.vx = -ball.vx;
  else ball.vy = -ball.vy;
}

function spawnPickupMaybe(x, y) {
  if (Math.random() < PICKUP_DROP_CHANCE) {
    pickups.push({ x, y, vy: PICKUP_FALL_SPEED });
  }
}

function collectCheese(b) {
  const clearedStage = stage;
  stageClearing = true;
  ballLaunched = false;
  shell.addScore(50);
  showPopupAt(b.x + b.w / 2, b.y, '🧀 GET!', 'bonus');
  [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => setTimeout(() => shell.playTone(f, 0.14, 'triangle'), i * 90));

  if (clearedStage >= FINAL_STAGE) {
    setTimeout(() => triggerAllClear(clearedStage), 700);
    return;
  }

  shell.toast(`ステージ${clearedStage}クリア！`);
  stage++;
  setTimeout(() => {
    buildStageBricks();
    resetBallOnPaddle();
    updateToolbar();
    stageClearing = false;
  }, 900);
}

/* ---------- 全ステージ制覇演出 ---------- */
function triggerAllClear(finalStage) {
  cancelAnimationFrame(rafId);
  runConfetti(finalStage, () => {
    shell.end(`🎉 全${finalStage}ステージ制覇！お疲れ様でした🐹🧀 最終スコア: ${shell.getScore()}`);
  });
}

function runConfetti(finalStage, onDone) {
  const particles = [];
  for (let i = 0; i < 26; i++) {
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
    grad.addColorStop(1, '#ffd9c2');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#c9506b';
    ctx.font = 'bold 22px sans-serif';
    ctx.fillText('🎉 コンプリート！🎉', W / 2, 66);
    ctx.font = '52px sans-serif';
    ctx.fillText('🐹🧀', W / 2, H / 2);
    ctx.font = 'bold 15px sans-serif';
    ctx.fillStyle = '#8a5a3c';
    ctx.fillText(`全${finalStage}ステージ制覇！`, W / 2, H / 2 + 60);

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
      confettiRafId = requestAnimationFrame(frame);
    } else {
      onDone();
    }
  }
  confettiRafId = requestAnimationFrame(frame);
}

function loseLife() {
  showPopupAt(ball.x, H - 40, '🐹💦', 'bad');
  lives--;
  updateToolbar();
  if (lives <= 0) {
    triggerGameOver();
  } else {
    shell.playTone(280, 0.2, 'sawtooth');
    resetBallOnPaddle();
  }
}

function triggerGameOver() {
  cancelAnimationFrame(rafId);
  drawGameOverScreen();
  shell.playTone(220, 0.2, 'sawtooth');
  setTimeout(() => shell.playTone(160, 0.3, 'sawtooth'), 150);
  shell.end(`🐹💦 ゲームオーバー…ステージ${stage} スコア: ${shell.getScore()}`);
}

function drawGameOverScreen() {
  ctx.clearRect(0, 0, W, H);
  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, '#f3e6e6');
  grad.addColorStop(1, '#e6c6c6');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '64px sans-serif';
  ctx.fillText('🐹💦', W / 2, H / 2 - 26);
  ctx.font = 'bold 20px sans-serif';
  ctx.fillStyle = '#7a4a45';
  ctx.fillText('ゲームオーバー…', W / 2, H / 2 + 46);
  ctx.font = '14px sans-serif';
  ctx.fillText(`ステージ${stage}　スコア${shell.getScore()}`, W / 2, H / 2 + 74);
}

/* ---------- メインループ ---------- */
function loop(ts) {
  if (paused) { draw(); rafId = requestAnimationFrame(loop); return; }
  if (!lastTs) lastTs = ts;
  const dt = Math.min((ts - lastTs) / 1000, 0.032);
  lastTs = ts;

  // 床のブースト状態を反映（中心位置は保ったまま幅だけ変える）
  paddle.w = Date.now() < paddle.boostUntil ? paddle.baseW * LONGBAR_MULT : paddle.baseW;
  paddle.cx = Math.min(W - paddle.w / 2, Math.max(paddle.w / 2, paddle.cx));

  // 十字キーでの連続移動（ドラッグ中でなければ有効）
  if (!dragging) {
    if (keyLeft) movePaddleTo(paddle.cx - KEY_PADDLE_SPEED * dt);
    if (keyRight) movePaddleTo(paddle.cx + KEY_PADDLE_SPEED * dt);
  }

  // 🐰の落下・キャッチ判定
  pickups = pickups.filter((p) => {
    p.y += p.vy * dt;
    const px = currentPaddleX();
    if (p.y + PICKUP_R >= paddle.y && p.y - PICKUP_R <= paddle.y + paddle.h &&
        p.x >= px && p.x <= px + paddle.w) {
      paddle.boostUntil = Date.now() + LONGBAR_MS;
      showPopupAt(p.x, p.y, '🐰💕', 'bonus');
      shell.playTone(880, 0.1);
      setTimeout(() => shell.playTone(1100, 0.12), 90);
      return false;
    }
    return p.y - PICKUP_R < H;
  });

  if (ballLaunched && !stageClearing) {
    ball.x += ball.vx * dt;
    ball.y += ball.vy * dt;

    if (ball.x - BALL_R < 0) { ball.x = BALL_R; ball.vx = -ball.vx; shell.playTone(420, 0.05); }
    if (ball.x + BALL_R > W) { ball.x = W - BALL_R; ball.vx = -ball.vx; shell.playTone(420, 0.05); }
    if (ball.y - BALL_R < 0) { ball.y = BALL_R; ball.vy = -ball.vy; shell.playTone(420, 0.05); }

    const px = currentPaddleX();
    if (ball.vy > 0 &&
        ball.y + BALL_R >= paddle.y && ball.y - BALL_R <= paddle.y + paddle.h &&
        ball.x >= px && ball.x <= px + paddle.w) {
      const hit = (ball.x - paddle.cx) / (paddle.w / 2); // -1〜1
      const angle = hit * 60 * Math.PI / 180;
      ball.vx = ballSpeed * Math.sin(angle);
      ball.vy = -ballSpeed * Math.cos(angle);
      ball.y = paddle.y - BALL_R;
      shell.playTone(600, 0.07);
    }

    for (const b of bricks) {
      if (!b.alive) continue;
      if (ball.x + BALL_R > b.x && ball.x - BALL_R < b.x + b.w &&
          ball.y + BALL_R > b.y && ball.y - BALL_R < b.y + b.h) {
        if (b.isCheese) {
          collectCheese(b);
        } else {
          b.hp--;
          resolveBounce(b);
          shell.playTone(700 + b.hp * 40, 0.06);
          if (b.hp <= 0) {
            b.alive = false;
            const gained = b.maxHp * 10;
            shell.addScore(gained);
            showPopupAt(b.x + b.w / 2, b.y, `+${gained}`, 'good');
            spawnPickupMaybe(b.x + b.w / 2, b.y + b.h / 2);
          }
        }
        break;
      }
    }

    if (ball.y - BALL_R > H) loseLife();
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
  cancelAnimationFrame(confettiRafId);
  keyLeft = false; keyRight = false; dragging = false;
  showPlaceholder();
});

shell.onHardModeChange(() => {
  // running中は呼ばれない（GameShell側で保証）。次回スタート時のバー幅に反映される。
});

showPlaceholder();
