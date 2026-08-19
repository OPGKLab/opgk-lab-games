/* =========================================================
   ことばの旅🌍 固有ロジック
   -----------------------------------------------------------
   モード選択 → (クイズ:シーン選択→出題) / (辞書:シーン一覧)
   の2画面構造。shell.board内をJSで丸ごと描き替える方式。

   クイズ：通常＝選んだシーンから8問・日→英のみ。
           激むず＝全シーン混合12問・日→英/英→日をランダム。
   辞書　：JAタップ→EN表示、さらに「🇰🇷韓国語は？」「🇹🇼中国語は？」で
           それぞれ表示という隠し分岐（2言語とも独立して開閉可）。
   ========================================================= */

const shell = new GameShell({
  rootSelector: '#app',
  title: 'ことばの旅🌍',
  hint: 'クイズか辞書を選んで、日常会話フレーズを学びましょう',
  hasScore: true,
  hasTimer: false,
});

const SCENES = {
  greeting: {
    label: 'あいさつ', emoji: '👋',
    items: [
      { ja: 'おはようございます', en: 'Good morning', ko: '좋은 아침이에요', koKana: 'チョウン アチミエヨ', zh: '早安', zhPinyin: 'zǎo ān', zhKana: 'ザオ アン' },
      { ja: 'こんにちは', en: 'Good afternoon', ko: '안녕하세요', koKana: 'アンニョンハセヨ', zh: '午安', zhPinyin: 'wǔ ān', zhKana: 'ウー アン' },
      { ja: 'こんばんは', en: 'Good evening', ko: '좋은 저녁이에요', koKana: 'チョウン チョニョギエヨ', zh: '晚上好', zhPinyin: 'wǎn shàng hǎo', zhKana: 'ワンシャンハオ' },
      { ja: 'ありがとうございます', en: 'Thank you very much', ko: '대단히 감사합니다', koKana: 'テダニ カムサハムニダ', zh: '太謝謝你了', zhPinyin: 'tài xièxie nǐ le', zhKana: 'タイ シエシエ ニーラ' },
      { ja: 'すみません', en: 'Excuse me', ko: '실례합니다', koKana: 'シルレハムニダ', zh: '不好意思', zhPinyin: 'bù hǎoyìsi', zhKana: 'プー ハオイース' },
      { ja: 'はじめまして', en: 'Nice to meet you', ko: '만나서 반갑습니다', koKana: 'マンナソ パンガッスムニダ', zh: '很高興認識你', zhPinyin: 'hěn gāoxìng rènshì nǐ', zhKana: 'ヘン ガオシン レンシーニー' },
      { ja: 'お元気ですか', en: 'How are you?', ko: '어떻게 지내세요?', koKana: 'オットケ チネセヨ', zh: '你好嗎？', zhPinyin: 'nǐ hǎo ma', zhKana: 'ニー ハオ マ' },
      { ja: 'さようなら', en: 'Goodbye', ko: '안녕히 가세요', koKana: 'アンニョンヒ カセヨ', zh: '再見', zhPinyin: 'zàijiàn', zhKana: 'ザイジェン' },
      { ja: 'お願いします', en: 'Please', ko: '부탁합니다', koKana: 'プタカムニダ', zh: '麻煩你', zhPinyin: 'máfan nǐ', zhKana: 'マーファン ニー' },
      { ja: 'お大事に', en: 'Take care', ko: '몸조리 잘 하세요', koKana: 'モムジョリ チャル ハセヨ', zh: '請多保重', zhPinyin: 'qǐng duō bǎozhòng', zhKana: 'チン ドゥオ バオジョン' },
    ],
  },
  shopping: {
    label: '買い物', emoji: '🛍️',
    items: [
      { ja: 'いくらですか', en: 'How much is it?', ko: '이거 얼마예요?', koKana: 'イゴ オルマエヨ', zh: '這個多少錢？', zhPinyin: 'zhège duōshǎo qián', zhKana: 'ジャガ ドゥオシャオ チェン' },
      { ja: 'これをください', en: "I'll take this, please", ko: '이거 주세요', koKana: 'イゴ ジュセヨ', zh: '我要這個', zhPinyin: 'wǒ yào zhège', zhKana: 'ウォ ヤオ ジャガ' },
      { ja: 'クレジットカードは使えますか', en: 'May I pay with a credit card?', ko: '신용카드 돼요?', koKana: 'シニョンカドゥ トェヨ', zh: '可以刷卡嗎？', zhPinyin: 'kěyǐ shuākǎ ma', zhKana: 'クァイー シュアカー マ' },
      { ja: '試着してもいいですか', en: 'May I try this on?', ko: '입어봐도 될까요?', koKana: 'イボブァド テルカヨ', zh: '可以試穿嗎？', zhPinyin: 'kěyǐ shìchuān ma', zhKana: 'クァイー シーチュアン マ' },
      { ja: 'もう少し安くなりますか', en: 'Could you make it a little cheaper?', ko: '조금 싸게 해주실 수 있어요?', koKana: 'チョグム サゲ ヘジュシルス イッソヨ', zh: '可以算便宜一點嗎？', zhPinyin: 'kěyǐ suàn piányí yìdiǎn ma', zhKana: 'クァイー スワン ピエンイー イーディエン マ' },
      { ja: '袋は要りません', en: "I don't need a bag", ko: '봉투는 필요 없어요', koKana: 'ポントゥヌン ピリョ オプソヨ', zh: '不需要袋子', zhPinyin: 'bù xūyào dàizi', zhKana: 'プー シュヤオ ダイズ' },
      { ja: 'サイズはありますか', en: 'Do you have this in my size?', ko: '이 사이즈 있어요?', koKana: 'イ サイジュ イッソヨ', zh: '有這個尺寸嗎？', zhPinyin: 'yǒu zhège chǐcùn ma', zhKana: 'ヨウ ジャガ チーツン マ' },
      { ja: 'レシートをください', en: 'May I have the receipt, please?', ko: '영수증 주세요', koKana: 'ヨンスジュン ジュセヨ', zh: '請給我收據', zhPinyin: 'qǐng gěi wǒ shōujù', zhKana: 'チン ゲイウォ ショウジュイ' },
      { ja: '他の色はありますか', en: 'Do you have other colors?', ko: '다른 색깔 있어요?', koKana: 'タルン セッカル イッソヨ', zh: '有其他顏色嗎？', zhPinyin: 'yǒu qítā yánsè ma', zhKana: 'ヨウ チーター イエンサ マ' },
      { ja: '返品できますか', en: 'May I return this?', ko: '반품할 수 있어요?', koKana: 'パンプムハルス イッソヨ', zh: '可以退貨嗎？', zhPinyin: 'kěyǐ tuìhuò ma', zhKana: 'クァイー トゥイフォ マ' },
    ],
  },
  restaurant: {
    label: 'レストラン', emoji: '🍽️',
    items: [
      { ja: 'メニューを見せてください', en: 'May I see the menu?', ko: '메뉴 좀 보여주세요', koKana: 'メニュ ジョム ポヨジュセヨ', zh: '請給我看菜單', zhPinyin: 'qǐng gěi wǒ kàn càidān', zhKana: 'チン ゲイウォ カン ツァイダン' },
      { ja: 'おすすめは何ですか', en: 'What do you recommend?', ko: '뭐가 맛있어요?', koKana: 'モワ マシッソヨ', zh: '有什麼推薦的？', zhPinyin: 'yǒu shénme tuījiàn de', zhKana: 'ヨウ シェンマ トゥイジェンダ' },
      { ja: 'お水をください', en: 'Water, please', ko: '물 좀 주세요', koKana: 'ムル ジョム ジュセヨ', zh: '請給我水', zhPinyin: 'qǐng gěi wǒ shuǐ', zhKana: 'チン ゲイウォ シュイ' },
      { ja: '会計をお願いします', en: 'Could I have the check, please?', ko: '계산해 주세요', koKana: 'ケサネ ジュセヨ', zh: '買單', zhPinyin: 'mǎidān', zhKana: 'マイダン' },
      { ja: 'これは辛いですか', en: 'Is this spicy?', ko: '이거 매워요?', koKana: 'イゴ メウォヨ', zh: '這個辣嗎？', zhPinyin: 'zhège là ma', zhKana: 'ジャガ ラー マ' },
      { ja: 'アレルギーがあります', en: 'I have an allergy', ko: '알레르기가 있어요', koKana: 'アルレルギガ イッソヨ', zh: '我對食物過敏', zhPinyin: 'wǒ duì shíwù guòmǐn', zhKana: 'ウォ ドゥイ シーウー グオミン' },
      { ja: 'とてもおいしかったです', en: 'It was delicious', ko: '정말 맛있었어요', koKana: 'チョンマル マシッソッソヨ', zh: '非常好吃', zhPinyin: 'fēicháng hǎochī', zhKana: 'フェイツァン ハオチー' },
      { ja: '予約をしています', en: 'I have a reservation', ko: '예약했어요', koKana: 'イェヤケッソヨ', zh: '我有訂位', zhPinyin: 'wǒ yǒu dìngwèi', zhKana: 'ウォ ヨウ ディンウェイ' },
      { ja: '別々に払えますか', en: 'May we pay separately?', ko: '따로 계산할 수 있어요?', koKana: 'タロ ケサナルス イッソヨ', zh: '可以分開付款嗎？', zhPinyin: 'kěyǐ fēnkāi fùkuǎn ma', zhKana: 'クァイー フェンカイ フークワン マ' },
      { ja: '持ち帰りできますか', en: 'May I get this to go?', ko: '포장 되나요?', koKana: 'ポジャン テナヨ', zh: '可以打包嗎？', zhPinyin: 'kěyǐ dǎbāo ma', zhKana: 'クァイー ダーバオ マ' },
    ],
  },
};

