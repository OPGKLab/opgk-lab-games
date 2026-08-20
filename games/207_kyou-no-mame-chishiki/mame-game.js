/* =========================================================
   きょうの豆知識📅 固有ロジック
   共通土台(GameShell)のAPIだけを使い、週間タブ選択式のクイズを実装。
   - 今週（日〜土）のみ選択可
   - 1日あたり1問、選んだ曜日のクイズを表示
   - 激むずモード：よりマニアックな雑学に差し替え
   - データはMM-DDキーで管理。未収録の日は準備中表示（今後の週で順次拡張）
   ========================================================= */

const shell = new GameShell({
  rootSelector: '#app',
  title: 'きょうの豆知識📅',
  hint: '曜日を選んで、その日の豆知識クイズに挑戦しましょう',
  hasScore: false,
  hasTimer: false,
});

const WD = ['日', '月', '火', '水', '木', '金', '土'];

/* データ：MM-DDキー。history/season混在、hardはより細かい雑学 */
const DATA = {
  '08-16': {
    question: '毎年8月16日に京都で行われる、お盆のご先祖を送る伝統行事は？',
    choices: ['祇園祭', '五山の送り火', '葵祭', '時代祭'],
    answer: 1,
    explanation: '京都市を囲む5つの山に「大」や「妙法」などの火文字を灯し、ご先祖の霊をあの世へ送り出す行事です。',
    hard: {
      question: '五山の送り火で、いちばん最初に点火される山はどこ？',
      choices: ['大文字山', '松ヶ崎（妙法）', '船形', '鳥居形'],
      answer: 0,
      explanation: '20時ちょうどに大文字山が点火され、その後10分ごとに妙法・船形・左大文字・鳥居形と続きます。',
    },
  },
  '08-17': {
    question: '1945年8月17日に独立を宣言した東南アジアの国は？',
    choices: ['タイ', 'インドネシア', 'ベトナム', 'フィリピン'],
    answer: 1,
    explanation: 'スカルノらが独立を宣言し、長いオランダによる植民地支配に終止符を打ちました。',
    hard: {
      question: 'インドネシア独立宣言を読み上げた初代大統領は誰？',
      choices: ['スカルノ', 'ハッタ', 'スハルト', 'ユドヨノ'],
      answer: 0,
      explanation: '副大統領ハッタの立ち会いのもと、スカルノが独立宣言を読み上げました。',
    },
  },
  '08-18': {
    question: '8月18日が「米の日」とされる理由は？',
    choices: ['米の収穫が始まる日だから', '「米」の字を分解すると八十八になるから', '昔の暦で稲の日とされていたから', '米騒動が起きた日だから'],
    answer: 1,
    explanation: '「米」という漢字をばらすと「八十八」になることにちなんでいます。',
    hard: {
      question: '田植えから収穫まで、稲作には88の作業がかかるとも言われる。これも「米の日」の由来のひとつとされるが、その言い伝えのもとになった民謡は？',
      choices: ['米節（こめぶし）', 'ソーラン節', '炭坑節', '斎太郎節'],
      answer: 0,
      explanation: '宮城県民謡「米節」の歌詞に由来するとされ、米作りの手間への感謝が込められています。',
    },
  },
  '08-19': {
    question: '8月19日が「俳句の日」なのはなぜ？',
    choices: ['松尾芭蕉の誕生日だから', '「8（は）1（い）9（く）」の語呂合わせだから', '俳句甲子園が始まった日だから', '国が制定した祝日だから'],
    answer: 1,
    explanation: '数字の8・1・9を「はいく」と読む語呂合わせが由来です。',
    hard: {
      question: '「俳句の日」の制定を提唱した、正岡子規研究で知られる俳人は？',
      choices: ['坪内稔典', '高浜虚子', '種田山頭火', '小林一茶'],
      answer: 0,
      explanation: '俳人・坪内稔典氏らが1991年に提唱し、この日が「俳句の日」となりました。',
    },
  },
  '08-20': {
    question: '1931年8月20日、東京のある繁華街に日本初の3色灯の自動交通信号機が設置されました。その繁華街は？',
    choices: ['新宿', '浅草', '銀座', '渋谷'],
    answer: 2,
    explanation: '銀座の尾張町交差点など34か所に、赤・黄・青の3色が自動で切り替わる信号機が設置されました。',
    hard: {
      question: '日本で最初に（1930年、アメリカ製の）機械式信号機が設置された交差点はどこ？',
      choices: ['日比谷交差点', '渋谷スクランブル交差点', '新橋交差点', '上野広小路'],
      answer: 0,
      explanation: '1930年、日比谷交差点に日本初の機械式信号機が設置され、その翌年に銀座で3色灯式が導入されました。',
    },
  },
  '08-21': {
    question: '1911年8月21日、ルーヴル美術館からある名画が盗まれました。その絵とは？',
    choices: ['最後の晩餐', 'モナ・リザ', '真珠の耳飾りの少女', '叫び'],
    answer: 1,
    explanation: '「モナ・リザ」が盗まれた事件は世界中で報じられ、絵の知名度をさらに高めるきっかけになりました。',
    hard: {
      question: 'モナ・リザを盗んだ元ルーヴル職人の名前は？',
      choices: ['ビンセンツォ・ペルージャ', 'パブロ・ピカソ', 'ルイ・ベロー', 'ギヨーム・アポリネール'],
      answer: 0,
      explanation: '元ルーヴル職人のイタリア人、ビンセンツォ・ペルージャが犯人でした。ピカソも一時容疑者として尋問されましたが無実でした。',
    },
  },
  '08-22': {
    question: '1903年8月22日、東京で初めて開業した乗り物は？',
    choices: ['地下鉄', '路面電車', '乗合バス', 'ケーブルカー'],
    answer: 1,
    explanation: '新橋〜品川間で路面電車（愛称・チンチン電車）の営業運転が始まりました。',
    hard: {
      question: '日本で最初に路面電車が走ったのは京都でした。それは西暦何年？',
      choices: ['1890年', '1895年', '1903年', '1910年'],
      answer: 1,
      explanation: '1895年、京都電気鉄道が日本初の営業用路面電車として運行を始めました。東京での開業はその8年後です。',
    },
  },
  '08-23': {
    question: '1868年8月23日、戊辰戦争のさなかに会津藩の少年たちで編成された部隊が、飯盛山で命を絶ちました。この部隊の名は？',
    choices: ['白虎隊', '朱雀隊', '青龍隊', '玄武隊'],
    answer: 0,
    explanation: '会津藩は兵を年齢別に4部隊に分けており、16〜17歳の少年たちで編成されたのが「白虎隊」でした。',
    hard: {
      question: '白虎隊の少年たちが、若松城が燃えていると誤解して自刃した場所はどこ？',
      choices: ['飯盛山', '会津若松城本丸', '猪苗代湖畔', '磐梯山'],
      answer: 0,
      explanation: '飯盛山から城下に上がった火の手を見て、若松城が落城したと思い込み、20人全員が自刃しました。',
    },
  },
  '08-24': {
    question: '8月24日が「歯ブラシの日」なのはなぜ？',
    choices: ['歯医者の開業記念日だから', '「ハ(8)ブ(2)ラシ(4)」の語呂合わせだから', '世界初の歯ブラシが発売された日だから', '国が定めた祝日だから'],
    answer: 1,
    explanation: '数字の8・2・4を「はぶらし」と読む語呂合わせが由来です。',
    hard: {
      question: '歯ブラシの交換時期の目安として、毎月何日が「歯ブラシ交換デー」とされている？',
      choices: ['1日', '8日', '15日', '24日'],
      answer: 1,
      explanation: '歯（ハ＝8）にちなんで、毎月8日が歯ブラシの交換時期の目安とされています。',
    },
  },
  '08-25': {
    question: '1958年8月25日に日清食品が発売した、世界初のインスタントラーメンは？',
    choices: ['カップヌードル', 'チキンラーメン', '出前一丁', 'サッポロ一番'],
    answer: 1,
    explanation: '日清食品の創業者・安藤百福氏が開発した「チキンラーメン」が世界初の即席麺として発売されました。',
    hard: {
      question: 'チキンラーメンの開発で使われた、麺を油で揚げて乾燥させる製法の名前は？',
      choices: ['瞬間油熱乾燥法', '真空凍結乾燥法', '高温圧縮乾燥法', '蒸気熟成製法'],
      answer: 0,
      explanation: '麺を油で揚げることで水分を飛ばす「瞬間油熱乾燥法」が発明され、お湯を注ぐだけで食べられる即席麺が誕生しました。',
    },
  },
  '08-26': {
    question: '1789年8月26日、フランスの憲法制定国民議会が採択した、自由・平等などをうたう宣言は？',
    choices: ['独立宣言', '人権宣言', '権利章典', '解放宣言'],
    answer: 1,
    explanation: '正式名称は「人間および市民の権利の宣言」。フランス革命の理念を示す重要な文書です。',
    hard: {
      question: '8月26日は「ユースホステルの日」でもあります。その由来となった、ユースホステルの創始者はどこの国の人物？',
      choices: ['ドイツ', 'イギリス', 'スイス', 'フランス'],
      answer: 0,
      explanation: 'ドイツの小学校教師リヒャルト・シルマンが、遠足中の雨宿りをきっかけにユースホステルを考案しました。',
    },
  },
  '08-27': {
    question: '1969年8月27日に第1作が公開された、渥美清さん主演の国民的映画シリーズは？',
    choices: ['男はつらいよ', '釣りバカ日誌', 'フーテンの寅', '三丁目の夕日'],
    answer: 0,
    explanation: '山田洋次監督、渥美清さん主演の「男はつらいよ」第1作が公開され、後に48作に及ぶ世界最長シリーズとなりました。',
    hard: {
      question: '「男はつらいよ」は元々テレビドラマとして放送されていました。その最終回で主人公・寅次郎はどうなった設定だった？',
      choices: ['死亡した', '失踪した', '結婚した', '海外へ渡った'],
      answer: 0,
      explanation: 'テレビドラマ版の最終回では寅次郎が亡くなる設定でしたが、あまりの反響の大きさから映画で「復活」しました。',
    },
  },
  '08-28': {
    question: '1953年8月28日、日本初の民間放送テレビ局として開局したのは？',
    choices: ['NHK', '日本テレビ', 'TBS', 'フジテレビ'],
    answer: 1,
    explanation: '同年2月にNHKがテレビ放送を開始した半年後、日本テレビが民放第1号として開局しました。',
    hard: {
      question: '1953年8月28日、日本テレビの放送開始と同じ日に誕生したものは？',
      choices: ['日本初のテレビCM', '日本初のテレビアニメ', '日本初のニュース番組', '日本初のドラマ番組'],
      answer: 0,
      explanation: '精工舎（現セイコー）の時報CMが日本初のテレビCMとして放送されました（映像が裏返しに映る放送事故があったそうです）。',
    },
  },
  '08-29': {
    question: '8月29日が「焼き肉の日」なのはなぜ？',
    choices: ['「8(やき)2(に)9(く)」の語呂合わせだから', '焼き肉店の創業記念日だから', '肉の日として制定されたから', '秋の始まりを祝う日だから'],
    answer: 0,
    explanation: '1993年に全国焼肉協会が制定。日付の語呂合わせに、夏バテ予防に焼き肉を、という願いが込められています。',
    hard: {
      question: '「焼き肉の日」を含む、夏バテ防止の三大記念日と言われる組み合わせは、焼き肉の日・天ぷらの日と、あと一つは？',
      choices: ['土用の丑の日', 'うなぎの日', 'スタミナの日', '土用の虫干しの日'],
      answer: 0,
      explanation: '7月20日頃の「土用の丑の日」、7月23日の「天ぷらの日」、8月29日の「焼き肉の日」が、夏バテ防止の三大記念日と言われています。',
    },
  },
  '08-30': {
    question: '1895年8月30日、富士山の山頂剣ヶ峯に、気象学者・野中至が私財を投じて開設した施設は？',
    choices: ['測候所', '天文台', '灯台', '気球発射場'],
    answer: 0,
    explanation: '富士山頂に「野中測候所」が開設され、後の気象庁富士山測候所の前身となりました。',
    hard: {
      question: '野中至とともに、命がけで富士山頂での冬季観測に挑んだ人物は誰？',
      choices: ['妻の野中千代子', '弟の野中誠', '息子の野中一郎', '友人の測候技師'],
      answer: 0,
      explanation: '妻の千代子も同行して観測を続けましたが、厳しい寒さで夫妻とも体調を崩し、同年12月に観測を断念しました。',
    },
  },
  '08-31': {
    question: '8月31日が「野菜の日」なのはなぜ？',
    choices: ['「8(や)3(さ)1(い)」の語呂合わせだから', '野菜の収穫祭が開かれる日だから', '国連が定めた国際デーだから', '野菜の品種改良が始まった日だから'],
    answer: 0,
    explanation: '数字の8・3・1を「やさい」と読む語呂合わせから、1983年に関連団体が制定しました。',
    hard: {
      question: '「野菜の日」に合わせて、8月24日が「ドレッシングの日」とされているのはなぜ？',
      choices: ['カレンダー上で野菜の日の真上にくるから', 'ドレッシングの発売日だから', '野菜より1週間早く収穫されるから', '語呂合わせが似ているから'],
      answer: 0,
      explanation: 'ドレッシングは野菜にかけることが多いため、月めくりカレンダーで「野菜の日」（8月31日）の真上にくる8月24日が選ばれました。',
    },
  },
  '09-01': {
    question: '9月1日「防災の日」は、1923年に起きたある災害にちなんで制定されました。その災害とは？',
    choices: ['関東大震災', '伊勢湾台風', '濃尾地震', '昭和三陸津波'],
    answer: 0,
    explanation: '1923年9月1日に発生した関東大震災の教訓を忘れないよう、1960年に「防災の日」が制定されました。',
    hard: {
      question: '防災の日を含む「防災週間」は、8月30日から何日までとされている？',
      choices: ['9月3日', '9月5日', '9月7日', '9月10日'],
      answer: 1,
      explanation: '8月30日から9月5日までの1週間が「防災週間」とされ、各地で防災訓練が行われます。',
    },
  },
  '09-02': {
    question: '9月2日が「宝くじの日」なのはなぜ？',
    choices: ['「く(9)じ(2)」の語呂合わせだから', '宝くじが日本で初めて発売された日だから', '高額当選が相次いだ日だから', '国が宝くじ制度を作った日だから'],
    answer: 0,
    explanation: '数字の9・2を「くじ」と読む語呂合わせから、当選金の引き換え忘れ防止を目的に1967年に制定されました。',
    hard: {
      question: '1945年9月2日、東京湾に停泊したアメリカの戦艦上で日本が降伏文書に調印し、第二次世界大戦が正式に終結しました。その戦艦の名は？',
      choices: ['ミズーリ号', 'アリゾナ号', 'エンタープライズ号', 'ヨークタウン号'],
      answer: 0,
      explanation: '戦艦ミズーリの甲板上で調印式が行われ、これにより第二次世界大戦が正式に終わりました。',
    },
  },
  '09-03': {
    question: '1977年9月3日、読売ジャイアンツの王貞治選手が達成した世界新記録は？',
    choices: ['通算756号本塁打', '3000本安打', '2000試合連続出場', '打率4割'],
    answer: 0,
    explanation: '王貞治選手がハンク・アーロン選手の記録を抜く通算756号本塁打を放ち、世界新記録を達成しました。',
    hard: {
      question: '王貞治選手の世界新記録達成を称え、当時の内閣総理大臣が創設した賞は？',
      choices: ['国民栄誉賞', '文化勲章', '内閣総理大臣顕彰', 'スポーツ功労賞'],
      answer: 0,
      explanation: '福田赳夫首相が「国民栄誉賞」を創設し、王貞治選手がその第1号として表彰されました。',
    },
  },
  '09-04': {
    question: '9月4日が「くしの日」なのはなぜ？',
    choices: ['「く(9)し(4)」の語呂合わせだから', 'くしの発明記念日だから', '美容師の国家資格ができた日だから', 'くしを使った祭りが始まった日だから'],
    answer: 0,
    explanation: '数字の9・4を「くし」と読む語呂合わせから、美容関係者らが1978年に制定しました。',
    hard: {
      question: '1994年9月4日に開港した、世界初の本格的な海上空港は？',
      choices: ['関西国際空港', '中部国際空港', '羽田空港', '成田国際空港'],
      answer: 0,
      explanation: '大阪湾の人工島に建設された関西国際空港が、世界初の本格的な海上空港として開港しました。',
    },
  },
  '09-05': {
    question: '1955年9月5日、後楽園遊園地に日本で初めて設置された本格的な乗り物は？',
    choices: ['観覧車', 'ジェットコースター', 'メリーゴーランド', 'ゴーカート'],
    answer: 1,
    explanation: '後楽園遊園地（現・東京ドームシティ）に日本初の本格的なジェットコースターが設置され、話題になりました。',
    hard: {
      question: '9月5日は「クリーンコールデー」でもあります。この記念日名は何の語呂合わせ？',
      choices: ['ク(9)リーン・コ(5)ール', 'ク(9)ール・コ(5)ンボ', 'ク(9)ラシック・コ(5)ンサート', 'ク(9)リア・コ(5)ード'],
      answer: 0,
      explanation: '石炭をクリーンなエネルギーとして再評価する狙いから、1992年に制定されました。',
    },
  },
};

