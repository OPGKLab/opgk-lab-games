/* =========================================================
   Series共通土台: GameShell
   -----------------------------------------------------------
   役割（これだけ）:
     - ブランド/タイトル/スコア/タイマー表示などの枠組みを描画
     - スタート・リセット・サウンドボタンの動作
     - 隠しトリガー（タイトル5回タップ→激むず切替）
     - 効果音エンジン・得点ポップアップ・トースト通知

   役割ではない（各ゲーム側で実装すること）:
     - 盤面のマス目・レイアウト
     - ゲームのルール・当たり判定・勝敗判定
     - 難易度の中身（速度、マス数、地雷数など）

   使い方:
     const shell = new GameShell({ rootSelector, title, hint, hasScore, hasTimer, duration });
     shell.board                     // ゲーム側がここに盤面を描画する
     shell.onStart(() => {...})      // スタート押下時、盤面初期化＆ゲーム開始処理
     shell.onReset(() => {...})      // リセット押下時、盤面を初期状態に戻す処理
     shell.onHardModeChange(hard => {...}) // 激むず切替時（プレイ中は発動しない）
     shell.onTimeUp(() => {...})     // タイマー使用時、時間切れの処理（結果表示など）
     shell.end('メッセージ')          // タイマーなしゲームがルール上ゲーム終了させる時
     shell.addScore(n) / shell.setScore(n) / shell.getScore()
     shell.playTone(freq, duration, type)
     shell.showPopup(targetEl, text, 'good'|'bad'|'bonus')
     shell.toast('メッセージ')
     shell.hardMode                  // 現在激むず中か（bool）読み取り用
   ========================================================= */

class GameShell {
  constructor(config) {
    this.cfg = Object.assign({ hasScore: true, hasTimer: true, duration: 30 }, config);
    this.score = 0;
    this.timeLeft = this.cfg.duration;
    this.running = false;
    this.hardMode = false;
    this.soundOn = true; // デフォルトON、保存はしない
    this.audioCtx = null;
    this._secretTapCount = 0;
    this._secretTapTimer = null;
    this._countdownTimer = null;
    this._hooks = { start: [], reset: [], timeUp: [], hardModeChange: [] };

    this._buildDom();
    this._bindChromeEvents();
  }

  /* ---------- DOM構築（外枠のみ） ---------- */
  _buildDom() {
    const root = document.querySelector(this.cfg.rootSelector);
    root.innerHTML = `
      <div class="s-brand">🌿 OPGK Lab</div>
      <div class="s-header">
        <h1 class="s-title" id="sTitle">${this.cfg.title}</h1>
        <div class="s-status">
          <span class="s-badge" id="sModeBadge">通常</span>
          ${this.cfg.hasScore ? '<span>スコア: <b id="sScore">0</b></span>' : ''}
          ${this.cfg.hasTimer ? `<span>残り: <b id="sTime">${this.cfg.duration}</b>秒</span>` : ''}
        </div>
      </div>
      <div class="s-board" id="sBoard"></div>
      <div class="s-footer">
        <div class="s-controls">
          <button class="s-btn" id="sStartBtn">スタート</button>
          <button class="s-icon-btn s-icon-btn-text" id="sResetBtn">🔄 リセット</button>
          <button class="s-icon-btn" id="sSoundBtn">🔊</button>
        </div>
        <p class="s-hint">${this.cfg.hint || ''}</p>
        <a class="s-back-link" href="../../index.html">← ゲーム一覧に戻る</a>
        <p class="s-copyright">©2026 OPGK Lab</p>
      </div>
    `;
    this.board = root.querySelector('#sBoard'); // ゲーム側がここに描画する
    this.el = {
      score: root.querySelector('#sScore'),
      time: root.querySelector('#sTime'),
      startBtn: root.querySelector('#sStartBtn'),
      resetBtn: root.querySelector('#sResetBtn'),
      soundBtn: root.querySelector('#sSoundBtn'),
      title: root.querySelector('#sTitle'),
      modeBadge: root.querySelector('#sModeBadge'),
    };
  }

  _bindChromeEvents() {
    this.el.startBtn.addEventListener('click', () => {
      this._ensureAudio();
      this._start();
    });
    this.el.resetBtn.addEventListener('click', () => this._reset());
    this.el.soundBtn.addEventListener('click', () => {
      this.soundOn = !this.soundOn;
      this.el.soundBtn.textContent = this.soundOn ? '🔊' : '🔇';
    });
    // 隠しトリガー: タイトルを5回連続タップで激むずモード切替（プレイ中は不可）
    this.el.title.addEventListener('click', () => {
      this._secretTapCount++;
      clearTimeout(this._secretTapTimer);
      this._secretTapTimer = setTimeout(() => (this._secretTapCount = 0), 1200);
      if (this._secretTapCount >= 5) {
        this._secretTapCount = 0;
        this._toggleHardMode();
      }
    });
  }