const NORMAL_QUESTION_COUNT = 8;
const HARD_QUESTION_COUNT = 12;

let quiz = null; // { questions:[{item, direction}], index, correctCount }

/* ---------- ユーティリティ ---------- */
function shuffleArr(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function allItemsFlat() {
  const out = [];
  Object.keys(SCENES).forEach((key) => {
    SCENES[key].items.forEach((it) => out.push(it));
  });
  return out;
}

/* ---------- トップ：モード選択 ---------- */
function showModeSelect() {
  shell.board.className = 's-board';
  shell.board.innerHTML = `
    <div class="kt-menu">
      <p>クイズで力だめし、または辞書でじっくり眺めながら、日・英・韓・中（台湾）のフレーズを学べます。</p>
      <div class="kt-menu-row">
        <button class="kt-menu-btn" id="ktQuizBtn">
          <span class="kt-emoji">📝</span>
          <span>クイズであそぶ<span class="kt-sub">日本語を見て、正しい英語を選びましょう</span></span>
        </button>
        <button class="kt-menu-btn" id="ktDictBtn">
          <span class="kt-emoji">📖</span>
          <span>辞書でながめる<span class="kt-sub">シーン別にフレーズをじっくり確認できます</span></span>
        </button>
      </div>
    </div>
  `;
  shell.board.querySelector('#ktQuizBtn').addEventListener('click', () => {
    if (shell.hardMode) startQuiz('__all__');
    else showSceneSelect('quiz');
  });
  shell.board.querySelector('#ktDictBtn').addEventListener('click', () => showSceneSelect('dict'));
}

/* ---------- シーン選択（クイズ通常時／辞書） ---------- */
function showSceneSelect(purpose) {
  shell.board.className = 's-board';
  const rows = Object.keys(SCENES).map((key) => {
    const s = SCENES[key];
    return `<button class="kt-menu-btn" data-scene="${key}"><span class="kt-emoji">${s.emoji}</span><span>${s.label}</span></button>`;
  }).join('');
  shell.board.innerHTML = `
    <div class="kt-menu">
      <div class="kt-mode-tag">${purpose === 'quiz' ? '📝 クイズモード' : '📖 辞書モード'}</div>
      <p>${purpose === 'quiz' ? 'どのシーンのフレーズに挑戦しますか？' : 'どのシーンのフレーズを見てみますか？'}</p>
      <div class="kt-menu-row">${rows}</div>
      <button class="kt-back-btn" id="ktBackBtn">← モード選択に戻る</button>
    </div>
  `;
  shell.board.querySelectorAll('[data-scene]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.scene;
      if (purpose === 'quiz') startQuiz(key);
      else showDictionary(key);
    });
  });
  shell.board.querySelector('#ktBackBtn').addEventListener('click', showModeSelect);
}