let weekDates = [];
let answered = {};

function pad(n) { return String(n).padStart(2, '0'); }
function dateKey(d) { return `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }

function getWeekDates(base) {
  const day = base.getDay();
  const sun = new Date(base.getFullYear(), base.getMonth(), base.getDate() - day);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(sun);
    d.setDate(sun.getDate() + i);
    return d;
  });
}

function showPlaceholder() {
  shell.board.className = 's-board';
  shell.board.innerHTML = '<div class="mame-placeholder">「スタート」を押すと今週のカレンダーが表示されます</div>';
}

function buildBoard() {
  const today = new Date();
  weekDates = getWeekDates(today);
  const todayKey = dateKey(today);

  shell.board.className = 's-board mame-board';
  shell.board.innerHTML = '';

  const tabRow = document.createElement('div');
  tabRow.className = 'mame-tabs';
  weekDates.forEach((d) => {
    const key = dateKey(d);
    const btn = document.createElement('button');
    btn.className = 'mame-tab';
    btn.dataset.key = key;
    if (key === todayKey) btn.classList.add('mame-tab-today');
    if (answered[key]) btn.classList.add('mame-tab-done');
    btn.innerHTML = `<span class="mame-tab-wd">${WD[d.getDay()]}</span><span class="mame-tab-date">${d.getDate()}</span>`;
    btn.addEventListener('click', () => selectDay(key));
    tabRow.appendChild(btn);
  });
  shell.board.appendChild(tabRow);

  const card = document.createElement('div');
  card.className = 'mame-card';
  card.id = 'mameCard';
  shell.board.appendChild(card);

  selectDay(todayKey);
}

function selectDay(key) {
  shell.board.querySelectorAll('.mame-tab').forEach((b) => {
    b.classList.toggle('mame-tab-selected', b.dataset.key === key);
  });
  renderQuestion(key);
}

function findDate(key) {
  return weekDates.find((d) => dateKey(d) === key);
}

function renderQuestion(key) {
  const card = document.getElementById('mameCard');
  const d = findDate(key);
  const entry = DATA[key];

  if (!entry) {
    card.innerHTML = `<p class="mame-date">${d.getMonth() + 1}月${d.getDate()}日</p><p class="mame-noentry">この日の豆知識はただいま準備中です🌱</p>`;
    return;
  }

  const q = shell.hardMode && entry.hard ? entry.hard : entry;
  const isAnswered = answered[key];

  card.innerHTML = `
    <p class="mame-date">${d.getMonth() + 1}月${d.getDate()}日</p>
    <p class="mame-question">${q.question}</p>
    <div class="mame-choices"></div>
    <p class="mame-explain" id="mameExplain" style="display:none;"></p>
  `;

  const choiceWrap = card.querySelector('.mame-choices');
  q.choices.forEach((c, i) => {
    const b = document.createElement('button');
    b.className = 'mame-choice';
    b.textContent = c;
    if (isAnswered) {
      b.disabled = true;
      if (i === q.answer) b.classList.add('mame-choice-correct');
    }
    b.addEventListener('click', () => onAnswer(key, i, q));
    choiceWrap.appendChild(b);
  });

  if (isAnswered) {
    const ex = card.querySelector('#mameExplain');
    ex.style.display = 'block';
    ex.textContent = q.explanation;
  }
}

function onAnswer(key, idx, q) {
  if (!shell.running || answered[key]) return;
  answered[key] = true;

  const correct = idx === q.answer;
  shell.playTone(correct ? 660 : 330, correct ? 0.15 : 0.2, correct ? 'triangle' : 'sine');
  shell.toast(correct ? '正解です！' : `残念、正解は「${q.choices[q.answer]}」でした`);

  const tabBtn = shell.board.querySelector(`.mame-tab[data-key="${key}"]`);
  if (tabBtn) tabBtn.classList.add('mame-tab-done');

  renderQuestion(key);
  checkComplete();
}

function checkComplete() {
  const allDone = weekDates.every((d) => {
    const key = dateKey(d);
    return DATA[key] ? answered[key] : true;
  });
  if (allDone) {
    shell.end('今週の豆知識、ぜんぶチェックしました🎉');
  }
}

showPlaceholder();

/* ---- GameShellのライフサイクルに接続 ---- */
shell.onStart(() => {
  buildBoard();
});
shell.onReset(() => {
  answered = {};
  showPlaceholder();
});
