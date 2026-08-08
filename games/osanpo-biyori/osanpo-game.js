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
  { id: 'inu', emoji: '🐶', name: 'いぬ' },
  { id: 'neko', emoji: '🐱', name: 'ねこ' },
  { id: 'kotori', emoji: '🐦', name: 'ことり' },
  { id: 'risu', emoji: '🐿️', name: 'りす' },
  { id: 'usagi', emoji: '🐇', name: 'うさぎ' },
  { id: 'kamo', emoji: '🦆', name: 'かも' },
  { id: 'kame', emoji: '🐢', name: 'かめ' },
  { id: 'uma', emoji: '🐴', name: 'うま' },
  { id: 'ushi', emoji: '🐮', name: 'うし' },
  { id: 'hitsuji', emoji: '🐑', name: 'ひつじ' },
  { id: 'fukurou', emoji: '🦉', name: 'ふくろう' },
  { id: 'niwatori', emoji: '🐔', name: 'にわとり' },
];

// season: 'all' | 'spring' | 'summer' | 'autumn' | 'winter'
const TOWN_POOL = [
  { id: 'jitensha', emoji: '🚲', name: 'じてんしゃ', season: 'all' },
  { id: 'post', emoji: '📮', name: 'ポスト', season: 'all' },
  { id: 'enpitsu', emoji: '✏️', name: 'えんぴつ', season: 'all' },
  { id: 'coin', emoji: '🪙', name: 'コイン', season: 'all' },
  { id: 'fuusen', emoji: '🎈', name: 'ふうせん', season: 'all' },
  { id: 'tebukuro', emoji: '🧤', name: 'てぶくろ（おとしもの）', season: 'all' },
  { id: 'ball', emoji: '⚽', name: 'ボール', season: 'all' },
  { id: 'kutsushita', emoji: '🧦', name: 'くつした（おとしもの）', season: 'all' },
  { id: 'kagi', emoji: '🔑', name: 'かぎ', season: 'all' },
  { id: 'osaifu', emoji: '👛', name: 'おさいふ', season: 'all' },
  { id: 'koinobori', emoji: '🎏', name: 'こいのぼり', season: 'spring' },
  { id: 'ochiba', emoji: '🍁', name: 'おちば', season: 'autumn' },
  { id: 'sakura', emoji: '🌸', name: 'さくら', season: 'spring' },
  { id: 'himawari', emoji: '🌻', name: 'ひまわり', season: 'summer' },
  { id: 'sasanoha', emoji: '🎋', name: 'ささのは', season: 'summer' },
  { id: 'yukidaruma', emoji: '⛄', name: 'ゆきだるま', season: 'winter' },
  { id: 'xmastree', emoji: '🎄', name: 'クリスマスツリー', season: 'winter' },
  { id: 'chouchin', emoji: '🏮', name: 'ちょうちん', season: 'summer' },
  { id: 'shingou', emoji: '🚦', name: 'しんごう', season: 'all' },
  { id: 'basutei', emoji: '🚏', name: 'バスてい', season: 'all' },
  { id: 'bench', emoji: '🪑', name: 'ベンチ', season: 'all' },
  { id: 'funsui', emoji: '⛲', name: 'ふんすい', season: 'all' },
  { id: 'gomibako', emoji: '🗑️', name: 'ごみばこ', season: 'all' },
  { id: 'tobira', emoji: '🚪', name: 'とびら', season: 'all' },
  { id: 'ouchi', emoji: '🏠', name: 'おうち', season: 'all' },
  { id: 'ooki_na_ki', emoji: '🌳', name: 'おおきなき', season: 'all' },
  { id: 'present', emoji: '🎁', name: 'プレゼント', season: 'all' },
  { id: 'ehon', emoji: '📚', name: 'えほん', season: 'all' },
  { id: 'yakyuu_ball', emoji: '⚾', name: 'やきゅうボール', season: 'all' },
  { id: 'yoyo', emoji: '🪀', name: 'ヨーヨー', season: 'all' },
  { id: 'palette', emoji: '🎨', name: 'パレット', season: 'all' },
  { id: 'nuigurumi', emoji: '🧸', name: 'ぬいぐるみ', season: 'all' },
  { id: 'ribbon', emoji: '🎀', name: 'リボン', season: 'all' },
  { id: 'kasa', emoji: '☂️', name: 'かさ', season: 'all' },
  { id: 'muffler', emoji: '🧣', name: 'マフラー', season: 'winter' },
  { id: 'boushi', emoji: '🧢', name: 'ぼうし', season: 'all' },
];

const RARE_POOL = [
  { id: 'poodle', emoji: '🐩', name: 'プードル' },
  { id: 'kuma_saru', emoji: '🐻🐒', name: 'くまとさるのコンビ' },
];

