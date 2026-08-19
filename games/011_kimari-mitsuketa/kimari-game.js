/* =========================================================
   法則さがし🕵️ 固有ロジック
   共通土台(GameShell)のAPIだけを使い、出題（数列／絵文字パターン）・
   判定・ヒントを実装。
   通常: 8問（等差・等比・階差ゆるめ） / 激むず: 12問（フィボナッチ型・
   交互演算・周期長めの絵文字パターンなど）
   ========================================================= */

const shell = new GameShell({
  rootSelector: '#app',
  title: '法則さがし🕵️',
  hint: '数字や絵文字の並びから、次に来るものを当てましょう',
  hasScore: true,
  hasTimer: false,
});

const NORMAL_QUESTIONS = 8;
const HARD_QUESTIONS = 12;
const MAX_INPUT_LEN = 4;

/* 性別を感じさせない絵文字プール（動物・食べ物・自然・記号） */
const EMOJI_POOL = [
  '🍎', '🍌', '🍇', '🍊', '🌟', '⭐', '🌙', '☀️',
  '🐱', '🐶', '🐰', '🦊', '🐻', '🌸', '🍀', '🎈',
  '⚽', '🔔', '🎵', '🐢', '🐟', '🦋', '🌈', '☂️',
];

let totalQuestions = NORMAL_QUESTIONS;
let currentIndex = 0;
let currentQuestion = null;
let inputStr = '';
let locked = false;
let hintTimeoutId = null;

