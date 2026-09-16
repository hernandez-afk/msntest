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
    controlsDefaultSide: 'right',   // 'left' | 'right' — which side holds primary controls
    joystick: {                     // optional: analog stick instead of directional buttons
      label: 'STICK · ↑ THRUST',
      keys: { left: 'ArrowLeft', right: 'ArrowRight', thrust: 'ArrowUp' }, // also: up/down, for a plain vertical axis
      side: 'left',                 // optional: literal 'left'/'right', ignoring handedness
    },
    buttons: [                      // remaining action buttons (shoot/hyper etc.)
      { id: 'shoot',  label: 'SHOOT',  key: ' ',     hold: true,  accessory: true },
      { id: 'hyper',  label: 'HYPER',  key: 'Shift', hold: false, accessory: true },
    ],
    colorProgression: {              // optional overrides for the accent-growth curve
      satRampScore: 2500, huePerLevel: 47, hueDriftScore: 3500,
    },
    titleFont: '--font-namco',      // optional: title/GAME OVER/high-score face — one of
                                     // --font-body / --font-atari / --font-namco, or omit for
                                     // the default real vector stroke glyphs
    bodyFont: "'Poppins', sans-serif", // optional: swap the plain/legible body typeface
    onInit(shell) {},               // called once, wire up your game object
    onStart(shell) {},              // called every time a run begins
    onUpdate(dt, shell) {},         // called each frame while playing — when using a joystick, read
                                     // shell.input.turn/.thrust (-1..1 / 0..1) and/or .moveY (-1..1,
                                     // positive = down) depending which axes the game needs
    onRender(ctx, shell) {},        // called each frame while playing
  }
*/

