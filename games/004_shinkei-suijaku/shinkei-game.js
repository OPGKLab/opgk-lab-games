/* =========================================================
   動物しんけいすいじゃく🐾 固有ロジック
   共通土台(GameShell)のAPIだけを使い、盤面生成・めくり・一致判定を実装。
   カードは表裏(front/back)divを持つ3Dフリップ方式。
   通常: 4x4(8ペア) / 激むず: 6x6(18ペア)
   ========================================================= */

const shell = new GameShell({
  rootSelector: '#app',
  title: 'どうぶつ神経衰弱🐾',
  hint: 'カードを2枚めくってペアを探しましょう',
  hasScore: true,
  hasTimer: false,
});

const ANIMALS = ['🐰','🐨','🐯','🦁','🐮','🐷','🐹','🐵','🐔','🐧','🦉','🐴','🦢','🦝','🐿️','🦔','🦦','🦫'];

const NORMAL = { rows: 4, cols: 4, pairs: 8 };
const HARD   = { rows: 6, cols: 6, pairs: 18 };
const MISMATCH_SOUND_DELAY = 250;  // カードを見せてからNG音を鳴らすまで（視認優先）
const MISMATCH_TOTAL_MS = 1200;    // めくってから裏返すまでの合計時間
const MATCH_HIDE_DELAY = 600;      // 正解音を鳴らしてから盤面から消えるまで
const HINT_LIMIT = 3;
const HINT_SHOW_MS = 800;

let rows = NORMAL.rows, cols = NORMAL.cols;
let cards = [];       // { emoji, matched }
let cardEls = [];
let openIndices = [];
let locked = false;
let matchedCount = 0;
let moveCount = 0;
let hintsLeft = HINT_LIMIT;
let hintBtnEl = null;

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function buildDeck(pairCount) {
  const chosen = ANIMALS.slice(0, pairCount);
  const deck = shuffle([...chosen, ...chosen]);
  return deck.map((emoji) => ({ emoji, matched: false }));
}

function buildBoard() {
  const size = shell.hardMode ? HARD : NORMAL;
  rows = size.rows; cols = size.cols;
  cards = buildDeck(size.pairs);
  openIndices = [];
  locked = false;
  matchedCount = 0;
  moveCount = 0;
  hintsLeft = HINT_LIMIT;

  shell.board.className = 's-board shinkei-board';
  shell.board.innerHTML = `
    <div class="shinkei-toolbar">
      <span class="shinkei-count">手数: <b id="shinkeiMoves">0</b></span>
      <button class="s-icon-btn-text shinkei-hint-btn" id="shinkeiHintBtn"></button>
    </div>
    <div class="shinkei-grid" id="shinkeiGrid" style="--cols:${cols}"></div>
  `;
  const grid = shell.board.querySelector('#shinkeiGrid');
  cardEls = [];
  cards.forEach((card, i) => {
    const btn = document.createElement('button');
    btn.className = 'shinkei-card';
    btn.innerHTML = `
      <div class="shinkei-face shinkei-face-back"></div>
      <div class="shinkei-face shinkei-face-front">${card.emoji}</div>
    `;
    btn.addEventListener('click', () => onCardClick(i));
    grid.appendChild(btn);
    cardEls.push(btn);
  });

  hintBtnEl = shell.board.querySelector('#shinkeiHintBtn');
  hintBtnEl.addEventListener('click', showHint);
  updateHintButton();
}

function updateHintButton() {
  if (!hintBtnEl) return;
  hintBtnEl.textContent = `💡 ヒント(${hintsLeft})`;
  hintBtnEl.disabled = hintsLeft <= 0;
}

function showHint() {
  if (!shell.running || locked || openIndices.length > 0 || hintsLeft <= 0) return;
  hintsLeft--;
  updateHintButton();
  locked = true;
  shell.playTone(440, 0.1, 'sine');
  setTimeout(() => shell.playTone(550, 0.1, 'sine'), 100);

  cards.forEach((c, i) => {
    if (!c.matched) cardEls[i].classList.add('shinkei-flip');
  });
  shell.toast('パッ！とおぼえてね！');

  setTimeout(() => {
    cards.forEach((c, i) => {
      if (!c.matched && !openIndices.includes(i)) cardEls[i].classList.remove('shinkei-flip');
    });
    locked = false;
  }, HINT_SHOW_MS);
}

function showPlaceholder() {
  shell.board.className = 's-board';
  shell.board.innerHTML = '<div class="pipe-placeholder">「スタート」を押すとカードが配られます</div>';
}

function onCardClick(i) {
  if (!shell.running || locked) return;
  const card = cards[i];
  if (card.matched || openIndices.includes(i)) return;

  cardEls[i].classList.add('shinkei-flip');
  shell.playTone(520, 0.08, 'triangle');
  openIndices.push(i);

  if (openIndices.length === 2) {
    moveCount++;
    shell.board.querySelector('#shinkeiMoves').textContent = moveCount;
    const [a, b] = openIndices;
    if (cards[a].emoji === cards[b].emoji) {
      handleMatch(a, b);
    } else {
      handleMismatch(a, b);
    }
  }
}

function handleMatch(a, b) {
  locked = true;
  cards[a].matched = true;
  cards[b].matched = true;

  shell.playTone(660, 0.12, 'sine');
  setTimeout(() => shell.playTone(880, 0.15, 'sine'), 120);
  shell.addScore(10);
  shell.showPopup(cardEls[b], '+10', 'good');

  setTimeout(() => {
    matchedCount++;
    [a, b].forEach((idx) => {
      cardEls[idx].classList.add('shinkei-matched');
      cardEls[idx].disabled = true;
    });
    openIndices = [];
    locked = false;

    if (matchedCount === cards.length / 2) {
      [523.25, 659.25, 783.99, 1046.5].forEach((freq, i) =>
        setTimeout(() => shell.playTone(freq, 0.16, 'triangle'), i * 100)
      );
      shell.end(`クリア！ 手数: ${moveCount}`);
    }
  }, MATCH_HIDE_DELAY);
}

function handleMismatch(a, b) {
  locked = true;
  // まずカードを見せる（視認優先）。NG音は少し遅らせて鳴らす。
  setTimeout(() => {
    shell.playTone(200, 0.18, 'sawtooth');
  }, MISMATCH_SOUND_DELAY);

  setTimeout(() => {
    [a, b].forEach((idx) => cardEls[idx].classList.remove('shinkei-flip'));
    openIndices = [];
    locked = false;
  }, MISMATCH_TOTAL_MS);
}

showPlaceholder();

/* ---- GameShellのライフサイクルに接続 ---- */
shell.onStart(() => {
  buildBoard();
});
shell.onReset(() => {
  showPlaceholder();
});