/* ---------- クイズ：出題データ作成 ---------- */
function startQuiz(sceneKey) {
  const hard = shell.hardMode;
  const count = hard ? HARD_QUESTION_COUNT : NORMAL_QUESTION_COUNT;
  const pool = sceneKey === '__all__' ? allItemsFlat() : SCENES[sceneKey].items;
  const picked = shuffleArr(pool).slice(0, Math.min(count, pool.length));
  const questions = picked.map((item) => ({
    item,
    direction: hard && Math.random() < 0.5 ? 'en2ja' : 'ja2en',
  }));
  quiz = { questions, index: 0, correctCount: 0 };
  shell.setScore(0);
  renderQuizQuestion();
}

function buildOptions(item, direction) {
  const field = direction === 'ja2en' ? 'en' : 'ja';
  const correct = item[field];
  const others = allItemsFlat().filter((it) => it[field] !== correct);
  const distractors = shuffleArr(others).slice(0, 3).map((it) => it[field]);
  return shuffleArr([correct, ...distractors]);
}

/* ---------- クイズ：出題画面 ---------- */
function renderQuizQuestion() {
  const { questions, index } = quiz;
  const total = questions.length;
  const q = questions[index];
  const promptText = q.direction === 'ja2en' ? q.item.ja : q.item.en;
  const promptLabel = q.direction === 'ja2en' ? '英語で何と言う？' : '日本語で何と言う？';
  const options = buildOptions(q.item, q.direction);
  const correctText = q.direction === 'ja2en' ? q.item.en : q.item.ja;

  shell.board.className = 's-board';
  shell.board.innerHTML = `
    <div class="kt-mode-tag">📝 クイズモード</div>
    <div class="kt-quiz-progress">問題 ${index + 1} / ${total}</div>
    <div class="kt-quiz-prompt-label">${promptLabel}</div>
    <div class="kt-quiz-prompt">${promptText}</div>
    <div class="kt-options">
      ${options.map((opt) => `<button class="kt-opt-btn" data-opt="${encodeURIComponent(opt)}">${opt}</button>`).join('')}
    </div>
  `;
  shell.board.querySelectorAll('.kt-opt-btn').forEach((btn) => {
    btn.addEventListener('click', () => onAnswer(btn, decodeURIComponent(btn.dataset.opt), correctText, q.item));
  });
}

