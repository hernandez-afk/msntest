/*
  Atari Shared Design System — game-shell.js
  ===========================================
  One reusable runtime for the boot -> home -> gameplay -> game-over ->
  leaderboard flow, the persistent HUD, pixel-dust VFX and beep/ping SFX.

  A game calls `AtariShell.init(config)` once and gets back a small API
  (`shell`) to drive gameplay. The game never touches DOM/CSS for chrome —
  only `config` (labels, button layout, accent colors, callbacks).

  Config shape:
  {
    gameId: 'asteroids',            // used for localStorage keys
    title: 'ASTEROIDS',
    instructions: 'Rotate with...', // shown on home screen / help panel
    accent: '--yellow',             // CSS var name (or hex) for primary sprite color
    accent2: '--blue',
    livesStart: 3,
    controlsDefaultSide: 'right',   // 'left' | 'right' — which side holds primary buttons
    buttons: [                      // primary + accessory action buttons
      { id: 'thrust', label: 'THRUST', key: 'ArrowUp',   hold: true  },
      { id: 'shoot',  label: 'SHOOT',  key: ' ',         hold: true  },
      { id: 'hyper',  label: 'HYPER',  key: 'Shift',     hold: false, accessory: true },
    ],
    onInit(shell) {},               // called once, wire up your game object
    onStart(shell) {},              // called every time a run begins
    onUpdate(dt, shell) {},         // called each frame while playing
    onRender(ctx, shell) {},        // called each frame while playing
  }
*/

