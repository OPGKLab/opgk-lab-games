/* =========================================================
   ペアつなぎ👯 固有ロジック
   共通土台(GameShell)のAPIだけを使い、盤面生成・線の描画・交差判定を実装。
   固定点の同色ペアを、線が交差しないようにつなぐ。クリアで自動的に次のレベルへ進む。
   ========================================================= */

const shell = new GameShell({
  rootSelector: '#app',
  title: 'ペアつなぎ👯',
  hint: '同じ色の丸どうしを、線が交わらないようにつなぎましょう',
  hasScore: false,
  hasTimer: false,
});

const svgNS = 'http://www.w3.org/2000/svg';
const CX = 180, CY = 180, RMAX = 140;
const COLOR_POOL = ['#e36363','#ea9e52','#e3ca52','#61bf87','#52bfce','#5c8cd6','#967dd6','#d875b1']; // シリーズ標準8色
const MAX_LEVEL = 100;
const HARD_OFFSET = 50;   // 激むず：通常の難易度カーブを50レベル先取りする
const HIT_R = 22, RELEASE_R = 24;

/* ---------- 進行状態 ---------- */
let level = 1;
let currentPts = [];
let currentSolution = null;   // 生成時にソルバーが見つけた解ルート（ヒント用）
let lockedSegments = [];
let moveHistory = [];
let dragging = null, dragLine = null;
let solved = false;
let advanceTimer = null;
let svgEl = null, linesLayer = null, pointsLayer = null;

function storageKey(){ return shell.hardMode ? 'pairTsunagiLevelHard' : 'pairTsunagiLevel'; }
function loadLevel(){
  try { const v = parseInt(localStorage.getItem(storageKey()), 10); return v >= 1 ? Math.min(MAX_LEVEL, v) : 1; }
  catch(e){ return 1; }
}
function saveLevel(){ try { localStorage.setItem(storageKey(), String(level)); } catch(e){} }

/* ---------- 共通枠への追加UI（ひとつ戻る／ヒント／レベル表示／リセット導線） ---------- */
const root = document.querySelector('#app');
const infoEl = document.createElement('span');
root.querySelector('.s-status').appendChild(infoEl);

const tools = document.createElement('div');
tools.className = 's-controls pair-tools';
tools.innerHTML =
  '<button class="s-icon-btn s-icon-btn-text" id="pairUndoBtn">⬅️ひとつ戻る</button>' +
  '<button class="s-icon-btn s-icon-btn-text" id="pairHintBtn">💡ヒント</button>';
root.querySelector('.s-controls').after(tools);

const linkWrap = document.createElement('div');
linkWrap.className = 'pair-link-wrap';
linkWrap.innerHTML = '<button class="pair-link-btn" id="pairResetLevelBtn">レベル1から始め直す</button>';
root.querySelector('.s-hint').after(linkWrap);

function updateInfo(){
  if (!shell.running || !currentPts.length){ infoEl.textContent = `レベル: ${level}`; return; }
  const total = currentPts.length / 2;
  const done = currentPts.filter(p => p.connected).length / 2;
  infoEl.textContent = `レベル: ${level}　接続: ${done} / ${total}`;
}

/* ---------- 効果音・演出 ---------- */
function playConnectSound(){
  shell.playTone(880, 0.1, 'triangle');
  setTimeout(() => shell.playTone(1318.51, 0.18, 'triangle'), 90);
}
function playClearFanfare(){
  const notes = [523.25, 659.25, 783.99, 1046.5];
  notes.forEach((f, i) => setTimeout(() => shell.playTone(f, 0.16, 'triangle'), i * 100));
  setTimeout(() => shell.playTone(1318.51, 0.4, 'triangle'), notes.length * 100);
}
function playNg(){
  shell.playTone(150, 0.15, 'square');
  if (navigator.vibrate) navigator.vibrate(60);
}
function spawnSpark(x, y){
  const s = document.createElementNS(svgNS, 'text');
  s.setAttribute('x', x); s.setAttribute('y', y);
  s.setAttribute('text-anchor', 'middle'); s.setAttribute('class', 'pair-spark'); s.setAttribute('font-size', '22');
  s.textContent = '✨';
  linesLayer.appendChild(s);
  setTimeout(() => s.remove(), 650);
}

