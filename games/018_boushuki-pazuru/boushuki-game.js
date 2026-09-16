/* =========================================================
   いろぬきパズル🔓 固有ロジック
   マス目に複数色のピンが積み重なって刺さっている（末尾が一番上＝露出面）。

   ルール：
   - ある色は「盤面上に残っているその色のピンが、全マスで一番上に
     露出している」時だけ触れる（ロック解除）
   - 1つでもその色が他の色の下に埋もれていたら、その色は盤面全体で
     ロックされ、露出している分をタップしても抜けない（ブブー）
   - ロック解除された色は、露出しているピンを1個ずつタップして抜く
     （まとめて消える演出はしない）
   - 上に乗っていた色が全部消えれば、下の色が露出し、いずれロック
     解除される

   生成方式：消す順番（色の並び）を先にランダムに決め、その順で
   各色のピンをランダムなマスへ積み増していく（同じ色は同じマスに
   重ねて置かない）。これにより、最後に積んだ色は必ず全マスで
   露出した状態＝最初から確実にロック解除されている状態になり、
   「積んだ逆順で消せば必ずクリアできる」ことが保証される。
   ========================================================= */

const shell = new GameShell({
  rootSelector: '#app',
  title: 'いろぬきパズル🔓',
  hint: '露出している色をタップして抜きましょう。まだ隠れている色はロックされて抜けません',
  hasScore: false,
  hasTimer: false,
});

const PIN_COLORS = ['#e36363', '#ea9e52', '#e3ca52', '#61bf87', '#52bfce', '#5c8cd6', '#967dd6', '#d875b1'];
const PIN_LABELS = ['あか', 'だいだい', 'きいろ', 'みどり', 'みずいろ', 'あお', 'むらさき', 'ピンク'];

const NORMAL_MODE = { cols: 5, rows: 4, colorCount: 5, perColor: 4 };
const HARD_MODE   = { cols: 5, rows: 5, colorCount: 6, perColor: 5 };

let cfg = NORMAL_MODE;
let cells = [];         // cells[i] = [colorIndex, ...]（末尾が一番上＝露出面）
let cellEls = [];
let colorRemain = [];
let totalPins = 0;
let removedCount = 0;
let cleared = false;
let hintTimeoutId = null;

