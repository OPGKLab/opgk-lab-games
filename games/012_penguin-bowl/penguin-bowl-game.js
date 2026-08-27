/* =========================================================
   ペンギンボウル🎳 固有ロジック
   共通土台(GameShell)のAPIだけを使用。
   ボール＝ペンギン、ピン＝こおりブロック🧊。
   専用ボタンで①方向→②力の2ステップを決定し発射する。
   10本ピン（4-3-2-1）を近接判定＋巻き込みで倒す。
   1ラウンド＝最大2投（ストライクなら1投で終了、それ以外は
   残ったピンを2投目でねらう。本家ボウリング準拠のシンプル版）。
   ========================================================= */

const shell = new GameShell({
  rootSelector: '#app',
  title: 'ペンギンボウル🎳',
  hint: 'ボタンで方向と力を決め、こおりピンをねらいましょう',
  hasScore: true,
  hasTimer: false,
});

// 論理座標系（幅300×高さ420）
const LANE_W = 300;
const LANE_H = 420;
const BALL_START = { x: 150, y: 390 };
const GUTTER_MARGIN_NORMAL = 28;
const GUTTER_MARGIN_HARD = 38;
const PIN_RADIUS_NORMAL = 20;
const PIN_RADIUS_HARD = 15;
const CHAIN_RADIUS_NORMAL = 24;
const CHAIN_RADIUS_HARD = 18;
const CHAIN_CHANCE_NORMAL = 0.5;
const CHAIN_CHANCE_HARD = 0.3;
const ZOOM_TRIGGER_Y = 230;

let pins = [];
let phase = 'idle'; // idle | aim | power | rolling | done
let hard = false;
let gutterMargin = GUTTER_MARGIN_NORMAL;
let pinRadius = PIN_RADIUS_NORMAL;
let chainRadius = CHAIN_RADIUS_NORMAL;
let chainChance = CHAIN_CHANCE_NORMAL;

let laneInnerEl, ballEl, aimArrowEl, phaseMsgEl, gaugeWrapEl, gaugeFillEl, actionBtnEl;
let rafId = null;
let aimAngleDeg = 0;
let lockedAngleDeg = 0;
let lockedPower = 0;

let throwNum = 1;
let knockedBeforeThrow = 0;

function pinLayout() {
  // 4-3-2-1 三角配置（頂点＝1番ピンがプレイヤー側手前）
  const rows = [
    { y: 150, xs: [150] },
    { y: 122, xs: [135, 165] },
    { y: 94, xs: [120, 150, 180] },
    { y: 66, xs: [105, 135, 165, 195] },
  ];
  const list = [];
  let id = 0;
  rows.forEach((row) => {
    row.xs.forEach((x) => {
      list.push({ id: id++, x, y: row.y, down: false, el: null });
    });
  });
  return list;
}

function buildLane() {
  hard = !!shell.hardMode;
  gutterMargin = hard ? GUTTER_MARGIN_HARD : GUTTER_MARGIN_NORMAL;
  pinRadius = hard ? PIN_RADIUS_HARD : PIN_RADIUS_NORMAL;
  chainRadius = hard ? CHAIN_RADIUS_HARD : CHAIN_RADIUS_NORMAL;
  chainChance = hard ? CHAIN_CHANCE_HARD : CHAIN_CHANCE_NORMAL;
  pins = pinLayout();
  phase = 'idle';
  throwNum = 1;
  knockedBeforeThrow = 0;

  shell.board.className = 's-board';
  shell.board.innerHTML = '';

  const wrap = document.createElement('div');
  wrap.className = 'bowl-wrap';

  phaseMsgEl = document.createElement('div');
  phaseMsgEl.className = 'bowl-phase-msg';
  wrap.appendChild(phaseMsgEl);

  const viewport = document.createElement('div');
  viewport.className = 'lane-viewport';

  laneInnerEl = document.createElement('div');
  laneInnerEl.className = 'lane-inner';

  const surface = document.createElement('div');
  surface.className = 'lane-surface';
  laneInnerEl.appendChild(surface);

  pins.forEach((p) => {
    const el = document.createElement('div');
    el.className = 'pin';
    el.textContent = '🧊';
    setPos(el, p.x, p.y);
    p.el = el;
    laneInnerEl.appendChild(el);
  });

  aimArrowEl = document.createElement('div');
  aimArrowEl.className = 'aim-arrow';
  aimArrowEl.style.left = pctX(BALL_START.x) + '%';
  aimArrowEl.style.bottom = (100 - pctY(BALL_START.y)) + '%';
  laneInnerEl.appendChild(aimArrowEl);

  ballEl = document.createElement('div');
  ballEl.className = 'ball';
  ballEl.textContent = '🐧';
  setPos(ballEl, BALL_START.x, BALL_START.y);
  laneInnerEl.appendChild(ballEl);

  viewport.appendChild(laneInnerEl);
  wrap.appendChild(viewport);

  gaugeWrapEl = document.createElement('div');
  gaugeWrapEl.className = 'power-gauge';
  gaugeFillEl = document.createElement('div');
  gaugeFillEl.className = 'power-gauge-fill';
  gaugeWrapEl.appendChild(gaugeFillEl);
  wrap.appendChild(gaugeWrapEl);

  actionBtnEl = document.createElement('button');
  actionBtnEl.className = 'bowl-action-btn';
  actionBtnEl.addEventListener('click', onActionTap);
  wrap.appendChild(actionBtnEl);

  shell.board.appendChild(wrap);

  startAimPhase();
}

