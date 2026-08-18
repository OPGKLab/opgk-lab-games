/* =========================================================
   おさんぽ日和🐕‍🦺 固有ロジック
   共通土台(GameShell)のAPIだけを使い、3レーン自動スクロール＋
   左右移動によるキャッチ、図鑑登録、ハザード回避を実装。
   ゴールなし・エンドレス。「今日のおさんぽはここまで」ボタンで任意終了。
   ========================================================= */

const shell = new GameShell({
  rootSelector: '#app',
  title: 'おさんぽ日和🐕‍🦺',
  hint: '左右ボタンでレーンを移動して「？」をキャッチ（タイトル5回タップで激むず）',
  hasScore: false,
  hasTimer: false,
});

/* ---------- 図鑑データ ---------- */
const LIVING_POOL = [
  { id: 'inu', emoji: '🐶', name: 'いぬ', note: '鼻紋は指紋のように1匹ずつ違います' },
  { id: 'neko', emoji: '🐱', name: 'ねこ', note: 'ヒゲの長さで体の幅を測っています' },
  { id: 'kotori', emoji: '🐦', name: 'ことり', note: '骨の中まで空洞で体を軽くしています' },
  { id: 'risu', emoji: '🐿️', name: 'りす', note: '木の実を埋めた場所を高確率で忘れます' },
  { id: 'usagi', emoji: '🐇', name: 'うさぎ', note: '耳を動かして体温を調節しています' },
  { id: 'kamo', emoji: '🦆', name: 'かも', note: '羽はいつも油でコーティングされ水を弾きます' },
  { id: 'kame', emoji: '🐢', name: 'かめ', note: '甲羅には神経が通っていて触るとわかります' },
  { id: 'uma', emoji: '🐴', name: 'うま', note: '立ったまま眠ることができます' },
  { id: 'ushi', emoji: '🐮', name: 'うし', note: '仲の良い牛を見分けて群れをつくります' },
  { id: 'hitsuji', emoji: '🐑', name: 'ひつじ', note: '毛は一年中伸び続けます' },
  { id: 'fukurou', emoji: '🦉', name: 'ふくろう', note: '首を約270度回すことができます' },
  { id: 'niwatori', emoji: '🐔', name: 'にわとり', note: '実は少しだけ空を飛べます' },
];

