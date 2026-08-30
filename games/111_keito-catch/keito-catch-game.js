/* =========================================================
   けいとキャッチ🐈 固有ロジック（振り子ジャンプタッチ型）
   共通土台(GameShell)のAPIだけを使い、canvasゲームを実装。
   毛糸玉が糸でぶら下がり、弧を描いて左右に揺れ続ける。
   振り子が一番下（猫の真上）に来た瞬間にタップ＝猫がジャンプしてタッチ。
   目標クリア型：毛糸玉を規定数集めたら「クリア！」。
   ライフ制（ほうきの誤タップ×3で先にゲームオーバー）。
   ========================================================= */

const shell = new GameShell({
  rootSelector: '#app',
  title: 'けいとキャッチ🐈',
  hint: 'ジャンプして毛糸玉にタッチしましょう。ほうきに触れると🧡が減ります。毛糸玉15個でクリアです',
  hasScore: true,
  hasTimer: false,
});

const BOARD_W = 320;
const BOARD_H = 380;
const ANCHOR_X = BOARD_W / 2;
const ANCHOR_Y = 20;
const STRING_LEN = 145;          // 短くしてキャッチ位置を高く
const MAX_ANGLE = 1.15;          // 振り子の最大振れ角（ラジアン、約66°）
const EXTREME_RATIO = 0.92;      // この割合を超えたら「端」＝次の絵柄に切り替え

const LOWEST_Y = ANCHOR_Y + STRING_LEN;   // 振り子が一番下に来た時のy座標
const CAT_GAP = 70;
const CAT_REST_Y = LOWEST_Y + CAT_GAP;    // 猫の待機y座標（頭の位置）
const JUMP_HEIGHT = 76;
const JUMP_DURATION = 0.36;
const FLOOR_Y = CAT_REST_Y + 36;          // 壁面の開始位置
const WALL_BAND = 34;                     // 壁面の高さ（この下から木目フロア）
const WOOD_Y = FLOOR_Y + WALL_BAND;

const THETA_TOL_NORMAL = 0.34;   // 判定ウィンドウ（ラジアン）
const THETA_TOL_HARD = 0.18;
const END_DELAY = 650;           // 演出を見せてから終了するまでの待ち時間(ms)

const LIVES_START = 3;
const GOAL_YARN = 15;
const BASE_PERIOD = 2.5;         // 秒（1往復にかかる時間）
const MIN_PERIOD = 1.4;
const PERIOD_DECAY = 0.012;      // 経過時間に応じて徐々に速くなる

// 単独レア（片方ずつ出現）
const RARE_SOLO = ['🐕\u200d🦺', '🐩'];
// クマ→サルは必ず連続セットで出現（OPGKこだわり／単独出現なし）
const RARE_PAIR = ['🐻', '🐒'];

let canvas, ctx, livesEl, goalEl;
let thetaTol = THETA_TOL_NORMAL;
let phase = 0;
let elapsed = 0;
let currentType = null;
let pairQueue = [];
let atExtreme = false;
let passResolved = false;
let particles = [];
let jumpT = -1;          // ジャンプ演出の経過時間（負値なら非ジャンプ中）
let prevJumping = false;
let lastJumpHit = false;
let prevBallX = null;
let prevBallY = null;
let lives = LIVES_START;
let yarnCount = 0;
let loopId = null;
let lastTime = 0;
let gameEnding = false;
let floorClutter = [];

function setupDom() {
  shell.board.className = 's-board';
  shell.board.innerHTML =
    '<div class="keito-status">' +
    '<span class="keito-lives" id="keitoLives"></span>' +
    '<span class="keito-goal" id="keitoGoal"></span>' +
    '</div>' +
    '<canvas class="keito-canvas" id="keitoCanvas"></canvas>';
  livesEl = document.getElementById('keitoLives');
  goalEl = document.getElementById('keitoGoal');
  canvas = document.getElementById('keitoCanvas');
  ctx = canvas.getContext('2d');

  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  canvas.width = BOARD_W * dpr;
  canvas.height = BOARD_H * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  canvas.addEventListener('pointerdown', onTap);
}

function showPlaceholder() {
  shell.board.className = 's-board';
  shell.board.innerHTML =
    '<div class="keito-placeholder">' +
    '<p>🧶が一番下に来た瞬間にタップ！<br>ねこがジャンプしてタッチします</p>' +
    '<p>ほうき🧹はタップ厳禁、<br>毛糸玉🧶を15個集めたらクリアです</p>' +
    '<p>たまに現れるレアどうぶつはボーナス+5点♪</p>' +
    '</div>';
}

function updateLivesDisplay() {
  livesEl.textContent = '🧡'.repeat(lives) + '🤍'.repeat(LIVES_START - lives);
}
function updateGoalDisplay() {
  goalEl.textContent = `🧶 ${yarnCount} / ${GOAL_YARN}`;
}

