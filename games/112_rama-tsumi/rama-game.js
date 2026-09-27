/* =========================================================
   ラマつみつみ🦙 固有ロジック（骨組み・要調整版）
   -----------------------------------------------------------
   ルール概要：
   - ブロックが左右交互（ランダム側）からせり出してくる。幅・高さはランダム
     （約22%の確率で「高背・細幅」パターンが混じる、見た目・積み上がり方の
     バリエーションのみで当たり判定には影響しない）。
   - タップで即ジャンプ（固定モーション）。ジャンプの頂点の高さは演出のみ。
   - 着地位置と直前タワー中心とのズレ（ブロック幅で正規化した相対値）を
     balanceへ加算。balanceは常時DECAYで自然減衰する。
   - |balance| が THRESHOLD を超えたら崩壊＝ゲームオーバー。
   - ブロックがまだ画面内に届いていない状態で着地判定が来た場合はペナルティ
     なしの空振り扱い（出現直後の早すぎるジャンプで即死しないように）。
   - 5段ごとにスターが出現。出現中はブロックのせり出しを一時停止し、
     スター単独をジャンプで取ると balance=0＋タワーを中心へ整列。
     取得後にせり出しを再開する。
   - ジャンプせず放置し、せり出しブロックがラマの位置まで来ると衝突で
     ゲームオーバー。
   - ブロックの配色は5段ごとにパレットを巡回（仮の配色。図柄は未実装）。
   - ゲームオーバー後は、ドラッグでタワーを上下に見返せる（土台〜頂上）。
   - 操作はcanvasタップと専用ジャンプボタンの両方に対応。

   ▼▼▼ 骨組み段階のため、以下は仮値・簡略実装。実プレイしながら要調整 ▼▼▼
   - NORMAL_MODE / HARD_MODE の数値、JUMP_DURATION/JUMP_HEIGHT
   - カメラスクロールの余白（VIEW_MARGIN）
   - 見た目の演出（スター取得後の整列アニメ、ラマのジャンプモーション、
     ブロックの図柄）は未実装。崩壊・衝突時のブロック散乱は実装済み（仮モーション）
   ========================================================= */

const shell = new GameShell({
  rootSelector: '#app',
  title: 'ラマつみつみ🦙',
  hint: 'タイミングよくタップしてジャンプし、せり出すブロックに飛び乗りましょう',
  hasScore: true,
  hasTimer: false,
});

const W = 300, H = 420;
const GROUND_Y = H - 40;
const VIEW_MARGIN = 140; // これを超えて積み上がったらカメラを上へスクロール
const BASE_BLOCK = { w: 96, h: 26 };
const STAR_INTERVAL = 10; // 5→10に変更、試験中（難易度感を見て要調整）
const HIT_MARGIN = 5; // px。この距離までブロックが迫ったら衝突扱い

/* ジャンプはタップで即発動する固定ジャンプ（チャージ式は撤回）。
   頂点の高さは見た目の演出のみで、当たり判定には関与しない */
const JUMP_DURATION = 0.75;
const JUMP_HEIGHT = 110;

/* 仮パラメータ。speed=初期せり出し速度(px/s)、speedStep=10段ごとの上昇量、
   maxSpeed=速度の上限、decay=balanceの毎秒減衰率、
   threshold=崩壊するbalanceの絶対値、minW/maxW/minH/maxH=ブロックサイズ範囲 */
const NORMAL_MODE = { speed: 85, speedStep: 14, maxSpeed: 175, decay: 0.55, threshold: 1.15, minW: 60, maxW: 118, minH: 20, maxH: 32 };
const HARD_MODE   = { speed: 125, speedStep: 16, maxSpeed: 220, decay: 0.42, threshold: 0.92, minW: 46, maxW: 100, minH: 18, maxH: 28 };
// ※decayは「1秒あたり何倍に減衰するか」。draw/loop内で dt 秒分を pow(decay, dt) として適用する。

function currentSpeed() {
  const tier = Math.floor(stage / 10);
  return Math.min(mode.speed + tier * mode.speedStep, mode.maxSpeed);
}

