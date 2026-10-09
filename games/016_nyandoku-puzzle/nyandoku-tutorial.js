/* =========================================================
   ねこ配置パズル「遊びかた」チュートリアル（動く説明書）

   構成（将来 common/ へ移す時は「枠」だけを共通化する想定）
     [枠]   オーバーレイ表示・まえへ/つぎへ・とじる・タイマー管理・体験ステップの進行（ゲーム非依存）
     [内容] お手本盤面(5×5)・各ステップの説明文とアニメ（このゲーム専用）

   ステップは2種類
     見るだけ … { caption, build() }            build()が時間つきの演出(ops)を返す
     体験する … { caption, targets[], finale }  光ったマスをユーザーがタップして進める

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

  const FIRST_CAT = [2, 2];   // ①：1マスだけのエリア＝ここしか置けない（②〜④もこのネコ）
  const DEDUCED_CAT = [0, 1]; // ⑤：✕でしぼられて「ここ1つだけ」になるネコ（青）
  const AUTO_CAT2 = [1, 4];   // ⑥：同じく「ここ1つだけ」になるネコ（緑）
  // ⑦：ユーザーがタップして置くネコ（赤→紫）。赤を置くと横ラインで紫に✕が入り、紫も1マスだけになる
  const PRACTICE_RED = [4, 3];
  const PRACTICE_PURPLE = [3, 0];

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
    s.el.classList.remove('nya-marked', 'nya-tut-old', 'nya-tut-target', 'nya-tut-tap');
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

  // 「このエリアは置けるマスが1つだけ」→ エリアを光らせ、残った1マスを点滅 → ネコが入る → ✕が広がる
  function deduceOps(pos) {
    const pl = planner();
    const ops = [[0, dimOld]];
    const [r, c] = pos;
    const reg = regionCells(LAYOUT[r][c]);
    ops.push([300, () => { glow(reg, true); glow([[r, c]], true, 'nya-tut-target'); }]);
    ops.push([1900, () => { glow(reg, false); glow([[r, c]], false, 'nya-tut-target'); }]);
    catBurst(ops, 1900, r, c, pl);
    return ops;
  }
  // 完成：光の波＋ファンファーレ（本編のクリア演出と同じ見た目）
  function waveOps(t) {
    const ops = [];
    const wave = [];
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) wave.push([r, c]);
    wave.sort((a, b) => (a[0] + a[1]) - (b[0] + b[1]));
    wave.forEach(([r, c], i) => ops.push([t + i * 35, (inst) => {
      if (!inst) cells[r][c].el.classList.add('nya-solved');
    }]));
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) =>
      ops.push([t + i * 90, (inst) => { if (!inst) tone(f, 0.14, 'triangle'); }]));
    return ops;
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
      build() { return deduceOps(DEDUCED_CAT); },
    },
    {
      caption: '⑥ 緑のエリアも、置けるマスが<b>1つだけ</b>になりました。ネコを置くと、<b>同じ色</b>・縦・横・まわりに✕がふえます。',
      build() { return deduceOps(AUTO_CAT2); },
    },
    {
      // 体験ステップ：光ったマスをタップ → ネコが入り✕が広がる → 次のマスへ
      caption: '⑦ ここからは、やってみましょう！赤のエリアは置けるマスが<b>1つだけ</b>。光っているマスをタップして、ネコを置いてください。',
      targets: [
        {
          cat: PRACTICE_RED,
          prompt: '⑦ ここからは、やってみましょう！赤のエリアは置けるマスが<b>1つだけ</b>。光っているマスをタップして、ネコを置いてください。',
          done: 'そうです！ネコと<b>同じ横のライン</b>にも置けなくなるので、✕が入ります。',
          glowLine: 'row',
          pause: 1200,
        },
        {
          cat: PRACTICE_PURPLE,
          prompt: '紫のエリアに✕が入って、置けるマスが<b>1つだけ</b>になりました。最後です。光っているマスをタップしましょう！',
          pause: 500,
        },
      ],
      finale: 'クリア！全部のネコを置けました🎉 本番では「✕印」ボタンで✕をつけながら、しぼりこんでいきましょう。',
    },
  ];

  /* ===================== [枠] 表示・進行（ゲーム非依存） ===================== */
  let opts = {};
  let overlay = null;
  let ui = {};
  let pending = [];
  let practice = null; // 体験ステップの進行 { k, idx, busy, done }
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
    renderButtons();
  }
  function renderButtons() {
    const step = STEPS[cur];
    const last = cur === STEPS.length - 1;
    const waiting = !!step.targets && !(practice && practice.done); // 体験の途中
    ui.next.textContent = waiting ? '答えを見る' : (last ? 'あそんでみる' : 'つぎへ ▶');
    ui.replay.classList.toggle('nya-tut-hidden', !(last && !waiting));
  }

  function playStep(k) {
    if (STEPS[k].targets) startPractice(k);
    else schedule(STEPS[k].build());
  }

  /* ---- 体験ステップ：光ったマスをタップ → ネコ＋✕ → 次のマスへ ---- */
  function startPractice(k) {
    practice = { k, idx: 0, busy: false, done: false };
    ui.boardWrap.classList.add('nya-tut-practice');
    dimOld();
    promptTarget();
  }
  function promptTarget() {
    const t = STEPS[practice.k].targets[practice.idx];
    const [r, c] = t.cat;
    ui.caption.innerHTML = t.prompt;
    glow(regionCells(LAYOUT[r][c]), true);
    glow([[r, c]], true, 'nya-tut-target');
    glow([[r, c]], true, 'nya-tut-tap');
    practice.busy = false;
    renderButtons();
  }
  function clearFocus(r, c) {
    glow(regionCells(LAYOUT[r][c]), false);
    glow([[r, c]], false, 'nya-tut-target');
    glow([[r, c]], false, 'nya-tut-tap');
  }
  function onBoardClick(e) {
    if (!practice || practice.busy || practice.done) return;
    const el = e.target.closest('.nya-cell');
    if (!el) return;
    const idx = Array.prototype.indexOf.call(ui.board.children, el);
    const r = (idx / N) | 0, c = idx % N;
    const t = STEPS[practice.k].targets[practice.idx];
    if (r === t.cat[0] && c === t.cat[1]) {
      practice.busy = true;
      clearFocus(r, c);
      dimOld(); // 今までの✕はうすく、これから増える✕を目立たせる
      if (t.done) ui.caption.innerHTML = t.done;
      const ops = [];
      const end = catBurst(ops, 0, r, c, planner());
      const line = t.glowLine === 'row' ? lineRow(r) : t.glowLine === 'col' ? lineCol(c) : null;
      if (line) {
        ops.push([0, () => glow(line, true)]);
        ops.push([end, () => glow(line, false)]);
      }
      ops.push([end + (t.pause || 0), (inst) => advancePractice(inst)]);
      schedule(ops);
    } else {
      // ちがうマス：ぷるっと揺らして、光っているマスを案内する
      el.classList.remove('nya-shake');
      void el.offsetWidth;
      el.classList.add('nya-shake');
      setTimeout(() => el.classList.remove('nya-shake'), 320);
      tone(260, 0.12, 'sawtooth');
    }
  }
  function advancePractice(inst) {
    if (!practice) return;
    const step = STEPS[practice.k];
    practice.idx++;
    if (practice.idx < step.targets.length) { promptTarget(); return; }
    practice.done = true;
    ui.boardWrap.classList.remove('nya-tut-practice');
    ui.caption.innerHTML = step.finale;
    renderButtons();
    if (!inst) schedule(waveOps(300));
  }
  // 「答えを見る」：のこりを自動で置いて完成させる
  function finishPractice() {
    if (!practice || practice.done) return;
    flush();
    while (practice && !practice.done) {
      const [r, c] = STEPS[practice.k].targets[practice.idx].cat;
      clearFocus(r, c);
      dimOld();
      const ops = [];
      const end = catBurst(ops, 0, r, c, planner());
      ops.push([end, (inst) => advancePractice(inst)]);
      ops.sort((a, b) => a[0] - b[0]).forEach(([, fn]) => fn(true));
    }
    renderButtons();
  }

  // 盤面を作り直し、k番目の手前までを一瞬で再現してから、k番目をアニメ再生
  function rebuildTo(k) {
    cancelPending();
    practice = null;
    ui.boardWrap.classList.remove('nya-tut-practice');
    buildBoard(ui.board, opts.colors);
    for (let i = 0; i < k; i++) {
      STEPS[i].build().sort((a, b) => a[0] - b[0]).forEach(([, fn]) => fn(true));
    }
    cur = k;
    renderChrome();
    playStep(k);
  }

  function next() {
    if (STEPS[cur].targets) {
      if (practice && !practice.done) { finishPractice(); return; }
      close();
      return;
    }
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
      boardWrap: overlay.querySelector('.nya-tut-boardwrap'),
      board: overlay.querySelector('.nya-grid'),
      caption: overlay.querySelector('.nya-tut-caption'),
      count: overlay.querySelector('.nya-tut-count'),
      prev: overlay.querySelector('.nya-tut-prev'),
      next: overlay.querySelector('.nya-tut-next'),
      replay: overlay.querySelector('.nya-tut-replay'),
    };
    ui.board.style.setProperty('--cols', N);
    ui.board.addEventListener('click', onBoardClick);
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
    practice = null;
    document.removeEventListener('keydown', onKey);
    document.body.style.overflow = prevOverflow;
    overlay.remove();
    overlay = null;
  }

  return { open, close };
})();
