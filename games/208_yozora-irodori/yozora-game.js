/* =========================================================
   夜空いろどり🌌 固有ロジック
   共通土台(GameShell)のAPIだけを使った、塗り絵1本のゲーム。
   - スタートを押すと、七宝つなぎ／刺し子／パッチワーク／組子の柄がランダムで自動生成される（かならず対称）
   - 色を選んで区画をタップして塗る（グラデーションのツヤ付き）
   - 「もようをかえる」「はじめから」「ぬりおわった」の3ボタン
   ========================================================= */

const shell = new GameShell({
  rootSelector: '#app',
  title: '夜空いろどり🌌',
  hint: '色を選んで、好きな場所をタップしてぬりましょう',
  hasScore: false,
  hasTimer: false,
});

/* 塗り絵の色（規定カラー）。＋ボタンから任意の色も選べる */
const PRESET_COLORS = ['#34d399', '#22d3ee', '#a78bfa', '#f472b6', '#60a5fa', '#fbbf24', '#ffffff'];
let currentColor = PRESET_COLORS[0];

function showPlaceholder() {
  shell.board.className = 's-board yozora-board';
  shell.board.innerHTML = `
    <div class="yozora-placeholder">
      <p class="yozora-placeholder-title">🌌 夜空いろどり</p>
      <p>星空みたいな模様に、好きな色をぬっていきましょう。<br>のんびり、ゆっくり、自由にどうぞ。</p>
      <p class="yozora-placeholder-sub">「スタート」を押すと始まります</p>
    </div>`;
}

/* 色からグラデーション用の明るい色・暗い色を計算（スウォッチ・塗りのツヤ用） */
function shade(hex, percent) {
  const num = parseInt(hex.slice(1), 16);
  let r = (num >> 16) + Math.round(255 * percent);
  let g = ((num >> 8) & 0xff) + Math.round(255 * percent);
  let b = (num & 0xff) + Math.round(255 * percent);
  r = Math.min(255, Math.max(0, r));
  g = Math.min(255, Math.max(0, g));
  b = Math.min(255, Math.max(0, b));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

/* ---- 🎨夜空いろどり：図柄の自動生成 ----
   4系統（七宝つなぎ／刺し子／パッチワーク／組子）から毎回ランダムに1柄を選び、
   サイズ・部品・中のパーツ配置も乱数で生成する。
   ただし乱数は「対称の仲間（オービット）」ごとに1回だけ振るので、
   ランダムでも柄はかならず左右（柄によっては上下・斜めも）対称になる。 */
const SVGNS = 'http://www.w3.org/2000/svg';
const CENTER = 150;
const rndPick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const f2 = (n) => Math.round(n * 100) / 100;

function el(tag, attrs) {
  const e = document.createElementNS(SVGNS, tag);
  Object.keys(attrs).forEach((k) => e.setAttribute(k, attrs[k]));
  return e;
}
function region(g, tag, attrs) {
  const e = el(tag, attrs);
  e.setAttribute('class', 'yozora-region');
  attachRegionClick(e);
  g.appendChild(e);
  return e;
}
const poly = (g, pts) => region(g, 'polygon', { points: pts.map((p) => `${f2(p[0])},${f2(p[1])}`).join(' ') });
const rect = (g, x, y, w, h) => region(g, 'rect', { x: f2(x), y: f2(y), width: f2(w), height: f2(h) });
const circle = (g, cx, cy, r) => region(g, 'circle', { cx: f2(cx), cy: f2(cy), r: f2(r) });

/* 盤面中心からの相対位置が鏡像・回転で重なるものに同じ乱数結果を返す。
   diag=true なら斜め（x↔y）の入れ替えも同じ仲間として扱う */
function makeOrbit(diag) {
  const memo = new Map();
  return (dx, dy, gen) => {
    let a = Math.abs(dx).toFixed(1);
    let b = Math.abs(dy).toFixed(1);
    if (diag && parseFloat(a) > parseFloat(b)) [a, b] = [b, a];
    const key = `${a}_${b}`;
    if (!memo.has(key)) memo.set(key, gen());
    return memo.get(key);
  };
}

/* ① 七宝つなぎ：円を格子に並べ、重なり（レンズ形）を独立した区画にする（四方対称） */
function buildShippou(g) {
  const n = rndPick([3, 4]);
  const s = 300 / n;
  const r = s / Math.SQRT2; // となり合う円が重なり、斜めの円とは1点で接する比率
  const coreMode = rndPick(['none', 'all', 'orbit']);
  const orbit = makeOrbit(true);
  const grid = [];
  for (let row = 0; row < n; row++) {
    const line = [];
    for (let col = 0; col < n; col++) line.push({ cx: (col + 0.5) * s, cy: (row + 0.5) * s, r });
    grid.push(line);
  }
  grid.forEach((line) => line.forEach((c) => circle(g, c.cx, c.cy, c.r)));
  grid.forEach((line) => line.forEach((c) => {
    const has = coreMode === 'all' ||
      (coreMode === 'orbit' && orbit(c.cx - CENTER, c.cy - CENTER, () => Math.random() < 0.55));
    if (has) circle(g, c.cx, c.cy, c.r * 0.3);
  }));
  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n - 1; col++) addLensIfOverlapping(g, grid[row][col], grid[row][col + 1]);
  }
  for (let row = 0; row < n - 1; row++) {
    for (let col = 0; col < n; col++) addLensIfOverlapping(g, grid[row][col], grid[row + 1][col]);
  }
}