/* ---------- 盤面生成・ソルバー ---------- */
function shuffle(arr){ for(let i=arr.length-1;i>0;i--){const j=(Math.random()*(i+1))|0; [arr[i],arr[j]]=[arr[j],arr[i]];} return arr; }

function pathToSegments(path){
  const segs=[]; for (let i=0;i<path.length-1;i++) segs.push([path[i],path[i+1]]); return segs;
}
function segsCrossAny(segs, locked){
  return segs.some(s=>locked.some(ls=>segIntersect(s[0],s[1],ls[0],ls[1])));
}

/* ---- マス目探索ソルバー（盤面を6px格子に区切り、既存の線と他の点を避けて最短経路を探す） ---- */
const GC=6, GN=60, PATH_CLEAR=8, DOT_CLEAR=15, OWN_CLEAR=11;
const IN_DISK = (()=>{ const a=new Uint8Array(GN*GN);
  for (let i=0;i<GN*GN;i++){ const x=(i%GN+0.5)*GC, y=(Math.floor(i/GN)+0.5)*GC; a[i]=Math.hypot(x-CX,y-CY)<=147?1:0; }
  return a; })();
function buildDotBlock(pts){
  const a=new Int16Array(GN*GN).fill(-1);
  pts.forEach((p,k)=>{
    for (let gy=Math.max(0,Math.floor((p.y-DOT_CLEAR)/GC)); gy<=Math.min(GN-1,Math.floor((p.y+DOT_CLEAR)/GC)); gy++)
      for (let gx=Math.max(0,Math.floor((p.x-DOT_CLEAR)/GC)); gx<=Math.min(GN-1,Math.floor((p.x+DOT_CLEAR)/GC)); gx++){
        if (Math.hypot((gx+0.5)*GC-p.x,(gy+0.5)*GC-p.y)<DOT_CLEAR && a[gy*GN+gx]<0) a[gy*GN+gx]=k;
      }
  });
  return a;
}
function markPath(block, path){
  for (let i=0;i<path.length-1;i++){
    const A=path[i], B=path[i+1], len=Math.hypot(B.x-A.x,B.y-A.y), n=Math.max(1,Math.ceil(len/2));
    for (let t=0;t<=n;t++){
      const x=A.x+(B.x-A.x)*t/n, y=A.y+(B.y-A.y)*t/n;
      for (let gy=Math.max(0,Math.floor((y-PATH_CLEAR)/GC)); gy<=Math.min(GN-1,Math.floor((y+PATH_CLEAR)/GC)); gy++)
        for (let gx=Math.max(0,Math.floor((x-PATH_CLEAR)/GC)); gx<=Math.min(GN-1,Math.floor((x+PATH_CLEAR)/GC)); gx++)
          if (Math.hypot((gx+0.5)*GC-x,(gy+0.5)*GC-y)<=PATH_CLEAR) block[gy*GN+gx]=1;
    }
  }
}
function routeGrid(p,q,pi,qi,pathBlock,dotBlock){
  const passable = c=>{
    if (!IN_DISK[c]) return false;
    const d=dotBlock[c]; if (d>=0 && d!==pi && d!==qi) return false;
    if (!pathBlock[c]) return true;
    const x=(c%GN+0.5)*GC, y=(Math.floor(c/GN)+0.5)*GC;
    return Math.hypot(x-p.x,y-p.y)<OWN_CLEAR || Math.hypot(x-q.x,y-q.y)<OWN_CLEAR;
  };
  const s=Math.floor(p.y/GC)*GN+Math.floor(p.x/GC), g=Math.floor(q.y/GC)*GN+Math.floor(q.x/GC);
  const prev=new Int32Array(GN*GN).fill(-2), queue=new Int32Array(GN*GN);
  let qh=0, qt=0; queue[qt++]=s; prev[s]=-1;
  const DX=[1,-1,0,0,1,1,-1,-1], DY=[0,0,1,-1,1,-1,1,-1];
  while (qh<qt && prev[g]===-2){
    const c=queue[qh++], cx=c%GN, cy=(c/GN)|0;
    for (let k=0;k<8;k++){
      const nx=cx+DX[k], ny=cy+DY[k];
      if (nx<0||ny<0||nx>=GN||ny>=GN) continue;
      const n=ny*GN+nx; if (prev[n]!==-2) continue;
      if (!passable(n)) continue;
      if (k>=4 && (!passable(cy*GN+nx) || !passable(ny*GN+cx))) continue;
      prev[n]=c; queue[qt++]=n;
    }
  }
  if (prev[g]===-2) return null;
  const cells=[]; for (let c=g;c!==-1;c=prev[c]) cells.push(c); cells.reverse();
  const pts=cells.map(c=>({x:(c%GN+0.5)*GC, y:(Math.floor(c/GN)+0.5)*GC}));
  pts[0]={x:p.x,y:p.y}; pts[pts.length-1]={x:q.x,y:q.y};
  const clear=(A,B)=>{
    const len=Math.hypot(B.x-A.x,B.y-A.y), n=Math.max(1,Math.ceil(len/3));
    for (let t=0;t<=n;t++){
      const x=A.x+(B.x-A.x)*t/n, y=A.y+(B.y-A.y)*t/n;
      if (!passable(Math.floor(y/GC)*GN+Math.floor(x/GC))) return false;
    }
    return true;
  };
  const out=[pts[0]]; let i=0;
  while (i<pts.length-1){
    let j=pts.length-1; while (j>i+1 && !clear(pts[i],pts[j])) j--;
    out.push(pts[j]); i=j;
  }
  return out;
}
function trySolveOrder(pts, pairOrder, dotBlock){
  const pathBlock=new Uint8Array(GN*GN); const locked=[]; const sol=new Map();
  for (const idx of pairOrder){
    const p=pts[idx], q=pts[p.partner];
    const routed=routeGrid(p,q,idx,p.partner,pathBlock,dotBlock);
    if (!routed) return null;
    const segs=pathToSegments(routed);
    if (segsCrossAny(segs, locked)) return null;
    locked.push(...segs); markPath(pathBlock, routed); sol.set(idx, routed);
  }
  return sol;
}
/* 解の有無と「順番許容率」（ランダムな順でつないで詰まらない割合。低いほど順番の読みが必要）を返す */
function evaluatePuzzle(pts, randomOrders=10){
  const dotBlock=buildDotBlock(pts);
  const seen=new Set(), pairList=[];
  pts.forEach((p,i)=>{ if(!seen.has(i)){ pairList.push(i); seen.add(i); seen.add(p.partner); } });
  const dist=idx=>{ const p=pts[idx], q=pts[p.partner]; return Math.hypot(p.x-q.x,p.y-q.y); };
  const orders=[pairList.slice().sort((a,b)=>dist(a)-dist(b)), pairList.slice().sort((a,b)=>dist(b)-dist(a))];
  for (let i=0;i<randomOrders;i++) orders.push(shuffle(pairList.slice()));
  let ok=0, first=null;
  for (const o of orders){ const s=trySolveOrder(pts,o,dotBlock); if (s){ ok++; if(!first) first=s; } }
  return { sol:first, rate:ok/orders.length };
}
function targetRateForLevel(lv){ return 0.45 - 0.33*(lv-1)/99; }
function pairCountForLevel(lv){ return Math.min(8, 3 + Math.floor((lv-1)/8)); }
function nonCrossingAssign(slots){
  const partner = new Array(slots).fill(-1);
  function assign(indices){
    if (!indices.length) return;
    const p0 = indices[0];
    const rest = indices.slice(1);
    const evenPositions = [];
    for (let k=0;k<rest.length;k+=2) evenPositions.push(k);
    const k = evenPositions[(Math.random()*evenPositions.length)|0];
    const pt = rest[k];
    partner[p0]=pt; partner[pt]=p0;
    assign(rest.slice(0,k));
    assign(rest.slice(k+1));
  }
  assign(Array.from({length:slots},(_,i)=>i));
  return partner;
}
function countNaiveCrossings(all){
  const segs=[]; const seen=new Set();
  all.forEach(p=>{ if(!seen.has(p.slot)){ segs.push([p, all[p.partner]]); seen.add(p.slot); seen.add(p.partner); } });
  let count=0;
  for (let i=0;i<segs.length;i++) for (let j=i+1;j<segs.length;j++){
    if (segIntersect(segs[i][0],segs[i][1],segs[j][0],segs[j][1])) count++;
  }
  return count;
}
function minPairDistance(pts){
  const seen=new Set(); let minD=Infinity;
  pts.forEach(p=>{
    if (!seen.has(p.slot)){
      const q=pts[p.partner];
      minD = Math.min(minD, Math.hypot(p.x-q.x, p.y-q.y));
      seen.add(p.slot); seen.add(p.partner);
    }
  });
  return minD;
}
function generateLayout(pairCount, interiorPointCount){
  const total = pairCount*2;
  const boundaryCount = total - interiorPointCount;
  const pts = [];
  // 外周点：外周点どうしを等間隔に配置（開始角はランダム回転）
  const offset = Math.random()*2*Math.PI;
  for (let i=0;i<boundaryCount;i++){
    const a = offset + i*(2*Math.PI/boundaryCount);
    pts.push({x:CX+RMAX*Math.cos(a), y:CY+RMAX*Math.sin(a), partner:null, connected:false});
  }
  // 内側点：既存の点から最も離れた候補を選ぶ（best-candidate法）ことで偏りを抑える
  for (let k=0;k<interiorPointCount;k++){
    let bx=CX, by=CY, bd=-1;
    for (let t=0;t<40;t++){
      const r = RMAX*0.72*Math.sqrt(Math.random());
      const a = Math.random()*2*Math.PI;
      const x = CX+r*Math.cos(a), y = CY+r*Math.sin(a);
      let d = Infinity;
      for (const p of pts) d = Math.min(d, Math.hypot(p.x-x, p.y-y));
      if (d>bd){ bd=d; bx=x; by=y; }
    }
    pts.push({x:bx, y:by, partner:null, connected:false});
  }
  const MIN_D = 85;
  let paired=false;
  for (let attempt=0; attempt<30 && !paired; attempt++){
    const rest = shuffle(Array.from({length:total},(_,i)=>i));
    const pairs = []; let stuck=false;
    while (rest.length){
      const a = rest.shift();
      const cand = rest.filter(b=>Math.hypot(pts[a].x-pts[b].x, pts[a].y-pts[b].y)>=MIN_D);
      if (!cand.length){ stuck=true; break; }
      const b = cand[(Math.random()*cand.length)|0];
      rest.splice(rest.indexOf(b),1);
      pairs.push([a,b]);
    }
    if (!stuck){ pairs.forEach(([a,b])=>{ pts[a].partner=b; pts[b].partner=a; }); paired=true; }
  }
  if (!paired){
    const order = shuffle(Array.from({length:total},(_,i)=>i));
    for (let i=0;i<order.length;i+=2){ pts[order[i]].partner = order[i+1]; pts[order[i+1]].partner = order[i]; }
  }
  pts.forEach((p,i)=>p.slot=i);
  const palette = Array.from({length:pairCount},(_,i)=>COLOR_POOL[Math.round(i*COLOR_POOL.length/pairCount)]);
  let pi=0; const seen = new Set();
  pts.forEach(p=>{
    if (!seen.has(p.slot)){
      const e = palette[pi++];
      p.col = e; pts[p.partner].col = e;
      seen.add(p.slot); seen.add(p.partner);
    }
  });
  return pts;
}
function generateSafeLayout(pairCount){
  const total = pairCount*2;
  const assign = nonCrossingAssign(total);
  const pts = [];
  for (let i=0;i<total;i++){
    const angle = -Math.PI/2 + i*(2*Math.PI/total);
    pts.push({x:CX+RMAX*Math.cos(angle), y:CY+RMAX*Math.sin(angle), partner:assign[i], connected:false});
  }
  pts.forEach((p,i)=>p.slot=i);
  const palette = Array.from({length:pairCount},(_,i)=>COLOR_POOL[Math.round(i*COLOR_POOL.length/pairCount)]);
  let pi=0; const seen = new Set();
  pts.forEach(p=>{
    if (!seen.has(p.slot)){
      const e = palette[pi++];
      p.col = e; pts[p.partner].col = e;
      seen.add(p.slot); seen.add(p.partner);
    }
  });
  return pts;
}
function searchPuzzle(pairCount, target, attempts){
  const total = pairCount*2, TOL = 0.10;
  const maxInterior = Math.min(total-2, Math.max(2, Math.floor(total*0.6)));
  let best=null;
  for (let attempt=0; attempt<attempts; attempt++){
    // 内側点の数は固定スケジュールにせず、目標の難しさに合う盤面が出るよう毎回変えて探す
    const interior = 2 + ((Math.random()*(maxInterior-2+1))|0);
    const pts = generateLayout(pairCount, interior);
    if (countNaiveCrossings(pts)===0) continue;   // 直線だけで解ける盤面は除外
    const ev = evaluatePuzzle(pts);
    if (!ev.sol) continue;                         // 解けない盤面は破棄
    const diff = Math.abs(ev.rate - target);
    if (!best || diff<best.diff) best = {pts, rate:ev.rate, sol:ev.sol, diff};
    if (diff<=TOL) break;
  }
  return best;
}
function buildPuzzle(level){
  const pairCount = pairCountForLevel(level);
  const target = targetRateForLevel(level);
  let found = searchPuzzle(pairCount, target, pairCount>=7 ? 100 : 50);
  if (!found && pairCount>3) found = searchPuzzle(pairCount-1, target, 50);   // 見つからない時は1ペア減らして再探索
  if (!found){
    const pts = generateSafeLayout(pairCount);     // 最終保険：外周のみの非交差配置（必ず解ける）
    const ev = evaluatePuzzle(pts);
    found = {pts, rate:ev.rate, sol:ev.sol};
  }
  const best = found.pts;
  currentSolution = found.sol;
  return best;
}