// season: 'all' | 'spring' | 'summer' | 'autumn' | 'winter'
const TOWN_POOL = [
  { id: 'jitensha', emoji: '🚲', name: 'じてんしゃ', season: 'all', note: '世界最初の自転車にはペダルがありませんでした' },
  { id: 'post', emoji: '📮', name: 'ポスト', season: 'all', note: '日本の郵便ポストは形も色も進化してきました' },
  { id: 'enpitsu', emoji: '✏️', name: 'えんぴつ', season: 'all', note: '1本で約50kmの線が書けるといわれています' },
  { id: 'coin', emoji: '🪙', name: 'コイン', season: 'all', note: '硬貨のギザギザは偽造防止のためにあります' },
  { id: 'fuusen', emoji: '🎈', name: 'ふうせん', season: 'all', note: 'ヘリウム入りは数日で少ししぼんでしまいます' },
  { id: 'tebukuro', emoji: '🧤', name: 'てぶくろ（おとしもの）', season: 'all', note: '片方だけ落ちてしまうことが多いおとしものです' },
  { id: 'ball', emoji: '⚽', name: 'ボール', season: 'all', note: '正六角形と正五角形を組み合わせた模様です' },
  { id: 'kutsushita', emoji: '🧦', name: 'くつした（おとしもの）', season: 'all', note: '洗濯のたびに片方だけ行方不明になりがちです' },
  { id: 'kagi', emoji: '🔑', name: 'かぎ', season: 'all', note: '世界最古の鍵は木製だったといわれています' },
  { id: 'osaifu', emoji: '👛', name: 'おさいふ', season: 'all', note: '「お財布を忘れた」は世界共通のあるあるです' },
  { id: 'koinobori', emoji: '🎏', name: 'こいのぼり', season: 'spring', note: '一番上の吹き流しは魔除けの意味があります' },
  { id: 'ochiba', emoji: '🍁', name: 'おちば', season: 'autumn', note: '落ち葉のじゅうたんは踏むと良い音がします' },
  { id: 'sakura', emoji: '🌸', name: 'さくら', season: 'spring', note: '満開から散るまで約1週間ほどです' },
  { id: 'himawari', emoji: '🌻', name: 'ひまわり', season: 'summer', note: '若い花は太陽の方向を追いかけて動きます' },
  { id: 'sasanoha', emoji: '🎋', name: 'ささのは', season: 'summer', note: '七夕の短冊はもともと中国由来の風習です' },
  { id: 'yukidaruma', emoji: '⛄', name: 'ゆきだるま', season: 'winter', note: '二段だるまは日本ならではの形だそうです' },
  { id: 'xmastree', emoji: '🎄', name: 'クリスマスツリー', season: 'winter', note: 'モミの木は冬でも葉を落としません' },
  { id: 'chouchin', emoji: '🏮', name: 'ちょうちん', season: 'summer', note: '中の明かりが風でゆらゆら揺れます' },
  { id: 'shingou', emoji: '🚦', name: 'しんごう', season: 'all', note: '世界初の信号機はガス灯式でした' },
  { id: 'basutei', emoji: '🚏', name: 'バスてい', season: 'all', note: 'バスを待つ時間が一番長く感じるそうです' },
  { id: 'bench', emoji: '🪑', name: 'ベンチ', season: 'all', note: '公園のベンチは一休みにちょうどいい高さです' },
  { id: 'funsui', emoji: '⛲', name: 'ふんすい', season: 'all', note: '水音には気持ちを落ち着ける効果があるそうです' },
  { id: 'gomibako', emoji: '🗑️', name: 'ごみばこ', season: 'all', note: 'きちんと分別されているとちょっと嬉しいです' },
  { id: 'tobira', emoji: '🚪', name: 'とびら', season: 'all', note: 'ノックの回数にもマナーがあるとかないとか' },
  { id: 'ouchi', emoji: '🏠', name: 'おうち', season: 'all', note: '屋根の形は雪や雨の量で地域ごとに違います' },
  { id: 'ooki_na_ki', emoji: '🌳', name: 'おおきなき', season: 'all', note: '大きな木の下は夏でもひんやり涼しいです' },
  { id: 'present', emoji: '🎁', name: 'プレゼント', season: 'all', note: 'リボン結びにも国ごとの流派があるそうです' },
  { id: 'ehon', emoji: '📚', name: 'えほん', season: 'all', note: '同じ絵本でも読むたびに違う発見があります' },
  { id: 'yakyuu_ball', emoji: '⚾', name: 'やきゅうボール', season: 'all', note: '縫い目は108個あるといわれています' },
  { id: 'yoyo', emoji: '🪀', name: 'ヨーヨー', season: 'all', note: '紐の長さで技の難易度が変わります' },
  { id: 'palette', emoji: '🎨', name: 'パレット', season: 'all', note: '絵の具を混ぜすぎると茶色っぽくなりがちです' },
  { id: 'nuigurumi', emoji: '🧸', name: 'ぬいぐるみ', season: 'all', note: '抱きしめると心拍数が落ち着くといわれています' },
  { id: 'ribbon', emoji: '🎀', name: 'リボン', season: 'all', note: 'リボン結びは意外と奥が深い手技です' },
  { id: 'kasa', emoji: '☂️', name: 'かさ', season: 'all', note: '忘れ物ナンバーワンともいわれるアイテムです' },
  { id: 'muffler', emoji: '🧣', name: 'マフラー', season: 'winter', note: '首元を温めると全身がぽかぽかしやすいです' },
  { id: 'boushi', emoji: '🧢', name: 'ぼうし', season: 'all', note: 'つばの向きでちょっと印象が変わります' },
];

const RARE_POOL = [
  { id: 'poodle', emoji: '🐩', name: 'プードル', note: '巻き毛は元々水猟犬として活躍した名残です' },
  { id: 'kuma_saru', emoji: '🐻🐒', name: 'くまとさるのコンビ', note: '森の仲良しコンビ、なかなか同時には会えません' },
];

// すれ違い挨拶イベント専用：図鑑には登録されない、完全に雰囲気演出
const PASSERBY_POOL = [
  { emoji: '🐕', greet: 'ワン！' },
  { emoji: '🐈', greet: 'にゃー！' },
];