/* ② 刺し子・青海波：同心円の波を半段ずつずらして重ねる（左右対称） */
function buildSeigaiha(g) {
  const [m, rings] = rndPick([[2, 3], [3, 2]]);
  const r = 150 / m;
  const step = r / 2;
  rect(g, 0, 0, 300, 300); // 波のすき間（背景）も塗れるように
  for (let j = 0; j * step < 300 + r; j++) {
    const y = j * step;
    const even = j % 2 === 0;
    const count = even ? m : m + 1;
    for (let k = 0; k < count; k++) {
      const cx = even ? (k + 0.5) * 2 * r : k * 2 * r;
      for (let t = 0; t < rings; t++) circle(g, cx, y, r * (1 - t / rings));
    }
  }
}

/* ③ 刺し子・麻の葉：正三角形の格子を、それぞれ重心から3分割（左右・上下対称） */
function tri3(g, A, B, C) {
  const xs = [A[0], B[0], C[0]];
  if (Math.max(...xs) < 0 || Math.min(...xs) > 300) return; // 盤面外は作らない
  const c = [(A[0] + B[0] + C[0]) / 3, (A[1] + B[1] + C[1]) / 3];
  poly(g, [A, B, c]);
  poly(g, [B, C, c]);
  poly(g, [C, A, c]);
}
function buildAsanoha(g) {
  const R = 4;
  const h = 300 / R;
  const a = (2 * h) / Math.sqrt(3);
  const d0 = rndPick([0, 0.5]); // 縦の対称軸が「頂点」を通るか「三角形の中」を通るか
  const vx = (k, i) => CENTER + (i + d0 + 0.5 * k) * a;
  for (let k = 0; k < R; k++) {
    const yT = k * h;
    const yB = (k + 1) * h;
    for (let i = -10; i <= 10; i++) {
      tri3(g, [vx(k, i), yT], [vx(k, i + 1), yT], [vx(k + 1, i), yB]);
      tri3(g, [vx(k + 1, i - 1), yB], [vx(k + 1, i), yB], [vx(k, i), yT]);
    }
  }
}

