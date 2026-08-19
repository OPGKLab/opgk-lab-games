/* =========================================================
   じゃぐちパズル🚰 固有ロジック
   共通土台(GameShell)のAPIだけを使い、盤面生成・回転・接続判定を実装。
   入口は左上（じゃぐち・左側から）、出口は右下（バケツ・右側へ）固定。
   ========================================================= */

const shell = new GameShell({
  rootSelector: '#app',
  title: 'じゃぐちパズル🚰',
  hint: 'パイプをタップして回転させ、じゃぐちからバケツまで水路をつなげましょう',
  hasScore: false,
  hasTimer: false,
});

const NORMAL_SIZE = { rows: 4, cols: 4 };
const HARD_SIZE = { rows: 5, cols: 5 };

const DIR_ORDER = ['N', 'E', 'S', 'W']; // 時計回り順
const BASE_OPENINGS = {
  straight: ['W', 'E'],
  corner: ['N', 'E'],
};

let rows = NORMAL_SIZE.rows;
let cols = NORMAL_SIZE.cols;
let grid = [];
let solved = false;

function rotateDir(d, rot) {
  const i = DIR_ORDER.indexOf(d);
  return DIR_ORDER[(i + rot) % 4];
}
function oppositeDir(d) {
  return DIR_ORDER[(DIR_ORDER.indexOf(d) + 2) % 4];
}
function rotateOpenings(type, rot) {
  return BASE_OPENINGS[type].map((d) => rotateDir(d, rot));
}
function dirBetween(a, b) {
  if (b[0] < a[0]) return 'N';
  if (b[0] > a[0]) return 'S';
  if (b[1] < a[1]) return 'W';
  return 'E';
}
function neighborCoord(r, c, dir) {
  if (dir === 'N') return [r - 1, c];
  if (dir === 'S') return [r + 1, c];
  if (dir === 'E') return [r, c + 1];
  return [r, c - 1];
}

/* 左上→右下の一筆書き経路をランダム生成（バックトラック法） */
function randomPath(r, c) {
  const visited = Array.from({ length: r }, () => Array(c).fill(false));
  const path = [];
  function shuffledNeighbors(rr, cc) {
    const list = [];
    if (rr > 0) list.push([rr - 1, cc]);
    if (rr < r - 1) list.push([rr + 1, cc]);
    if (cc > 0) list.push([rr, cc - 1]);
    if (cc < c - 1) list.push([rr, cc + 1]);
    for (let i = list.length - 1; i > 0; i--) {
      const j = (Math.random() * (i + 1)) | 0;
      [list[i], list[j]] = [list[j], list[i]];
    }
    return list;
  }
  function dfs(rr, cc) {
    visited[rr][cc] = true;
    path.push([rr, cc]);
    if (rr === r - 1 && cc === c - 1) return true;
    for (const [nr, nc] of shuffledNeighbors(rr, cc)) {
      if (!visited[nr][nc] && dfs(nr, nc)) return true;
    }
    path.pop();
    visited[rr][cc] = false;
    return false;
  }
  dfs(0, 0);
  return path;
}

/* 経路上マスに、必要な向き(2方向)を必ず表現できる種類(type)を割り当てて経路情報を返す */
function planPath(r, c) {
  const path = randomPath(r, c);
  const plan = []; // { pr, pc, type, need:[inD,outD], isEntrance, isExit }
  path.forEach(([pr, pc], i) => {
    const inD = i === 0 ? 'W' : oppositeDir(dirBetween(path[i - 1], path[i]));
    const outD = i === path.length - 1 ? 'E' : dirBetween(path[i], path[i + 1]);
    const type = oppositeDir(inD) === outD ? 'straight' : 'corner';
    plan.push({ pr, pc, type, need: [inD, outD], isEntrance: i === 0, isExit: i === path.length - 1 });
  });
  return plan;
}

/* 経路プランの各マスについて「必要な向きを実現できる回転」が存在するか検証（保険） */
function planIsSolvable(plan) {
  return plan.every(({ type, need }) => {
    for (let rot = 0; rot < 4; rot++) {
      const s = new Set(rotateOpenings(type, rot));
      if (s.has(need[0]) && s.has(need[1])) return true;
    }
    return false;
  });
}

function buildPuzzle(r, c) {
  solved = false;

  let plan = planPath(r, c);
  let guard = 0;
  while (!planIsSolvable(plan) && guard < 20) {
    plan = planPath(r, c);
    guard++;
  }

  rows = r;
  cols = c;
  grid = Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => ({
      type: Math.random() < 0.5 ? 'straight' : 'corner',
      rotation: (Math.random() * 4) | 0,
      isEntrance: false,
      isExit: false,
    }))
  );
  plan.forEach(({ pr, pc, type, isEntrance, isExit }) => {
    grid[pr][pc] = {
      type,
      rotation: (Math.random() * 4) | 0, // 向きはランダム＝これをプレイヤーが揃える
      isEntrance,
      isExit,
    };
  });

  renderGrid();
}