  _toggleHardMode() {
    if (this.running) return;
    this.hardMode = !this.hardMode;
    this.el.modeBadge.textContent = this.hardMode ? '激むず' : '通常';
    this.el.modeBadge.classList.toggle('s-badge-hard', this.hardMode);
    this.toast(this.hardMode ? '激むずモード解禁！' : '通常モードに戻りました');
    this._hooks.hardModeChange.forEach((fn) => fn(this.hardMode));
  }

  /* ---------- ゲーム側が使うフック登録 ---------- */
  onStart(fn) { this._hooks.start.push(fn); }
  onReset(fn) { this._hooks.reset.push(fn); }
  onTimeUp(fn) { this._hooks.timeUp.push(fn); }
  onHardModeChange(fn) { this._hooks.hardModeChange.push(fn); }

  /* ---------- 進行制御 ---------- */
  _start() {
    if (this.running) return;
    this.running = true;
    this.setScore(0);
    if (this.cfg.hasTimer) {
      this.timeLeft = this.cfg.duration;
      this.el.time.textContent = this.timeLeft;
      this._countdownTimer = setInterval(() => {
        this.timeLeft--;
        this.el.time.textContent = this.timeLeft;
        if (this.timeLeft <= 0) this._timeUp();
      }, 1000);
    }
    this.el.startBtn.disabled = true;
    this.el.startBtn.textContent = 'プレイ中...';
    this.playTone(660, 0.15);
    this._hooks.start.forEach((fn) => fn());
  }

  _timeUp() {
    clearInterval(this._countdownTimer);
    this.running = false;
    this.el.startBtn.disabled = false;
    this.el.startBtn.textContent = 'もう一度あそぶ';
    this.playTone(440, 0.25, 'triangle');
    this._hooks.timeUp.forEach((fn) => fn());
  }

  // タイマーがないゲーム（パズル系など）が、ルール上の終了時に自分で呼ぶ
  end(message) {
    if (this._countdownTimer) clearInterval(this._countdownTimer);
    this.running = false;
    this.el.startBtn.disabled = false;
    this.el.startBtn.textContent = 'もう一度あそぶ';
    this.playTone(440, 0.25, 'triangle');
    if (message) this.toast(message);
  }

  _reset() {
    if (this._countdownTimer) clearInterval(this._countdownTimer);
    this.running = false;
    this.setScore(0);
    if (this.cfg.hasTimer) {
      this.timeLeft = this.cfg.duration;
      this.el.time.textContent = this.timeLeft;
    }
    this.el.startBtn.disabled = false;
    this.el.startBtn.textContent = 'スタート';
    this.toast('リセットしました');
    this._hooks.reset.forEach((fn) => fn());
  }

  /* ---------- スコア ---------- */
  setScore(n) {
    this.score = n;
    if (this.el.score) this.el.score.textContent = n;
  }
  addScore(n) { this.setScore(this.score + n); }
  getScore() { return this.score; }

  /* ---------- サウンド ---------- */
  _ensureAudio() {
    if (!this.audioCtx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) this.audioCtx = new AC();
    }
  }
  playTone(freq, duration = 0.12, type = 'sine') {
    if (!this.soundOn) return;
    this._ensureAudio();
    if (!this.audioCtx) return;
    const ctx = this.audioCtx;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + duration);
  }

  /* ---------- 演出 ---------- */
  toast(msg) {
    const root = document.querySelector(this.cfg.rootSelector);
    const el = document.createElement('div');
    el.className = 's-toast';
    el.textContent = msg;
    root.appendChild(el);
    setTimeout(() => el.remove(), 1600);
  }

  // targetEl: 盤面内の要素。その左上を基準にふわっと浮かぶ得点テキストを表示
  showPopup(targetEl, text, type = 'good') {
    const cls = type === 'bonus' ? 's-popup-bonus' : type === 'bad' ? 's-popup-bad' : 's-popup-good';
    const popup = document.createElement('div');
    popup.className = `s-popup ${cls}`;
    popup.textContent = text;
    popup.style.left = `${targetEl.offsetLeft + targetEl.offsetWidth / 2}px`;
    popup.style.top = `${targetEl.offsetTop}px`;
    this.board.appendChild(popup);
    setTimeout(() => popup.remove(), 700);
  }
}