/* ④ 刺し子・市松：正方形、または45°回転させた菱形。中に小さな四角を重ねる変化つき（四方対称） */
function buildIchimatsu(g) {
  const diamond = Math.random() < 0.4;
  let m;
  let s;
  if (!diamond) {
    m = rndPick([4, 5]);
    s = 300 / m;
  } else {
    s = 300 / rndPick([3, 4]);
    m = Math.ceil(430 / s);
    if (m % 2 === 0) m++;
  }
  const inner = m % 2 === 1 ? rndPick(['none', 'all', 'alt']) : rndPick(['none', 'all']);
  const layer = el('g', diamond ? { transform: 'rotate(45 150 150)' } : {});
  g.appendChild(layer);
  const x0 = CENTER - (m * s) / 2;
  for (let r = 0; r < m; r++) {
    for (let c = 0; c < m; c++) {
      const x = x0 + c * s;
      const y = x0 + r * s;
      rect(layer, x, y, s, s);
      if (inner === 'all' || (inner === 'alt' && (r + c) % 2 === 0)) {
        const p = s * 0.27;
        rect(layer, x + p, y + p, s - 2 * p, s - 2 * p);
      }
    }
  }
}

/* ⑤ パッチワーク：ブロック（風車・ひし・ログキャビン・ナインパッチ）を並べる。
   ブロック自身が上下左右対称で、種類は対称の位置ごとに決める */
function drawBlock(g, spec, x, y, s) {
  const cx = x + s / 2;
  const cy = y + s / 2;
  if (spec.type === 'kazaguruma') {
    const P = [[0, 0], [0.5, 0], [1, 0], [1, 0.5], [1, 1], [0.5, 1], [0, 1], [0, 0.5]]
      .map(([u, v]) => [x + u * s, y + v * s]);
    for (let i = 0; i < 8; i++) poly(g, [[cx, cy], P[i], P[(i + 1) % 8]]);
  } else if (spec.type === 'hishi') {
    const T = [cx, y];
    const Rt = [x + s, cy];
    const B = [cx, y + s];
    const L = [x, cy];
    poly(g, [T, Rt, B, L]);
    poly(g, [[x, y], T, L]);
    poly(g, [T, [x + s, y], Rt]);
    poly(g, [Rt, [x + s, y + s], B]);
    poly(g, [B, [x, y + s], L]);
    if (spec.nest) poly(g, [[cx, cy - s / 4], [cx + s / 4, cy], [cx, cy + s / 4], [cx - s / 4, cy]]);
  } else if (spec.type === 'logcabin') {
    const k = spec.k;
    const t = s / (2 * k + 1);
    rect(g, x + k * t, y + k * t, t, t);
    for (let j = 1; j <= k; j++) {
      const w = (2 * j + 1) * t;
      const o = (k - j) * t;
      rect(g, x + o, y + o, w, t);
      rect(g, x + o, y + o + w - t, w, t);
      rect(g, x + o, y + o + t, t, w - 2 * t);
      rect(g, x + o + w - t, y + o + t, t, w - 2 * t);
    }
  } else {
    const q = s / 3;
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) rect(g, x + c * q, y + r * q, q, q);
  }
}
function buildPatchwork(g) {
  const n = rndPick([2, 3, 3]);
  const bs = 300 / n;
  const orbit = makeOrbit(true);
  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) {
      const ox = col * bs;
      const oy = row * bs;
      const spec = orbit(ox + bs / 2 - CENTER, oy + bs / 2 - CENTER, () => ({
        type: rndPick(['kazaguruma', 'hishi', 'logcabin', 'ninepatch']),
        k: rndPick([2, 3]),
        nest: Math.random() < 0.5,
      }));
      drawBlock(g, spec, ox, oy, bs);
    }
  }
}