function pipeSVG(type) {
  if (type === 'straight') {
    return '<svg viewBox="0 0 100 100" class="pipe-svg"><line x1="0" y1="50" x2="100" y2="50"/></svg>';
  }
  // corner 基準openingsは N-E（回転0の状態）
  return '<svg viewBox="0 0 100 100" class="pipe-svg"><path d="M50,0 L50,50 L100,50"/></svg>';
}

function renderGrid() {
  shell.board.className = 's-board pipe-board';
  shell.board.style.setProperty('--rows', rows);
  shell.board.style.setProperty('--cols', cols);
  shell.board.innerHTML = '';

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const tile = grid[r][c];
      const btn = document.createElement('button');
      btn.className = `pipe-tile pipe-${tile.type}`;
      if (tile.isEntrance) btn.classList.add('pipe-entrance');
      if (tile.isExit) btn.classList.add('pipe-exit');

      const shape = document.createElement('div');
      shape.className = 'pipe-shape';
      shape.style.transform = `rotate(${tile.rotation * 90}deg)`;
      shape.innerHTML = pipeSVG(tile.type);
      btn.appendChild(shape);
      tile.shapeEl = shape;

      btn.addEventListener('click', () => onTileClick(tile, shape));
      shell.board.appendChild(btn);
    }
  }
}

function onTileClick(tile, shapeEl) {
  if (!shell.running || solved) return;
  tile.rotation = (tile.rotation + 1) % 4;
  shapeEl.style.transform = `rotate(${tile.rotation * 90}deg)`;
  shell.playTone(520, 0.06);

  const flow = computeFlow();
  if (flow.ok) {
    solved = true;
    playFlowAnimation(flow.order);
  }
}

/* 入口から出口まで、つながっている順にパイプを光らせてから完了処理をする */
function playFlowAnimation(order) {
  const step = Math.max(45, Math.min(90, 900 / Math.max(order.length, 1)));
  order.forEach(([r, c], i) => {
    setTimeout(() => {
      const t = grid[r][c];
      if (t.shapeEl) t.shapeEl.classList.add('pipe-wet');
    }, i * step);
  });
  setTimeout(() => {
    shell.board.classList.add('pipe-solved');
    playClearFanfare();
    shell.end('クリア！水がつながったよ🚰');
  }, order.length * step + 200);
}

/* クリア時のサウンド（上昇アルペジオ＋余韻） */
function playClearFanfare() {
  const notes = [523.25, 659.25, 783.99, 1046.5];
  notes.forEach((freq, i) => setTimeout(() => shell.playTone(freq, 0.16, 'triangle'), i * 100));
  setTimeout(() => shell.playTone(1318.51, 0.4, 'triangle'), notes.length * 100);
}

function currentOpenings(r, c) {
  return new Set(rotateOpenings(grid[r][c].type, grid[r][c].rotation));
}

/* 入口から到達可能なマスをBFSで探索し、到達順(order)とクリア判定(ok)を返す */
function computeFlow() {
  const order = [];
  if (!currentOpenings(0, 0).has('W')) return { ok: false, order };

  const visited = grid.map((row) => row.map(() => false));
  const queue = [[0, 0]];
  visited[0][0] = true;

  while (queue.length) {
    const [r, c] = queue.shift();
    order.push([r, c]);
    for (const dir of currentOpenings(r, c)) {
      const [nr, nc] = neighborCoord(r, c, dir);
      if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
      if (visited[nr][nc]) continue;
      if (currentOpenings(nr, nc).has(oppositeDir(dir))) {
        visited[nr][nc] = true;
        queue.push([nr, nc]);
      }
    }
  }
  const ok = visited[rows - 1][cols - 1] && currentOpenings(rows - 1, cols - 1).has('E');
  return { ok, order };
}

function showPlaceholder() {
  shell.board.className = 's-board';
  shell.board.innerHTML = '<div class="pipe-placeholder">「スタート」を押すとパズルが始まります</div>';
}

showPlaceholder();

/* ---- GameShellのライフサイクルに接続 ---- */
shell.onStart(() => {
  const size = shell.hardMode ? HARD_SIZE : NORMAL_SIZE;
  buildPuzzle(size.rows, size.cols);
});
shell.onReset(() => {
  showPlaceholder();
});