function assignNextType() {
  if (pairQueue.length) {
    currentType = pairQueue.shift();
    return;
  }
  const r = Math.random();
  if (r < 0.62) {
    currentType = { type: 'yarn', emoji: '🧶' };
  } else if (r < 0.88) {
    currentType = { type: 'bomb', emoji: '🧹' };
  } else if (r < 0.94) {
    currentType = { type: 'rare', emoji: RARE_SOLO[(Math.random() * RARE_SOLO.length) | 0] };
  } else {
    // クマ→サルの順で連続出現（必ずセット）
    pairQueue.push({ type: 'rare', emoji: RARE_PAIR[1] });
    currentType = { type: 'rare', emoji: RARE_PAIR[0] };
  }
}

function spawnParticles(x, y) {
  const emojis = ['✨', '💕', '⭐'];
  for (let i = 0; i < 10; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 60 + Math.random() * 80;
    particles.push({
      kind: 'sparkle',
      x, y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life: 0.7,
      maxLife: 0.7,
      emoji: emojis[(Math.random() * emojis.length) | 0],
    });
  }
}

/* 空振り着地の「ボフッ」演出：角度を変えて煙を広めに数か所ぱっと出す */
function spawnPoof(x, y) {
  const angles = [-60, -35, -10, 15, 40, 65, 90];
  angles.forEach((deg) => {
    const rad = (deg * Math.PI) / 180;
    particles.push({
      kind: 'poof',
      x: x + Math.sin(rad) * 14,
      y: y + 4,
      vx: Math.sin(rad) * 46,
      vy: -Math.abs(Math.cos(rad)) * 18,
      angle: rad,
      life: 0.5,
      maxLife: 0.5,
      emoji: '💨',
    });
  });
}

function currentTheta() {
  return MAX_ANGLE * Math.sin(phase);
}
function ballPos() {
  const theta = currentTheta();
  return {
    x: ANCHOR_X + STRING_LEN * Math.sin(theta),
    y: ANCHOR_Y + STRING_LEN * Math.cos(theta),
    theta,
  };
}

