/* =========================================================
   さくさくジャッジ 固有ロジック
   共通土台(GameShell)のAPIだけを使い、出題・判定を実装。
   ジャンルはスタート時にランダムで1つ選出し、そのジャンルの
   アイテムプールを使い切ったらシャッフルし直して継続する。
   ========================================================= */

const shell = new GameShell({
  rootSelector: '#app',
  title: 'さくさくジャッジ👀',
  hint: 'お題に合うものだけ〇、違うものは✕（タイトル5回タップで激むず）',
  hasScore: true,
  hasTimer: true,
  duration: 30,
});

const NORMAL_DURATION = 30;
const HARD_DURATION = 18;

/* ---------- ジャンル定義 ---------- */
/* pool: 通常時の出題プール（タグの組み合わせでお題を使い回す）
   hardExtra: 激むず時のみ追加される、判定に一瞬迷う項目
   themes: このジャンルで出題されるお題タグの候補 */
const GENRES = [
  {
    name: 'くだもの・やさい',
    themes: ['くだもの', 'やさい', 'あか', 'きいろ', 'みどり'],
    pool: [
      { emoji: '🍓', name: 'いちご', tags: ['くだもの', 'あか'] },
      { emoji: '🍎', name: 'りんご', tags: ['くだもの', 'あか'] },
      { emoji: '🍌', name: 'バナナ', tags: ['くだもの', 'きいろ'] },
      { emoji: '🍇', name: 'ぶどう', tags: ['くだもの'] },
      { emoji: '🍊', name: 'みかん', tags: ['くだもの'] },
      { emoji: '🍉', name: 'すいか', tags: ['くだもの', 'みどり'] },
      { emoji: '🥝', name: 'キウイ', tags: ['くだもの', 'みどり'] },
      { emoji: '🍒', name: 'さくらんぼ', tags: ['くだもの', 'あか'] },
      { emoji: '🍋', name: 'レモン', tags: ['くだもの', 'きいろ'] },
      { emoji: '🍈', name: 'メロン', tags: ['くだもの', 'みどり'] },
      { emoji: '🥕', name: 'にんじん', tags: ['やさい'] },
      { emoji: '🥒', name: 'きゅうり', tags: ['やさい', 'みどり'] },
      { emoji: '🍆', name: 'なす', tags: ['やさい'] },
      { emoji: '🌽', name: 'とうもろこし', tags: ['やさい', 'きいろ'] },
      { emoji: '🫑', name: 'ピーマン', tags: ['やさい', 'みどり'] },
      { emoji: '🥦', name: 'ブロッコリー', tags: ['やさい', 'みどり'] },
      { emoji: '🧅', name: 'たまねぎ', tags: ['やさい'] },
      { emoji: '🥬', name: 'はくさい', tags: ['やさい', 'みどり'] },
      { emoji: '🌶️', name: 'とうがらし', tags: ['やさい', 'あか'] },
      { emoji: '🍅', name: 'トマト', tags: ['やさい', 'あか'] },
    ],
    hardExtra: [
      { emoji: '🥔', name: 'じゃがいも', tags: ['やさい'] },
      { emoji: '🍠', name: 'さつまいも', tags: ['やさい'] },
      { emoji: '🍑', name: 'もも', tags: ['くだもの'] },
      { emoji: '🍐', name: 'なし', tags: ['くだもの'] },
    ],
  },
  {
    name: 'いきもの・しょくぶつ',
    themes: ['いきもの', 'しょくぶつ', 'とり', 'うみのいきもの', 'はな'],
    pool: [
      { emoji: '🐶', name: 'いぬ', tags: ['いきもの'] },
      { emoji: '🐱', name: 'ねこ', tags: ['いきもの'] },
      { emoji: '🐰', name: 'うさぎ', tags: ['いきもの'] },
      { emoji: '🐻', name: 'くま', tags: ['いきもの'] },
      { emoji: '🐼', name: 'ぱんだ', tags: ['いきもの'] },
      { emoji: '🦁', name: 'らいおん', tags: ['いきもの'] },
      { emoji: '🐘', name: 'ぞう', tags: ['いきもの'] },
      { emoji: '🐮', name: 'うし', tags: ['いきもの'] },
      { emoji: '🐧', name: 'ペンギン', tags: ['いきもの', 'とり'] },
      { emoji: '🦉', name: 'ふくろう', tags: ['いきもの', 'とり'] },
      { emoji: '🐔', name: 'にわとり', tags: ['いきもの', 'とり'] },
      { emoji: '🐟', name: 'さかな', tags: ['いきもの', 'うみのいきもの'] },
      { emoji: '🐙', name: 'たこ', tags: ['いきもの', 'うみのいきもの'] },
      { emoji: '🐬', name: 'いるか', tags: ['いきもの', 'うみのいきもの'] },
      { emoji: '🌸', name: 'さくら', tags: ['しょくぶつ', 'はな'] },
      { emoji: '🌻', name: 'ひまわり', tags: ['しょくぶつ', 'はな'] },
      { emoji: '🌷', name: 'チューリップ', tags: ['しょくぶつ', 'はな'] },
      { emoji: '🌳', name: 'き', tags: ['しょくぶつ'] },
      { emoji: '🌲', name: 'まつ', tags: ['しょくぶつ'] },
      { emoji: '🍀', name: 'くさ', tags: ['しょくぶつ'] },
    ],
    hardExtra: [
      { emoji: '🦇', name: 'こうもり', tags: ['いきもの'] },
      { emoji: '🐢', name: 'かめ', tags: ['いきもの', 'うみのいきもの'] },
      { emoji: '🍄', name: 'きのこ', tags: ['しょくぶつ'] },
      { emoji: '🦋', name: 'ちょう', tags: ['いきもの'] },
    ],
  },
  {
    name: '色',
    themes: ['あか', 'きいろ', 'みどり', 'あお', 'むらさき'],
    pool: [
      { emoji: '🍎', name: 'りんご', tags: ['あか'] },
      { emoji: '🍓', name: 'いちご', tags: ['あか'] },
      { emoji: '🌶️', name: 'とうがらし', tags: ['あか'] },
      { emoji: '🍒', name: 'さくらんぼ', tags: ['あか'] },
      { emoji: '🍌', name: 'バナナ', tags: ['きいろ'] },
      { emoji: '🌻', name: 'ひまわり', tags: ['きいろ'] },
      { emoji: '🍋', name: 'レモン', tags: ['きいろ'] },
      { emoji: '🐤', name: 'ひよこ', tags: ['きいろ'] },
      { emoji: '🥒', name: 'きゅうり', tags: ['みどり'] },
      { emoji: '🍈', name: 'メロン', tags: ['みどり'] },
      { emoji: '🐸', name: 'かえる', tags: ['みどり'] },
      { emoji: '🫑', name: 'ピーマン', tags: ['みどり'] },
      { emoji: '🫐', name: 'ブルーベリー', tags: ['むらさき'] },
      { emoji: '💧', name: 'しずく', tags: ['あお'] },
      { emoji: '🌊', name: 'うみ', tags: ['あお'] },
      { emoji: '🐳', name: 'くじら', tags: ['あお'] },
      { emoji: '🍇', name: 'ぶどう', tags: ['むらさき'] },
      { emoji: '🍆', name: 'なす', tags: ['むらさき'] },
      { emoji: '💜', name: 'むらさきのハート', tags: ['むらさき'] },
    ],
    hardExtra: [
      { emoji: '🍅', name: 'トマト', tags: ['あか'] },
      { emoji: '🥝', name: 'キウイ', tags: ['みどり'] },
      { emoji: '🌽', name: 'とうもろこし', tags: ['きいろ'] },
      { emoji: '🟣', name: 'むらさきのまる', tags: ['むらさき'] },
    ],
  },
  {
    name: '生活用品',
    themes: ['のりもの', 'ぶんぼうぐ', 'でんかせいひん', 'たべもの'],
    pool: [
      { emoji: '🚗', name: 'くるま', tags: ['のりもの'] },
      { emoji: '🚲', name: 'じてんしゃ', tags: ['のりもの'] },
      { emoji: '🚆', name: 'でんしゃ', tags: ['のりもの'] },
      { emoji: '✈️', name: 'ひこうき', tags: ['のりもの'] },
      { emoji: '🚢', name: 'ふね', tags: ['のりもの'] },
      { emoji: '✏️', name: 'えんぴつ', tags: ['ぶんぼうぐ'] },
      { emoji: '📏', name: 'じょうぎ', tags: ['ぶんぼうぐ'] },
      { emoji: '✂️', name: 'はさみ', tags: ['ぶんぼうぐ'] },
      { emoji: '📕', name: 'ほん', tags: ['ぶんぼうぐ'] },
      { emoji: '🖊️', name: 'ペン', tags: ['ぶんぼうぐ'] },
      { emoji: '📺', name: 'テレビ', tags: ['でんかせいひん'] },
      { emoji: '☎️', name: 'でんわ', tags: ['でんかせいひん'] },
      { emoji: '💡', name: 'でんきゅう', tags: ['でんかせいひん'] },
      { emoji: '📷', name: 'カメラ', tags: ['でんかせいひん'] },
      { emoji: '🔌', name: 'コンセント', tags: ['でんかせいひん'] },
      { emoji: '🍞', name: 'パン', tags: ['たべもの'] },
      { emoji: '🍙', name: 'おにぎり', tags: ['たべもの'] },
      { emoji: '🍜', name: 'ラーメン', tags: ['たべもの'] },
      { emoji: '🍰', name: 'ケーキ', tags: ['たべもの'] },
      { emoji: '🍕', name: 'ピザ', tags: ['たべもの'] },
    ],
    hardExtra: [
      { emoji: '🚌', name: 'バス', tags: ['のりもの'] },
      { emoji: '📓', name: 'ノート', tags: ['ぶんぼうぐ'] },
      { emoji: '🖥️', name: 'パソコン', tags: ['でんかせいひん'] },
      { emoji: '🍔', name: 'ハンバーガー', tags: ['たべもの'] },
    ],
  },
  {
    name: '形・幾何学',
    themes: ['まる', 'さんかく', 'しかく', 'ほし'],
    pool: [
      { emoji: '⚪', name: 'まる', tags: ['まる'] },
      { emoji: '🔴', name: 'あかいまる', tags: ['まる'] },
      { emoji: '🌕', name: 'まんげつ', tags: ['まる'] },
      { emoji: '⚽', name: 'サッカーボール', tags: ['まる'] },
      { emoji: '🍩', name: 'ドーナツ', tags: ['まる'] },
      { emoji: '🔺', name: 'さんかく', tags: ['さんかく'] },
      { emoji: '🍕', name: 'ピザ', tags: ['さんかく'] },
      { emoji: '⛰️', name: 'やま', tags: ['さんかく'] },
      { emoji: '🍦', name: 'ソフトクリーム', tags: ['さんかく'] },
      { emoji: '🎪', name: 'サーカスのテント', tags: ['さんかく'] },
      { emoji: '⬛', name: 'しかく', tags: ['しかく'] },
      { emoji: '🚪', name: 'ドア', tags: ['しかく'] },
      { emoji: '📱', name: 'スマホ', tags: ['しかく'] },
      { emoji: '🎁', name: 'プレゼントばこ', tags: ['しかく'] },
      { emoji: '🧊', name: 'さいころ', tags: ['しかく'] },
      { emoji: '⭐', name: 'ほし', tags: ['ほし'] },
      { emoji: '🌟', name: 'きらきらぼし', tags: ['ほし'] },
      { emoji: '🎖️', name: 'メダル', tags: ['ほし'] },
      { emoji: '🏅', name: 'きんメダル', tags: ['ほし'] },
      { emoji: '🌠', name: 'ながれぼし', tags: ['ほし'] },
    ],
    hardExtra: [
      { emoji: '🟠', name: 'だいだいのまる', tags: ['まる'] },
      { emoji: '🔻', name: 'さかさまさんかく', tags: ['さんかく'] },
      { emoji: '🟪', name: 'むらさきのしかく', tags: ['しかく'] },
      { emoji: '💫', name: 'まわるほし', tags: ['ほし'] },
    ],
  },
];

