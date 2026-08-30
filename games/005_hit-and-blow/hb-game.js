/* =========================================================
   ヒット&ブロー🔢 固有ロジック
   共通土台(GameShell)のAPIだけを使い、出題・入力・判定・ヒントを実装。
   通常: 4桁 / 激むず: 5桁（0〜9重複なし）
   ヒント: 未確定の桁からランダムに1つ、正しい数字を確定表示（固定・回数無制限）
   ========================================================= */

const shell = new GameShell({
  rootSelector: '#app',
  title: 'ヒット&ブロー🔢',
  hint: '数字の位置とヒントから正解を推理しましょう。ヒントは何度でも使えます。',
  hasScore: false,
  hasTimer: false,
});

const NORMAL_DIGITS = 4;
const HARD_DIGITS = 5;

let digitCount = NORMAL_DIGITS;
let secret = [];
let slots = [];    // { value: number|null, locked: bool }
let history = [];  // { guess:[], hit, blow }
let solved = false;

/* ---------- 出題生成 ---------- */
function randomSecret(n) {
  const pool = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, n);
}

/* ---------- 盤面構築 ---------- */
function buildBoard() {
  digitCount = shell.hardMode ? HARD_DIGITS : NORMAL_DIGITS;
  secret = randomSecret(digitCount);
  slots = Array.from({ length: digitCount }, () => ({ value: null, locked: false }));
  history = [];
  solved = false;

  shell.board.className = 's-board hb-board';
  shell.board.innerHTML = `
    <div class="hb-slots" id="hbSlots"></div>
    <div class="hb-legend">Hit＝数字も位置も正解　/　Blow＝数字は合っているが位置が違う</div>
    <div class="hb-keypad" id="hbKeypad"></div>
    <div class="hb-actions">
      <button class="s-icon-btn-text hb-hint-btn" id="hbHintBtn">💡 ヒント</button>
      <button class="s-btn hb-submit-btn" id="hbSubmitBtn">きめる</button>
    </div>
    <div class="hb-history" id="hbHistory"></div>
  `;

  shell.board.querySelector('#hbHintBtn').addEventListener('click', useHint);
  shell.board.querySelector('#hbSubmitBtn').addEventListener('click', submitGuess);

  renderSlots();
  renderKeypad();
  renderHistory();
}

/* ---------- 桁表示 ---------- */
function renderSlots() {
  const el = shell.board.querySelector('#hbSlots');
  el.innerHTML = '';
  slots.forEach((s) => {
    const d = document.createElement('div');
    d.className = 'hb-slot' + (s.locked ? ' hb-slot-locked' : '') + (s.value !== null ? ' hb-slot-filled' : '');
    d.textContent = s.value !== null ? s.value : '';
    el.appendChild(d);
  });
}

function usedDigits() {
  return new Set(slots.filter((s) => s.value !== null).map((s) => s.value));
}

/* ---------- キーパッド ---------- */
function renderKeypad() {
  const el = shell.board.querySelector('#hbKeypad');
  el.innerHTML = '';
  for (let n = 0; n <= 9; n++) {
    const btn = document.createElement('button');
    btn.className = 'hb-key';
    btn.textContent = n;
    btn.addEventListener('click', () => inputDigit(n));
    el.appendChild(btn);
  }
  const back = document.createElement('button');
  back.className = 'hb-key hb-key-back';
  back.textContent = '⌫';
  back.addEventListener('click', backspace);
  el.appendChild(back);
  updateKeypadState();
}

function updateKeypadState() {
  const used = usedDigits();
  const keys = shell.board.querySelectorAll('.hb-key');
  keys.forEach((btn, i) => {
    if (btn.classList.contains('hb-key-back')) return;
    btn.disabled = used.has(i) || solved || !shell.running;
  });
  const submitBtn = shell.board.querySelector('#hbSubmitBtn');
  if (submitBtn) submitBtn.disabled = solved || !shell.running || slots.some((s) => s.value === null);
  const hintBtn = shell.board.querySelector('#hbHintBtn');
  if (hintBtn) hintBtn.disabled = solved || !shell.running;
}