(function (global) {
  'use strict';

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;

  // ---------------------------------------------------------------
  // Vector title font — the real Atari Asteroids arcade stroke font
  // (Ed Logg, as reverse-engineered by Trammell Hudson:
  // https://trmm.net/Asteroids_font/), used for the title header, GAME
  // OVER, and high-score headings when the "vector" title font is
  // active — the default look. Rendered as an inline SVG path (not a
  // web font) so it matches the hand-drawn line-segment art the rest
  // of a vector-styled game already uses.
  // ---------------------------------------------------------------
  const VECTOR_TITLE_GLYPHS = {
    A: [[[0,6],[0,2],[2,0],[4,2],[4,6]],[[0,4],[4,4]]],
    B: [[[0,6],[0,0],[3,0],[4,1],[4,2],[3,3],[0,3]],[[3,3],[4,4],[4,5],[3,6],[0,6]]],
    C: [[[4,0],[0,0],[0,6],[4,6]]],
    D: [[[0,0],[0,6],[2,6],[4,4],[4,2],[2,0],[0,0]]],
    E: [[[4,0],[0,0],[0,6],[4,6]],[[0,3],[3,3]]],
    F: [[[4,0],[0,0],[0,6]],[[0,3],[3,3]]],
    G: [[[4,1],[4,0],[0,0],[0,6],[4,6],[4,3],[2,3]]],
    H: [[[0,0],[0,6]],[[4,0],[4,6]],[[0,3],[4,3]]],
    I: [[[1,0],[3,0]],[[2,0],[2,6]],[[1,6],[3,6]]],
    J: [[[4,0],[4,5],[3,6],[1,6],[0,5]]],
    K: [[[0,0],[0,6]],[[4,0],[0,3],[4,6]]],
    L: [[[0,0],[0,6],[4,6]]],
    M: [[[0,6],[0,0],[2,2],[4,0],[4,6]]],
    N: [[[0,6],[0,0],[4,6],[4,0]]],
    O: [[[0,0],[4,0],[4,6],[0,6],[0,0]]],
    P: [[[0,6],[0,0],[4,0],[4,3],[0,3]]],
    Q: [[[0,0],[4,0],[4,6],[0,6],[0,0]],[[2,4],[4,6]]],
    R: [[[0,6],[0,0],[4,0],[4,3],[0,3]],[[1,3],[4,6]]],
    S: [[[4,0],[0,0],[0,3],[4,3],[4,6],[0,6]]],
    T: [[[0,0],[4,0]],[[2,0],[2,6]]],
    U: [[[0,0],[0,6],[4,6],[4,0]]],
    V: [[[0,0],[2,6],[4,0]]],
    W: [[[0,0],[1,6],[2,4],[3,6],[4,0]]],
    X: [[[0,0],[4,6]],[[4,0],[0,6]]],
    Y: [[[0,0],[2,2],[4,0]],[[2,2],[2,6]]],
    Z: [[[0,0],[4,0],[0,6],[4,6]]],
    '0': [[[0,0],[4,0],[4,6],[0,6],[0,0]],[[4,0],[0,6]]],
    '1': [[[2,0],[2,6]]],
    '2': [[[0,0],[4,0],[4,3],[0,3],[0,6],[4,6]]],
    '3': [[[0,0],[4,0],[4,6],[0,6]],[[1,3],[4,3]]],
    '4': [[[0,0],[0,3],[4,3]],[[4,0],[4,6]]],
    '5': [[[4,0],[0,0],[0,3],[4,3],[4,6],[0,6]]],
    '6': [[[0,0],[0,6],[4,6],[4,3],[0,3]]],
    '7': [[[0,0],[4,0],[4,6]]],
    '8': [[[0,0],[4,0],[4,6],[0,6],[0,0]],[[0,3],[4,3]]],
    '9': [[[4,6],[4,0],[0,0],[0,3],[4,3]]],
    ' ': [],
  };
  function vectorTitlePath(text, size, tracking) {
    tracking = tracking === undefined ? 1.6 : tracking;
    const s = size / 6, adv = (4 + tracking) * s;
    let d = '', x = 0;
    for (const ch of String(text).toUpperCase()) {
      const g = VECTOR_TITLE_GLYPHS[ch];
      if (g) for (const poly of g) {
        d += poly.map((p, i) => (i ? 'L' : 'M') + (x + p[0] * s).toFixed(2) + ' ' + (p[1] * s).toFixed(2)).join('');
      }
      x += adv;
    }
    return { d, width: x - tracking * s };
  }
  function vectorTitleSvg(text, size) {
    size = size || 46;
    const { d, width } = vectorTitlePath(text, size);
    const pad = 5;
    const w = (width + pad * 2).toFixed(2), h = (size + pad * 2).toFixed(2);
    return `<svg class="vector-glyph-title" viewBox="${-pad} ${-pad} ${w} ${h}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="${String(text).replace(/"/g, '&quot;')}"><path d="${d}" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"></path></svg>`;
  }

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
        collect: { freq: 1200, dur: 0.04, type: 'sine', gain: 0.05 },
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

  // The real Atari logo (Fuji + wordmark + ®), for the boot/load-up screen.
  // Always solid red — matches --atari-red — never re-tinted by the
  // progressive accent (this is a brand mark, not gameplay chrome).
  const BOOT_LOGO_SVG = `<svg class="boot-logo-mark" fill="#E01E2B" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 295.89 331.29"><path d="M9.58,215.73s35.23-4,62.69-26.64c26.16-21.55,35.61-40.14,42.13-61.21s7.52-71.71,7.52-86.76V0H105.67s0,4.15,0,15.22c-.29,22.81-2.26,66.16-12.72,94.36-25.23,68-83.36,74-83.36,74Z"/><path d="M277.73,215.73s-35.22-4-62.68-26.64c-26.17-21.55-35.61-40.14-42.13-61.21s-7.52-71.71-7.52-86.76V0h16.25s0,4.15,0,15.22c.29,22.81,2.25,66.16,12.72,94.36,25.23,68,83.35,74,83.35,74Z"/><rect x="128.65" width="30.02" height="215.73"/><polygon points="119.24 232.68 63.56 232.68 63.56 247.6 84.04 247.6 84.04 331.29 98.67 331.29 98.67 247.6 119.24 247.6 119.24 232.68"/><rect x="261.87" y="232.68" width="15.49" height="98.61"/><path d="M26.48,292.51l10.94-37.68,10.94,37.68ZM48.92,242c-1.45-5.67-5.79-9.48-11.5-9.48A11.69,11.69,0,0,0,26.52,240h0v0c-.24.62-26.5,91.28-26.5,91.28H15.21l7.23-24.85h30l7.18,24.82H74.91Z"/><path d="M135.41,292.51l10.91-37.68,10.89,37.68ZM157.78,242c-1.44-5.67-5.79-9.48-11.46-9.48A11.68,11.68,0,0,0,135.45,240h0v0c-.24.62-26.5,91.28-26.5,91.28h15.2l7.24-24.85h29.89l7.17,24.82h15.32Z"/><path d="M248.57,258.65a47.62,47.62,0,0,1-.6,10.75c-2.05,11.49-9.22,16.1-12.22,17.85s-4.68,3-4.68,3a3.74,3.74,0,0,0-1.46,3,5.58,5.58,0,0,0,.92,3.15s1.05,1.47,4.05,6.08,19.34,28.88,19.34,28.88H236.6l-22.33-33.81a12.48,12.48,0,0,1-2.56-7.8c0-4.91,2.7-8.16,6.92-9.94,0,0,15.37-5,15.37-17a22.74,22.74,0,0,0-.79-6.21,12.26,12.26,0,0,0-11.53-9l-11.77,0a3.36,3.36,0,0,0-3.36,3.36v80.38H191.79v-86.1a12.43,12.43,0,0,1,12.36-12.51h17.19a27.27,27.27,0,0,1,27.26,27.26"/><path d="M288.74,325.34h1.2a1.91,1.91,0,0,0,1.16-.25.83.83,0,0,0,.31-.68.74.74,0,0,0-.15-.48.94.94,0,0,0-.41-.32,3.17,3.17,0,0,0-1-.1h-1.12Zm-1,3.42v-6.08h2.08a5.15,5.15,0,0,1,1.55.17,1.51,1.51,0,0,1,.77.59,1.56,1.56,0,0,1,.28.89,1.63,1.63,0,0,1-.47,1.16,1.84,1.84,0,0,1-1.27.55,1.72,1.72,0,0,1,.52.33,6.55,6.55,0,0,1,.9,1.2l.74,1.19h-1.2l-.53-.95a5,5,0,0,0-1-1.42,1.35,1.35,0,0,0-.79-.21h-.58v2.58Zm2.48-7.83a4.93,4.93,0,0,0-2.33.6,4.53,4.53,0,0,0-1.76,1.74,4.88,4.88,0,0,0-.64,2.37,4.8,4.8,0,0,0,.63,2.34,4.46,4.46,0,0,0,1.75,1.75,4.74,4.74,0,0,0,4.69,0,4.37,4.37,0,0,0,1.74-1.75,4.7,4.7,0,0,0,.63-2.34,4.88,4.88,0,0,0-.64-2.37,4.4,4.4,0,0,0-1.76-1.74,4.91,4.91,0,0,0-2.31-.6m0-.94a5.84,5.84,0,0,1,2.77.72,5.24,5.24,0,0,1,2.11,2.09,5.84,5.84,0,0,1,.76,2.84,5.69,5.69,0,0,1-.75,2.81,5.13,5.13,0,0,1-2.09,2.09,5.65,5.65,0,0,1-2.8.75,5.73,5.73,0,0,1-2.82-.75,5.13,5.13,0,0,1-2.09-2.09,5.66,5.66,0,0,1,0-5.65,5.2,5.2,0,0,1,2.12-2.09,5.82,5.82,0,0,1,2.78-.72"/></svg>`;

  // The real Atari brand mark (wordmark + Fuji), for the persistent header
  // only — always solid white, never re-tinted by the progressive accent,
  // same as a real cabinet's badge stays a fixed brand color.
  const ATARI_LOGO_SVG = `<svg viewBox="0 0 607.29 140.94" xmlns="http://www.w3.org/2000/svg"><polygon class="cls-1" points="355.24 0.23 275.78 0.23 275.78 21.53 305.01 21.53 305.01 140.94 325.89 140.94 325.89 21.53 355.24 21.53 355.24 0.23"></polygon><rect class="cls-1" x="558.74" y="0.23" width="22.11" height="140.7"></rect><path class="cls-1" d="M222.88,85.6l15.6-53.77L254.09,85.6Zm32-72.06C252.83,5.44,246.63,0,238.49,0a16.69,16.69,0,0,0-15.55,10.62h0l0,.08c-.33.88-37.81,130.24-37.81,130.24h21.7l10.32-35.46h42.75l10.25,35.41H292Z"></path><path class="cls-1" d="M378.31,85.6l15.56-53.77L409.42,85.6Zm31.91-72.06C408.16,5.44,402,0,393.87,0a16.7,16.7,0,0,0-15.51,10.62h0l0,.08c-.33.88-37.81,130.24-37.81,130.24h21.7l10.32-35.46H415.2l10.22,35.41h21.87Z"></path><path class="cls-1" d="M539.77,37.29s.59,5.1-.86,15.34C536,69,525.76,75.6,521.48,78.1s-6.68,4.23-6.68,4.23a5.31,5.31,0,0,0-2.08,4.22,8,8,0,0,0,1.31,4.5s1.49,2.1,5.77,8.67,27.6,41.22,27.6,41.22H522.7L490.83,92.7c-3.65-5.34-3.65-9.07-3.65-11.13,0-7,3.85-11.64,9.87-14.19,0,0,21.93-7.13,21.93-24.24a32.22,32.22,0,0,0-1.13-8.86A17.49,17.49,0,0,0,501.4,21.4l-16.79.05a4.8,4.8,0,0,0-4.79,4.8V140.94H458.74V18.08A17.76,17.76,0,0,1,476.39.23h24.52a38.9,38.9,0,0,1,38.9,38.9"></path><path class="cls-1" d="M597.09,132.44h1.7a2.68,2.68,0,0,0,1.66-.36,1.17,1.17,0,0,0,.45-1,1.22,1.22,0,0,0-.21-.69,1.37,1.37,0,0,0-.6-.45,4.36,4.36,0,0,0-1.4-.15h-1.6Zm-1.39,4.89v-8.68h3a7.18,7.18,0,0,1,2.21.25,2,2,0,0,1,1.1.84,2.17,2.17,0,0,1,.4,1.26,2.35,2.35,0,0,1-.67,1.66,2.69,2.69,0,0,1-1.81.79,2.4,2.4,0,0,1,.74.46,10.1,10.1,0,0,1,1.28,1.72l1.06,1.7h-1.71L600.5,136a6.79,6.79,0,0,0-1.46-2,1.89,1.89,0,0,0-1.12-.29h-.83v3.68Zm3.53-11.18a7,7,0,0,0-3.31.86,6.35,6.35,0,0,0-2.52,2.49,7,7,0,0,0-.91,3.38,6.83,6.83,0,0,0,.9,3.34,6.28,6.28,0,0,0,2.49,2.49,6.73,6.73,0,0,0,6.69,0,6.24,6.24,0,0,0,2.5-2.49,6.79,6.79,0,0,0,0-6.72,6.23,6.23,0,0,0-2.52-2.49,7,7,0,0,0-3.3-.86m0-1.34a8.36,8.36,0,0,1,4,1,7.53,7.53,0,0,1,3,3,8.36,8.36,0,0,1,1.08,4,8.2,8.2,0,0,1-1.07,4,7.56,7.56,0,0,1-3,3,8.13,8.13,0,0,1-8,0,7.56,7.56,0,0,1-3-3,8.09,8.09,0,0,1-1.07-4,8.25,8.25,0,0,1,1.08-4,7.46,7.46,0,0,1,3-3,8.3,8.3,0,0,1,4-1"></path><path class="cls-1" d="M0,140.94s23-2.59,40.89-17.38c17.06-14,23.22-26.18,27.47-39.92s4.91-46.77,4.91-56.58V.23H62.67s0,2.71,0,9.93C62.47,25,61.19,53.31,54.37,71.7,37.91,116.07,0,120,0,120Z"></path><path class="cls-1" d="M174.89,140.94s-23-2.59-40.89-17.38c-17.06-14-23.22-26.18-27.47-39.92s-4.91-46.77-4.91-56.58V.23h10.6s0,2.71,0,9.93c.19,14.88,1.47,43.15,8.29,61.54C137,116.07,174.89,120,174.89,120Z"></path><rect class="cls-1" x="77.66" y="0.23" width="19.58" height="140.7"></rect></svg>`;

  // One icon set, one visual language (stroke = currentColor, same 24x24
  // box, optically balanced within it) so the top-left HUD reads as
  // matching buttons, never mismatched emoji.
  const ICONS = {
    unmuted: `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M19 5a10 10 0 0 1 0 14"/></svg>`,
    muted: `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M16 9l6 6"/><path d="M22 9l-6 6"/></svg>`,
    home: `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V20a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V9.5"/></svg>`,
    help: `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="12" r="9"/><path d="M9.2 9.6a2.8 2.8 0 1 1 3.9 2.6c-.8.4-1.1.9-1.1 1.8"/><line x1="12" y1="17" x2="12" y2="17.1"/></svg>`,
    pause: `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><line x1="8" y1="5" x2="8" y2="19"/><line x1="16" y1="5" x2="16" y2="19"/></svg>`,
    close: `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>`,
  };

  const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

  // Cabinet accent progression: every game starts pure white and grows
  // saturated + hue-shifts as score/level climb (see Shell._updateAccentColor).
  function hslToRgb(h, s, l) {
    s /= 100; l /= 100;
    const k = (n) => (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return [Math.round(255 * f(0)), Math.round(255 * f(8)), Math.round(255 * f(4))];
  }

  // ---------------------------------------------------------------
  // Shell — orchestrates state machine + builds the chrome DOM.
  // ---------------------------------------------------------------
  class Shell {
    constructor(config) {
      this.config = config;
      this.gameId = config.gameId;
      this.state = 'boot';
      this.score = 0;
      this.level = 1;
      this.lives = config.livesStart ?? 3;
      // Namespaced by whether this game has a joystick: a handedness value
      // cached from before a game grew a joystick (button-only layout) must
      // not leak into the joystick layout — it can park the stick on the
      // wrong side, making it look unresponsive. Adding a joystick to a
      // game intentionally starts its handedness fresh from
      // controlsDefaultSide; toggling afterward is remembered under this
      // namespaced key same as before.
      this._sideKey = `atari:side:${this.gameId}${config.joystick ? ':joy' : ''}`;
      this.side = localStorage.getItem(this._sideKey) || config.controlsDefaultSide || 'right';
      this.audio = new AudioEngine(this.gameId);
      this.particles = new ParticleSystem();
      this.input = new InputManager();
      this.input.turn = 0;
      this.input.thrust = 0;
      this.input.moveY = 0;
      this.leaderboard = new Leaderboard(this.gameId);
      this._raf = null;
      this._lastT = 0;
      this._gridPhase = 0;
      this._lastAccentKey = '';
      this._accentOverride = null;
      // A hub/gallery page (this project's own, or a tool like the Artifact
      // preview) links here with ?preview=1 so this page can offer a way
      // back — plain history.back() works since that link is same-window,
      // not a new tab.
      this._isPreview = new URLSearchParams(location.search).has('preview');

      // --accent itself is progressive by default (see _updateAccentColor)
      // — every cabinet starts white and grows color as score/level climb
      // — but a game can pin it to a fixed color instead via config.accent,
      // same as accent-2/accent-3's ordinary static per-game overrides.
      if (config.accent) {
        const triplet = hexToRgbTriplet(cssVar(config.accent));
        if (triplet) this.setAccentOverride(triplet);
      }
      if (config.accent2) document.documentElement.style.setProperty('--accent-2', cssVar(config.accent2));
      if (config.accent3) document.documentElement.style.setProperty('--accent-3', cssVar(config.accent3));
      // plain/legible text defaults to Poppins (theme.css); a game may swap
      // its whole body typeface for something more fitting its own system
      if (config.bodyFont) document.documentElement.style.setProperty('--font-body', config.bodyFont);
      // Title header / GAME OVER / high-score face — defaults to the real
      // vector stroke glyphs (see setTitleFont) unless a game opts into
      // one of the plain web fonts instead.
      if (config.titleFont) this.setTitleFont(config.titleFont);

      this._buildDom();
      this._wireHud();
      if (config.joystick) this._joystickEl = this._buildJoystick(config.joystick);
      this._wireButtons();
      this.input.attachKeyboard();

      if (config.onInit) config.onInit(this);

      this._showBoot();
    }

    setLevel(n) { this.level = n; }

    // Live-updates the title wherever it's shown (home screen + pause menu)
    // without rebuilding anything else.
    setTitle(title) {
      this.config.title = title;
      const h = document.getElementById('screen-home-title');
      if (h) this._setTitleText(h, title);
      const p = document.getElementById('pause-title');
      if (p) p.textContent = title;
    }

    // Renders `text` into a .screen-title element either as plain text
    // (Poppins/Atari1972/Namco) or as the hand-drawn vector stroke font
    // (the default "vector" choice) — see setTitleFont(). The original
    // text is kept on the element so switching modes later can redraw it.
    _setTitleText(el, text) {
      el.dataset.titleText = text;
      this._renderTitleEl(el);
    }
    _renderTitleEl(el) {
      const text = el.dataset.titleText;
      if (text === undefined) return;
      if (this._useVectorGlyphTitle()) el.innerHTML = vectorTitleSvg(text);
      else el.textContent = text;
    }
    _useVectorGlyphTitle() {
      return !this._titleFontToken || this._titleFontToken === '--font-vector';
    }
    _refreshTitleGlyphs() {
      document.querySelectorAll('.screen-title[data-title-text]').forEach((el) => this._renderTitleEl(el));
    }

    // Repoints the title header / "GAME OVER" / high-score headings
    // (.screen-title) at a different face — pass one of the --font-*
    // tokens (e.g. '--font-atari') or null to fall back to the default
    // vector font. For tooling that lets someone try different type.
    setTitleFont(fontToken) {
      this._titleFontToken = fontToken;
      document.documentElement.style.setProperty('--font-title', fontToken ? `var(${fontToken})` : '');
      // Namco is a single-case display face — see theme.css for why.
      document.documentElement.style.setProperty('--font-title-transform', fontToken === '--font-namco' ? 'lowercase' : '');
      this._refreshTitleGlyphs();
    }

    // Freezes --accent at a fixed "r, g, b" string instead of letting it
    // grow with score/level — for tooling (e.g. a theme/template preview)
    // that wants to show a color choice as-is. Pass null to hand control
    // back to the normal score/level progression.
    setAccentOverride(rgb) {
      this._accentOverride = rgb;
      this._lastAccentKey = '';
    }

    // Swaps the whole button set live and re-lays-out the control zones —
    // for tooling that lets someone try different button counts/labels.
    setButtons(buttons) {
      this.config.buttons = buttons;
      this._wireButtons();
    }

    // Swaps the joystick live — pass a config (optionally with `side:
    // 'left'|'right'` for a literal fixed zone) or null to remove it and
    // fall back to whatever buttons occupy that zone. For tooling that
    // lets someone try a joystick instead of buttons on a given side.
    setJoystick(cfg) {
      if (this._joystickEl) { this._joystickEl.remove(); this._joystickEl = null; }
      this.input.turn = 0;
      this.input.thrust = 0;
      this.input.moveY = 0;
      this.config.joystick = cfg || null;
      if (cfg) this._joystickEl = this._buildJoystick(cfg);
      this._layoutButtons();
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

      // Persistent top-left HUD: mute always; home while playing; help on
      // the home/game-over screens only. Hidden entirely while paused —
      // the pause menu carries its own mute/home. No title/logo here —
      // those only show up inside the pause menu.
      const topleft = el('div', 'hud-topleft');
      topleft.innerHTML = `
        <button class="icon-btn" id="btn-mute" aria-label="Mute">
          <span class="icon-unmuted">${ICONS.unmuted}</span><span class="icon-muted">${ICONS.muted}</span>
        </button>
        <button class="icon-btn" id="btn-home" aria-label="Home" hidden>${ICONS.home}</button>
        <button class="icon-btn" id="btn-help" aria-label="How to play">${ICONS.help}</button>
      `;
      screen.appendChild(topleft);

      // Pause lives on the opposite corner from mute/home/help. A close
      // button joins it when this page was opened as a preview from a
      // hub/gallery (see the ?preview=1 check in the constructor) — always
      // visible, unlike pause, since there's no "gameplay only" restriction
      // on wanting to leave a preview.
      const topright = el('div', 'hud-topright');
      topright.innerHTML = `
        <button class="icon-btn" id="btn-pause" aria-label="Pause" hidden>${ICONS.pause}</button>
        ${this._isPreview ? `<button class="icon-btn" id="btn-close-preview" aria-label="Close preview">${ICONS.close}</button>` : ''}
      `;
      screen.appendChild(topright);

      // Center HUD (lives + score [+ optional dust/buff readout]) — gameplay only
      const center = el('div', 'hud-center');
      center.id = 'hud-center';
      center.hidden = true;
      center.innerHTML = `
        <div class="hud-lives" id="hud-lives"></div>
        <div class="hud-score"><span class="label">SCORE</span><span id="hud-score">0</span></div>
        <div class="hud-dust" id="hud-dust"></div>
      `;
      screen.appendChild(center);

      // Control zones — buttons/joystick float directly over the play
      // field (translucent), never in a separate control-deck strip.
      const zoneLeft = el('div', 'controls-zone side-left');
      zoneLeft.id = 'zone-left';
      const zoneRight = el('div', 'controls-zone side-right');
      zoneRight.id = 'zone-right';
      screen.appendChild(zoneLeft);
      screen.appendChild(zoneRight);

      // Screens: boot, home, gameover, leaderboard, help, pause
      screen.appendChild(this._buildBootScreen());
      screen.appendChild(this._buildHomeScreen());
      screen.appendChild(this._buildGameOverScreen());
      screen.appendChild(this._buildLeaderboardScreen());
      screen.appendChild(this._buildHelpScreen());
      screen.appendChild(this._buildPauseScreen());

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
        hudDust: center.querySelector('#hud-dust'),
        zoneLeft, zoneRight,
        hudTopleft: topleft,
        btnMute: topleft.querySelector('#btn-mute'),
        btnHome: topleft.querySelector('#btn-home'),
        btnHelp: topleft.querySelector('#btn-help'),
        btnPause: topright.querySelector('#btn-pause'),
        btnClosePreview: topright.querySelector('#btn-close-preview'),
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
      const s = el('div', 'screen', BOOT_LOGO_SVG);
      s.id = 'screen-boot';
      return s;
    }

    _buildHomeScreen() {
      const s = el('div', 'screen', '');
      s.id = 'screen-home';
      s.hidden = true;
      s.innerHTML = `
        <h1 class="screen-title vector-text" id="screen-home-title"></h1>
        <p class="screen-sub pixel-text blink">TAP TO START</p>
        <div class="side-toggle pixel-text">
          <span class="screen-sub" style="align-self:center;">CONTROLS:</span>
          <button class="btn-pixel" id="side-left" aria-pressed="false">LEFT</button>
          <button class="btn-pixel" id="side-right" aria-pressed="false">RIGHT</button>
        </div>
      `;
      this._setTitleText(s.querySelector('#screen-home-title'), this.config.title || this.gameId.toUpperCase());
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
        <h2 class="screen-title vector-text" style="font-size:clamp(16px,4vw,26px)"></h2>
        <p class="screen-sub pixel-text" style="max-width:70%;line-height:1.8">${this.config.instructions || ''}</p>
        <div class="screen-sub pixel-text" style="opacity:.6">LANGUAGE: EN</div>
        <button class="btn-pixel primary" id="help-close">BACK</button>
      `);
      s.id = 'screen-help';
      s.hidden = true;
      this._setTitleText(s.querySelector('.screen-title'), 'HOW TO PLAY');
      return s;
    }

    // The title/logo treatment that used to sit in a persistent header now
    // only shows up here — opened by the pause button, closed by RESUME
    // (or the same pause button again). Carries its own mute/home too, so
    // the whole pause menu is self-contained.
    _buildPauseScreen() {
      const s = el('div', 'screen', `
        <div class="pause-marquee">
          <div class="pause-title" id="pause-title">${this.config.title || this.gameId.toUpperCase()}</div>
          <div class="pause-logo" aria-hidden="true">${ATARI_LOGO_SVG}</div>
        </div>
        <button class="btn-pixel primary" id="pause-resume">RESUME</button>
        <div class="pause-controls">
          <button class="icon-btn" id="pause-mute" aria-label="Mute">
            <span class="icon-unmuted">${ICONS.unmuted}</span><span class="icon-muted">${ICONS.muted}</span>
          </button>
          <button class="icon-btn" id="pause-home" aria-label="Home">${ICONS.home}</button>
        </div>
      `);
      s.id = 'screen-pause';
      s.hidden = true;
      return s;
    }

    // ---- HUD wiring -------------------------------------------------
    _wireHud() {
      const { btnMute, btnHome, btnPause, btnHelp } = this.dom;
      const pauseMute = document.getElementById('pause-mute');
      const syncMute = (muted) => {
        btnMute.dataset.muted = muted ? 'true' : 'false';
        pauseMute.dataset.muted = muted ? 'true' : 'false';
      };
      syncMute(this.audio.muted);
      btnMute.addEventListener('click', () => syncMute(this.audio.toggle()));
      pauseMute.addEventListener('click', () => syncMute(this.audio.toggle()));

      btnHome.addEventListener('click', () => this.goHome());
      document.getElementById('pause-home').addEventListener('click', () => this.goHome());
      btnPause.addEventListener('click', () => this.pause());
      if (this.dom.btnClosePreview) this.dom.btnClosePreview.addEventListener('click', () => history.back());
      document.getElementById('pause-resume').addEventListener('click', () => this.resume());

      btnHelp.addEventListener('click', () => this._openHelp());
      document.getElementById('help-close').addEventListener('click', () => this._closeHelp());

      document.getElementById('side-left').addEventListener('click', (e) => { e.stopPropagation(); this._setSide('left'); });
      document.getElementById('side-right').addEventListener('click', (e) => { e.stopPropagation(); this._setSide('right'); });
      this._reflectSide();
    }

    _setSide(side) {
      this.side = side;
      localStorage.setItem(this._sideKey, side);
      this._reflectSide();
      this._layoutButtons();
    }
    _reflectSide() {
      document.getElementById('side-left').setAttribute('aria-pressed', String(this.side === 'left'));
      document.getElementById('side-right').setAttribute('aria-pressed', String(this.side === 'right'));
    }

    _openHelp() {
      const returnScreen = { home: 'screen-home', gameover: 'screen-gameover' };
      this._returnTo = returnScreen[this.state] || null;
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

    // Which physical zone a button belongs in: an explicit `side` ('left'/
    // 'right') always wins — for tooling that wants a literal fixed side
    // regardless of handedness. Without one, falls back to the normal
    // accessory/primary-vs-handedness rule every game already uses.
    _zoneForButton(b, primaryZone, accessoryZone) {
      if (b.side === 'left') return this.dom.zoneLeft;
      if (b.side === 'right') return this.dom.zoneRight;
      return b.accessory ? accessoryZone : primaryZone;
    }

    // Buttons that share a `pair` id render as one row (left/right) or
    // one column (up/down) so directional controls read as a matched unit.
    _groupForZone(buttons, zoneEl, primaryZone, accessoryZone) {
      const items = [];
      const pairIndex = {};
      const DIR_ORDER = { left: 0, up: 0, right: 1, down: 1 };
      buttons
        .filter((b) => this._zoneForButton(b, primaryZone, accessoryZone) === zoneEl)
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

      if (this._joystickEl) {
        const joyCfg = this.config.joystick || {};
        const joyZone = joyCfg.side === 'left' ? this.dom.zoneLeft
          : joyCfg.side === 'right' ? this.dom.zoneRight
          : primaryZone;
        joyZone.appendChild(this._joystickEl);
      }

      const render = (zoneEl) => {
        this._groupForZone(buttons, zoneEl, primaryZone, accessoryZone).forEach((item) => {
          if (item instanceof HTMLElement) { zoneEl.appendChild(item); return; }
          const isRow = item.entries.some((e) => e.dir === 'left' || e.dir === 'right');
          const wrap = el('div', 'btn-pair ' + (isRow ? 'dir-row' : 'dir-column'));
          item.entries.forEach((e) => wrap.appendChild(e.el));
          zoneEl.appendChild(wrap);
        });
      };
      render(this.dom.zoneLeft);
      render(this.dom.zoneRight);
    }

    // ---- Joystick (optional, replaces directional buttons) -----------
    // Analog turn (x) + analog thrust (up), drag distance clamped to
    // JOY_MAX_PX. Keyboard (if configured) and drag both feed the same
    // shell.input.turn/.thrust — whichever is more extreme each frame wins.
    _buildJoystick(cfg) {
      const wrap = el('div', 'joystick-wrap');
      wrap.innerHTML = `
        <div class="joystick-base" id="joy-base">
          <svg class="joystick-ring" viewBox="0 0 100 100"></svg>
          <div class="joystick-top-label">TOP</div>
          <div class="joystick-knob"></div>
        </div>
        <div class="joystick-label">${cfg.label || 'STICK'}</div>
      `;
      const base = wrap.querySelector('.joystick-base');
      const knob = wrap.querySelector('.joystick-knob');
      this._buildJoystickRing(wrap.querySelector('.joystick-ring'));

      const JOY_MAX_PX = 30;
      let active = false, cx = 0, cy = 0;
      // turn/thrust: Asteroids-style (horizontal -1..1, forward-only 0..1).
      // moveY: a plain signed vertical axis (-1..1, positive = down) for a
      // game that just wants up/down, like a paddle.
      this._joyDrag = { turn: 0, thrust: 0, moveY: 0 };
      const apply = (clientX, clientY) => {
        let dx = clientX - cx, dy = clientY - cy;
        const m = Math.hypot(dx, dy);
        if (m > JOY_MAX_PX) { dx = (dx / m) * JOY_MAX_PX; dy = (dy / m) * JOY_MAX_PX; }
        knob.style.transform = `translate(${dx}px, ${dy}px)`;
        this._joyDrag.turn = clamp(Math.abs(dx) / JOY_MAX_PX, 0, 1) * Math.sign(dx);
        this._joyDrag.thrust = dy < 0 ? clamp(-dy / JOY_MAX_PX, 0, 1) : 0;
        this._joyDrag.moveY = clamp(dy / JOY_MAX_PX, -1, 1);
      };
      const reset = () => {
        active = false;
        knob.style.transform = 'translate(0px, 0px)';
        this._joyDrag.turn = 0;
        this._joyDrag.thrust = 0;
        this._joyDrag.moveY = 0;
      };
      base.addEventListener('pointerdown', (e) => {
        base.setPointerCapture(e.pointerId);
        const r = base.getBoundingClientRect();
        cx = r.left + r.width / 2;
        cy = r.top + r.height / 2;
        active = true;
        apply(e.clientX, e.clientY);
      });
      base.addEventListener('pointermove', (e) => { if (active) apply(e.clientX, e.clientY); });
      base.addEventListener('pointerup', reset);
      base.addEventListener('pointercancel', reset);
      base.addEventListener('pointerleave', (e) => { if (e.buttons === 0) reset(); });

      if (cfg.keys) {
        this.input.bindKey(cfg.keys.left, 'joyLeft');
        this.input.bindKey(cfg.keys.right, 'joyRight');
        this.input.bindKey(cfg.keys.thrust, 'joyThrust');
        this.input.bindKey(cfg.keys.up, 'joyUp');
        this.input.bindKey(cfg.keys.down, 'joyDown');
      }
      return wrap;
    }

    // Dashed dial ring around the stick — 35 dashes on a 35-slot grid, one
    // gap at the top, and the dashes flanking each of the 90°/180°/270°
    // ticks replaced by a taller flared accent shape instead of a plain
    // dash (traced from the same reference cabinet's dial housing). Built
    // once from plain trig; colored live via var(--accent).
    _buildJoystickRing(svg) {
      const cx = 50, cy = 50;
      const SLOT_COUNT = 35, SLOT_DEG = 360 / SLOT_COUNT;
      const dashHalfW = 2.27, dashRIn = 44.51, dashROut = 46.58;
      const dashRectPts = [[-dashHalfW, dashRIn], [dashHalfW, dashRIn], [dashHalfW, dashROut], [-dashHalfW, dashROut]];
      const flareScale = 0.1284; // reference circle radius (358.3) scaled to this ring's radius (46)
      const flarePts = [
        [15.13, 346.69], [-21.16, 346.24], [-22.96, 362.30], [-2.51, 363.34], [12.56, 395.01], [18.95, 394.94],
      ].map(([t, rr]) => [t * flareScale, rr * flareScale]);
      const flarePtsMirrored = flarePts.map(([t, rr]) => [-t, rr]);
      const gapSlots = new Set([SLOT_COUNT - 1, 0, 1]);
      // The slot immediately before each cardinal tick gets the traced
      // flare shape as-is; the slot immediately after gets it mirrored.
      const specialSlots = new Map([
        [8, flarePts], [9, flarePtsMirrored],
        [17, flarePts], [18, flarePtsMirrored],
        [26, flarePts], [27, flarePtsMirrored],
      ]);
      const fmt = (n) => n.toFixed(2);
      let markup = '';
      for (let i = 0; i < SLOT_COUNT; i++) {
        if (gapSlots.has(i)) continue;
        const centerRad = i * SLOT_DEG * (Math.PI / 180);
        const tanX = Math.cos(centerRad), tanY = Math.sin(centerRad);
        const radX = Math.sin(centerRad), radY = -Math.cos(centerRad);
        const localPts = specialSlots.get(i) || dashRectPts;
        const pts = localPts
          .map(([t, rr]) => `${fmt(cx + tanX * t + radX * rr)},${fmt(cy + tanY * t + radY * rr)}`)
          .join(' ');
        markup += `<polygon points="${pts}" fill="var(--accent)"/>`;
      }
      svg.innerHTML = markup;
    }

    // Combines keyboard (digital) and drag (analog) into one live turn/
    // thrust/moveY set each frame — called only while a joystick is configured.
    _updateJoystickInput() {
      const kbTurn = (this.input.isDown('joyRight') ? 1 : 0) - (this.input.isDown('joyLeft') ? 1 : 0);
      const dragTurn = this._joyDrag.turn;
      this.input.turn = Math.abs(kbTurn) >= Math.abs(dragTurn) ? kbTurn : dragTurn;
      const kbThrust = this.input.isDown('joyThrust') ? 1 : 0;
      this.input.thrust = Math.max(kbThrust, this._joyDrag.thrust);
      const kbMoveY = (this.input.isDown('joyDown') ? 1 : 0) - (this.input.isDown('joyUp') ? 1 : 0);
      const dragMoveY = this._joyDrag.moveY;
      this.input.moveY = Math.abs(kbMoveY) >= Math.abs(dragMoveY) ? kbMoveY : dragMoveY;
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

    // Optional per-game readout under the score (e.g. Asteroids' dust
    // meter + active buff). Call with no args to clear it.
    setDust(pct, buffLabel, secondsLeft) {
      if (pct == null) { this.dom.hudDust.innerHTML = ''; return; }
      let html = `DUST ${Math.round(pct)}%`;
      if (buffLabel) {
        html += `<span class="buff">${buffLabel}${secondsLeft != null ? ' ' + Math.ceil(secondsLeft) + 'S' : ''}</span>`;
      }
      this.dom.hudDust.innerHTML = html;
    }

    // ---- State machine ---------------------------------------------
    _hideAllScreens() {
      ['screen-boot', 'screen-home', 'screen-gameover', 'screen-leaderboard', 'screen-pause'].forEach((id) => {
        document.getElementById(id).hidden = true;
      });
    }

    _showBoot() {
      this.state = 'boot';
      this._hideAllScreens();
      const s = document.getElementById('screen-boot');
      s.hidden = false;
      this.dom.btnHome.hidden = true;
      this.dom.btnPause.hidden = true;
      this.dom.btnHelp.hidden = true;
      this._loop(); // start render/parallax loop immediately for ambience
      // Tooling (e.g. the screen template) wants direct, immediate control
      // of which screen shows — skip the timed fade so no delayed goHome()
      // fires later and yanks the user back off whatever they've navigated to.
      if (this.config.skipBoot) { this.goHome(); return; }
      setTimeout(() => {
        s.classList.add('is-fading');
        setTimeout(() => { s.classList.remove('is-fading'); this.goHome(); }, 400);
      }, 1400);
    }

    goHome() {
      this.state = 'home';
      this._hideAllScreens();
      document.getElementById('screen-home').hidden = false;
      this.dom.hudCenter.hidden = true;
      this.dom.zoneLeft.style.visibility = 'hidden';
      this.dom.zoneRight.style.visibility = 'hidden';
      this.dom.btnHome.hidden = true;
      this.dom.btnPause.hidden = true;
      this.dom.btnHelp.hidden = false;
      this.dom.hudTopleft.hidden = false;
      this.particles.clear();
      this.setDust(null);
    }

    startRun() {
      this.audio.play('confirm');
      this.state = 'playing';
      this._hideAllScreens();
      this.dom.hudCenter.hidden = false;
      this.dom.zoneLeft.style.visibility = 'visible';
      this.dom.zoneRight.style.visibility = 'visible';
      this.dom.btnHome.hidden = false;
      this.dom.btnPause.hidden = false;
      this.dom.btnHelp.hidden = true;
      this.setScore(0);
      this.setLevel(1);
      this.setLives(this.config.livesStart ?? 3);
      if (this.config.onStart) this.config.onStart(this);
    }

    pause() {
      if (this.state !== 'playing') return;
      this.state = 'paused';
      this.audio.play('select');
      document.getElementById('screen-pause').hidden = false;
      this.dom.btnPause.hidden = true;
      this.dom.hudTopleft.hidden = true;
    }
    resume() {
      if (this.state !== 'paused') return;
      document.getElementById('screen-pause').hidden = true;
      this.dom.btnPause.hidden = false;
      this.dom.hudTopleft.hidden = false;
      this.state = 'playing';
    }

    gameOver() {
      this.state = 'gameover';
      this.audio.play('explode');
      const s = document.getElementById('screen-gameover');
      s.innerHTML = `
        <h2 class="screen-title vector-text"></h2>
        <p class="screen-sub pixel-text">SCORE <strong style="color:var(--accent)">${this.score}</strong></p>
        <p class="screen-sub pixel-text blink">TAP TO CONTINUE</p>
      `;
      this._setTitleText(s.querySelector('.screen-title'), 'GAME OVER');
      this._hideAllScreens();
      s.hidden = false;
      this.dom.btnHome.hidden = true;
      this.dom.btnPause.hidden = true;
      this.dom.btnHelp.hidden = false;
      const advance = () => { s.removeEventListener('click', advance); this._showLeaderboardFlow(); };
      s.addEventListener('click', advance);
    }

    // Public entry point for jumping straight to the leaderboard/high-score
    // screen (normally only reached via gameOver() -> tap to continue).
    showLeaderboard() { this._showLeaderboardFlow(); }

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
      this.dom.btnHelp.hidden = true;
    }

    _renderInitialsEntry(container) {
      let idx = [0, 0, 0];
      const wrap = el('div', 'screen-flow', '');
      wrap.innerHTML = `
        <h2 class="screen-title vector-text" style="font-size:clamp(16px,4vw,26px)"></h2>
        <p class="screen-sub">SCORE ${this.score} — ENTER INITIALS</p>
        <div class="initials-entry" id="initials-entry"></div>
        <button class="btn-pixel primary" id="initials-confirm">CONFIRM</button>
      `;
      this._setTitleText(wrap.querySelector('.screen-title'), 'NEW HIGH SCORE');
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
      const wrap = el('div', 'screen-flow', '');
      wrap.innerHTML = `
        <h2 class="screen-title vector-text" style="font-size:clamp(16px,4vw,26px)"></h2>
        <ol class="leaderboard-list" id="lb-list"></ol>
        <button class="btn-pixel primary" id="play-again">PLAY AGAIN</button>
      `;
      this._setTitleText(wrap.querySelector('.screen-title'), 'HIGH SCORES');
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

    // ---- Cabinet accent color -----------------------------------------
    // Starts pure white; grows saturated (score) and rotates hue (level),
    // with a slow in-level drift too so it never feels static. Only the
    // chrome (--accent) moves — gameplay sprites a game draws with a
    // literal color, or via --accent-2/--accent-3, stay fixed.
    _updateAccentColor() {
      if (this._accentOverride) {
        if (this._accentOverride === this._lastAccentKey) return;
        this._lastAccentKey = this._accentOverride;
        document.documentElement.style.setProperty('--accent-rgb', this._accentOverride);
        return;
      }
      const prog = Object.assign(
        { satRampScore: 2500, huePerLevel: 47, hueDriftScore: 3500 },
        this.config.colorProgression || {}
      );
      const satT = clamp(this.score / prog.satRampScore, 0, 1);
      const hue = (((this.level - 1) * prog.huePerLevel) +
        ((this.score % prog.hueDriftScore) / prog.hueDriftScore) * prog.huePerLevel) % 360;
      const sat = satT * 88;
      const light = 96 - satT * 38;
      const [r, g, b] = hslToRgb(hue, sat, light);
      const key = `${r}, ${g}, ${b}`;
      if (key === this._lastAccentKey) return;
      this._lastAccentKey = key;
      document.documentElement.style.setProperty('--accent-rgb', key);
    }

    // ---- Main loop ---------------------------------------------------
    _loop(t = 0) {
      const dt = Math.min((t - this._lastT) / 1000, 0.05) || 0;
      this._lastT = t;

      this._gridPhase += dt * 14;
      this.dom.gridBg.style.setProperty('--grid-y', `${(this._gridPhase % 40)}px`);
      this._updateAccentColor();

      const ctx = this.ctx2d;
      ctx.clearRect(0, 0, this.width, this.height);

      if (this.state === 'playing') {
        if (this._joystickEl) this._updateJoystickInput();
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

  // For config.accent, which — like accent-2/accent-3 — takes a CSS var
  // name or a literal hex color, but --accent-rgb (unlike accent-2/3) is
  // always a bare "r, g, b" triplet (see setAccentOverride), not a color
  // value CSS can use directly.
  function hexToRgbTriplet(hex) {
    const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return m ? `${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)}` : null;
  }

  global.AtariShell = {
    init(config) { return new Shell(config); },
  };
})(window);