/* ⑥ 組子・亀甲：六角形の敷き詰め。中を小さな六角や6分割にする変化つき（左右・上下対称） */
function hexPoints(cx, cy, R) {
  const pts = [];
  for (let k = 0; k < 6; k++) {
    const ang = ((-90 + 60 * k) * Math.PI) / 180;
    pts.push([cx + R * Math.cos(ang), cy + R * Math.sin(ang)]);
  }
  return pts;
}
function buildKikkou(g) {
  const R = rndPick([44, 52, 60]);
  const w = Math.sqrt(3) * R;
  const mode = rndPick(['plain', 'inner', 'tri', 'mixed']);
  const orbit = makeOrbit(false);
  for (let j = -6; j <= 6; j++) {
    const cy = CENTER + j * 1.5 * R;
    if (cy < -R || cy > 300 + R) continue;
    for (let i = -8; i <= 8; i++) {
      const cx = CENTER + (i + (Math.abs(j) % 2 ? 0.5 : 0)) * w;
      if (cx < -R || cx > 300 + R) continue;
      const kind = mode === 'mixed'
        ? orbit(cx - CENTER, cy - CENTER, () => rndPick(['plain', 'inner', 'tri']))
        : mode;
      const pts = hexPoints(cx, cy, R);
      if (kind === 'tri') {
        for (let k = 0; k < 6; k++) poly(g, [[cx, cy], pts[k], pts[(k + 1) % 6]]);
      } else {
        poly(g, pts);
        if (kind === 'inner') poly(g, hexPoints(cx, cy, R * 0.5));
      }
    }
  }
}

/* ⑦ 組子・格子：桟（さん）で区切った升目。中を菱形や4分割にする変化つき（四方対称） */
function buildKoushi(g) {
  const n = rndPick([4, 5]);
  const s = 300 / n;
  const gap = s * rndPick([0.1, 0.14]);
  const mode = rndPick(['plain', 'diamond', 'quad', 'mixed']);
  const orbit = makeOrbit(true);
  rect(g, 0, 0, 300, 300); // 桟（さん）
  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) {
      const x = col * s + gap;
      const y = row * s + gap;
      const w = s - 2 * gap;
      const kind = mode === 'mixed'
        ? orbit(col * s + s / 2 - CENTER, row * s + s / 2 - CENTER, () => rndPick(['plain', 'diamond', 'quad']))
        : mode;
      if (kind === 'quad') {
        const g2 = gap * 0.7;
        const q = (w - g2) / 2;
        rect(g, x, y, q, q);
        rect(g, x + q + g2, y, q, q);
        rect(g, x, y + q + g2, q, q);
        rect(g, x + q + g2, y + q + g2, q, q);
      } else {
        rect(g, x, y, w, w);
        if (kind === 'diamond') {
          const cx = x + w / 2;
          const cy = y + w / 2;
          const d = w * 0.34;
          poly(g, [[cx, cy - d], [cx + d, cy], [cx, cy + d], [cx - d, cy]]);
        }
      }
    }
  }
}

/* 4系統からランダムに1柄。直前と同じ柄は避ける */
const PATTERN_FAMILIES = [
  [{ id: 'shippou', name: '七宝つなぎ', build: buildShippou }],
  [
    { id: 'seigaiha', name: '刺し子・青海波', build: buildSeigaiha },
    { id: 'asanoha', name: '刺し子・麻の葉', build: buildAsanoha },
    { id: 'ichimatsu', name: '刺し子・市松', build: buildIchimatsu },
  ],
  [{ id: 'patchwork', name: 'パッチワーク', build: buildPatchwork }],
  [
    { id: 'kikkou', name: '組子・亀甲', build: buildKikkou },
    { id: 'koushi', name: '組子・格子', build: buildKoushi },
  ],
];
let lastPatternId = null;
function pickPattern() {
  let p;
  for (let tries = 0; tries < 10; tries++) {
    p = rndPick(rndPick(PATTERN_FAMILIES));
    if (p.id !== lastPatternId) break;
  }
  lastPatternId = p.id;
  return p;
}

let currentPaintDefs = null;
let currentGradientRegistry = {};