function pctX(x) { return (x / LANE_W) * 100; }
function pctY(y) { return (y / LANE_H) * 100; }
function setPos(el, x, y) {
  el.style.left = pctX(x) + '%';
  el.style.top = pctY(y) + '%';
}

function startAimPhase() {
  phase = 'aim';
  phaseMsgEl.textContent = throwNum === 1 ? '1投目：方向を決めましょう' : '2投目：残りをねらいましょう';
  actionBtnEl.textContent = '① 方向を決める';
  actionBtnEl.style.display = 'block';
  gaugeWrapEl.classList.remove('visible');
  const period = hard ? 1400 : 2000;
  const maxAngle = 38;
  const t0 = performance.now();
  function loop(t) {
    if (phase !== 'aim') return;
    const elapsed = t - t0;
    aimAngleDeg = Math.sin((elapsed / period) * Math.PI * 2) * maxAngle;
    aimArrowEl.style.transform = `rotate(${aimAngleDeg}deg)`;
    rafId = requestAnimationFrame(loop);
  }
  rafId = requestAnimationFrame(loop);
}

function startPowerPhase() {
  phase = 'power';
  lockedAngleDeg = aimAngleDeg;
  cancelAnimationFrame(rafId);
  phaseMsgEl.textContent = '力を決めましょう';
  actionBtnEl.textContent = '② 打つ！';
  gaugeWrapEl.classList.add('visible');
  const period = hard ? 1100 : 1500;
  const t0 = performance.now();
  let power = 0;
  function loop(t) {
    if (phase !== 'power') return;
    const elapsed = t - t0;
    power = (Math.sin((elapsed / period) * Math.PI * 2 - Math.PI / 2) + 1) / 2;
    gaugeFillEl.style.width = (power * 100) + '%';
    rafId = requestAnimationFrame(loop);
  }
  rafId = requestAnimationFrame(loop);
  gaugeWrapEl._getPower = () => power;
}

function onActionTap() {
  if (!shell.running) return;
  if (phase === 'aim') {
    startPowerPhase();
    shell.playTone(440, 0.05);
  } else if (phase === 'power') {
    lockedPower = gaugeWrapEl._getPower ? gaugeWrapEl._getPower() : 0.7;
    cancelAnimationFrame(rafId);
    shell.playTone(660, 0.06);
    launch();
  }
}

function launch() {
  phase = 'rolling';
  phaseMsgEl.textContent = '';
  gaugeWrapEl.classList.remove('visible');
  actionBtnEl.style.display = 'none';
  aimArrowEl.style.display = 'none';
  knockedBeforeThrow = pins.filter((p) => p.down).length;

  const angleRad = (lockedAngleDeg * Math.PI) / 180;
  const minDist = 190;
  const maxDist = 370;
  const targetDist = minDist + lockedPower * (maxDist - minDist);
  const duration = 1300;
  const t0 = performance.now();
  let gutter = false;
  let zoomed = false;
  let prevX = BALL_START.x;
  let prevY = BALL_START.y;

  function ease(p) { return 1 - Math.pow(1 - p, 2); }

  // 点(px,py)と線分(x0,y0)-(x1,y1)の最短距離（すり抜け防止用）
  function distToSegment(px, py, x0, y0, x1, y1) {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const lenSq = dx * dx + dy * dy;
    let t = lenSq === 0 ? 0 : ((px - x0) * dx + (py - y0) * dy) / lenSq;
    t = Math.max(0, Math.min(1, t));
    const cx = x0 + t * dx;
    const cy = y0 + t * dy;
    return Math.sqrt((px - cx) ** 2 + (py - cy) ** 2);
  }

  function knockPin(pin, viaChain) {
    if (pin.down) return;
    pin.down = true;
    if (viaChain) {
      setTimeout(() => {
        pin.el.classList.add('down');
        shell.playTone(260 + Math.random() * 80, 0.07, 'triangle');
      }, 90);
    } else {
      pin.el.classList.add('down');
      shell.playTone(300 + Math.random() * 120, 0.08, 'triangle');
    }
    chainFrom(pin);
  }

  // 倒れたピンの近くにある未だ立っているピンを、確率で巻き込んで倒す
  function chainFrom(originPin) {
    pins.forEach((p) => {
      if (p.down) return;
      const dx = originPin.x - p.x;
      const dy = originPin.y - p.y;
      if (Math.sqrt(dx * dx + dy * dy) <= chainRadius && Math.random() < chainChance) {
        knockPin(p, true);
      }
    });
  }

  function frame(t) {
    const elapsed = t - t0;
    const p = Math.min(1, elapsed / duration);
    const dist = ease(p) * targetDist;
    const x = BALL_START.x + Math.sin(angleRad) * dist;
    const y = BALL_START.y - Math.cos(angleRad) * dist;

    if (!gutter && (x < gutterMargin || x > LANE_W - gutterMargin)) {
      gutter = true;
      setPos(ballEl, x, y);
      finishThrow();
      return;
    }

    setPos(ballEl, x, y);

    if (!zoomed && y <= ZOOM_TRIGGER_Y) {
      zoomed = true;
      laneInnerEl.classList.add('zoomed');
    }

    pins.forEach((pin) => {
      if (pin.down) return;
      if (distToSegment(pin.x, pin.y, prevX, prevY, x, y) <= pinRadius) {
        knockPin(pin, false);
      }
    });
    prevX = x;
    prevY = y;

    if (p < 1) {
      rafId = requestAnimationFrame(frame);
    } else {
      finishThrow();
    }
  }
  rafId = requestAnimationFrame(frame);
}