/* ---------- 今日のお題 ---------- */
const LOST_ITEM_IDS = ['tebukuro', 'kutsushita', 'kagi', 'osaifu', 'kasa'];
const STREET_ITEM_IDS = ['jitensha', 'shingou', 'basutei', 'post'];

const THEMES = [
  { label: '🐾 生きものをさがそう', match: (it) => LIVING_POOL.includes(it) },
  { label: '🌸 季節のいろどりをさがそう', match: (it) => TOWN_POOL.includes(it) && it.season !== 'all' },
  { label: '👛 おとしものをさがそう', match: (it) => LOST_ITEM_IDS.includes(it.id) },
  { label: '🚲 まちかどをさがそう', match: (it) => STREET_ITEM_IDS.includes(it.id) },
  { label: '💗 大好きな子に出会おう', match: (it) => RARE_POOL.includes(it) },
];

/* ---------- 難易度別パラメータ ---------- */
// scrollSpeed: 1秒あたりに進む割合(%)  spawnIntervalMin/Max: 出現間隔(ms)
const NORMAL_MODE = { scrollSpeed: 16, spawnIntervalMin: 1300, spawnIntervalMax: 2000, hazardWeight: 14 };
const HARD_MODE = { scrollSpeed: 26, spawnIntervalMin: 800, spawnIntervalMax: 1300, hazardWeight: 24 };
const RARE_WEIGHT = 4;      // 100分率のうちレア枠に割く重み
const PASSERBY_WEIGHT = 10; // 100分率のうちすれ違いイベントに割く重み
const MAX_ACTIVE_ITEMS = 4; // 画面内に同時に出す上限（渋滞防止）
const CATCH_LINE = 76;      // %。この位置あたりで犬とすれ違う
const REMOVE_LINE = 108;    // %。これを超えたら盤面から除去
const ADMIRE_HOLD_MS = 1400; // 発見直後、その場に留まって鑑賞できる時間

const LANES = [20, 50, 80]; // %（均等配置。原因だった反転時のワープを解消したため対称に戻せる）

let findPool = [];      // 今回のセッションで出現しうる通常枠（季節フィルタ済み）
let totalCount = 0;     // 今回の図鑑コンプ総数
let foundIds = new Set();
let currentLane = 1;
let facingLeft = true;
let items = [];
let itemSeq = 1;
let spawnTimer = null;
let rafId = null;
let lastTs = 0;
let dogEl, zukanCountEl, boardEl;
let zukanModalEl, zukanGridEl;
let dogFlipEl, dogWagEl, moodBadgeEl;
let streak = 0;
let currentTheme = null;
let themeAchieved = false;
let themeStatusEl;

/* ---------- 季節判定 ---------- */
function getCurrentSeason() {
  const m = new Date().getMonth(); // 0-11
  if (m >= 2 && m <= 4) return 'spring';
  if (m >= 5 && m <= 7) return 'summer';
  if (m >= 8 && m <= 10) return 'autumn';
  return 'winter';
}

/* ---------- 時間帯判定（盤面の色調のみに使用） ---------- */
function getTimeOfDay() {
  const h = new Date().getHours();
  if (h >= 5 && h < 10) return 'morning';
  if (h >= 10 && h < 16) return 'day';
  if (h >= 16 && h < 19) return 'evening';
  return 'night';
}
const TIME_OF_DAY = getTimeOfDay(); // セッション中は固定（プレイ中に時間帯が切り替わって見た目が変わらないように）

function buildFindPool() {
  const season = getCurrentSeason();
  const seasonalTown = TOWN_POOL.filter((it) => it.season === 'all' || it.season === season);
  findPool = LIVING_POOL.concat(seasonalTown);
  totalCount = findPool.length + RARE_POOL.length;
}

