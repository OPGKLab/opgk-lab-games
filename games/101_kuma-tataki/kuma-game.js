/* =========================================================
   くまさんぽこぽこ 固有ロジック
   共通土台(GameShell)のAPIだけを使い、盤面生成・出現・当たり判定を実装。
   ========================================================= */

const shell = new GameShell({
  rootSelector: '#app',
  title: 'くまさんぽこぽこ🐻',
  hint: 'ぱんだ🐼はよけて、くまとしろくまをタップしましょう。',
  hasScore: true,
  hasTimer: true,
  duration: 30,
});

const HOLE_COUNT = 9;

const CHARACTERS = [
  { id: 'kuma',      emoji: '🐻',    points: 10,  label: '+10',   weight: 6 },
  { id: 'shirokuma', emoji: '🐻‍❄️', points: 20,  label: '2倍✨', weight: 2, bonus: true },
  { id: 'panda',     emoji: '🐼',    points: -10, label: '-10',   weight: 3, avoid: true },
];

const NORMAL_MODE = { spawnIntervalMin: 650, spawnIntervalMax: 1050, showDuration: 1100 };
const HARD_MODE   = { spawnIntervalMin: 500, spawnIntervalMax: 750,  showDuration: 850 };

let holes = [];
let spawnTimer = null;

function ruleBarHTML() {
  return `
    <div class="kuma-rule">
      <span class="kuma-rule-item kuma-rule-good">🐻 +10</span>
      <span class="kuma-rule-item kuma-rule-bonus">🐻‍❄️ 2倍✨</span>
      <span class="kuma-rule-item kuma-rule-bad">🐼 -10 よけて！</span>
    </div>
  `;
}

function showPlaceholder() {
  holes = [];
  shell.board.innerHTML = `
    ${ruleBarHTML()}
    <div class="kuma-placeholder">「スタート」を押すとゲームが始まります</div>
  `;
}

function buildBoard() {
  holes = [];
  shell.board.innerHTML = `
    ${ruleBarHTML()}
    <div class="kuma-holes" id="kumaHoles"></div>
  `;
  const holesWrap = shell.board.querySelector('#kumaHoles');
  for (let i = 0; i < HOLE_COUNT; i++) {
    const hole = document.createElement('button');
    hole.className = 'kuma-hole';
    hole.innerHTML = `<div class="kuma-mound"></div><div class="kuma-char"></div>`;
    hole.addEventListener('click', () => whack(i));
    holesWrap.appendChild(hole);
    holes.push({ el: hole, char: null, timeoutId: null });
  }
}

showPlaceholder();

function pickChar() {
  const totalWeight = CHARACTERS.reduce((s, c) => s + c.weight, 0);
  let r = Math.random() * totalWeight;
  for (const c of CHARACTERS) {
    if (r < c.weight) return c;
    r -= c.weight;
  }
  return CHARACTERS[0];
}

function showChar(hole, char, duration) {
  hole.char = char;
  hole.el.classList.add('kuma-up');
  hole.el.querySelector('.kuma-char').textContent = char.emoji;
  hole.el.classList.toggle('kuma-avoid', !!char.avoid);
  hole.timeoutId = setTimeout(() => hideChar(hole), duration);
}

function hideChar(hole) {
  hole.char = null;
  hole.el.classList.remove('kuma-up', 'kuma-avoid');
  hole.el.querySelector('.kuma-char').textContent = '';
  clearTimeout(hole.timeoutId);
}

function spawnLoop() {
  if (!shell.running) return;
  const mode = shell.hardMode ? HARD_MODE : NORMAL_MODE;
  const empty = holes.filter((h) => !h.char);
  if (empty.length) {
    const hole = empty[Math.floor(Math.random() * empty.length)];
    showChar(hole, pickChar(), mode.showDuration);
  }
  const next = mode.spawnIntervalMin + Math.random() * (mode.spawnIntervalMax - mode.spawnIntervalMin);
  spawnTimer = setTimeout(spawnLoop, next);
}

function whack(index) {
  if (!shell.running) return;
  const hole = holes[index];
  if (!hole.char) return;
  const char = hole.char;

  shell.addScore(char.points);
  if (char.points < 0) shell.playTone(180, 0.2, 'sawtooth');
  else if (char.bonus) shell.playTone(1050, 0.15);
  else shell.playTone(760, 0.1);

  shell.showPopup(hole.el, char.label, char.bonus ? 'bonus' : char.points < 0 ? 'bad' : 'good');

  hole.el.classList.add(char.points < 0 ? 'kuma-hit-bad' : 'kuma-hit-good');
  setTimeout(() => hole.el.classList.remove('kuma-hit-bad', 'kuma-hit-good'), 200);
  hideChar(hole);
}

/* ---- GameShellのライフサイクルに接続 ---- */
shell.onStart(() => {
  buildBoard();
  spawnLoop();
});
shell.onReset(() => {
  clearTimeout(spawnTimer);
  showPlaceholder();
});
shell.onTimeUp(() => {
  clearTimeout(spawnTimer);
  holes.forEach(hideChar);
  shell.toast(`終了！スコア: ${shell.getScore()}`);
});