function onAnswer(btn, chosen, correctText, item) {
  const buttons = shell.board.querySelectorAll('.kt-opt-btn');
  buttons.forEach((b) => (b.disabled = true));
  const isCorrect = chosen === correctText;
  buttons.forEach((b) => {
    if (decodeURIComponent(b.dataset.opt) === correctText) b.classList.add('kt-correct');
  });
  if (isCorrect) {
    quiz.correctCount++;
    shell.addScore(1);
    shell.playTone(880, 0.12);
  } else {
    btn.classList.add('kt-wrong');
    shell.playTone(260, 0.15, 'sawtooth');
  }

  const feedback = document.createElement('div');
  feedback.className = 'kt-feedback';
  feedback.innerHTML = `
    <p class="kt-feedback-msg ${isCorrect ? 'kt-good' : 'kt-bad'}">${isCorrect ? '正解です！' : `残念、正解は「${correctText}」`}</p>
    <button class="kt-next-btn">次へ</button>
  `;
  shell.board.appendChild(feedback);

  feedback.querySelector('.kt-next-btn').addEventListener('click', () => {
    quiz.index++;
    if (quiz.index >= quiz.questions.length) finishQuiz();
    else renderQuizQuestion();
  });
}

function finishQuiz() {
  const total = quiz.questions.length;
  const correct = quiz.correctCount;
  [523.25, 659.25, 783.99, 1046.5].forEach((f, i) =>
    setTimeout(() => shell.playTone(f, 0.15, 'triangle'), i * 100)
  );
  shell.board.className = 's-board';
  shell.board.innerHTML = `
    <div class="kt-quiz-result">
      <div class="kt-mode-tag">📝 クイズモード</div>
      <p style="font-size:20px;font-weight:bold;">${total}問中 ${correct}問 正解！</p>
      <button class="kt-back-btn" id="ktResultBackBtn">← モード選択に戻る</button>
    </div>
  `;
  shell.board.querySelector('#ktResultBackBtn').addEventListener('click', showModeSelect);
  shell.end();
}