/* ---------- 図鑑モーダル ---------- */
function buildZukanModal() {
  const root = document.querySelector(shell.cfg.rootSelector);
  const modal = document.createElement('div');
  modal.className = 'osanpo-zukan-modal';
  modal.innerHTML = `
    <div class="osanpo-zukan-panel">
      <div class="osanpo-zukan-header">
        <span>📖 図鑑一覧</span>
        <button class="osanpo-zukan-close" id="osanpoZukanClose">✕</button>
      </div>
      <div class="osanpo-zukan-grid" id="osanpoZukanGrid"></div>
    </div>
  `;
  root.appendChild(modal);
  modal.querySelector('#osanpoZukanClose').addEventListener('click', closeZukanModal);
  modal.addEventListener('click', (e) => { if (e.target === modal) closeZukanModal(); });
  zukanModalEl = modal;
  zukanGridEl = modal.querySelector('#osanpoZukanGrid');
}

function renderZukanGrid() {
  const all = findPool.concat(RARE_POOL);
  zukanGridEl.innerHTML = all.map((it) => {
    const found = foundIds.has(it.id);
    const rareClass = RARE_POOL.includes(it) ? ' osanpo-zukan-rare' : '';
    return `
      <div class="osanpo-zukan-cell${found ? ' osanpo-zukan-found' : ''}${rareClass}" data-id="${it.id}">
        <div class="osanpo-zukan-emoji">${found ? it.emoji : '？'}</div>
        <div class="osanpo-zukan-name">${found ? it.name : '？？？'}</div>
      </div>`;
  }).join('');

  zukanGridEl.querySelectorAll('.osanpo-zukan-cell.osanpo-zukan-found').forEach((cell) => {
    cell.addEventListener('click', () => {
      const item = all.find((it) => it.id === cell.dataset.id);
      if (item && item.note) shell.toast(`${item.name}：${item.note}`);
    });
  });
}

function openZukanModal() {
  renderZukanGrid();
  zukanModalEl.classList.add('osanpo-zukan-open');
}
function closeZukanModal() {
  zukanModalEl.classList.remove('osanpo-zukan-open');
}


function buildBoard() {
  buildFindPool();
  foundIds = new Set();
  items = [];
  currentLane = 1;
  facingLeft = true;
  currentTheme = THEMES[(Math.random() * THEMES.length) | 0];
  themeAchieved = false;

  shell.board.className = `s-board osanpo-board osanpo-tod-${TIME_OF_DAY}`;
  shell.board.innerHTML = `
    <div class="osanpo-toolbar">
      <span class="osanpo-zukan">図鑑：<b id="osanpoCount">0</b> / <b>${totalCount}</b> 発見</span>
      <button class="s-icon-btn-text osanpo-zukan-btn" id="osanpoZukanBtn">📖 図鑑</button>
      <button class="s-icon-btn-text osanpo-end-btn" id="osanpoEndBtn">今日はここまで</button>
    </div>
    <div class="osanpo-theme-row">
      きょうのお題：${currentTheme.label}
      <span class="osanpo-theme-status" id="osanpoThemeStatus"></span>
    </div>
    <div class="osanpo-field" id="osanpoField">
      <div class="osanpo-lane-line" style="left:20%"></div>
      <div class="osanpo-lane-line" style="left:50%"></div>
      <div class="osanpo-lane-line" style="left:80%"></div>
      <div class="osanpo-dog" id="osanpoDog">
        <span class="osanpo-dog-flip" id="osanpoDogFlip"><span class="osanpo-dog-wag" id="osanpoDogWag">🐕‍🦺</span></span>
        <span class="osanpo-mood-badge" id="osanpoMoodBadge"></span>
      </div>
    </div>
    <div class="osanpo-controls">
      <button class="s-btn osanpo-lane-btn" id="osanpoLeftBtn">◀</button>
      <button class="s-btn osanpo-lane-btn" id="osanpoRightBtn">▶</button>
    </div>
  `;
  boardEl = shell.board.querySelector('#osanpoField');
  dogEl = shell.board.querySelector('#osanpoDog');
  dogFlipEl = shell.board.querySelector('#osanpoDogFlip');
  dogWagEl = shell.board.querySelector('#osanpoDogWag');
  moodBadgeEl = shell.board.querySelector('#osanpoMoodBadge');
  zukanCountEl = shell.board.querySelector('#osanpoCount');
  themeStatusEl = shell.board.querySelector('#osanpoThemeStatus');

  shell.board.querySelector('#osanpoLeftBtn').addEventListener('click', () => moveLane(-1));
  shell.board.querySelector('#osanpoRightBtn').addEventListener('click', () => moveLane(1));
  shell.board.querySelector('#osanpoEndBtn').addEventListener('click', finishWalk);
  shell.board.querySelector('#osanpoZukanBtn').addEventListener('click', openZukanModal);

  streak = 0;
  updateDogPosition();
  updateMood();
}

