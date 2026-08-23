/* =========================================================
   だるまさん落とし🪆 固有ロジック
   共通土台(GameShell)のAPIだけを使用。
   下から順に1枚ずつ、マーカーが赤いワク（的）に触れた瞬間に
   「たたく」をタップして抜き取る、タイミングタップ形式。
   5ステージ制：段数は固定、的の幅がステージごとに縮小する。
   ========================================================= */

const shell = new GameShell({
  rootSelector: '#app',
  title: 'だるまさん落とし🪆',
  hint: 'マーカーが赤いワクに触れた瞬間に「たたく」をタップして、下から一枚ずつ抜き取りましょう',
  hasScore: false,
  hasTimer: false,
});

const STAGE_CONFIG = {
  normal: { discs: 6, zones: [34, 30, 26, 22, 18] },
  hard: { discs: 7, zones: [25, 22, 19, 16, 13] },
};
const STAGE_COUNT = 5;
const PERIOD = 1400;       // マーカー往復1周期(ms)
const MAX_LIVES = 5;
const TRACK_WIDTH = 260;   // .daruma-track の幅(px)と一致させる
const MARKER_DIAMETER = 32;
const MARKER_RADIUS_PCT = (MARKER_DIAMETER / 2 / TRACK_WIDTH) * 100;
const INTRO_DURATION = 550; // 開始直後、狙いを見せる静止時間(ms)
const HIT_ANIM_DURATION = 260; // 命中〜段が飛んでいくアニメの時間(ms)

let mode = 'normal';
let stageIndex = 0;
let discCount = 0;
let zoneWidth = 0;
let discs = [];
let lives = MAX_LIVES;
let zoneStart = 0;
let turnStartTime = 0;
let rafId = null;
let busy = false;      // 演出中は入力をロック
let finished = false;

let stackEl, zoneEl, markerEl, livesEl, strikeBtn, stageLabelEl, headEl, boardWrap, arrowEl;

function markerPosition(elapsed) {
  const t = (elapsed % PERIOD) / PERIOD;
  return t < 0.5 ? t * 200 : 200 - t * 200;
}

function pickZone() {
  zoneStart = Math.random() * (100 - zoneWidth);
}

function newTurn() {
  pickZone();
  turnStartTime = performance.now();
}

function discHeight() {
  return discCount <= 6 ? 26 : 20;
}

function renderStack() {
  stackEl.innerHTML = '';
  discs.forEach((_, i) => {
    const el = document.createElement('div');
    el.className = 'daruma-disc' + (i % 2 === 1 ? ' alt' : '');
    el.style.height = discHeight() + 'px';
    stackEl.appendChild(el);
  });
  headEl = document.createElement('div');
  headEl.className = 'daruma-head';
  headEl.textContent = '🪆';
  stackEl.appendChild(headEl);
}

function renderLives() {
  livesEl.textContent = '❤️'.repeat(lives) + '🖤'.repeat(MAX_LIVES - lives);
}

function renderStageLabel() {
  stageLabelEl.textContent = `ステージ ${stageIndex + 1} / ${STAGE_COUNT}`;
}

/* 矢印を実際の最下段（次のターゲット）に紐づけて配置。対象が無くなったら非表示 */
function positionArrow() {
  const targetEl = discs.length > 0 ? stackEl.children[0] : null;
  if (!targetEl) {
    arrowEl.classList.remove('show');
    return;
  }
  const rect = targetEl.getBoundingClientRect();
  const wrapRect = arrowEl.parentElement.getBoundingClientRect();
  const top = rect.top - wrapRect.top + rect.height / 2 - 7; // 7 = 矢印の高さ(14px)の半分
  arrowEl.style.top = top + 'px';
  arrowEl.classList.add('show');
}

/* 効果線：命中した段が右へ飛んでいく勢いを表現 */
function spawnSpeedLines(targetEl) {
  const rect = targetEl.getBoundingClientRect();
  const wrapRect = boardWrap.getBoundingClientRect();
  const top = rect.top - wrapRect.top + rect.height / 2;
  for (let i = 0; i < 3; i++) {
    const line = document.createElement('div');
    line.className = 'daruma-speedline';
    line.style.top = (top - 6 + i * 6) + 'px';
    line.style.animationDelay = (i * 0.03) + 's';
    boardWrap.appendChild(line);
    setTimeout(() => line.remove(), 400);
  }
}

function loop(now) {
  if (!shell.running || finished) return;
  if (!busy) {
    const pos = markerPosition(now - turnStartTime);
    markerEl.style.left = `calc(${pos}% - ${MARKER_DIAMETER / 2}px)`;
    zoneEl.style.left = zoneStart + '%';
    zoneEl.style.width = zoneWidth + '%';
  }
  rafId = requestAnimationFrame(loop);
}

/* スタート直後：ハンマーと矢印を一瞬静止させ、狙う対象を伝えてから動かし始める */
function runIntro() {
  busy = true;
  pickZone();
  markerEl.style.left = `calc(0% - ${MARKER_DIAMETER / 2}px)`;
  markerEl.classList.add('daruma-marker-flip');
  zoneEl.style.left = zoneStart + '%';
  zoneEl.style.width = zoneWidth + '%';
  positionArrow();
  setTimeout(() => {
    if (!shell.running) return;
    markerEl.classList.remove('daruma-marker-flip');
    busy = false;
    turnStartTime = performance.now();
    rafId = requestAnimationFrame(loop);
  }, INTRO_DURATION);
}