/* ---------- 辞書：一覧画面 ---------- */
function showDictionary(sceneKey) {
  shell.board.className = 's-board';
  const tabs = Object.keys(SCENES).map((key) =>
    `<button class="kt-dict-tab${key === sceneKey ? ' kt-active' : ''}" data-tab="${key}">${SCENES[key].emoji} ${SCENES[key].label}</button>`
  ).join('');
  shell.board.innerHTML = `
    <div class="kt-mode-tag">📖 辞書モード</div>
    <div class="kt-dict-tabs">${tabs}</div>
    <div class="kt-dict-list" id="ktDictList"></div>
    <button class="kt-back-btn" id="ktDictBackBtn">← モード選択に戻る</button>
  `;
  renderDictList(sceneKey);
  shell.board.querySelectorAll('.kt-dict-tab').forEach((tab) => {
    tab.addEventListener('click', () => showDictionary(tab.dataset.tab));
  });
  shell.board.querySelector('#ktDictBackBtn').addEventListener('click', showModeSelect);
}

function renderDictList(sceneKey) {
  const list = shell.board.querySelector('#ktDictList');
  list.innerHTML = SCENES[sceneKey].items.map((it, i) => `
    <div class="kt-dict-card" data-i="${i}">
      <div class="kt-dict-ja">${it.ja}</div>
      <div class="kt-dict-hint">タップして英語を見る</div>
    </div>
  `).join('');
  list.querySelectorAll('.kt-dict-card').forEach((card) => {
    card.addEventListener('click', () => revealDictCard(card, SCENES[sceneKey].items[card.dataset.i]));
  }, { once: false });
}

function revealDictCard(card, item) {
  if (card.querySelector('.kt-dict-en')) return; // 既に開いている
  card.querySelector('.kt-dict-hint').remove();
  const en = document.createElement('div');
  en.className = 'kt-dict-en';
  en.textContent = item.en;
  card.appendChild(en);

  const btnRow = document.createElement('div');
  btnRow.className = 'kt-dict-lang-btns';
  btnRow.innerHTML = `
    <button class="kt-dict-lang-btn" data-lang="ko">🇰🇷 韓国語は？</button>
    <button class="kt-dict-lang-btn" data-lang="zh">🇹🇼 中国語は？</button>
  `;
  card.appendChild(btnRow);

  btnRow.querySelectorAll('.kt-dict-lang-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const lang = btn.dataset.lang;
      const line = document.createElement('div');
      line.className = 'kt-dict-lang-line';
      if (lang === 'ko') {
        line.innerHTML = `🇰🇷 ${item.ko}<span class="kt-lang-kana">${item.koKana}</span>`;
      } else {
        line.innerHTML = `🇹🇼 ${item.zh}<span class="kt-lang-kana">${item.zhPinyin}／${item.zhKana}</span>`;
      }
      btn.replaceWith(line);
    });
  });
}

/* ---------- プレイ前・リセット後のプレースホルダー ---------- */
function showPlaceholder() {
  shell.board.className = 's-board';
  shell.board.innerHTML = `
    <div class="kt-menu">
      <p>あいさつ／買い物／レストランなど<br>日常会話のフレーズが学べます。<br>韓国語・中国語訳もこっそり見られます。</p>
      <p>「スタート」を押すとはじまります</p>
    </div>
  `;
}
showPlaceholder();

/* ---- GameShellのライフサイクルに接続 ---- */
shell.onStart(() => {
  showModeSelect();
});
shell.onReset(() => {
  quiz = null;
  showPlaceholder();
});