function showPlaceholder() {
  shell.board.className = `s-board osanpo-tod-${TIME_OF_DAY}`;
  shell.board.innerHTML = `
    <div class="osanpo-placeholder">「スタート」を押すとお散歩が始まります</div>
    <div class="osanpo-placeholder-zukan-row">
      <button class="s-icon-btn-text osanpo-zukan-btn" id="osanpoZukanBtnIdle">📖 図鑑を見る</button>
    </div>
  `;
  shell.board.querySelector('#osanpoZukanBtnIdle').addEventListener('click', openZukanModal);
}

/* ---------- 犬の移動 ---------- */
function moveLane(dir) {
  if (!shell.running) return;
  const next = currentLane + dir;
  if (next < 0 || next > 2) return;
  facingLeft = dir > 0;
  currentLane = next;
  updateDogPosition();
  shell.playTone(500, 0.05);
}

function updateDogPosition() {
  if (!dogEl) return;
  dogEl.style.left = `${LANES[currentLane]}%`;
  dogFlipEl.style.setProperty('--flip', facingLeft ? -1 : 1);
}

function flinchDog() {
  dogWagEl.classList.add('osanpo-dog-flinch');
  setTimeout(() => dogWagEl.classList.remove('osanpo-dog-flinch'), 350);
}

/* ---------- ごきげんメーター ---------- */
const MOOD_LEVELS = [
  { min: 6, cls: 'osanpo-mood-3', badge: '😆' },
  { min: 3, cls: 'osanpo-mood-2', badge: '🥰' },
  { min: 1, cls: 'osanpo-mood-1', badge: '🙂' },
];

function updateMood() {
  dogWagEl.classList.remove('osanpo-mood-1', 'osanpo-mood-2', 'osanpo-mood-3');
  const level = MOOD_LEVELS.find((l) => streak >= l.min);
  if (level) {
    dogWagEl.classList.add(level.cls);
    moodBadgeEl.textContent = level.badge;
    moodBadgeEl.classList.add('osanpo-mood-badge-show');
  } else {
    moodBadgeEl.textContent = '';
    moodBadgeEl.classList.remove('osanpo-mood-badge-show');
  }
}

/* ---------- 出現 ---------- */
function pickSpawn() {
  const mode = shell.hardMode ? HARD_MODE : NORMAL_MODE;
  const r = Math.random() * 100;
  let acc = mode.hazardWeight;
  if (r < acc) return { kind: 'hazard' };
  acc += PASSERBY_WEIGHT;
  if (r < acc) return { kind: 'passerby', data: PASSERBY_POOL[(Math.random() * PASSERBY_POOL.length) | 0] };
  acc += RARE_WEIGHT;
  if (r < acc) return { kind: 'rare', data: RARE_POOL[(Math.random() * RARE_POOL.length) | 0] };
  return { kind: 'normal', data: findPool[(Math.random() * findPool.length) | 0] };
}

function spawnItem() {
  if (items.length < MAX_ACTIVE_ITEMS) {
    const pick = pickSpawn();
    const lane = (Math.random() * 3) | 0;
    const el = document.createElement('div');
    el.className = `osanpo-item${pick.kind === 'hazard' ? ' osanpo-hazard' : ''}${pick.kind === 'passerby' ? ' osanpo-passerby' : ''}`;
    el.style.left = `${LANES[lane]}%`;
    el.textContent = pick.kind === 'hazard' ? '🔎' : pick.kind === 'passerby' ? pick.data.emoji : '？';

    const item = {
      id: itemSeq++,
      kind: pick.kind,
      data: pick.data,
      lane,
      y: -8,
      el,
      resolved: false,
    };
    boardEl.appendChild(el);
    items.push(item);
  }

  const mode = shell.hardMode ? HARD_MODE : NORMAL_MODE;
  const next = mode.spawnIntervalMin + Math.random() * (mode.spawnIntervalMax - mode.spawnIntervalMin);
  spawnTimer = setTimeout(spawnItem, next);
}

