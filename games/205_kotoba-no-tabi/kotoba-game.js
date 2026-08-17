/* =========================================================
   ことばの旅🌍 固有ロジック
   -----------------------------------------------------------
   モード選択 → (クイズ:シーン選択→出題) / (辞書:シーン一覧)
   の2画面構造。shell.board内をJSで丸ごと描き替える方式。

   クイズ：通常＝選んだシーンから8問・日→英のみ。
           激むず＝全シーン混合12問・日→英/英→日をランダム。
   辞書　：JAタップ→EN表示、さらに「🇪🇸スペイン語は？」で
           ES表示という二段階の隠し分岐（クイズにも同じ仕組み）。
   ========================================================= */

const shell = new GameShell({
  rootSelector: '#app',
  title: 'ことばの旅🌍',
  hint: 'クイズか辞書を選んで、日常会話フレーズを学びましょう（タイトル5回タップで激むず＝全シーン12問ミックス／出題方向ランダム。プレイ中は切替不可）',
  hasScore: true,
  hasTimer: false,
});

const SCENES = {
  greeting: {
    label: 'あいさつ', emoji: '👋',
    items: [
      { ja: 'おはようございます', en: 'Good morning', es: 'Buenos días', esKana: 'ブエノス ディアス' },
      { ja: 'こんにちは', en: 'Good afternoon', es: 'Buenas tardes', esKana: 'ブエナス タルデス' },
      { ja: 'こんばんは', en: 'Good evening', es: 'Buenas noches', esKana: 'ブエナス ノチェス' },
      { ja: 'ありがとうございます', en: 'Thank you very much', es: 'Muchas gracias', esKana: 'ムーチャス グラシアス' },
      { ja: 'すみません', en: 'Excuse me', es: 'Disculpe', esKana: 'ディスクルペ' },
      { ja: 'はじめまして', en: 'Nice to meet you', es: 'Mucho gusto', esKana: 'ムーチョ グスト' },
      { ja: 'お元気ですか', en: 'How are you?', es: '¿Cómo está usted?', esKana: 'コモ エスタ ウステッ' },
      { ja: 'さようなら', en: 'Goodbye', es: 'Adiós', esKana: 'アディオス' },
      { ja: 'お願いします', en: 'Please', es: 'Por favor', esKana: 'ポル ファボール' },
      { ja: 'お大事に', en: 'Take care', es: 'Cuídese', esKana: 'クイデセ' },
    ],
  },
  shopping: {
    label: '買い物', emoji: '🛍️',
    items: [
      { ja: 'いくらですか', en: 'How much is it?', es: '¿Cuánto cuesta?', esKana: 'クアント クエスタ' },
      { ja: 'これをください', en: "I'll take this, please", es: 'Deme esto, por favor', esKana: 'デメ エスト、ポル ファボール' },
      { ja: 'クレジットカードは使えますか', en: 'May I pay with a credit card?', es: '¿Puedo pagar con tarjeta?', esKana: 'プエド パガール コン タルヘタ' },
      { ja: '試着してもいいですか', en: 'May I try this on?', es: '¿Puedo probármelo?', esKana: 'プエド プロバールメロ' },
      { ja: 'もう少し安くなりますか', en: 'Could you make it a little cheaper?', es: '¿Puede rebajar el precio?', esKana: 'プエデ レバハール エル プレシオ' },
      { ja: '袋は要りません', en: "I don't need a bag", es: 'No necesito bolsa', esKana: 'ノ ネセシト ボルサ' },
      { ja: 'サイズはありますか', en: 'Do you have this in my size?', es: '¿Tiene esto en mi talla?', esKana: 'ティエネ エスト エン ミ タヤ' },
      { ja: 'レシートをください', en: 'May I have the receipt, please?', es: '¿Me da el recibo, por favor?', esKana: 'メ ダ エル レシボ、ポル ファボール' },
      { ja: '他の色はありますか', en: 'Do you have other colors?', es: '¿Tiene otros colores?', esKana: 'ティエネ オトロス コロレス' },
      { ja: '返品できますか', en: 'May I return this?', es: '¿Puedo devolver esto?', esKana: 'プエド デボルベール エスト' },
    ],
  },
  restaurant: {
    label: 'レストラン', emoji: '🍽️',
    items: [
      { ja: 'メニューを見せてください', en: 'May I see the menu?', es: '¿Me muestra el menú?', esKana: 'メ ムエストラ エル メヌ' },
      { ja: 'おすすめは何ですか', en: 'What do you recommend?', es: '¿Qué me recomienda?', esKana: 'ケ メ レコミエンダ' },
      { ja: 'お水をください', en: 'Water, please', es: 'Agua, por favor', esKana: 'アグア、ポル ファボール' },
      { ja: '会計をお願いします', en: 'Could I have the check, please?', es: 'La cuenta, por favor', esKana: 'ラ クエンタ、ポル ファボール' },
      { ja: 'これは辛いですか', en: 'Is this spicy?', es: '¿Esto es picante?', esKana: 'エスト エス ピカンテ' },
      { ja: 'アレルギーがあります', en: 'I have an allergy', es: 'Tengo alergia', esKana: 'テンゴ アレルヒア' },
      { ja: 'とてもおいしかったです', en: 'It was delicious', es: 'Estuvo delicioso', esKana: 'エストゥボ デリシオソ' },
      { ja: '予約をしています', en: 'I have a reservation', es: 'Tengo una reserva', esKana: 'テンゴ ウナ レセルバ' },
      { ja: '別々に払えますか', en: 'May we pay separately?', es: '¿Podemos pagar por separado?', esKana: 'ポデモス パガール ポル セパラド' },
      { ja: '持ち帰りできますか', en: 'May I get this to go?', es: '¿Puedo llevarlo para llevar?', esKana: 'プエド ジェバルロ パラ ジェバール' },
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
      <p>クイズで力だめし、または辞書でじっくり眺めながら、日・英・スペイン語のフレーズを学べます。</p>
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
    <button class="kt-es-reveal-btn">🇪🇸 スペイン語では？</button>
    <button class="kt-next-btn">次へ</button>
  `;
  shell.board.appendChild(feedback);

  feedback.querySelector('.kt-es-reveal-btn').addEventListener('click', (e) => {
    const line = document.createElement('div');
    line.className = 'kt-es-line';
    line.innerHTML = `🇪🇸 ${item.es}<span class="kt-es-kana">${item.esKana}</span>`;
    e.target.replaceWith(line);
  });
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
  const esBtn = document.createElement('button');
  esBtn.className = 'kt-dict-es-btn';
  esBtn.textContent = '🇪🇸 スペイン語は？';
  esBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const es = document.createElement('div');
    es.className = 'kt-dict-es';
    es.innerHTML = `🇪🇸 ${item.es}<span class="kt-es-kana">${item.esKana}</span>`;
    esBtn.replaceWith(es);
  });
  card.appendChild(en);
  card.appendChild(esBtn);
}

/* ---------- プレイ前・リセット後のプレースホルダー ---------- */
function showPlaceholder() {
  shell.board.className = 's-board';
  shell.board.innerHTML = `
    <div class="kt-menu">
      <p>あいさつ／買い物／レストランなど<br>日常会話のフレーズが学べます。<br>スペイン語訳もこっそり見られます。</p>
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