/* ---------- ユーティリティ ---------- */
function shuffleArr(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
function randInt(min, max) { return min + ((Math.random() * (max - min + 1)) | 0); }

/* ---------- 数列生成器（それぞれ6項ぶんの値とヒント文を返す） ---------- */
function genArithmeticAsc() {
  const step = randInt(2, 9);
  const start = randInt(1, 9);
  const vals = [];
  for (let i = 0; i < 6; i++) vals.push(start + i * step);
  return { vals, hint: `隣どうしの数字は、いつも同じ数だけ増えています（+${step}）` };
}
function genArithmeticDesc() {
  const step = randInt(3, 9);
  const start = step * 6 + randInt(5, 20);
  const vals = [];
  for (let i = 0; i < 6; i++) vals.push(start - i * step);
  return { vals, hint: `隣どうしの数字は、いつも同じ数だけ減っています（-${step}）` };
}
function genGeometric(hard) {
  const ratio = hard ? (Math.random() < 0.5 ? 3 : 2) : 2;
  const start = randInt(1, ratio === 3 ? 4 : 6);
  const vals = [];
  for (let i = 0; i < 6; i++) vals.push(start * Math.pow(ratio, i));
  return { vals, hint: `隣の数字は、いつも同じ数をかけた数になっています（×${ratio}）` };
}
function genFibonacciLike() {
  const a = randInt(1, 5), b = randInt(1, 5);
  const vals = [a, b];
  for (let i = 2; i < 6; i++) vals.push(vals[i - 1] + vals[i - 2]);
  return { vals, hint: '前の2つの数字を足すと、次の数字になります' };
}
function genDiffIncreasing() {
  const d0 = randInt(1, 3), e = randInt(1, 2);
  const a0 = randInt(1, 5);
  const vals = [a0];
  let d = d0;
  for (let i = 1; i < 6; i++) { vals.push(vals[i - 1] + d); d += e; }
  return { vals, hint: '数字の増え方が、少しずつ大きくなっています' };
}
function genAlternatingOps() {
  const x = randInt(2, 5);
  const start = randInt(1, 5);
  const vals = [start];
  for (let i = 1; i < 6; i++) {
    vals.push(i % 2 === 1 ? vals[i - 1] + x : vals[i - 1] * 2);
  }
  return { vals, hint: 'たし算とかけ算が、交互にくり返されています' };
}

function generateNumberQuestion(hard) {
  const generators = hard
    ? [genFibonacciLike, genDiffIncreasing, genAlternatingOps, () => genGeometric(true), genArithmeticDesc]
    : [genArithmeticAsc, () => genGeometric(false), genArithmeticDesc];
  const gen = generators[(Math.random() * generators.length) | 0];
  const { vals, hint } = gen();
  return { type: 'number', sequence: vals.slice(0, 5), answer: vals[5], hint };
}

/* ---------- 絵文字パターン生成器 ---------- */
function generateEmojiQuestion(hard) {
  const period = hard ? (Math.random() < 0.5 ? 4 : 5) : (Math.random() < 0.5 ? 2 : 3);
  const chosen = shuffleArr(EMOJI_POOL.slice()).slice(0, period);
  const seq = [];
  for (let i = 0; i < 7; i++) seq.push(chosen[i % period]);
  const shown = seq.slice(0, 6);
  const answer = seq[6];
  const distractors = shuffleArr(EMOJI_POOL.filter((e) => e !== answer)).slice(0, 3);
  const choices = shuffleArr([answer, ...distractors]);
  return { type: 'emoji', sequence: shown, answer, choices, hint: `同じ順番が${period}個ずつくり返されています` };
}

function buildQuestionData() {
  const hard = shell.hardMode;
  return Math.random() < 0.5 ? generateNumberQuestion(hard) : generateEmojiQuestion(hard);
}

/* ---------- 出題・描画 ---------- */
function buildQuestion() {
  currentQuestion = buildQuestionData();
  inputStr = '';
  locked = false;
  clearTimeout(hintTimeoutId);

  shell.board.className = 's-board kimari-board';
  const badge = `<div class="kimari-question-badge">問題 ${currentIndex + 1} / ${totalQuestions}</div>`;

  if (currentQuestion.type === 'number') {
    shell.board.innerHTML = `
      ${badge}
      <div class="kimari-seq" id="kimariSeq"></div>
      <div class="kimari-keypad" id="kimariKeypad"></div>
      <div class="kimari-actions">
        <button class="s-icon-btn-text" id="kimariHintBtn">💡 ヒント</button>
        <button class="s-btn" id="kimariSubmitBtn">きめる</button>
      </div>
    `;
    renderSeq();
    renderKeypad();
    shell.board.querySelector('#kimariSubmitBtn').addEventListener('click', submitNumberAnswer);
  } else {
    shell.board.innerHTML = `
      ${badge}
      <div class="kimari-seq" id="kimariSeq"></div>
      <div class="kimari-choices" id="kimariChoices"></div>
      <div class="kimari-actions">
        <button class="s-icon-btn-text" id="kimariHintBtn">💡 ヒント</button>
      </div>
    `;
    renderSeq();
    renderChoices();
  }
  shell.board.querySelector('#kimariHintBtn').addEventListener('click', showHint);
}

function renderSeq() {
  const el = shell.board.querySelector('#kimariSeq');
  el.innerHTML = '';
  const emojiMode = currentQuestion.type === 'emoji';
  currentQuestion.sequence.forEach((v) => {
    const tile = document.createElement('div');
    tile.className = 'kimari-tile' + (emojiMode ? ' kimari-tile-emoji' : '');
    tile.textContent = v;
    el.appendChild(tile);
  });
  const blank = document.createElement('div');
  blank.className = 'kimari-tile kimari-blank' + (emojiMode ? ' kimari-tile-emoji' : '');
  blank.id = 'kimariBlank';
  blank.textContent = currentQuestion.type === 'number' ? '？' : '❓';
  el.appendChild(blank);
}

function updateBlankDisplay() {
  const blank = shell.board.querySelector('#kimariBlank');
  if (blank) blank.textContent = inputStr || '？';
}

/* ---------- 数字キーパッド ---------- */
function renderKeypad() {
  const el = shell.board.querySelector('#kimariKeypad');
  el.innerHTML = '';
  for (let n = 0; n <= 9; n++) {
    const btn = document.createElement('button');
    btn.className = 'kimari-key';
    btn.textContent = n;
    btn.addEventListener('click', () => inputDigit(n));
    el.appendChild(btn);
  }
  const back = document.createElement('button');
  back.className = 'kimari-key kimari-key-back';
  back.textContent = '⌫';
  back.addEventListener('click', backspace);
  el.appendChild(back);
}
function inputDigit(n) {
  if (!shell.running || locked) return;
  if (inputStr.length >= MAX_INPUT_LEN) return;
  inputStr += String(n);
  updateBlankDisplay();
}
function backspace() {
  if (!shell.running || locked) return;
  inputStr = inputStr.slice(0, -1);
  updateBlankDisplay();
}

function submitNumberAnswer() {
  if (!shell.running || locked || inputStr === '') return;
  if (Number(inputStr) === currentQuestion.answer) {
    handleCorrect();
  } else {
    handleWrong();
    inputStr = '';
    updateBlankDisplay();
  }
}

/* ---------- 絵文字選択肢 ---------- */
function renderChoices() {
  const el = shell.board.querySelector('#kimariChoices');
  el.innerHTML = '';
  currentQuestion.choices.forEach((emoji) => {
    const btn = document.createElement('button');
    btn.className = 'kimari-choice-btn';
    btn.textContent = emoji;
    btn.addEventListener('click', () => onChoiceClick(emoji, btn));
    el.appendChild(btn);
  });
}
function onChoiceClick(emoji, btn) {
  if (!shell.running || locked) return;
  if (emoji === currentQuestion.answer) {
    const blank = shell.board.querySelector('#kimariBlank');
    if (blank) blank.textContent = emoji;
    handleCorrect();
  } else {
    btn.classList.add('kimari-shake');
    setTimeout(() => btn.classList.remove('kimari-shake'), 300);
    handleWrong();
  }
}

/* ---------- 正誤処理 ---------- */
function handleCorrect() {
  locked = true;
  shell.addScore(10);
  const blank = shell.board.querySelector('#kimariBlank');
  if (blank) {
    blank.classList.add('kimari-correct-flash');
    shell.showPopup(blank, '+10', 'good');
  }
  playCorrectChime();
  setTimeout(nextQuestion, 700);
}

// 正解時の「ピンポン♪」チャイム（明るい2音を素早く連続再生）
function playCorrectChime() {
  shell.playTone(1046.5, 0.1, 'sine');
  setTimeout(() => shell.playTone(1396.9, 0.16, 'sine'), 110);
}
function handleWrong() {
  shell.playTone(280, 0.15, 'triangle'); // 不正解は軽い音のみ、減点なし
  const blank = shell.board.querySelector('#kimariBlank');
  if (blank) {
    blank.classList.add('kimari-shake');
    setTimeout(() => blank.classList.remove('kimari-shake'), 300);
  }
}

function nextQuestion() {
  currentIndex++;
  if (currentIndex >= totalQuestions) {
    showAllClear();
  } else {
    buildQuestion();
  }
}

/* ---------- ヒント（回数無制限） ---------- */
function showHint() {
  if (!shell.running || locked) return;
  clearTimeout(hintTimeoutId);
  const blank = shell.board.querySelector('#kimariBlank');
  if (blank) {
    blank.classList.add('kimari-hint-pulse');
    hintTimeoutId = setTimeout(() => blank.classList.remove('kimari-hint-pulse'), 1800);
  }
  shell.playTone(500, 0.08);
  shell.toast(currentQuestion.hint);
}

/* ---------- 全問クリア演出 ---------- */
function showAllClear() {
  const finalScore = shell.getScore();
  shell.board.className = 's-board kimari-board';
  shell.board.innerHTML = `
    <div class="kimari-allclear" id="kimariAllClear">
      <div class="kimari-allclear-title">🎉 全問クリア！ 🎉</div>
      <div class="kimari-allclear-score">スコア: <b>${finalScore}</b></div>
      <div class="kimari-allclear-sub">お疲れ様でした🕵️</div>
    </div>
  `;
  const container = shell.board.querySelector('#kimariAllClear');
  const emojis = ['🎉', '🔍', '✨', '⭐', '🕵️', '🎊'];
  for (let i = 0; i < 20; i++) {
    const el = document.createElement('div');
    el.className = 'kimari-confetti';
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

function showPlaceholder() {
  shell.board.className = 's-board';
  shell.board.innerHTML = `
    <div class="kimari-placeholder">
      <p>数字や絵文字の並び方から<b>きまり（法則）</b>を見つけて、次に来るものを当てるゲームです。</p>
      <p>制限時間はありません。ヒントは💡ボタンで何度でも使えます。</p>
      <p>「スタート」を押すとはじまります</p>
    </div>
  `;
}

showPlaceholder();

/* ---- GameShellのライフサイクルに接続 ---- */
shell.onStart(() => {
  totalQuestions = shell.hardMode ? HARD_QUESTIONS : NORMAL_QUESTIONS;
  currentIndex = 0;
  buildQuestion();
});
shell.onReset(() => {
  clearTimeout(hintTimeoutId);
  locked = true;
  showPlaceholder();
});
shell.onHardModeChange(() => {
  // running中は呼ばれない（GameShell側で保証）。次回スタート時の問題数・難易度に反映される。
});