/* ---------- 描画 ---------- */
function renderBoard(){
  shell.board.className = 's-board pair-board';
  shell.board.innerHTML =
    '<svg class="pair-svg" viewBox="0 0 360 360">' +
    '<defs>' +
    '<radialGradient id="pairDotGloss" cx="28%" cy="22%" r="48%"><stop offset="0" stop-color="#fff" stop-opacity="0.45"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>' +
    '<radialGradient id="pairDotShade" cx="50%" cy="35%" r="70%"><stop offset="0.6" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.2"/></radialGradient>' +
    '</defs>' +
    '<circle class="pair-boundary" cx="180" cy="180" r="150"></circle>' +
    '<g class="pair-lines"></g><g class="pair-points"></g></svg>';
  svgEl = shell.board.querySelector('svg');
  linesLayer = svgEl.querySelector('.pair-lines');
  pointsLayer = svgEl.querySelector('.pair-points');
  currentPts.forEach(p => {
    const hit = document.createElementNS(svgNS, 'circle');
    hit.setAttribute('cx', p.x); hit.setAttribute('cy', p.y); hit.setAttribute('r', HIT_R);
    hit.setAttribute('class', 'pair-hit');
    hit.dataset.slot = p.slot;
    pointsLayer.appendChild(hit);
    [['base', p.col], ['shade', 'url(#pairDotShade)'], ['gloss', 'url(#pairDotGloss)']].forEach(([k, fill]) => {
      const c = document.createElementNS(svgNS, 'circle');
      c.setAttribute('cx', p.x); c.setAttribute('cy', p.y); c.setAttribute('r', 14);
      c.setAttribute('fill', fill);
      if (k === 'base'){ c.setAttribute('stroke', 'rgba(0,0,0,0.08)'); c.setAttribute('stroke-width', '1'); }
      c.style.pointerEvents = 'none';
      pointsLayer.appendChild(c);
    });
  });
  svgEl.addEventListener('pointerdown', onDown);
  svgEl.addEventListener('pointermove', onMove);
  svgEl.addEventListener('pointerup', onUp);
  svgEl.addEventListener('pointercancel', onCancel);
}