function onStrike() {
  if (!shell.running || finished || busy) return;
  const pos = markerPosition(performance.now() - turnStartTime);
  // マーカーの半径分を考慮し、円がワクに触れていればヒット扱いにする
  const hit = pos + MARKER_RADIUS_PCT >= zoneStart && pos - MARKER_RADIUS_PCT <= zoneStart + zoneWidth;

  if (hit) {
    shell.playTone(660, 0.08, 'triangle');
    shell.showPopup(strikeBtn, 'ぴったり！', 'good');
    busy = true;
    const flyingEl = stackEl.children[0]; // 現在の最下段（対象）
    if (flyingEl) {
      flyingEl.classList.add('daruma-disc-fly');
      spawnSpeedLines(flyingEl);
    }
    discs.pop();
    setTimeout(() => {
      if (!shell.running) return;
      renderStack();
      positionArrow();
      const newBottom = stackEl.children[0];
      if (newBottom) {
        newBottom.classList.add('daruma-disc-drop');
        setTimeout(() => newBottom.classList.remove('daruma-disc-drop'), 260);
      }
      busy = false;
      if (discs.length === 0) {
        handleStageClear();
      } else {
        newTurn();
      }
    }, HIT_ANIM_DURATION);
    return;
  }

  shell.playTone(180, 0.15, 'sawtooth');
  shell.showPopup(strikeBtn, 'おっと', 'bad');
  stackEl.classList.add('shake');
  setTimeout(() => stackEl.classList.remove('shake'), 300);
  lives--;
  renderLives();
  if (lives <= 0) {
    handleGameOver();
    return;
  }
  newTurn();
}

function handleStageClear() {
  if (stageIndex < STAGE_COUNT - 1) {
    busy = true;
    shell.playTone(880, 0.12, 'triangle');
    shell.toast(`ステージ${stageIndex + 1}クリア！`);
    setTimeout(() => {
      if (!shell.running) return;
      stageIndex++;
      zoneWidth = STAGE_CONFIG[mode].zones[stageIndex];
      discs = Array.from({ length: discCount });
      renderStack();
      positionArrow();
      renderStageLabel();
      newTurn();
      busy = false;
    }, 900);
  } else {
    finished = true;
    cancelAnimationFrame(rafId);
    showAllClear();
  }
}

function handleGameOver() {
  finished = true;
  cancelAnimationFrame(rafId);
  if (headEl) headEl.classList.add('daruma-topple');
  shell.playTone(140, 0.3, 'sawtooth');
  setTimeout(() => {
    shell.end('ざんねん、くずれてしまいました');
  }, 700);
}

/* 全ステージクリア時：盤面内に紙吹雪演出を表示してから終了処理へ（シリーズ共通パターン） */
function showAllClear() {
  shell.board.className = 's-board daruma-stage';
  shell.board.innerHTML = `
    <div class="daruma-allclear" id="darumaAllClear">
      <div class="daruma-allclear-title">🎉 全ステージクリア！ 🎉</div>
      <div class="daruma-allclear-sub">お見事です、だるまさんが立ちました🪆</div>
    </div>
  `;
  const container = shell.board.querySelector('#darumaAllClear');
  const emojis = ['🪆', '🪆', '🔨', '🎉', '✨', '🎊', '⭐'];
  for (let i = 0; i < 20; i++) {
    const el = document.createElement('div');
    el.className = 'daruma-confetti';
    el.textContent = emojis[(Math.random() * emojis.length) | 0];
    el.style.left = `${Math.random() * 100}%`;
    el.style.animationDelay = `${Math.random() * 0.6}s`;
    el.style.animationDuration = `${1.6 + Math.random() * 1.2}s`;
    el.style.fontSize = `${20 + Math.random() * 14}px`;
    container.appendChild(el);
  }
  [523.25, 659.25, 783.99, 1046.5, 1318.51].forEach((f, i) =>
    setTimeout(() => shell.playTone(f, 0.16, 'triangle'), i * 100)
  );
  shell.end(); // メッセージなし＝盤面の演出そのものを結果表示とする
}

function buildBoard() {
  shell.board.className = 's-board daruma-stage';
  shell.board.innerHTML = `
    <div class="daruma-stage-label"></div>
    <div class="daruma-lives"></div>
    <div class="daruma-stack-wrap">
      <div class="daruma-target-arrow"></div>
      <div class="daruma-stack"></div>
    </div>
    <div class="daruma-track">
      <div class="daruma-zone"></div>
      <div class="daruma-marker">🔨</div>
    </div>
    <button class="daruma-strike-btn" type="button">たたく！</button>
  `;
  boardWrap = shell.board;
  stageLabelEl = shell.board.querySelector('.daruma-stage-label');
  livesEl = shell.board.querySelector('.daruma-lives');
  arrowEl = shell.board.querySelector('.daruma-target-arrow');
  stackEl = shell.board.querySelector('.daruma-stack');
  zoneEl = shell.board.querySelector('.daruma-zone');
  markerEl = shell.board.querySelector('.daruma-marker');
  strikeBtn = shell.board.querySelector('.daruma-strike-btn');
  strikeBtn.addEventListener('click', onStrike);
}

function showPlaceholder() {
  shell.board.className = 's-board daruma-stage';
  shell.board.innerHTML = '<div class="daruma-placeholder">「スタート」を押すと始まります</div>';
}

showPlaceholder();

/* ---- GameShellのライフサイクルに接続 ---- */
shell.onStart(() => {
  mode = shell.hardMode ? 'hard' : 'normal';
  stageIndex = 0;
  discCount = STAGE_CONFIG[mode].discs;
  zoneWidth = STAGE_CONFIG[mode].zones[stageIndex];
  discs = Array.from({ length: discCount });
  lives = MAX_LIVES;
  finished = false;
  busy = false;
  buildBoard();
  renderStack();
  renderLives();
  renderStageLabel();
  runIntro();
});

shell.onReset(() => {
  if (rafId) cancelAnimationFrame(rafId);
  showPlaceholder();
});