/* ---------- 発見・ハザード処理 ---------- */
function catchNormalOrRare(item, ts) {
  item.resolved = true;
  item.holdUntil = ts + ADMIRE_HOLD_MS;
  const label = item.kind === 'rare' ? item.data.name : item.data.name;
  item.el.textContent = item.data.emoji;
  item.el.classList.add('osanpo-item-found');

  if (!foundIds.has(item.data.id)) {
    foundIds.add(item.data.id);
    zukanCountEl.textContent = foundIds.size;
  }

  streak++;
  updateMood();

  if (!themeAchieved && currentTheme.match(item.data)) {
    themeAchieved = true;
    themeStatusEl.textContent = '達成✔';
    shell.showPopup(item.el, 'お題たっせい！🎉', 'bonus');
    [659.25, 783.99, 1046.5].forEach((f, i) => setTimeout(() => shell.playTone(f, 0.14, 'triangle'), i * 90));
    showHeartBurst(item.el);
  }

  if (item.kind === 'rare') {
    shell.playTone(900, 0.12);
    setTimeout(() => shell.playTone(1200, 0.15), 100);
    showHeartBurst(item.el);
  } else {
    shell.playTone(760, 0.1);
  }
  shell.showPopup(item.el, item.kind === 'rare' ? `大好き！${label}` : `みっけ！${label}`, item.kind === 'rare' ? 'bonus' : 'good');
}

function showHeartBurst(targetEl) {
  const delays = [0, 90, 180, 260];
  delays.forEach((d) => setTimeout(() => shell.showPopup(targetEl, '💗', 'bonus'), d));
}

function greetPasserby(item) {
  item.resolved = true;
  item.el.classList.add('osanpo-item-found');
  shell.playTone(700, 0.07);
  setTimeout(() => shell.playTone(880, 0.08), 80);
  shell.showPopup(item.el, item.data.greet, 'good');
}

function hitHazard(item) {
  item.resolved = true;
  item.el.remove();
  flinchDog();
  shell.playTone(220, 0.2, 'sawtooth');
  shell.showPopup(dogEl, '😨💦', 'bad');
  streak = 0;
  updateMood();
  // 一歩後退：出現中のアイテムを少し押し戻す
  items.forEach((it) => { if (!it.resolved) it.y = Math.max(-8, it.y - 10); });
}

/* ---------- メインループ ---------- */
function loop(ts) {
  if (!lastTs) lastTs = ts;
  const dt = (ts - lastTs) / 1000;
  lastTs = ts;
  const mode = shell.hardMode ? HARD_MODE : NORMAL_MODE;

  items.forEach((item) => {
    const holding = item.resolved && item.holdUntil && ts < item.holdUntil;
    if (!holding) {
      item.y += mode.scrollSpeed * dt;
      item.el.style.top = `${item.y}%`;
    }

    if (!item.resolved && item.y >= CATCH_LINE) {
      if (item.kind === 'passerby') {
        greetPasserby(item);
      } else if (item.lane === currentLane) {
        if (item.kind === 'hazard') hitHazard(item);
        else catchNormalOrRare(item, ts);
      }
    }
  });

  items = items.filter((item) => {
    if (item.y >= REMOVE_LINE) {
      item.el.remove();
      return false;
    }
    return true;
  });

  if (shell.running) rafId = requestAnimationFrame(loop);
}

/* ---------- 終了 ---------- */
function finishWalk() {
  if (!shell.running) return;
  shell.end(`今日のおさんぽ、おしまい🐾（${foundIds.size} / ${totalCount} 匹発見）`);
}

/* ---- GameShellのライフサイクルに接続 ---- */
shell.onStart(() => {
  buildBoard();
  lastTs = 0;
  cancelAnimationFrame(rafId);
  rafId = requestAnimationFrame(loop);
  spawnItem();
});

shell.onReset(() => {
  clearTimeout(spawnTimer);
  cancelAnimationFrame(rafId);
  items.forEach((it) => it.el.remove());
  items = [];
  showPlaceholder();
});

shell.onHardModeChange(() => {
  // running中は呼ばれない（GameShell側で保証）。次回スタート時のspawn/loopに反映される。
});

buildFindPool();
buildZukanModal();
showPlaceholder();