(function (global) {
  'use strict';

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;

  // ---------------------------------------------------------------
  // Audio — minimal WebAudio synth, no music, just pings/pongs.
  // ---------------------------------------------------------------
  class AudioEngine {
    constructor(gameId) {
      this.gameId = gameId;
      this.ctx = null;
      this.muted = localStorage.getItem('atari:muted') === '1';
    }
    _ensure() {
      if (!this.ctx) {
        const AC = global.AudioContext || global.webkitAudioContext;
        this.ctx = new AC();
      }
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return this.ctx;
    }
    setMuted(m) {
      this.muted = m;
      localStorage.setItem('atari:muted', m ? '1' : '0');
    }
    toggle() {
      this.setMuted(!this.muted);
      return this.muted;
    }
    /** blip: {freq, dur, type, slideTo, gain} */
    blip(opts = {}) {
      if (this.muted) return;
      const ctx = this._ensure();
      const { freq = 440, dur = 0.08, type = 'square', slideTo = null, gain = 0.15 } = opts;
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, ctx.currentTime);
      if (slideTo) osc.frequency.linearRampToValueAtTime(slideTo, ctx.currentTime + dur);
      g.gain.setValueAtTime(gain, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
      osc.connect(g).connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + dur + 0.02);
    }
    play(name) {
      const presets = {
        shoot: { freq: 880, dur: 0.06, type: 'square', slideTo: 440 },
        thrust: { freq: 90, dur: 0.05, type: 'sawtooth', gain: 0.06 },
        hyper: { freq: 220, dur: 0.18, type: 'sine', slideTo: 660 },
        explode: { freq: 160, dur: 0.28, type: 'sawtooth', slideTo: 40, gain: 0.2 },
        hit: { freq: 520, dur: 0.06, type: 'triangle', slideTo: 300 },
        bounce: { freq: 300, dur: 0.05, type: 'square', slideTo: 340 },
        select: { freq: 660, dur: 0.05, type: 'square' },
        confirm: { freq: 523, dur: 0.09, type: 'square', slideTo: 1046 },
        life_lost: { freq: 260, dur: 0.35, type: 'sawtooth', slideTo: 60, gain: 0.2 },
        levelup: { freq: 392, dur: 0.14, type: 'square', slideTo: 784 },
      };
      this.blip(presets[name] || presets.select);
    }
  }

  // ---------------------------------------------------------------
  // Pixel dust — physics-driven square particles, not shiny circles.
  // ---------------------------------------------------------------
  class ParticleSystem {
    constructor() {
      this.particles = [];
    }
    burst(x, y, opts = {}) {
      const {
        count = 12,
        color = '#FFFFFF',
        speed = 120,
        size = 3,
        life = 0.6,
        gravity = 0,
        spread = Math.PI * 2,
        angle = 0,
      } = opts;
      for (let i = 0; i < count; i++) {
        const a = angle + (Math.random() - 0.5) * spread;
        const s = speed * (0.4 + Math.random() * 0.6);
        this.particles.push({
          x, y,
          vx: Math.cos(a) * s,
          vy: Math.sin(a) * s,
          size: size * (0.6 + Math.random() * 0.8),
          color,
          life,
          age: 0,
          gravity,
        });
      }
    }
    update(dt) {
      for (let i = this.particles.length - 1; i >= 0; i--) {
        const p = this.particles[i];
        p.age += dt;
        if (p.age >= p.life) { this.particles.splice(i, 1); continue; }
        p.vy += p.gravity * dt;
        p.vx *= 0.98;
        p.vy *= 0.98;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
      }
    }
    render(ctx) {
      for (const p of this.particles) {
        const t = 1 - p.age / p.life;
        ctx.globalAlpha = clamp(t, 0, 1);
        ctx.fillStyle = p.color;
        const s = p.size * t + 0.5;
        ctx.fillRect(p.x - s / 2, p.y - s / 2, s, s);
      }
      ctx.globalAlpha = 1;
    }
    clear() { this.particles.length = 0; }
  }

  // ---------------------------------------------------------------
  // Input — keyboard + on-screen buttons feed the same action state.
  // ---------------------------------------------------------------
  class InputManager {
    constructor() {
      this.down = new Set();
      this.pressedOnce = new Set(); // consumed per-frame taps
      this._keyMap = new Map();
    }
    bindKey(key, actionId) {
      if (key) this._keyMap.set(key.toLowerCase(), actionId);
    }
    attachKeyboard() {
      global.addEventListener('keydown', (e) => {
        const id = this._keyMap.get(e.key.toLowerCase());
        if (id) { this._setDown(id); e.preventDefault(); }
      });
      global.addEventListener('keyup', (e) => {
        const id = this._keyMap.get(e.key.toLowerCase());
        if (id) this._setUp(id);
      });
    }
    attachButton(el, actionId) {
      const start = (e) => { e.preventDefault(); this._setDown(actionId); };
      const end = (e) => { e.preventDefault(); this._setUp(actionId); };
      el.addEventListener('pointerdown', start);
      el.addEventListener('pointerup', end);
      el.addEventListener('pointerleave', end);
      el.addEventListener('pointercancel', end);
    }
    _setDown(id) {
      if (!this.down.has(id)) this.pressedOnce.add(id);
      this.down.add(id);
    }
    _setUp(id) { this.down.delete(id); }
    isDown(id) { return this.down.has(id); }
    /** true once per press, consumes the tap */
    wasPressed(id) {
      if (this.pressedOnce.has(id)) { this.pressedOnce.delete(id); return true; }
      return false;
    }
  }

  // ---------------------------------------------------------------
  // Leaderboard — per-game top scores in localStorage.
  // ---------------------------------------------------------------
  class Leaderboard {
    constructor(gameId, max = 10) {
      this.key = `atari:scores:${gameId}`;
      this.max = max;
    }
    all() {
      try { return JSON.parse(localStorage.getItem(this.key)) || []; }
      catch { return []; }
    }
    qualifies(score) {
      const list = this.all();
      return list.length < this.max || score > list[list.length - 1].score;
    }
    submit(initials, score) {
      const list = this.all();
      list.push({ initials, score, ts: Date.now() });
      list.sort((a, b) => b.score - a.score);
      list.length = Math.min(list.length, this.max);
      localStorage.setItem(this.key, JSON.stringify(list));
      return list.findIndex((r) => r.ts && r.initials === initials && r.score === score);
    }
  }

  // ---------------------------------------------------------------
  // DOM builder helpers
  // ---------------------------------------------------------------
  function el(tag, cls, html) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }

  const FUJI_SVG = `<svg class="boot-fuji" viewBox="0 0 100 60" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M50 2 C20 20, 5 35, 2 58 C15 50, 30 44, 50 44 C70 44, 85 50, 98 58 C95 35, 80 20, 50 2Z" fill="none" stroke="currentColor" stroke-width="3"/>
    <path d="M50 14 C30 26, 18 36, 15 52 C25 47, 37 44, 50 44 C63 44, 75 47, 85 52 C82 36, 70 26, 50 14Z" fill="none" stroke="currentColor" stroke-width="3"/>
  </svg>`;

  // One icon set, one visual language (stroke = currentColor, same viewBox)
  // so the top-left HUD reads as matching buttons, never mismatched emoji.
  const ICONS = {
    unmuted: `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M4 9v6h4l5 4V5L8 9H4z" fill="currentColor" stroke="none"/><path d="M16.2 8.8a5 5 0 0 1 0 6.4"/><path d="M19 6a9 9 0 0 1 0 12"/></svg>`,
    muted: `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M4 9v6h4l5 4V5L8 9H4z" fill="currentColor" stroke="none"/><path d="M15.5 9.5l5 5"/><path d="M20.5 9.5l-5 5"/></svg>`,
    home: `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M3 11.5 12 4l9 7.5"/><path d="M5 10v9a1 1 0 0 0 1 1h3v-5h6v5h3a1 1 0 0 0 1-1v-9"/></svg>`,
    help: `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="12" r="9"/><path d="M9.3 9.6a2.7 2.7 0 1 1 4.2 2.2c-.9.6-1.5 1.1-1.5 2.3"/><circle cx="12" cy="17.2" r="0.75" fill="currentColor" stroke="none"/></svg>`,
  };

  const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

  // ---------------------------------------------------------------
  // Shell — orchestrates state machine + builds the chrome DOM.
  // ---------------------------------------------------------------
  class Shell {
    constructor(config) {
      this.config = config;
      this.gameId = config.gameId;
      this.state = 'boot';
      this.score = 0;
      this.lives = config.livesStart ?? 3;
      this.side = localStorage.getItem(`atari:side:${this.gameId}`) || config.controlsDefaultSide || 'right';
      this.audio = new AudioEngine(this.gameId);
      this.particles = new ParticleSystem();
      this.input = new InputManager();
      this.leaderboard = new Leaderboard(this.gameId);
      this._raf = null;
      this._lastT = 0;
      this._gridPhase = 0;

      if (config.accent) document.documentElement.style.setProperty('--accent', cssVar(config.accent));
      if (config.accent2) document.documentElement.style.setProperty('--accent-2', cssVar(config.accent2));
      if (config.accent3) document.documentElement.style.setProperty('--accent-3', cssVar(config.accent3));
      // plain/legible text defaults to Poppins (theme.css); a game may swap
      // its whole body typeface for something more fitting its own system
      if (config.bodyFont) document.documentElement.style.setProperty('--font-body', config.bodyFont);

      this._buildDom();
      this._wireHud();
      this._wireButtons();
      this.input.attachKeyboard();

      if (config.onInit) config.onInit(this);

      this._showBoot();
    }

    // ---- DOM scaffolding -----------------------------------------
    _buildDom() {
      const root = document.getElementById('app') || document.body;
      const screen = el('div', 'crt-screen');
      screen.appendChild(el('div', 'grid-bg'));
      const canvas = el('canvas', null);
      canvas.id = 'game-canvas';
      screen.appendChild(canvas);
      screen.appendChild(el('div', 'vignette'));
      screen.appendChild(el('div', 'scanlines'));

      // Persistent top-left HUD
      const topleft = el('div', 'hud-topleft');
      topleft.innerHTML = `
        <button class="icon-btn" id="btn-mute" aria-label="Mute">
          <span class="icon-unmuted">${ICONS.unmuted}</span><span class="icon-muted">${ICONS.muted}</span>
        </button>
        <button class="icon-btn" id="btn-home" aria-label="Home" hidden>${ICONS.home}</button>
        <button class="icon-btn" id="btn-help" aria-label="How to play">${ICONS.help}</button>
      `;
      screen.appendChild(topleft);

      // Center HUD (lives + score) — gameplay only
      const center = el('div', 'hud-center');
      center.id = 'hud-center';
      center.hidden = true;
      center.innerHTML = `
        <div class="hud-lives" id="hud-lives"></div>
        <div class="hud-score"><span class="label">SCORE</span><span id="hud-score">0</span></div>
      `;
      screen.appendChild(center);

      // Control zones
      const zoneLeft = el('div', 'controls-zone side-left');
      zoneLeft.id = 'zone-left';
      const zoneRight = el('div', 'controls-zone side-right');
      zoneRight.id = 'zone-right';
      screen.appendChild(zoneLeft);
      screen.appendChild(zoneRight);

      // Screens: boot, home, gameover, leaderboard, help
      screen.appendChild(this._buildBootScreen());
      screen.appendChild(this._buildHomeScreen());
      screen.appendChild(this._buildGameOverScreen());
      screen.appendChild(this._buildLeaderboardScreen());
      screen.appendChild(this._buildHelpScreen());

      const rotatePrompt = el('div', 'rotate-prompt', 'ROTATE YOUR DEVICE<br>TO LANDSCAPE TO PLAY');
      rotatePrompt.classList.add('is-armed');
      document.body.appendChild(rotatePrompt);

      root.appendChild(screen);
      this.dom = {
        screen, canvas,
        gridBg: screen.querySelector('.grid-bg'),
        hudCenter: center,
        hudLives: center.querySelector('#hud-lives'),
        hudScore: center.querySelector('#hud-score'),
        zoneLeft, zoneRight,
        btnMute: topleft.querySelector('#btn-mute'),
        btnHome: topleft.querySelector('#btn-home'),
        btnHelp: topleft.querySelector('#btn-help'),
      };
      this.ctx2d = canvas.getContext('2d');
      this._resizeCanvas();
      global.addEventListener('resize', () => this._resizeCanvas());
    }

    _resizeCanvas() {
      const rect = this.dom.screen.getBoundingClientRect();
      const dpr = global.devicePixelRatio || 1;
      this.dom.canvas.width = rect.width * dpr;
      this.dom.canvas.height = rect.height * dpr;
      this.ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.width = rect.width;
      this.height = rect.height;
    }

    _buildBootScreen() {
      const s = el('div', 'screen', `
        ${FUJI_SVG}
        <div class="boot-logo">ATARI</div>
      `);
      s.id = 'screen-boot';
      s.style.color = 'var(--atari-red)';
      return s;
    }

    _buildHomeScreen() {
      const s = el('div', 'screen', '');
      s.id = 'screen-home';
      s.hidden = true;
      s.innerHTML = `
        <h1 class="screen-title vector-text">${this.config.title || this.gameId.toUpperCase()}</h1>
        <p class="screen-sub pixel-text blink">TAP TO START</p>
        <div class="side-toggle pixel-text">
          <span class="screen-sub" style="align-self:center;">CONTROLS:</span>
          <button class="btn-pixel" id="side-left" aria-pressed="false">LEFT</button>
          <button class="btn-pixel" id="side-right" aria-pressed="false">RIGHT</button>
        </div>
      `;
      s.addEventListener('click', (e) => {
        if (e.target.closest('.side-toggle')) return;
        this.startRun();
      });
      return s;
    }

    _buildGameOverScreen() {
      const s = el('div', 'screen', '');
      s.id = 'screen-gameover';
      s.hidden = true;
      return s;
    }

    _buildLeaderboardScreen() {
      const s = el('div', 'screen', '');
      s.id = 'screen-leaderboard';
      s.hidden = true;
      return s;
    }

    _buildHelpScreen() {
      const s = el('div', 'screen', `
        <h2 class="screen-title vector-text" style="font-size:clamp(16px,4vw,26px)">HOW TO PLAY</h2>
        <p class="screen-sub pixel-text" style="max-width:70%;line-height:1.8">${this.config.instructions || ''}</p>
        <div class="screen-sub pixel-text" style="opacity:.6">LANGUAGE: EN</div>
        <button class="btn-pixel primary" id="help-close">BACK</button>
      `);
      s.id = 'screen-help';
      s.hidden = true;
      return s;
    }

    // ---- HUD wiring -------------------------------------------------
    _wireHud() {
      const { btnMute, btnHome, btnHelp } = this.dom;
      btnMute.dataset.muted = this.audio.muted ? 'true' : 'false';
      btnMute.addEventListener('click', () => {
        const muted = this.audio.toggle();
        btnMute.dataset.muted = muted ? 'true' : 'false';
      });
      btnHome.addEventListener('click', () => this.goHome());
      btnHelp.addEventListener('click', () => this._openHelp());
      document.getElementById('help-close').addEventListener('click', () => this._closeHelp());

      document.getElementById('side-left').addEventListener('click', (e) => { e.stopPropagation(); this._setSide('left'); });
      document.getElementById('side-right').addEventListener('click', (e) => { e.stopPropagation(); this._setSide('right'); });
      this._reflectSide();
    }

    _setSide(side) {
      this.side = side;
      localStorage.setItem(`atari:side:${this.gameId}`, side);
      this._reflectSide();
      this._layoutButtons();
    }
    _reflectSide() {
      document.getElementById('side-left').setAttribute('aria-pressed', String(this.side === 'left'));
      document.getElementById('side-right').setAttribute('aria-pressed', String(this.side === 'right'));
    }

    _openHelp() {
      this._returnTo = this.state === 'home' ? 'screen-home' : null;
      if (this._returnTo) document.getElementById(this._returnTo).hidden = true;
      document.getElementById('screen-help').hidden = false;
    }
    _closeHelp() {
      document.getElementById('screen-help').hidden = true;
      if (this._returnTo) document.getElementById(this._returnTo).hidden = false;
    }

    // ---- Control buttons ---------------------------------------------
    // Longer labels get a smaller, tighter-wrapping font so the word
    // always stays inside the circle instead of running past its edge.
    static _fitLabelSize(label) {
      const len = label.length;
      if (len <= 4) return 'clamp(10px, 1.7vw, 13px)';
      if (len <= 6) return 'clamp(9px, 1.5vw, 11.5px)';
      if (len <= 9) return 'clamp(7.5px, 1.25vw, 10px)';
      return 'clamp(6.5px, 1.05vw, 8.5px)';
    }

    _wireButtons() {
      const buttons = this.config.buttons || [];
      this._buttonEls = {};
      buttons.forEach((b) => {
        const btn = el('button', 'btn-control' + (b.accessory ? '' : ' accent-2'));
        const labelSpan = el('span', 'btn-label', b.label);
        labelSpan.style.fontSize = Shell._fitLabelSize(b.label);
        btn.appendChild(labelSpan);
        btn.dataset.action = b.id;
        this.input.attachButton(btn, b.id);
        this.input.bindKey(b.key, b.id);
        this._buttonEls[b.id] = { el: btn, cfg: b };
      });
      this._layoutButtons();
    }

    // Buttons that share a `pair` id render as one row (left/right) or
    // one column (up/down) so directional controls read as a matched unit.
    _groupForZone(buttons, wantAccessory) {
      const items = [];
      const pairIndex = {};
      const DIR_ORDER = { left: 0, up: 0, right: 1, down: 1 };
      buttons
        .filter((b) => Boolean(b.accessory) === wantAccessory)
        .forEach((b) => {
          const btnEl = this._buttonEls[b.id].el;
          if (b.pair) {
            let group = pairIndex[b.pair];
            if (!group) {
              group = { pair: b.pair, entries: [] };
              pairIndex[b.pair] = group;
              items.push(group);
            }
            group.entries.push({ el: btnEl, dir: b.dir });
          } else {
            items.push(btnEl);
          }
        });
      items.forEach((item) => {
        if (item.entries) item.entries.sort((a, c) => (DIR_ORDER[a.dir] ?? 0) - (DIR_ORDER[c.dir] ?? 0));
      });
      return items;
    }

    _layoutButtons() {
      const buttons = this.config.buttons || [];
      this.dom.zoneLeft.innerHTML = '';
      this.dom.zoneRight.innerHTML = '';
      const primaryZone = this.side === 'left' ? this.dom.zoneLeft : this.dom.zoneRight;
      const accessoryZone = this.side === 'left' ? this.dom.zoneRight : this.dom.zoneLeft;
      primaryZone.classList.remove('accessory');
      accessoryZone.classList.add('accessory');

      const render = (zoneEl, wantAccessory) => {
        this._groupForZone(buttons, wantAccessory).forEach((item) => {
          if (item instanceof HTMLElement) { zoneEl.appendChild(item); return; }
          const isRow = item.entries.some((e) => e.dir === 'left' || e.dir === 'right');
          const wrap = el('div', 'btn-pair ' + (isRow ? 'dir-row' : 'dir-column'));
          item.entries.forEach((e) => wrap.appendChild(e.el));
          zoneEl.appendChild(wrap);
        });
      };
      render(primaryZone, false);
      render(accessoryZone, true);
    }

    // ---- Lives / score -------------------------------------------------
    setLives(n) {
      this.lives = n;
      this.dom.hudLives.innerHTML = Array.from({ length: Math.max(n, 0) })
        .map(() => `<svg class="life-icon" viewBox="0 0 10 10"><path d="M5 0 L6.2 3.6 L10 3.6 L7 5.9 L8.1 9.5 L5 7.3 L1.9 9.5 L3 5.9 L0 3.6 L3.8 3.6 Z" fill="currentColor"/></svg>`)
        .join('');
    }
    addScore(n) { this.setScore(this.score + n); }
    setScore(n) {
      this.score = n;
      this.dom.hudScore.textContent = String(n).padStart(4, '0');
    }
    loseLife() {
      this.setLives(this.lives - 1);
      this.audio.play('life_lost');
      if (this.lives <= 0) this.gameOver();
      return this.lives;
    }

    // ---- State machine ---------------------------------------------
    _hideAllScreens() {
      ['screen-boot', 'screen-home', 'screen-gameover', 'screen-leaderboard'].forEach((id) => {
        document.getElementById(id).hidden = true;
      });
    }

    _showBoot() {
      this.state = 'boot';
      this._hideAllScreens();
      const s = document.getElementById('screen-boot');
      s.hidden = false;
      this.dom.btnHome.hidden = true;
      setTimeout(() => {
        s.classList.add('is-fading');
        setTimeout(() => { s.classList.remove('is-fading'); this.goHome(); }, 400);
      }, 1400);
      this._loop(); // start render/parallax loop immediately for ambience
    }

    goHome() {
      this.state = 'home';
      this._hideAllScreens();
      document.getElementById('screen-home').hidden = false;
      this.dom.hudCenter.hidden = true;
      this.dom.zoneLeft.style.visibility = 'hidden';
      this.dom.zoneRight.style.visibility = 'hidden';
      this.dom.btnHome.hidden = true;
      this.particles.clear();
    }

    startRun() {
      this.audio.play('confirm');
      this.state = 'playing';
      this._hideAllScreens();
      this.dom.hudCenter.hidden = false;
      this.dom.zoneLeft.style.visibility = 'visible';
      this.dom.zoneRight.style.visibility = 'visible';
      this.dom.btnHome.hidden = false;
      this.setScore(0);
      this.setLives(this.config.livesStart ?? 3);
      if (this.config.onStart) this.config.onStart(this);
    }

    pause() {
      if (this.state !== 'playing') return;
      this.state = 'paused';
    }
    resume() {
      if (this.state !== 'paused') return;
      this.state = 'playing';
    }

    gameOver() {
      this.state = 'gameover';
      this.audio.play('explode');
      const s = document.getElementById('screen-gameover');
      s.innerHTML = `
        <h2 class="screen-title vector-text">GAME OVER</h2>
        <p class="screen-sub pixel-text">SCORE <strong style="color:var(--accent)">${this.score}</strong></p>
        <p class="screen-sub pixel-text blink">TAP TO CONTINUE</p>
      `;
      this._hideAllScreens();
      s.hidden = false;
      this.dom.btnHome.hidden = true;
      const advance = () => { s.removeEventListener('click', advance); this._showLeaderboardFlow(); };
      s.addEventListener('click', advance);
    }

    _showLeaderboardFlow() {
      this.state = 'leaderboard';
      this._hideAllScreens();
      const s = document.getElementById('screen-leaderboard');
      s.innerHTML = '';
      if (this.leaderboard.qualifies(this.score) && this.score > 0) {
        this._renderInitialsEntry(s);
      } else {
        this._renderLeaderboardList(s, null);
      }
      s.hidden = false;
    }

    _renderInitialsEntry(container) {
      let idx = [0, 0, 0];
      const wrap = el('div', '', '');
      wrap.innerHTML = `
        <h2 class="screen-title vector-text" style="font-size:clamp(16px,4vw,26px)">NEW HIGH SCORE</h2>
        <p class="screen-sub pixel-text">SCORE ${this.score} — ENTER INITIALS</p>
        <div class="initials-entry" id="initials-entry"></div>
        <button class="btn-pixel primary" id="initials-confirm">CONFIRM</button>
      `;
      container.appendChild(wrap);
      const entry = wrap.querySelector('#initials-entry');
      const slots = [0, 1, 2].map((i) => {
        const slot = el('div', 'initial-slot', `
          <button class="btn-pixel" data-dir="up" data-i="${i}">▲</button>
          <span class="initial-char" id="char-${i}">A</span>
          <button class="btn-pixel" data-dir="down" data-i="${i}">▼</button>
        `);
        entry.appendChild(slot);
        return slot;
      });
      const render = () => idx.forEach((v, i) => { entry.querySelector(`#char-${i}`).textContent = ALPHABET[v]; });
      entry.addEventListener('click', (e) => {
        const btn = e.target.closest('button');
        if (!btn) return;
        const i = Number(btn.dataset.i);
        const dir = btn.dataset.dir;
        idx[i] = (idx[i] + (dir === 'up' ? 1 : -1) + ALPHABET.length) % ALPHABET.length;
        this.audio.play('select');
        render();
      });
      render();
      wrap.querySelector('#initials-confirm').addEventListener('click', () => {
        const initials = idx.map((v) => ALPHABET[v]).join('');
        this.leaderboard.submit(initials, this.score);
        this.audio.play('confirm');
        container.innerHTML = '';
        this._renderLeaderboardList(container, initials);
      });
    }

    _renderLeaderboardList(container, highlightInitials) {
      const list = this.leaderboard.all();
      const wrap = el('div', '', '');
      wrap.innerHTML = `
        <h2 class="screen-title vector-text" style="font-size:clamp(16px,4vw,26px)">HIGH SCORES</h2>
        <ol class="leaderboard-list" id="lb-list"></ol>
        <button class="btn-pixel primary" id="play-again">PLAY AGAIN</button>
      `;
      container.appendChild(wrap);
      const ol = wrap.querySelector('#lb-list');
      if (list.length === 0) {
        ol.innerHTML = `<li class="screen-sub">NO SCORES YET — BE FIRST</li>`;
      } else {
        list.forEach((row, i) => {
          const li = el('li', row.initials === highlightInitials && row.score === this.score ? 'is-you' : '');
          li.innerHTML = `<span class="rank">${i + 1}</span><span>${row.initials}</span><span>${row.score}</span>`;
          ol.appendChild(li);
        });
      }
      wrap.querySelector('#play-again').addEventListener('click', () => this.goHome());
    }

    // ---- Main loop ---------------------------------------------------
    _loop(t = 0) {
      const dt = Math.min((t - this._lastT) / 1000, 0.05) || 0;
      this._lastT = t;

      this._gridPhase += dt * 14;
      this.dom.gridBg.style.setProperty('--grid-y', `${(this._gridPhase % 40)}px`);

      const ctx = this.ctx2d;
      ctx.clearRect(0, 0, this.width, this.height);

      if (this.state === 'playing') {
        if (this.config.onUpdate) this.config.onUpdate(dt, this);
        this.particles.update(dt);
        if (this.config.onRender) this.config.onRender(ctx, this);
        this.particles.render(ctx);
      } else if (this.state === 'paused') {
        if (this.config.onRender) this.config.onRender(ctx, this);
        this.particles.render(ctx);
      }

      this._raf = requestAnimationFrame((tt) => this._loop(tt));
    }
  }

  function cssVar(name) {
    if (typeof name === 'string' && name.startsWith('--')) {
      return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || name;
    }
    return name;
  }

  global.AtariShell = {
    init(config) { return new Shell(config); },
  };
})(window);