function startPuzzle(){
  clearTimeout(advanceTimer);
  solved = false; lockedSegments = []; moveHistory = []; dragging = null; dragLine = null;
  const diffLevel = shell.hardMode ? Math.min(MAX_LEVEL, level + HARD_OFFSET) : level;
  currentPts = buildPuzzle(diffLevel);
  renderBoard();
  updateInfo();
}

function showPlaceholder(){
  clearTimeout(advanceTimer);
  level = loadLevel();
  currentPts = []; dragging = null; dragLine = null;
  shell.board.className = 's-board pair-board';
  shell.board.innerHTML = `<div class="pair-placeholder">「スタート」を押すと<br>レベル${level}から始まります</div>`;
  updateInfo();
}

/* ---------- 入力（ドラッグで線を引く） ---------- */
function toSvgPoint(evt){
  const pt = svgEl.createSVGPoint();
  pt.x = evt.clientX; pt.y = evt.clientY;
  return pt.matrixTransform(svgEl.getScreenCTM().inverse());
}
function toSegments(path){
  const segs = []; for (let i = 0; i < path.length - 1; i++) segs.push([path[i], path[i+1]]); return segs;
}
function ccw(a, b, c){ return (c.y-a.y)*(b.x-a.x) > (b.y-a.y)*(c.x-a.x); }
function segIntersect(a, b, c, d){
  return (ccw(a,c,d) !== ccw(b,c,d)) && (ccw(a,b,c) !== ccw(a,b,d));
}