function inputDigit(n) {
  if (!shell.running || solved) return;
  if (usedDigits().has(n)) return;
  const idx = slots.findIndex((s) => !s.locked && s.value === null);
  if (idx === -1) return;
  slots[idx].value = n;
  shell.playTone(600, 0.06);
  renderSlots();
  updateKeypadState();
}

function backspace() {
  if (!shell.running || solved) return;
  for (let i = slots.length - 1; i >= 0; i--) {
    if (!slots[i].locked && slots[i].value !== null) { slots[i].value = null; break; }
  }
  renderSlots();
  updateKeypadState();
}

/* ---------- 判定 ---------- */
function submitGuess() {
  if (!shell.running || solved) return;
  if (slots.some((s) => s.value === null)) return;

  const guess = slots.map((s) => s.value);
  let hit = 0, blow = 0;
  guess.forEach((v, i) => { if (v === secret[i]) hit++; });
  guess.forEach((v) => { if (secret.includes(v)) blow++; });
  blow -= hit;

  history.unshift({ guess: guess.slice(), hit, blow });
  renderHistory();

  if (hit === digitCount) {
    solved = true;
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) =>
      setTimeout(() => shell.playTone(f, 0.16, 'triangle'), i * 100)
    );
    shell.end(`クリア！ ${history.length}回で正解`);
  } else {
    shell.playTone(420, 0.08);
    slots.forEach((s) => { if (!s.locked) s.value = null; }); // 未確定の桁だけクリアして再入力
    renderSlots();
  }
  updateKeypadState();
}

function renderHistory() {
  const el = shell.board.querySelector('#hbHistory');
  if (!el) return;
  el.innerHTML = history.map((h) => `
    <div class="hb-history-row">
      <span class="hb-history-guess">${h.guess.join(' ')}</span>
      <span class="hb-history-result"><b class="hb-hit">${h.hit}Hit</b> <b class="hb-blow">${h.blow}Blow</b></span>
    </div>
  `).join('');
}

/* ---------- ヒント ---------- */
function useHint() {
  if (!shell.running || solved) return;
  const remaining = slots.map((s, i) => ({ i, s })).filter((x) => !x.s.locked);
  if (remaining.length === 0) {
    shell.toast('すべての桁が開示されています');
    return;
  }
  const pick = remaining[(Math.random() * remaining.length) | 0];
  const correctVal = secret[pick.i];

  // 開示する数字が他の未確定桁に重複入力されていたら、そちらはクリアする
  slots.forEach((s, idx) => {
    if (idx !== pick.i && !s.locked && s.value === correctVal) s.value = null;
  });
  slots[pick.i] = { value: correctVal, locked: true };

  shell.playTone(880, 0.12);
  shell.toast(`${pick.i + 1}桁目は ${correctVal} です`);
  renderSlots();
  updateKeypadState();
}

/* ---------- プレースホルダー ---------- */
function showPlaceholder() {
  shell.board.className = 's-board';
  shell.board.innerHTML = `
    <div class="hb-placeholder">
      <p>コンピュータが決めた重複しない数字を当てるゲームです。</p>
      <p>数字を入力して「きめる」を押すと、<b>位置も数字も正解</b>➩<b>Hit</b>、<b>数字は合っているが位置が違う</b>➩<b>Blow</b>で表示されます。</p>
      <p>ヒントは💡ボタンでいつでも使えます。</p>
      <p class="hb-placeholder-start">「スタート」を押すとはじまります。</p>
    </div>
  `;
}
showPlaceholder();

/* ---- GameShellのライフサイクルに接続 ---- */
shell.onStart(() => {
  buildBoard();
});
shell.onReset(() => {
  showPlaceholder();
});