/* 現在の色に対応するグラデーションを（なければ作って）返し、fill用のurl(#id)を返す */
function fillUrlForColor(hex) {
  if (currentGradientRegistry[hex]) return `url(#${currentGradientRegistry[hex]})`;
  const svgNS = 'http://www.w3.org/2000/svg';
  const id = `yzgrad-${hex.replace('#', '')}-${Math.floor(Math.random() * 100000)}`;
  const light = shade(hex, 0.35);
  const dark = shade(hex, -0.22);
  const grad = document.createElementNS(svgNS, 'radialGradient');
  grad.setAttribute('id', id);
  grad.setAttribute('cx', '35%');
  grad.setAttribute('cy', '30%');
  grad.setAttribute('r', '75%');
  const s1 = document.createElementNS(svgNS, 'stop');
  s1.setAttribute('offset', '0%');
  s1.setAttribute('stop-color', light);
  const s2 = document.createElementNS(svgNS, 'stop');
  s2.setAttribute('offset', '100%');
  s2.setAttribute('stop-color', dark);
  grad.appendChild(s1);
  grad.appendChild(s2);
  currentPaintDefs.appendChild(grad);
  currentGradientRegistry[hex] = id;
  return `url(#${id})`;
}

function attachRegionClick(el) {
  el.addEventListener('click', () => {
    if (!shell.running) return;
    el.style.fill = fillUrlForColor(currentColor);
    shell.playTone(480, 0.05);
  });
}

/* 円Aと円Bが重なっていれば、円Bでクリップした円A＝レンズ形の要素を追加する */
function addLensIfOverlapping(svg, a, b) {
  const dist = Math.hypot(a.cx - b.cx, a.cy - b.cy);
  if (dist >= a.r + b.r - 2) return; // 重なりがほぼ無ければスキップ
  const svgNS = 'http://www.w3.org/2000/svg';
  const clipId = `yzclip-${Math.floor(Math.random() * 1000000)}`;
  const clipPath = document.createElementNS(svgNS, 'clipPath');
  clipPath.setAttribute('id', clipId);
  const clipCircle = document.createElementNS(svgNS, 'circle');
  clipCircle.setAttribute('cx', b.cx);
  clipCircle.setAttribute('cy', b.cy);
  clipCircle.setAttribute('r', b.r);
  clipPath.appendChild(clipCircle);
  currentPaintDefs.appendChild(clipPath);

  const lens = document.createElementNS(svgNS, 'circle');
  lens.setAttribute('cx', a.cx);
  lens.setAttribute('cy', a.cy);
  lens.setAttribute('r', a.r);
  lens.setAttribute('clip-path', `url(#${clipId})`);
  lens.setAttribute('class', 'yozora-region');
  attachRegionClick(lens);
  svg.appendChild(lens);
}