/* 肉球マーカー描画（判定ゾーンの目印：淡いピンク＋黒フチ） */
function drawPaw(cx, cy, size, active) {
  ctx.fillStyle = active ? '#f2a9bb' : '#f8d6df';
  ctx.strokeStyle = '#2b2b2b';
  ctx.lineWidth = active ? 2.5 : 2;
  ctx.beginPath();
  ctx.ellipse(cx, cy + size * 0.18, size * 0.34, size * 0.28, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  const toes = [
    { dx: -0.42, dy: -0.30, r: 0.17 },
    { dx: -0.16, dy: -0.46, r: 0.19 },
    { dx: 0.16, dy: -0.46, r: 0.19 },
    { dx: 0.42, dy: -0.30, r: 0.17 },
  ];
  toes.forEach((t) => {
    ctx.beginPath();
    ctx.ellipse(cx + t.dx * size, cy + t.dy * size, t.r * size, t.r * size * 1.15, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  });
}

function onTap() {
  if (!shell.running || gameEnding) return;
  jumpT = 0;
  lastJumpHit = false;
  shell.playTone(440, 0.05, 'sine');

  if (!passResolved) {
    const theta = currentTheta();
    if (Math.abs(theta) <= thetaTol) {
      passResolved = true;
      lastJumpHit = true;
      handleCatch(currentType);
    }
  }
}

function handleCatch(obj) {
  const p = ballPos();
  if (obj.type === 'bomb') {
    lives--;
    updateLivesDisplay();
    shell.playTone(180, 0.18, 'square');
    if (lives <= 0) {
      loseGame();
    } else {
      shell.toast(`ほうきキャッチ…のこり${lives}回`);
    }
  } else if (obj.type === 'yarn') {
    yarnCount++;
    shell.addScore(1);
    shell.playTone(700, 0.07, 'sine');
    updateGoalDisplay();
    spawnParticles(p.x, p.y);
    if (yarnCount >= GOAL_YARN) {
      winGame();
    }
  } else {
    shell.addScore(5);
    shell.playTone(1046.5, 0.09, 'sine');
    setTimeout(() => shell.playTone(1396.9, 0.12, 'sine'), 90);
    spawnParticles(p.x, p.y);
    shell.toast('レアどうぶつゲット！+5 💕');
  }
}

function winGame() {
  gameEnding = true;
  spawnParticles(ANCHOR_X, CAT_REST_Y - 30);
  const notes = [523.25, 659.25, 783.99, 1046.5];
  notes.forEach((freq, i) => setTimeout(() => shell.playTone(freq, 0.16, 'triangle'), i * 100));
  setTimeout(() => shell.playTone(1318.51, 0.4, 'triangle'), notes.length * 100);
  // ジャンプ演出＆キラキラを見せてから終了する
  setTimeout(() => {
    cancelAnimationFrame(loopId);
    shell.end(`クリア！毛糸玉ぜんぶ集まったよ🎉 スコア：${shell.getScore()}`);
  }, END_DELAY);
}

function loseGame() {
  gameEnding = true;
  shell.playTone(320, 0.12, 'triangle');
  setTimeout(() => shell.playTone(220, 0.2, 'triangle'), 100);
  setTimeout(() => {
    cancelAnimationFrame(loopId);
    shell.end(`おしい！またチャレンジしましょう（毛糸玉${yarnCount}/${GOAL_YARN}・スコア：${shell.getScore()}）`);
  }, END_DELAY);
}

function update(dt) {
  elapsed += dt;
  const period = Math.max(MIN_PERIOD, BASE_PERIOD - elapsed * PERIOD_DECAY);
  phase += dt * (2 * Math.PI / period);

  const theta = currentTheta();
  const nowExtreme = Math.abs(theta) > MAX_ANGLE * EXTREME_RATIO;
  if (nowExtreme && !atExtreme) {
    assignNextType();
    passResolved = false;
  }
  atExtreme = nowExtreme;

  if (jumpT >= 0) {
    jumpT += dt;
    if (jumpT > JUMP_DURATION) jumpT = -1;
  }
  const isJumping = jumpT >= 0;
  if (prevJumping && !isJumping && !lastJumpHit) {
    spawnPoof(ANCHOR_X, CAT_REST_Y + 6); // 空振り着地の「ボフッ」
  }
  prevJumping = isJumping;

  particles.forEach((p) => {
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vy += 40 * dt;
    p.life -= dt;
  });
  particles = particles.filter((p) => p.life > 0);
}

function draw() {
  ctx.clearRect(0, 0, BOARD_W, BOARD_H);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // 壁面（奥行きを出す帯）＋腰壁ライン
  const wallGrad = ctx.createLinearGradient(0, FLOOR_Y, 0, WOOD_Y);
  wallGrad.addColorStop(0, '#f8ecd6');
  wallGrad.addColorStop(1, '#efdfc0');
  ctx.fillStyle = wallGrad;
  ctx.fillRect(0, FLOOR_Y, BOARD_W, WALL_BAND);
  ctx.strokeStyle = 'rgba(90,60,30,0.18)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, WOOD_Y);
  ctx.lineTo(BOARD_W, WOOD_Y);
  ctx.stroke();

  // 窓（振り子の背景、部屋の奥のイメージ）
  ctx.strokeStyle = 'rgba(90,60,30,0.4)';
  ctx.lineWidth = 1.5;
  ctx.fillStyle = 'rgba(190,215,228,0.4)';
  ctx.fillRect(24, 44, 50, 64);
  ctx.strokeRect(24, 44, 50, 64);
  ctx.beginPath();
  ctx.moveTo(49, 44); ctx.lineTo(49, 108);
  ctx.moveTo(24, 76); ctx.lineTo(74, 76);
  ctx.stroke();

  // 毛糸バスケット（静的な置物、床に置く）
  ctx.font = '27px sans-serif';
  ctx.fillText('🧺', BOARD_W - 32, WOOD_Y + 14);

  // 木目フロア
  const floorGrad = ctx.createLinearGradient(0, WOOD_Y, 0, BOARD_H);
  floorGrad.addColorStop(0, '#efe0c6');
  floorGrad.addColorStop(1, '#d9bf95');
  ctx.fillStyle = floorGrad;
  ctx.fillRect(0, WOOD_Y, BOARD_W, BOARD_H - WOOD_Y);
  ctx.strokeStyle = 'rgba(90,60,30,0.12)';
  ctx.lineWidth = 1;
  for (let px = 30; px < BOARD_W; px += 46) {
    ctx.beginPath();
    ctx.moveTo(px, WOOD_Y);
    ctx.lineTo(px, BOARD_H);
    ctx.stroke();
  }

  // ラグ（フリンジ付きの長方形マット。丸い同心円はやめて「敷物」らしい形に）
  const rugW = 176, rugH = 46;
  const rugX = ANCHOR_X - rugW / 2;
  const rugY = WOOD_Y + 16;
  ctx.fillStyle = '#d9884f';
  ctx.beginPath();
  ctx.roundRect(rugX, rugY, rugW, rugH, 12);
  ctx.fill();
  ctx.strokeStyle = 'rgba(120,60,20,0.4)';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.strokeStyle = 'rgba(120,60,20,0.22)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.roundRect(rugX + 10, rugY + 8, rugW - 20, rugH - 16, 7);
  ctx.stroke();

  // 床に転がった毛糸玉（数は控えめ、はっきり見えるサイズに）
  ctx.globalAlpha = 0.75;
  floorClutter.forEach((c) => {
    ctx.save();
    ctx.translate(c.x, c.y);
    ctx.rotate(c.rot);
    ctx.font = `${c.size}px sans-serif`;
    ctx.fillText('🧶', 0, 0);
    ctx.restore();
  });
  ctx.globalAlpha = 1;

  // ターゲットの肉球マーカー
  const theta = currentTheta();
  const inWindow = Math.abs(theta) <= thetaTol;
  drawPaw(ANCHOR_X, LOWEST_Y, inWindow ? 54 : 46, inWindow);

  // 吊り糸
  const ball = ballPos();
  ctx.strokeStyle = 'rgba(60,40,20,0.35)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(ANCHOR_X, ANCHOR_Y);
  ctx.lineTo(ball.x, ball.y);
  ctx.stroke();

  // 振り子のスピード線（速く動いている時だけ）
  if (prevBallX !== null) {
    const vx = ball.x - prevBallX;
    const vy = ball.y - prevBallY;
    const speedMag = Math.hypot(vx, vy);
    if (speedMag > 1.2) {
      const ux = vx / speedMag, uy = vy / speedMag;
      for (let i = 1; i <= 3; i++) {
        ctx.strokeStyle = `rgba(193,101,47,${0.28 - i * 0.07})`;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(ball.x - ux * (10 * i), ball.y - uy * (10 * i));
        ctx.lineTo(ball.x - ux * (10 * i + 7), ball.y - uy * (10 * i + 7));
        ctx.stroke();
      }
    }
  }
  prevBallX = ball.x;
  prevBallY = ball.y;

  // 揺れる対象（老眼対策で大きめ）
  if (currentType) {
    ctx.font = '36px sans-serif';
    ctx.fillText(currentType.emoji, ball.x, ball.y);
  }

  // 猫のジャンプ演出
  let jumpOffset = 0;
  if (jumpT >= 0) {
    const t = jumpT / JUMP_DURATION;
    jumpOffset = JUMP_HEIGHT * Math.sin(Math.PI * Math.min(1, t));
    // 踏み切り瞬間のスピード線
    if (jumpT < 0.07) {
      ctx.strokeStyle = 'rgba(0,0,0,0.25)';
      ctx.lineWidth = 2;
      [-1, 1].forEach((dir) => {
        ctx.beginPath();
        ctx.moveTo(ANCHOR_X + dir * 20, CAT_REST_Y + 14);
        ctx.lineTo(ANCHOR_X + dir * 32, CAT_REST_Y + 20);
        ctx.stroke();
      });
    }
  }
  ctx.font = '46px sans-serif';
  ctx.fillText('🐈', ANCHOR_X, CAT_REST_Y - jumpOffset);

  // パーティクル（キラキラ＝スパークル／ボフッ＝白い煙の絵文字のみ）
  particles.forEach((p) => {
    const a = Math.max(0, p.life / p.maxLife);
    ctx.globalAlpha = a;
    if (p.kind === 'poof') {
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.angle);
      ctx.font = '30px sans-serif';
      ctx.fillText(p.emoji, 0, 0);
      ctx.restore();
    } else {
      ctx.font = '22px sans-serif';
      ctx.fillText(p.emoji, p.x, p.y);
    }
  });
  ctx.globalAlpha = 1;
}

function loop(now) {
  if (!shell.running) return;
  const dt = lastTime ? Math.min(0.05, (now - lastTime) / 1000) : 0;
  lastTime = now;
  update(dt);
  draw();
  loopId = requestAnimationFrame(loop);
}

function initGame() {
  thetaTol = shell.hardMode ? THETA_TOL_HARD : THETA_TOL_NORMAL;
  phase = 0;
  elapsed = 0;
  pairQueue = [];
  atExtreme = false;
  passResolved = false;
  particles = [];
  jumpT = -1;
  prevJumping = false;
  lastJumpHit = false;
  prevBallX = null;
  prevBallY = null;
  lives = LIVES_START;
  yarnCount = 0;
  lastTime = 0;
  gameEnding = false;

  floorClutter = [];
  const clutterSides = [-1, 1, -1];
  clutterSides.forEach((side) => {
    floorClutter.push({
      x: ANCHOR_X + side * (108 + Math.random() * 34),
      y: WOOD_Y + 18 + Math.random() * 44,
      rot: ((Math.random() * 30 - 15) * Math.PI) / 180,
      size: 20 + Math.random() * 6,
    });
  });

  setupDom();
  updateLivesDisplay();
  updateGoalDisplay();
  assignNextType();
  loopId = requestAnimationFrame(loop);
}

showPlaceholder();

/* ---- GameShellのライフサイクルに接続 ---- */
shell.onStart(() => {
  initGame();
});
shell.onReset(() => {
  cancelAnimationFrame(loopId);
  showPlaceholder();
});
