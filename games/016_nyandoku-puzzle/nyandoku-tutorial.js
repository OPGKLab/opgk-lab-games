/* =========================================================
   ねこ配置パズル「遊びかた」チュートリアル（動く説明書）

   構成（将来 common/ へ移す時は「枠」だけを共通化する想定）
     [枠]   オーバーレイ表示・まえへ/つぎへ・とじる・タイマー管理（ゲーム非依存）
     [内容] お手本盤面(5×5)・各ステップの説明文とアニメ（このゲーム専用）

   使い方：
     NyaTutorial.open({
       colors: REGION_COLORS,                       // 本編のエリア色（省略可）
       tone: (f, d, t) => shell.playTone(f, d, t),  // 効果音（省略可）
     });
   ========================================================= */

const NyaTutorial = (() => {
  /* ===================== [内容] お手本盤面 ===================== */
  const N = 5;
  // 数字＝エリア番号（2＝真ん中の1マスだけのエリア）。唯一解：(0,1) (1,4) (2,2) (3,0) (4,3)
  const LAYOUT = [
    [3, 0, 0, 1, 1],
    [3, 0, 0, 1, 1],
    [3, 0, 2, 1, 1],
    [3, 0, 0, 4, 4],
    [3, 4, 4, 4, 4],
  ];
  const REGION_COLOR_IDX = [5, 3, 2, 6, 0]; // エリア番号 → 本編パレットの色番号（青・緑・黄・紫・赤）
  const FALLBACK_COLORS = ['#e36363', '#ea9e52', '#e3ca52', '#61bf87', '#52bfce', '#5c8cd6', '#967dd6', '#d875b1'];

  const FIRST_CAT = [2, 2];                   // ①：1マスだけのエリア＝ここしか置けない（②〜④もこのネコ）
  const DEDUCED_CAT = [0, 1];                 // ⑤：✕でしぼられて「ここ1つだけ」になるネコ
  const REST_CATS = [[1, 4], [4, 3], [3, 0]]; // ⑥：のこりのネコ（決まる順）

  /* ===================== [内容] 盤面まわりの部品 ===================== */
  let cells = []; // cells[r][c] = { el, cat, x }

  const key = (r, c) => r * N + c;
  const regionCells = (id) => {
    const out = [];
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) if (LAYOUT[r][c] === id) out.push([r, c]);
    return out;
  };
  const lineCol = (c) => Array.from({ length: N }, (_, r) => [r, c]);
  const lineRow = (r) => Array.from({ length: N }, (_, c) => [r, c]);
  const around = (r, c) => {
    const out = [];
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        const nr = r + dr, nc = c + dc;
        if ((dr || dc) && nr >= 0 && nr < N && nc >= 0 && nc < N) out.push([nr, nc]);
      }
    }
    return out;
  };
  // ネコに近い順に並べる（✕がネコから広がるように見せる）
  const byDist = (list, [r0, c0]) =>
    list.slice().sort((a, b) =>
      (Math.abs(a[0] - r0) + Math.abs(a[1] - c0)) - (Math.abs(b[0] - r0) + Math.abs(b[1] - c0)));

  function buildBoard(boardEl, colors) {
    boardEl.innerHTML = '';
    cells = [];
    for (let r = 0; r < N; r++) {
      cells.push([]);
      for (let c = 0; c < N; c++) {
        const el = document.createElement('div');
        el.className = 'nya-cell';
        const i = REGION_COLOR_IDX[LAYOUT[r][c]];
        el.style.setProperty('--region-color', (colors && colors[i]) || FALLBACK_COLORS[i]);
        boardEl.appendChild(el);
        cells[r].push({ el, cat: false, x: false });
      }
    }
  }

  function setGlyph(s, ch, inst) {
    s.el.innerHTML = '';
    const span = document.createElement('span');
    span.className = 'nya-tut-g' + (inst ? '' : ' nya-tut-in');
    span.textContent = ch;
    s.el.appendChild(span);
  }
  function putCat(r, c, inst) {
    const s = cells[r][c];
    if (s.cat) return;
    s.cat = true;
    s.x = false;
    s.el.classList.remove('nya-marked', 'nya-tut-old', 'nya-tut-target');
    s.el.classList.add('nya-has-cat');
    setGlyph(s, '🐱', inst);
    if (!inst) tone(620, 0.08);
  }
  function putX(r, c, inst) {
    const s = cells[r][c];
    if (s.cat || s.x) return;
    s.x = true;
    s.el.classList.add('nya-marked');
    setGlyph(s, '✕', inst);
  }
  function glow(list, on, cls) {
    list.forEach(([r, c]) => cells[r][c].el.classList.toggle(cls || 'nya-tut-hl', on));
  }
  // ステップの頭で、それまでの✕をうすくして「新しく増えた✕」を目立たせる
  function dimOld() {
    cells.forEach((row) => row.forEach((s) => { if (s.x) s.el.classList.add('nya-tut-old'); }));
  }

  // ビルド時に「この時点で✕/ネコが付く予定のマス」を管理（時間の空白を作らないため）
  function planner() {
    const seen = new Set();
    cells.forEach((row, r) => row.forEach((s, c) => { if (s.x || s.cat) seen.add(key(r, c)); }));
    return {
      mark(r, c) { seen.add(key(r, c)); },
      take(list) {
        const out = list.filter(([r, c]) => !seen.has(key(r, c)));
        out.forEach(([r, c]) => seen.add(key(r, c)));
        return out;
      },
    };
  }

  // ライン/エリアを光らせてから、✕を1マスずつ付ける。終了時刻を返す
  function lineOps(ops, t0, glowCells, xs) {
    ops.push([t0, () => glow(glowCells, true)]);
    xs.forEach(([r, c], i) => ops.push([t0 + 500 + i * 150, (inst) => putX(r, c, inst)]));
    const end = t0 + 500 + xs.length * 150 + 350;
    ops.push([end, () => glow(glowCells, false)]);
    return end;
  }
  // ネコを置き、そのエリア・縦・横・まわりの✕をまとめて素早く付ける。終了時刻を返す
  function catBurst(ops, t0, r, c, pl) {
    pl.mark(r, c);
    ops.push([t0, (inst) => putCat(r, c, inst)]);
    const all = [].concat(regionCells(LAYOUT[r][c]), lineCol(c), lineRow(r), around(r, c));
    const xs = byDist(pl.take(all), [r, c]);
    xs.forEach(([xr, xc], i) => ops.push([t0 + 400 + i * 45, (inst) => putX(xr, xc, inst)]));
    return t0 + 400 + xs.length * 45 + 300;
  }

  /* ===================== [内容] ステップ定義 ===================== */
  // build() は「その時点の盤面」から、[待ち時間ms, 実行関数(inst)] の配列を作る
  const STEPS = [
    {
      caption: '① 色のついたエリアに、ネコを1匹ずつ置きます。この色は<b>1マスだけ</b>なので、ネコはここに決まりです！',
      build() {
        const ops = [[0, dimOld]];
        const [r, c] = FIRST_CAT;
        ops.push([300, () => glow([[r, c]], true, 'nya-tut-target')]);
        ops.push([1600, (inst) => { glow([[r, c]], false, 'nya-tut-target'); putCat(r, c, inst); }]);
        return ops;
      },
    },
    {
      caption: '② ネコと<b>同じ縦のライン</b>には、もう置けません（✕）。縦1列にネコは1匹だけです。',
      build() {
        const pl = planner();
        const ops = [[0, dimOld]];
        const [r, c] = FIRST_CAT;
        const line = lineCol(c);
        lineOps(ops, 300, line, byDist(pl.take(line), [r, c]));
        return ops;
      },
    },
    {
      caption: '③ <b>同じ横のライン</b>も同じです。横1列にネコは1匹だけです。',
      build() {
        const pl = planner();
        const ops = [[0, dimOld]];
        const [r, c] = FIRST_CAT;
        const line = lineRow(r);
        lineOps(ops, 300, line, byDist(pl.take(line), [r, c]));
        return ops;
      },
    },
    {
      caption: '④ ネコの<b>まわり8マス</b>（ナナメも）にも置けません。ネコ同士はくっつけて置けないルールです。',
      build() {
        const pl = planner();
        const ops = [[0, dimOld]];
        const [r, c] = FIRST_CAT;
        const ring = around(r, c);
        lineOps(ops, 300, ring, byDist(pl.take(ring), [r, c]));
        return ops;
      },
    },
    {
      caption: '⑤ ✕がふえて、このエリアは置けるマスが<b>ここ1つだけ</b>になりました。なのでネコが入ります！',
      build() {
        const pl = planner();
        const ops = [[0, dimOld]];
        const [r, c] = DEDUCED_CAT;
        const reg = regionCells(LAYOUT[r][c]);
        ops.push([300, () => { glow(reg, true); glow([[r, c]], true, 'nya-tut-target'); }]);
        ops.push([1900, () => { glow(reg, false); glow([[r, c]], false, 'nya-tut-target'); }]);
        catBurst(ops, 1900, r, c, pl);
        return ops;
      },
    },
    {
      caption: '⑥ ネコを置くたびに、<b>同じ色のエリア</b>・縦・横・まわりに✕がふえます。✕は「✕印」ボタンでつけるメモ。くり返して全部置けたらクリア！',
      build() {
        const pl = planner();
        const ops = [[0, dimOld]];
        let t = 400;
        REST_CATS.forEach(([r, c]) => { t = catBurst(ops, t, r, c, pl) + 250; });
        // 完成：光の波＋ファンファーレ（本編のクリア演出と同じ見た目）
        const wave = [];
        for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) wave.push([r, c]);
        wave.sort((a, b) => (a[0] + a[1]) - (b[0] + b[1]));
        wave.forEach(([r, c], i) => ops.push([t + i * 35, (inst) => {
          if (!inst) cells[r][c].el.classList.add('nya-solved');
        }]));
        [523.25, 659.25, 783.99, 1046.5].forEach((f, i) =>
          ops.push([t + i * 90, (inst) => { if (!inst) tone(f, 0.14, 'triangle'); }]));
        return ops;
      },
    },
  ];

  /* ===================== [枠] 表示・進行（ゲーム非依存） ===================== */
  let opts = {};
  let overlay = null;
  let ui = {};
  let pending = [];
  let cur = 0;
  let prevOverflow = '';

  function tone(f, d, t) { if (opts.tone) opts.tone(f, d, t); }

  function schedule(ops) {
    cancelPending();
    ops.sort((a, b) => a[0] - b[0]);
    pending = ops.map(([delay, fn]) => {
      const p = { fn, done: false, h: 0 };
      p.h = setTimeout(() => { p.done = true; fn(false); }, delay);
      return p;
    });
  }
  function cancelPending() {
    pending.forEach((p) => clearTimeout(p.h));
    pending = [];
  }
  // アニメの途中でも、残りを一気に完了させる
  function flush() {
    const rest = pending.filter((p) => !p.done);
    cancelPending();
    rest.forEach((p) => { p.done = true; p.fn(true); });
  }

  function renderChrome() {
    ui.caption.innerHTML = STEPS[cur].caption;
    ui.count.textContent = (cur + 1) + ' / ' + STEPS.length;
    ui.prev.disabled = cur === 0;
    ui.next.textContent = cur === STEPS.length - 1 ? 'あそんでみる' : 'つぎへ ▶';
    ui.replay.classList.toggle('nya-tut-hidden', cur !== STEPS.length - 1);
  }

  function playStep(k) { schedule(STEPS[k].build()); }

  // 盤面を作り直し、k番目の手前までを一瞬で再現してから、k番目をアニメ再生
  function rebuildTo(k) {
    cancelPending();
    buildBoard(ui.board, opts.colors);
    for (let i = 0; i < k; i++) {
      STEPS[i].build().sort((a, b) => a[0] - b[0]).forEach(([, fn]) => fn(true));
    }
    cur = k;
    renderChrome();
    playStep(k);
  }

  function next() {
    if (cur >= STEPS.length - 1) { close(); return; }
    flush();
    cur++;
    renderChrome();
    playStep(cur);
  }
  function prev() { if (cur > 0) rebuildTo(cur - 1); }
  function replay() { rebuildTo(0); }

  function onKey(e) {
    if (e.key === 'Escape') close();
    else if (e.key === 'ArrowRight') next();
    else if (e.key === 'ArrowLeft') prev();
  }

  function open(o) {
    if (overlay) return;
    opts = o || {};
    overlay = document.createElement('div');
    overlay.className = 'nya-tut-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', '遊びかた');
    overlay.innerHTML = `
      <div class="nya-tut-panel">
        <div class="nya-tut-head">
          <span class="nya-tut-title">❓ あそびかた</span>
          <span class="nya-tut-count"></span>
          <button type="button" class="nya-tut-close">とじる</button>
        </div>
        <div class="nya-tut-boardwrap"><div class="nya-grid"></div></div>
        <p class="nya-tut-caption"></p>
        <div class="nya-tut-actions">
          <button type="button" class="nya-tut-btn nya-tut-btn-sub nya-tut-prev">◀ まえへ</button>
          <button type="button" class="nya-tut-btn nya-tut-btn-main nya-tut-next">つぎへ ▶</button>
        </div>
        <button type="button" class="nya-tut-replay nya-tut-hidden">🔁 もう一度みる</button>
      </div>
    `;
    document.body.appendChild(overlay);
    prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    ui = {
      board: overlay.querySelector('.nya-grid'),
      caption: overlay.querySelector('.nya-tut-caption'),
      count: overlay.querySelector('.nya-tut-count'),
      prev: overlay.querySelector('.nya-tut-prev'),
      next: overlay.querySelector('.nya-tut-next'),
      replay: overlay.querySelector('.nya-tut-replay'),
    };
    ui.board.style.setProperty('--cols', N);
    ui.prev.addEventListener('click', prev);
    ui.next.addEventListener('click', next);
    ui.replay.addEventListener('click', replay);
    overlay.querySelector('.nya-tut-close').addEventListener('click', close);
    document.addEventListener('keydown', onKey);

    tone(660, 0.12); // タップ操作の中で鳴らして、以降の効果音を有効にする
    rebuildTo(0);
  }

  function close() {
    if (!overlay) return;
    cancelPending();
    document.removeEventListener('keydown', onKey);
    document.body.style.overflow = prevOverflow;
    overlay.remove();
    overlay = null;
  }

  return { open, close };
})();