/* ---------- 難易度別パラメータ ---------- */
// scrollSpeed: 1秒あたりに進む割合(%)  spawnIntervalMin/Max: 出現間隔(ms)
const NORMAL_MODE = { scrollSpeed: 16, spawnIntervalMin: 1300, spawnIntervalMax: 2000, hazardWeight: 14 };
const HARD_MODE = { scrollSpeed: 26, spawnIntervalMin: 800, spawnIntervalMax: 1300, hazardWeight: 24 };
const RARE_WEIGHT = 4;      // 100分率のうちレア枠に割く重み
const MAX_ACTIVE_ITEMS = 4; // 画面内に同時に出す上限（渋滞防止）
const CATCH_LINE = 76;      // %。この位置あたりで犬とすれ違う
const REMOVE_LINE = 108;    // %。これを超えたら盤面から除去
const ADMIRE_HOLD_MS = 1400; // 発見直後、その場に留まって鑑賞できる時間

const LANES = [16.5, 50, 83.5]; // %

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

/* ---------- 季節判定 ---------- */
function getCurrentSeason() {
  const m = new Date().getMonth(); // 0-11
  if (m >= 2 && m <= 4) return 'spring';
  if (m >= 5 && m <= 7) return 'summer';
  if (m >= 8 && m <= 10) return 'autumn';
  return 'winter';
}

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
      <div class="osanpo-zukan-cell${found ? ' osanpo-zukan-found' : ''}${rareClass}">
        <div class="osanpo-zukan-emoji">${found ? it.emoji : '？'}</div>
        <div class="osanpo-zukan-name">${found ? it.name : '？？？'}</div>
      </div>`;
  }).join('');
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

  shell.board.className = 's-board osanpo-board';
  shell.board.innerHTML = `
    <div class="osanpo-toolbar">
      <span class="osanpo-zukan">図鑑：<b id="osanpoCount">0</b> / <b>${totalCount}</b> 発見</span>
      <button class="s-icon-btn-text osanpo-zukan-btn" id="osanpoZukanBtn">📖 図鑑</button>
      <button class="s-icon-btn-text osanpo-end-btn" id="osanpoEndBtn">今日はここまで</button>
    </div>
    <div class="osanpo-field" id="osanpoField">
      <div class="osanpo-lane-line" style="left:${LANES[0]}%"></div>
      <div class="osanpo-lane-line" style="left:${LANES[1]}%"></div>
      <div class="osanpo-lane-line" style="left:${LANES[2]}%"></div>
      <div class="osanpo-dog" id="osanpoDog">🐕‍🦺</div>
    </div>
    <div class="osanpo-controls">
      <button class="s-btn osanpo-lane-btn" id="osanpoLeftBtn">◀</button>
      <button class="s-btn osanpo-lane-btn" id="osanpoRightBtn">▶</button>
    </div>
  `;
  boardEl = shell.board.querySelector('#osanpoField');
  dogEl = shell.board.querySelector('#osanpoDog');
  zukanCountEl = shell.board.querySelector('#osanpoCount');

  shell.board.querySelector('#osanpoLeftBtn').addEventListener('click', () => moveLane(-1));
  shell.board.querySelector('#osanpoRightBtn').addEventListener('click', () => moveLane(1));
  shell.board.querySelector('#osanpoEndBtn').addEventListener('click', finishWalk);
  shell.board.querySelector('#osanpoZukanBtn').addEventListener('click', openZukanModal);

  updateDogPosition();
}

function showPlaceholder() {
  shell.board.className = 's-board';
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
  dogEl.style.setProperty('--flip', facingLeft ? -1 : 1);
}

function flinchDog() {
  dogEl.classList.add('osanpo-dog-flinch');
  setTimeout(() => dogEl.classList.remove('osanpo-dog-flinch'), 350);
}

/* ---------- 出現 ---------- */
function pickSpawn() {
  const mode = shell.hardMode ? HARD_MODE : NORMAL_MODE;
  const r = Math.random() * 100;
  if (r < mode.hazardWeight) return { kind: 'hazard' };
  if (r < mode.hazardWeight + RARE_WEIGHT) {
    return { kind: 'rare', data: RARE_POOL[(Math.random() * RARE_POOL.length) | 0] };
  }
  return { kind: 'normal', data: findPool[(Math.random() * findPool.length) | 0] };
}

function spawnItem() {
  if (items.length < MAX_ACTIVE_ITEMS) {
    const pick = pickSpawn();
    const lane = (Math.random() * 3) | 0;
    const el = document.createElement('div');
    el.className = `osanpo-item${pick.kind === 'hazard' ? ' osanpo-hazard' : ''}`;
    el.style.left = `${LANES[lane]}%`;
    el.textContent = pick.kind === 'hazard' ? '🔎' : '？';

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

function hitHazard(item) {
  item.resolved = true;
  item.el.remove();
  flinchDog();
  shell.playTone(220, 0.2, 'sawtooth');
  shell.showPopup(dogEl, '😨💦', 'bad');
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

    if (!item.resolved && item.y >= CATCH_LINE && item.lane === currentLane) {
      if (item.kind === 'hazard') hitHazard(item);
      else catchNormalOrRare(item, ts);
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