/* ブロックの配色（ペルー織物風）。5段ごとにパレットを巡回。
   テラコッタ・マスタード・ターコイズ・深紅・藍 */
const BLOCK_COLORS = ['#c14e3a', '#e0a52c', '#2a8c7c', '#8c3a5a', '#2a4a7a'];

let mode = NORMAL_MODE;
let canvas, ctx;
let towerBlocks = [];     // { x(中心), w, h, color }
let currentBlock = null;  // { x, w, h, dir, color }
let stage = 0;
let balance = 0;
let lamaX = W / 2;
let jumpState = 'idle';   // 'idle' | 'jump'
let jumpT = 0;
let starActive = false;
let starX = 0;
let gameOver = false;
let rafId = null;
let lastTs = 0;
let manualScrollOffset = 0; // ゲームオーバー時のみ使う手動スクロール量
let dragStartY = null;
let dragStartOffset = 0;

/* 崩壊演出（バランス崩壊・衝突の両方で共用） */
let collapsing = false; // 崩壊/衝突アニメーション中かどうか
let fallingBlocks = [];
let pendingEndMsg = '';
let collapseElapsed = 0;
const COLLAPSE_DURATION = 0.9; // 秒（仮）
const GRAVITY = 950; // px/s^2（仮）

function rand(min, max) { return min + Math.random() * (max - min); }
function topBlock() { return towerBlocks[towerBlocks.length - 1]; }
function stackHeight() { return towerBlocks.reduce((s, b) => s + b.h, 0); }
function colorForStage(s) { return BLOCK_COLORS[Math.floor(s / STAR_INTERVAL) % BLOCK_COLORS.length]; }

/* 背景の山のシルエット（アンデスの断崖イメージ、固定形状） */
function drawMountains() {
  ctx.fillStyle = 'rgba(60, 40, 90, 0.35)';
  ctx.beginPath();
  ctx.moveTo(0, H); ctx.lineTo(0, 150); ctx.lineTo(55, 205);
  ctx.lineTo(115, 120); ctx.lineTo(180, 215); ctx.lineTo(240, 135);
  ctx.lineTo(W, 195); ctx.lineTo(W, H); ctx.closePath();
  ctx.fill();

  ctx.fillStyle = 'rgba(90, 55, 100, 0.35)';
  ctx.beginPath();
  ctx.moveTo(0, H); ctx.lineTo(0, 230); ctx.lineTo(80, 265);
  ctx.lineTo(150, 205); ctx.lineTo(220, 265); ctx.lineTo(W, 225);
  ctx.lineTo(W, H); ctx.closePath();
  ctx.fill();
}

/* ブロック表面の織物風ジグザグ模様 */
function drawBlockPattern(x, y, w, h) {
  if (h < 14) return;
  ctx.strokeStyle = 'rgba(255,255,255,0.4)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  const midY = y + h / 2;
  const step = 12;
  let px = x - w / 2;
  ctx.moveTo(px, midY + 4);
  let up = true;
  while (px < x + w / 2) {
    px = Math.min(px + step, x + w / 2);
    ctx.lineTo(px, up ? midY - 4 : midY + 4);
    up = !up;
  }
  ctx.stroke();
}