function renderPaintMode() {
  shell.board.className = 's-board yozora-board';
  shell.board.innerHTML = '';

  const wrap = document.createElement('div');
  wrap.style.display = 'flex';
  wrap.style.flexDirection = 'column';
  wrap.style.alignItems = 'center';
  wrap.style.width = '100%';

  const pattern = pickPattern();
  const instruction = document.createElement('p');
  instruction.className = 'yozora-instruction';
  instruction.innerHTML = `柄：<b>${pattern.name}</b><br>① 色を選ぶ → ② ぬりたい場所をタップ`;
  wrap.appendChild(instruction);

  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('viewBox', '0 0 300 300');
  svg.setAttribute('class', 'yozora-paint-svg');

  currentPaintDefs = document.createElementNS(svgNS, 'defs');
  svg.appendChild(currentPaintDefs);
  currentGradientRegistry = {};

  pattern.build(svg);

  wrap.appendChild(svg);

  /* パレット：規定カラー（グラデーション表示）＋任意調整（ブラウザ標準の色選択） */
  const palette = document.createElement('div');
  palette.className = 'yozora-palette';

  const swatchEls = [];
  PRESET_COLORS.forEach((color) => {
    const sw = document.createElement('button');
    sw.className = 'yozora-swatch';
    sw.style.background = `radial-gradient(circle at 32% 28%, ${shade(color, 0.35)} 0%, ${shade(color, -0.22)} 100%)`;
    if (color === currentColor) sw.classList.add('active');
    sw.addEventListener('click', () => {
      currentColor = color;
      swatchEls.forEach((el) => el.classList.remove('active'));
      sw.classList.add('active');
    });
    palette.appendChild(sw);
    swatchEls.push(sw);
  });

  /* ＋その他の色（ブラウザ/OS標準の色選択ダイアログ） */
  const customWrap = document.createElement('label');
  customWrap.className = 'yozora-swatch yozora-swatch-custom';
  customWrap.textContent = '＋';
  const colorInput = document.createElement('input');
  colorInput.type = 'color';
  colorInput.value = '#ffffff';
  colorInput.addEventListener('input', () => {
    currentColor = colorInput.value;
    customWrap.textContent = '';
    customWrap.style.background = `radial-gradient(circle at 32% 28%, ${shade(currentColor, 0.35)} 0%, ${shade(currentColor, -0.22)} 100%)`;
    swatchEls.forEach((el) => el.classList.remove('active'));
    customWrap.classList.add('active');
  });
  customWrap.appendChild(colorInput);
  palette.appendChild(customWrap);
  swatchEls.push(customWrap);

  wrap.appendChild(palette);

  /* 操作ボタン：もようをかえる／はじめから／ぬりおわった */
  const actionRow = document.createElement('div');
  actionRow.className = 'yozora-action-row';

  const rerollBtn = document.createElement('button');
  rerollBtn.className = 'yozora-action-btn';
  rerollBtn.textContent = '🔄もようをかえる';
  rerollBtn.addEventListener('click', () => {
    if (!shell.running) return;
    shell.playTone(440, 0.06);
    renderPaintMode();
  });
  actionRow.appendChild(rerollBtn);

  const resetPaintBtn = document.createElement('button');
  resetPaintBtn.className = 'yozora-action-btn';
  resetPaintBtn.textContent = '↩️はじめから';
  resetPaintBtn.addEventListener('click', () => {
    if (!shell.running) return;
    shell.playTone(400, 0.05);
    svg.querySelectorAll('.yozora-region').forEach((el) => {
      el.style.fill = '';
    });
  });
  actionRow.appendChild(resetPaintBtn);

  const doneBtn = document.createElement('button');
  doneBtn.className = 'yozora-action-btn yozora-action-btn-primary';
  doneBtn.textContent = '✨ぬりおわった';
  doneBtn.addEventListener('click', () => {
    if (!shell.running) return;
    playPaintCelebration(svg);
  });
  actionRow.appendChild(doneBtn);

  wrap.appendChild(actionRow);

  shell.board.appendChild(wrap);
}

/* SVG要素は offsetLeft を持たないため、shell.showPopup ではなく
   getBoundingClientRect で位置を計算する自前のポップ表示を使う */
function showSparkAt(svgEl, text) {
  const boardRect = shell.board.getBoundingClientRect();
  const elRect = svgEl.getBoundingClientRect();
  const popup = document.createElement('div');
  popup.className = 's-popup s-popup-bonus';
  popup.textContent = text;
  popup.style.left = `${elRect.left - boardRect.left + elRect.width / 2}px`;
  popup.style.top = `${elRect.top - boardRect.top}px`;
  shell.board.appendChild(popup);
  setTimeout(() => popup.remove(), 700);
}

/* 「ぬりおわった」を押したときの、控えめなお祝い演出（盤面全体の光の波＋✨ポップ） */
function playPaintCelebration(svg) {
  [523.25, 659.25, 783.99, 1046.5].forEach((f, i) =>
    setTimeout(() => shell.playTone(f, 0.14, 'triangle'), i * 90)
  );

  const wave = document.createElement('div');
  wave.className = 'yozora-wave';
  shell.board.appendChild(wave);
  setTimeout(() => wave.remove(), 1200);

  const regions = Array.from(svg.querySelectorAll('.yozora-region'));
  const spots = regions.sort(() => Math.random() - 0.5).slice(0, Math.min(3, regions.length));
  spots.forEach((el, i) => {
    setTimeout(() => showSparkAt(el, '✨'), 150 + i * 120);
  });

  shell.end('できあがり！すてきな夜空になったね🌌');
}

showPlaceholder();

/* ---- GameShellのライフサイクルに接続 ---- */
shell.onStart(() => {
  renderPaintMode();
});
shell.onReset(() => {
  showPlaceholder();
});