function finishThrow() {
  phase = 'done';
  const knockedTotal = pins.filter((p) => p.down).length;
  const knockedThisThrow = knockedTotal - knockedBeforeThrow;
  const remainingBefore = pins.length - knockedBeforeThrow;
  shell.setScore(knockedTotal);

  setTimeout(() => {
    const clearedAll = knockedThisThrow === remainingBefore && remainingBefore > 0;

    if (clearedAll && throwNum === 1) {
      strikeReaction();
      shell.end(`ストライク！全${pins.length}本たおしたよ🎳`);
      return;
    }
    if (clearedAll && throwNum === 2) {
      spareReaction();
      shell.end('スペア！2投で全部たおしたよ🎳');
      return;
    }
    if (knockedThisThrow === 0) {
      gutterReaction();
    } else {
      partialReaction(knockedThisThrow);
    }

    if (throwNum === 1) {
      setTimeout(() => {
        throwNum = 2;
        resetForSecondThrow();
        startAimPhase();
      }, 900);
    } else {
      shell.end(`${knockedTotal}本たおしました！`);
    }
  }, 400);
}

function resetForSecondThrow() {
  laneInnerEl.classList.remove('zoomed');
  setPos(ballEl, BALL_START.x, BALL_START.y);
  aimArrowEl.style.display = 'block';
  aimArrowEl.style.transform = 'rotate(0deg)';
}

/* ---- 結果ごとの音・演出 ---- */
function gutterReaction() {
  shell.playTone(420, 0.08, 'sine');
  setTimeout(() => shell.playTone(280, 0.16, 'sine'), 100);
  shell.toast('ざんねん…');
}

function partialReaction(count) {
  if (count >= 5) {
    shell.playTone(659.25, 0.12, 'triangle');
    setTimeout(() => shell.playTone(880, 0.16, 'triangle'), 100);
    shell.toast(`${count}本たおした！`);
  } else {
    shell.playTone(523.25, 0.13, 'triangle');
    shell.toast(`${count}本たおした`);
  }
}

function strikeReaction() {
  playStrikeFanfare();
  laneInnerEl.classList.add('strike-flash');
  setTimeout(() => laneInnerEl.classList.remove('strike-flash'), 700);
  shell.toast('ストライク!!');
}

function spareReaction() {
  const notes = [659.25, 783.99, 987.77];
  notes.forEach((freq, i) => setTimeout(() => shell.playTone(freq, 0.14, 'triangle'), i * 110));
  laneInnerEl.classList.add('strike-flash');
  setTimeout(() => laneInnerEl.classList.remove('strike-flash'), 600);
  shell.toast('スペア！');
}

function playStrikeFanfare() {
  const notes = [523.25, 659.25, 783.99, 1046.5, 1318.51];
  notes.forEach((freq, i) => setTimeout(() => shell.playTone(freq, 0.15, 'triangle'), i * 90));
  setTimeout(() => shell.playTone(1567.98, 0.45, 'triangle'), notes.length * 90);
}

function showPlaceholder() {
  cancelAnimationFrame(rafId);
  shell.board.className = 's-board';
  shell.board.innerHTML = '<div class="bowl-placeholder">「スタート」を押すとレーンが現れます</div>';
}

showPlaceholder();

/* ---- GameShellのライフサイクルに接続 ---- */
shell.onStart(() => {
  buildLane();
});
shell.onReset(() => {
  showPlaceholder();
});