/* 太陽モチーフ（インティ風。スターの代わり） */
function drawSun(x, y, r) {
  ctx.save();
  ctx.translate(x, y);
  ctx.strokeStyle = '#e8a92c';
  ctx.lineWidth = 3;
  for (let i = 0; i < 8; i++) {
    const angle = (i / 8) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(Math.cos(angle) * r * 0.55, Math.sin(angle) * r * 0.55);
    ctx.lineTo(Math.cos(angle) * r, Math.sin(angle) * r);
    ctx.stroke();
  }
  ctx.fillStyle = '#e8a92c';
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function spawnBlock() {
  const side = Math.random() < 0.5 ? 'left' : 'right';
  let w, h;
  if (Math.random() < 0.22) {
    // 高背・細幅パターン（長押しの高いジャンプで対応する想定）
    w = rand(mode.minW, mode.maxW) * 0.5;
    h = rand(mode.minH, mode.maxH) * 2;
  } else {
    w = rand(mode.minW, mode.maxW);
    h = rand(mode.minH, mode.maxH);
  }
  const startX = side === 'left' ? -w : W + w;
  currentBlock = { x: startX, w, h, dir: side === 'left' ? 1 : -1, color: colorForStage(stage) };
}

/* ---------- 進行 ---------- */
function buildBoard() {
  mode = shell.hardMode ? HARD_MODE : NORMAL_MODE;
  towerBlocks = [{ x: W / 2, w: BASE_BLOCK.w, h: BASE_BLOCK.h, color: BLOCK_COLORS[0] }];
  stage = 0;
  balance = 0;
  lamaX = W / 2;
  jumpState = 'idle';
  starActive = false;
  gameOver = false;
  collapsing = false;
  manualScrollOffset = 0;
  dragStartY = null;
  shell.setScore(0);

  shell.board.className = 's-board rama-board-wrap';
  shell.board.innerHTML = `
    <canvas id="ramaCanvas"></canvas>
    <button type="button" class="rama-jump-btn" id="ramaJumpBtn">🦙 ジャンプ</button>
  `;
  canvas = shell.board.querySelector('#ramaCanvas');
  const jumpBtn = shell.board.querySelector('#ramaJumpBtn');
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  canvas.addEventListener('pointerdown', onCanvasPointerDown);
  canvas.addEventListener('pointermove', onCanvasPointerMove);
  canvas.addEventListener('pointerup', onCanvasPointerUp);
  canvas.addEventListener('pointercancel', onCanvasPointerUp);
  jumpBtn.addEventListener('pointerdown', (e) => { e.preventDefault(); onTap(); });

  spawnBlock();
  lastTs = 0;
  cancelAnimationFrame(rafId);
  rafId = requestAnimationFrame(loop);
  draw();
}

function showPlaceholder() {
  shell.board.className = 's-board rama-board-wrap';
  shell.board.innerHTML = `
    <div class="rama-placeholder">
      <p>タイミングよくジャンプしてブロックに飛び乗りましょう🦙</p>
      <p>☀️を取るとブロックが安定化します。</p>
      <p>「スタート」を押すとはじまります</p>
    </div>
  `;
}

/* ---------- 操作 ---------- */
function onTap() {
  if (!shell.running || gameOver || collapsing || jumpState !== 'idle') return;
  jumpState = 'jump';
  jumpT = 0;
  shell.playTone(520, 0.06);
}

/* ゲームオーバー時のみ：ドラッグでタワーを見返せるようにする */
function onCanvasPointerDown(e) {
  if (gameOver) {
    dragStartY = e.clientY;
    dragStartOffset = manualScrollOffset;
    return;
  }
  onTap();
}
function onCanvasPointerMove(e) {
  if (!gameOver || dragStartY === null) return;
  const dy = e.clientY - dragStartY;
  const maxOffset = Math.max(0, stackHeight() - VIEW_MARGIN);
  // 下にドラッグ(dy>0)するほど土台側が見える方向。逆に感じる場合は符号を反転する
  manualScrollOffset = Math.min(maxOffset, Math.max(0, dragStartOffset - dy));
  draw();
}
function onCanvasPointerUp() {
  dragStartY = null;
}

function landBlock() {
  const prev = topBlock();
  const half = currentBlock.w / 2;
  // ズレ量：新ブロック中心と直前タワー中心の差を、新ブロック幅で正規化（相対値）
  const offsetRatio = (currentBlock.x - prev.x) / half;

  // ズレが大きすぎる＝まだ全然届いていない場合はペナルティなしの空振り扱い
  // （ブロック幅に依存しない一律の判定。出現直後の早すぎるジャンプ対策）
  const MISS_RATIO = 1.6; // 仮値。要調整
  if (Math.abs(offsetRatio) > MISS_RATIO) {
    jumpState = 'idle';
    shell.toast('まだ届いてない…もう一度！');
    return;
  }

  balance += offsetRatio;

  towerBlocks.push({ x: currentBlock.x, w: currentBlock.w, h: currentBlock.h, color: currentBlock.color });
  stage++;
  shell.setScore(stage);
  jumpState = 'idle';
  shell.playTone(640, 0.06);

  if (Math.abs(balance) > mode.threshold) {
    triggerCollapse();
    return;
  }

  if (stage % STAR_INTERVAL === 0) {
    starActive = true;
    starX = topBlock().x;
  } else {
    spawnBlock();
  }
}

function onStarCatch() {
  starActive = false;
  balance = 0;
  // TODO: 現状は即時に中心へ揃うだけ。ふわっと動く整列アニメーションを追加したい
  towerBlocks.forEach((b) => { b.x = W / 2; });
  shell.playTone(1046.5, 0.08, 'triangle');
  setTimeout(() => shell.playTone(1568, 0.14, 'triangle'), 80); // ピロリン♪
  shell.toast('スターゲット！安定しました✨');
  jumpState = 'idle';
  spawnBlock(); // 一時停止していた分、ここで次のブロックを出す
}

function triggerCollapse() {
  // balanceの符号方向へ崩れる（0の場合はランダム）
  const dir = balance !== 0 ? Math.sign(balance) : (Math.random() < 0.5 ? -1 : 1);
  startCollapse(`くずれた…！${stage}段まで積みました`, dir);
}

function triggerHit() {
  // ぶつかってきた側と逆方向（弾かれる向き）へ崩れる
  const dir = currentBlock ? Math.sign(lamaX - currentBlock.x) || 1 : 1;
  startCollapse(`ぶつかった…！${stage}段まで積みました`, dir);
}

/* ---------- 崩壊演出 ---------- */
function startCollapse(msg, dir) {
  collapsing = true;
  cancelAnimationFrame(rafId);
  shell.playTone(200, 0.3, 'sawtooth');
  pendingEndMsg = msg;
  collapseElapsed = 0;

  const totalH = stackHeight();
  const viewOffset = Math.max(0, totalH - VIEW_MARGIN);
  let cum = 0;
  fallingBlocks = towerBlocks.map((b, i) => {
    const y = GROUND_Y - cum - b.h + viewOffset;
    cum += b.h;
    return {
      x: b.x, y, w: b.w, h: b.h, color: b.color,
      vx: dir * (30 + i * 14 + Math.random() * 30), // 上の段ほど大きく飛ぶ
      vy: -(100 + Math.random() * 60),
      rot: 0,
      vRot: dir * (1.5 + Math.random() * 2),
    };
  });

  lastTs = 0;
  rafId = requestAnimationFrame(collapseLoop);
}

function collapseLoop(ts) {
  const dt = lastTs ? Math.min((ts - lastTs) / 1000, 0.05) : 0;
  lastTs = ts;
  collapseElapsed += dt;

  fallingBlocks.forEach((b) => {
    b.vy += GRAVITY * dt;
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    b.rot += b.vRot * dt;
  });

  ctx.clearRect(0, 0, W, H);
  drawMountains();
  fallingBlocks.forEach((b) => {
    ctx.save();
    ctx.translate(b.x, b.y + b.h / 2);
    ctx.rotate(b.rot);
    ctx.fillStyle = b.color;
    ctx.fillRect(-b.w / 2, -b.h / 2, b.w, b.h);
    ctx.restore();
  });

  // ラマも一緒に吹き飛ぶ演出（簡易。モーションは仮）
  const t = Math.min(1, collapseElapsed / COLLAPSE_DURATION);
  const dir = fallingBlocks[0] ? Math.sign(fallingBlocks[0].vx) || 1 : 1;
  ctx.font = '51px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.fillText('🦙', lamaX + dir * t * 90, GROUND_Y - t * 60 + t * t * 260);

  if (collapseElapsed < COLLAPSE_DURATION) {
    rafId = requestAnimationFrame(collapseLoop);
  } else {
    collapsing = false;
    gameOver = true;
    manualScrollOffset = Math.max(0, stackHeight() - VIEW_MARGIN);
    shell.end(pendingEndMsg);
    // ここでdraw()は呼ばない＝崩壊の最終フレームのまま静止させる。
    // ドラッグ操作(onCanvasPointerMove)が発生した時点で初めて通常表示に切り替わる。
  }
}

/* ---------- メインループ ---------- */
function loop(ts) {
  if (!shell.running || gameOver || collapsing) return;
  const dt = lastTs ? Math.min((ts - lastTs) / 1000, 0.05) : 0;
  lastTs = ts;

  // balanceは常時、待機中も含めて減衰させる
  balance *= Math.pow(mode.decay, dt);

  if (!starActive && currentBlock) {
    const prevX = currentBlock.x;
    currentBlock.x += currentBlock.dir * currentSpeed() * dt;

    // 高速移動時、1フレームでラマの位置を飛び越えて衝突判定をすり抜けないように
    // 「移動前後でラマの位置を跨いだか」でも判定する
    if (jumpState === 'idle') {
      const crossed = (prevX - lamaX) * (currentBlock.x - lamaX) <= 0;
      if (crossed || Math.abs(currentBlock.x - lamaX) < HIT_MARGIN) {
        triggerHit();
        return;
      }
    }

    // 画面外まで行ったら跳ね返って戻ってくる（乗るか崩れるまで往復させる）
    const bounceMargin = currentBlock.w * 1.2;
    if (currentBlock.x < -bounceMargin || currentBlock.x > W + bounceMargin) {
      currentBlock.dir *= -1;
    }
  }

  if (jumpState === 'jump') {
    jumpT += dt;
    const t = Math.min(1, jumpT / JUMP_DURATION);
    if (t >= 1) {
      if (starActive) onStarCatch();
      else landBlock();
    }
  }

  // landBlock()内でtriggerCollapse()が呼ばれ、collapseLoopに切り替わった場合は
  // ここで抜ける（そうしないと次の行でrafIdが通常loopに上書きされてしまう）
  if (collapsing) return;

  draw();
  rafId = requestAnimationFrame(loop);
}

/* ---------- 描画（簡略。装飾は未実装） ---------- */
function draw() {
  ctx.clearRect(0, 0, W, H);
  drawMountains();

  const totalH = stackHeight();
  const viewOffset = gameOver ? manualScrollOffset : Math.max(0, totalH - VIEW_MARGIN);

  let cum = 0;
  const blockYs = towerBlocks.map((b) => {
    const y = GROUND_Y - cum - b.h + viewOffset;
    cum += b.h;
    return y;
  });

  towerBlocks.forEach((b, i) => {
    ctx.fillStyle = b.color;
    ctx.fillRect(b.x - b.w / 2, blockYs[i], b.w, b.h);
    drawBlockPattern(b.x, blockYs[i], b.w, b.h);
  });

  const nextY = GROUND_Y - cum - (currentBlock ? currentBlock.h : BASE_BLOCK.h) + viewOffset;

  if (currentBlock && !starActive) {
    ctx.fillStyle = currentBlock.color;
    ctx.fillRect(currentBlock.x - currentBlock.w / 2, nextY, currentBlock.w, currentBlock.h);
    drawBlockPattern(currentBlock.x, nextY, currentBlock.w, currentBlock.h);
  }

  if (starActive) {
    // タワー最上段基準の固定位置に表示（せり出しブロックの高さに引きずられない）
    const starY = GROUND_Y - cum + viewOffset - 92;
    drawSun(starX, starY, 16);
  }

  const lamaBaseY = GROUND_Y - cum + viewOffset;
  const jumpArc = jumpState === 'jump' ? Math.sin(Math.min(1, jumpT / JUMP_DURATION) * Math.PI) * JUMP_HEIGHT : 0;
  ctx.font = '51px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.fillText('🦙', lamaX, lamaBaseY - jumpArc);
}

/* ---- GameShellのライフサイクルに接続 ---- */
shell.onStart(() => {
  buildBoard();
});
shell.onReset(() => {
  cancelAnimationFrame(rafId);
  showPlaceholder();
});
shell.onHardModeChange(() => {
  // running中は呼ばれない（GameShell側で保証）。次回スタート時のmodeに反映される。
});

showPlaceholder();