function shuffleArr(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function randInt(min, max) { return min + ((Math.random() * (max - min + 1)) | 0); }

/* ---------- 生成 ---------- */
function buildPuzzle() {
  cfg = shell.hardMode ? HARD_MODE : NORMAL_MODE;
  totalPins = cfg.colorCount * cfg.perColor;
  const cellCount = cfg.cols * cfg.rows;
  cells = Array.from({ length: cellCount }, () => []);

  // 消す順（解）を先に決め、その順に各色のピンをランダムなマスへ積んでいく。
  // 同じ色を同じマスへ二重に積まない（露出判定の整合性を保つため）。
  const colorOrder = shuffleArr([...Array(cfg.colorCount).keys()]);
  colorOrder.forEach((color) => {
    for (let i = 0; i < cfg.perColor; i++) {
      let idx, guard = 0;
      do {
        idx = randInt(0, cellCount - 1);
        guard++;
      } while (cells[idx].includes(color) && guard < 50);
      cells[idx].push(color);
    }
  });

  colorRemain = Array(cfg.colorCount).fill(cfg.perColor);
  removedCount = 0;
  cleared = false;

  renderBoard();
}

/* 指定色の「今、一番上に露出しているマス数」を数える */
function exposedCountOf(color) {
  let n = 0;
  cells.forEach((stack) => {
    if (stack.length > 0 && stack[stack.length - 1] === color) n++;
  });
  return n;
}

/* 指定色がロック解除されているか（その色の残り全部が露出しているか） */
function isUnlocked(color) {
  return colorRemain[color] > 0 && exposedCountOf(color) === colorRemain[color];
}

/* ---------- 描画 ---------- */
function buildDom() {
  shell.board.className = 's-board bs-board';
  shell.board.innerHTML = `
    <div class="bs-toolbar">
      <span class="bs-progress">残り: <b id="bsProgress">${totalPins}</b> / ${totalPins}</span>
      <div class="bs-toolbar-actions">
        <button class="s-icon-btn-text" id="bsHintBtn">💡 ヒント</button>
      </div>
    </div>
    <div class="bs-legend" id="bsLegend"></div>
    <div class="bs-grid" id="bsGrid" style="--cols:${cfg.cols}"></div>
  `;
  shell.board.querySelector('#bsHintBtn').addEventListener('click', showHint);

  const grid = shell.board.querySelector('#bsGrid');
  cellEls = [];
  cells.forEach((_, idx) => {
    const wrap = document.createElement('div');
    wrap.className = 'bs-cell';
    wrap.addEventListener('click', () => onCellClick(idx));
    grid.appendChild(wrap);
    cellEls[idx] = wrap;
  });
}

function renderBoard() {
  buildDom();
  cells.forEach((_, idx) => renderCell(idx));
  updateProgress();
  renderLegend();
}

function renderCell(idx) {
  const el = cellEls[idx];
  if (!el) return;
  const stack = cells[idx];
  el.innerHTML = '';
  el.classList.toggle('bs-cell-empty', stack.length === 0);

  stack.forEach((color, depth) => {
    const isTop = depth === stack.length - 1;
    const pinEl = document.createElement('div');
    pinEl.className = 'bs-pin' + (isTop ? ' bs-pin-top' : ' bs-pin-under');
    pinEl.style.setProperty('--pin-color', PIN_COLORS[color % PIN_COLORS.length]);
    pinEl.style.setProperty('--depth', depth);
    el.appendChild(pinEl);
  });
}

function renderLegend() {
  const el = shell.board.querySelector('#bsLegend');
  if (!el) return;
  el.innerHTML = '';
  for (let c = 0; c < cfg.colorCount; c++) {
    const done = colorRemain[c] === 0;
    const chip = document.createElement('span');
    chip.className = 'bs-legend-chip' + (done ? ' bs-legend-done' : '');
    const dot = document.createElement('span');
    dot.className = 'bs-legend-dot';
    dot.style.background = PIN_COLORS[c % PIN_COLORS.length];
    chip.appendChild(dot);
    chip.appendChild(document.createTextNode(String(colorRemain[c])));
    el.appendChild(chip);
  }
}

function updateProgress() {
  const el = shell.board.querySelector('#bsProgress');
  if (el) el.textContent = totalPins - removedCount;
}

function showPlaceholder() {
  shell.board.className = 's-board';
  shell.board.innerHTML = `
    <div class="bs-rule-row">
      <div class="bs-rule-stack-demo">
        <div class="bs-rule-pin" style="background:#61bf87;transform:translate(7px,7px)"></div>
        <div class="bs-rule-pin" style="background:#e36363"></div>
      </div>
      <div class="bs-rule-caption">同じ色が<b>盤面のどこかに隠れている間</b>は、その色は抜けません。<br>すべて露出してはじめて、1個ずつ抜けるようになります。</div>
    </div>
    <div class="bs-placeholder">
      <p>マス目に色つきのピンが積み重なっています。</p>
      <p>色をタップして、隠れているピンが残らないように<b>すべて抜き切りましょう</b>。</p>
      <p>「スタート」を押すとはじまります</p>
    </div>
  `;
}

/* ---------- 操作 ---------- */
function onCellClick(idx) {
  if (!shell.running || cleared) return;
  const stack = cells[idx];
  if (stack.length === 0) return;
  const color = stack[stack.length - 1];

  if (!isUnlocked(color)) {
    rejectTap(idx, color);
    return;
  }
  removePin(idx, color);
}

function rejectTap(idx, color) {
  shell.playTone(220, 0.15, 'sawtooth');
  const el = cellEls[idx];
  const topEl = el && el.querySelector('.bs-pin-top');
  if (topEl) {
    topEl.classList.add('bs-shake');
    setTimeout(() => topEl && topEl.classList.remove('bs-shake'), 300);
  }
  shell.toast(`まだ他の場所に${PIN_LABELS[color % PIN_LABELS.length]}色が残っています`);
}

function removePin(idx, color) {
  shell.playTone(560 + color * 30, 0.08);

  const el = cellEls[idx];
  const topEl = el && el.querySelector('.bs-pin-top');
  if (topEl) topEl.classList.add('bs-removing');

  setTimeout(() => {
    cells[idx].pop();
    removedCount++;
    colorRemain[color]--;
    renderCell(idx);
    updateProgress();
    renderLegend();

    if (colorRemain[color] === 0) {
      shell.toast(`${PIN_LABELS[color % PIN_LABELS.length]}色をぜんぶ抜きました！`);
      shell.playTone(880, 0.1);
    }
    if (removedCount === totalPins) triggerClear();
  }, 200);
}


/* ---------- ヒント：ロック解除されている色のピンを1つ光らせる ---------- */
function showHint() {
  if (!shell.running || cleared) return;
  clearTimeout(hintTimeoutId);

  let targetIdx = -1;
  for (let c = 0; c < cfg.colorCount; c++) {
    if (!isUnlocked(c)) continue;
    const found = cells.findIndex((stack) => stack.length && stack[stack.length - 1] === c);
    if (found !== -1) { targetIdx = found; break; }
  }
  if (targetIdx === -1) return;

  const el = cellEls[targetIdx];
  const topEl = el && el.querySelector('.bs-pin-top');
  if (!topEl) return;
  topEl.classList.add('bs-hint');
  shell.playTone(600, 0.08);
  shell.toast('光っているピンは今すぐ抜けます');
  hintTimeoutId = setTimeout(() => topEl && topEl.classList.remove('bs-hint'), 1800);
}

/* ---------- クリア ---------- */
function triggerClear() {
  cleared = true;
  [523.25, 659.25, 783.99, 1046.5].forEach((f, i) =>
    setTimeout(() => shell.playTone(f, 0.16, 'triangle'), i * 100)
  );
  shell.end('クリア！ぜんぶのピンを抜きました🔓');
}

showPlaceholder();

/* ---- GameShellのライフサイクルに接続 ---- */
shell.onStart(() => {
  buildPuzzle();
});
shell.onReset(() => {
  clearTimeout(hintTimeoutId);
  showPlaceholder();
});
shell.onHardModeChange(() => {
  // running中は呼ばれない（GameShell側で保証）。次回スタート時のcfgに反映される。
});