function onDown(e){
  if (!shell.running || solved || dragging) return;
  const slot = e.target.dataset && e.target.dataset.slot;
  if (slot === undefined) return;
  const p = currentPts[+slot];
  if (p.connected) return;
  e.preventDefault();
  dragging = { startSlot: p.slot, path: [{x: p.x, y: p.y}] };
  dragLine = document.createElementNS(svgNS, 'polyline');
  dragLine.setAttribute('class', 'pair-drag');
  dragLine.style.stroke = p.col;
  dragLine.setAttribute('points', `${p.x},${p.y}`);
  linesLayer.appendChild(dragLine);
  try { svgEl.setPointerCapture(e.pointerId); } catch(err){}
}
function onMove(e){
  if (!dragging) return;
  const pt = toSvgPoint(e);
  const last = dragging.path[dragging.path.length - 1];
  const dx = pt.x - last.x, dy = pt.y - last.y;
  if (dx*dx + dy*dy > 25){
    dragging.path.push({x: pt.x, y: pt.y});
    dragLine.setAttribute('points', dragging.path.map(q => `${q.x},${q.y}`).join(' '));
  }
}
function onCancel(){
  if (!dragging) return;
  dragLine.remove(); dragging = null; dragLine = null;
}
function onUp(e){
  if (!dragging) return;
  const rel = toSvgPoint(e);
  let target = null, bestDist = Infinity;
  currentPts.forEach(p => {
    if (p.slot === dragging.startSlot) return;
    const d = (p.x-rel.x)*(p.x-rel.x) + (p.y-rel.y)*(p.y-rel.y);
    if (d < bestDist){ bestDist = d; target = p; }
  });
  const startP = currentPts[dragging.startSlot];
  let success = false;
  if (target && bestDist < RELEASE_R*RELEASE_R && !target.connected && target.col === startP.col){
    dragging.path.push({x: target.x, y: target.y});
    const segs = toSegments(dragging.path);
    const crosses = segs.some(s => lockedSegments.some(ls => segIntersect(s[0], s[1], ls[0], ls[1])));
    if (!crosses){
      success = true;
      lockedSegments.push(...segs);
      startP.connected = true; target.connected = true;
      dragLine.setAttribute('class', 'pair-line');
      dragLine.setAttribute('points', dragging.path.map(q => `${q.x},${q.y}`).join(' '));
      moveHistory.push({slotA: startP.slot, slotB: target.slot, segCount: segs.length, el: dragLine});
      playConnectSound();
      spawnSpark((startP.x + target.x) / 2, (startP.y + target.y) / 2);
    }
  }
  if (!success){ playNg(); dragLine.remove(); }
  dragging = null; dragLine = null;
  checkClear();
}