/* お題タグごとの代表アイコン。テキストだけでは対象がイメージしにくいので併記する */
const THEME_ICON = {
  'くだもの': '🍎', 'やさい': '🥕', 'あか': '🔴', 'きいろ': '🟡', 'みどり': '🟢',
  'あお': '🔵', 'むらさき': '🟣', 'いきもの': '🐾', 'しょくぶつ': '🌱', 'とり': '🐦',
  'うみのいきもの': '🐟', 'はな': '🌸', 'のりもの': '🚗', 'ぶんぼうぐ': '✏️',
  'でんかせいひん': '📺', 'たべもの': '🍙', 'まる': '⚪', 'さんかく': '🔺',
  'しかく': '⬛', 'ほし': '⭐',
};

let currentGenre = null;
let deck = [];
let deckIndex = 0;
let currentItem = null;
let currentThemeTag = null;
let questionCount = 0;
let locked = false;

/* ---------- ユーティリティ ---------- */
function shuffleArr(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function buildPool(genre) {
  const items = genre.pool.slice();
  if (shell.hardMode) items.push(...genre.hardExtra);
  return items;
}

function nextItem() {
  if (deckIndex >= deck.length) {
    // プールを使い切ったらシャッフルし直して継続する
    deck = shuffleArr(buildPool(currentGenre));
    deckIndex = 0;
  }
  return deck[deckIndex++];
}

/* ---------- 盤面構築・出題 ---------- */
function buildBoard() {
  currentGenre = GENRES[(Math.random() * GENRES.length) | 0];
  currentThemeTag = currentGenre.themes[(Math.random() * currentGenre.themes.length) | 0];
  deck = shuffleArr(buildPool(currentGenre));
  deckIndex = 0;
  questionCount = 0;

  shell.board.className = 's-board sj-board';
  shell.board.innerHTML = `
    <div class="sj-theme" id="sjTheme"></div>
    <div class="sj-card" id="sjCard">
      <span class="sj-emoji" id="sjEmoji"></span>
      <div class="sj-itemname" id="sjName"></div>
    </div>
    <div class="sj-buttons">
      <button class="sj-btn sj-btn-yes" id="sjYesBtn">〇</button>
      <button class="sj-btn sj-btn-no" id="sjNoBtn">✕</button>
    </div>
  `;
  shell.board.querySelector('#sjYesBtn').addEventListener('click', () => answer(true));
  shell.board.querySelector('#sjNoBtn').addEventListener('click', () => answer(false));

  showQuestion();
}

function showQuestion() {
  locked = false;
  currentItem = nextItem();
  const icon = THEME_ICON[currentThemeTag] || '';
  shell.board.querySelector('#sjTheme').textContent = `${icon} ${currentThemeTag} だけ`;
  shell.board.querySelector('#sjEmoji').textContent = currentItem.emoji;
  shell.board.querySelector('#sjName').textContent = currentItem.name;
}

function answer(pressedYes) {
  if (!shell.running || locked) return;
  locked = true;
  questionCount++;

  const isMatch = currentItem.tags.includes(currentThemeTag);
  const correct = pressedYes === isMatch;
  const btn = shell.board.querySelector(pressedYes ? '#sjYesBtn' : '#sjNoBtn');

  if (correct) {
    shell.addScore(10);
    playCorrectChime();
    const card = shell.board.querySelector('#sjCard');
    card.classList.add('sj-correct-flash');
    setTimeout(() => card.classList.remove('sj-correct-flash'), 500);
    shell.showPopup(btn, '✨+10', 'bonus');
  } else {
    // 不正解は減点なし。軽い音だけで即次の問題へ
    shell.playTone(300, 0.15, 'triangle');
  }
  setTimeout(showQuestion, 250);
}

// 正解時の「ピンポン♪」チャイム（2音を素早く連続再生）
function playCorrectChime() {
  shell.playTone(880, 0.12, 'sine');
  setTimeout(() => shell.playTone(1175, 0.18, 'sine'), 110);
}

function showPlaceholder() {
  shell.board.className = 's-board';
  shell.board.innerHTML = '<div class="sj-placeholder">「スタート」を押すと出題が始まります</div>';
}

showPlaceholder();

/* ---- GameShellのライフサイクルに接続 ---- */
shell.onStart(() => {
  buildBoard();
});
shell.onReset(() => {
  showPlaceholder();
});
shell.onTimeUp(() => {
  shell.toast(`終了！スコア: ${shell.getScore()}（${questionCount}問中正解を判定）`);
});
// 激むず時は制限時間も短縮する（shell.cfg.duration を直接書き換える運用。
// GameShell側に公式APIがまだ無いための暫定対応）
shell.onHardModeChange((hard) => {
  shell.cfg.duration = hard ? HARD_DURATION : NORMAL_DURATION;
});