function checkClear(){
  updateInfo();
  const total = currentPts.length / 2;
  const done = currentPts.filter(p => p.connected).length / 2;
  if (done === total && total > 0 && !solved){
    solved = true;
    playClearFanfare();
    shell.toast('クリア！');
    level = Math.min(level + 1, MAX_LEVEL);
    saveLevel();
    advanceTimer = setTimeout(() => { if (shell.running) startPuzzle(); }, 1600);   // 自動で次のパズルへ
  }
}

/* ---------- 補助ボタン ---------- */
function undoLast(){
  if (!shell.running || solved || !moveHistory.length) return;
  const last = moveHistory.pop();
  lockedSegments.length -= last.segCount;
  currentPts[last.slotA].connected = false;
  currentPts[last.slotB].connected = false;
  last.el.remove();
  updateInfo();
}
function showHint(){
  if (!shell.running || solved) return;
  const p = currentPts.find(q => !q.connected);
  if (!p) return;
  let path = currentSolution && (currentSolution.get(p.slot) || currentSolution.get(p.partner));
  if (!path) path = [p, currentPts[p.partner]];
  const hl = document.createElementNS(svgNS, 'polyline');
  hl.setAttribute('class', 'pair-hint-line');
  hl.setAttribute('points', path.map(q => `${q.x},${q.y}`).join(' '));
  linesLayer.appendChild(hl);
  setTimeout(() => hl.remove(), 1500);
}
document.getElementById('pairUndoBtn').addEventListener('click', undoLast);
document.getElementById('pairHintBtn').addEventListener('click', showHint);

/* レベル1へ戻す（誤タップ防止のため2回タップで確定） */
(function(){
  const btn = document.getElementById('pairResetLevelBtn');
  const label = btn.textContent; let armed = false, timer = null;
  function disarm(){ armed = false; btn.textContent = label; clearTimeout(timer); }
  btn.addEventListener('click', () => {
    if (!armed){ armed = true; btn.textContent = 'もう一度押すとレベル1に戻ります'; timer = setTimeout(disarm, 3000); return; }
    disarm();
    level = 1; saveLevel();
    if (shell.running) startPuzzle(); else showPlaceholder();
  });
})();

/* ---- GameShellのライフサイクルに接続 ---- */
showPlaceholder();
shell.onStart(() => { level = loadLevel(); startPuzzle(); });
shell.onReset(() => { showPlaceholder(); });
shell.onHardModeChange(() => { showPlaceholder(); });
