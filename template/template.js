/*
  Screen Template — drives the shared shell's blank/default screens
  directly (no real gameplay) so the chrome can be inspected and tuned
  on its own: Home, In-Game, Game Over, High Score.
*/
(function () {
  'use strict';

  const MAX_BUTTONS_PER_SIDE = 4;

  // The 8-color Atari sprite palette (shared/theme.css --sprite-1..8),
  // as {r, g, b} strings ready for shell.setAccentOverride().
  const SCHEMES = [
    { name: 'White', hex: '#FFFFFF', rgb: '255, 255, 255' },
    { name: 'Atari Red', hex: '#E01E2B', rgb: '224, 30, 43' },
    { name: 'Yellow', hex: '#FCCE01', rgb: '252, 206, 1' },
    { name: 'Orange', hex: '#FF6B00', rgb: '255, 107, 0' },
    { name: 'Bright Red', hex: '#FF0000', rgb: '255, 0, 0' },
    { name: 'Pink', hex: '#FF008D', rgb: '255, 0, 141' },
    { name: 'Purple', hex: '#A4009F', rgb: '164, 0, 159' },
    { name: 'Blue', hex: '#0065B9', rgb: '0, 101, 185' },
  ];

  // The larger Atari Color Spectrum (the brand deck's full PMS set) — a
  // secondary, lower-saturation palette to complement the 8 bright
  // primaries above, same {r, g, b} shape for setAccentOverride().
  const SPECTRUM = [
    { name: 'PMS 7631 C', hex: '#4C2625', rgb: '76, 38, 37' },
    { name: 'PMS 4625 C', hex: '#492B20', rgb: '73, 43, 32' },
    { name: 'PMS 504 C', hex: '#572B28', rgb: '87, 43, 40' },
    { name: 'PMS 175 C', hex: '#6C302E', rgb: '108, 48, 46' },
    { name: 'PMS 1685 C', hex: '#8E3C27', rgb: '142, 60, 39' },
    { name: 'PMS 1605 C', hex: '#AD582A', rgb: '173, 88, 42' },
    { name: 'PMS 7584 C', hex: '#BE5229', rgb: '190, 82, 41' },
    { name: 'PMS 7597 C', hex: '#CF472D', rgb: '207, 71, 45' },
    { name: 'PMS 7578 C', hex: '#DB6D41', rgb: '219, 109, 65' },
    { name: 'PMS 7576 C', hex: '#DD9058', rgb: '221, 144, 88' },
    { name: 'PMS 5555 C', hex: '#608154', rgb: '96, 129, 84' },
    { name: 'PMS 7491 C', hex: '#7F9339', rgb: '127, 147, 57' },
    { name: 'PMS 7743 C', hex: '#4D6A31', rgb: '77, 106, 49' },
    { name: 'PMS 5467 C', hex: '#1C3430', rgb: '28, 52, 48' },
    { name: 'PMS 7690 C', hex: '#096AA7', rgb: '9, 106, 167' },
    { name: 'PMS 646 C', hex: '#4B7ABA', rgb: '75, 122, 186' },
    { name: 'PMS 7686 C', hex: '#273C89', rgb: '39, 60, 137' },
    { name: 'PMS 274 C', hex: '#25215A', rgb: '37, 33, 90' },
    { name: 'PMS 682 C', hex: '#9E4A97', rgb: '158, 74, 151' },
    { name: 'PMS 689 C', hex: '#8D3373', rgb: '141, 51, 115' },
    { name: 'PMS 674 C', hex: '#C4458F', rgb: '196, 69, 143' },
    { name: 'PMS 7425 C', hex: '#BD1E56', rgb: '189, 30, 86' },
    { name: 'PMS 191 C', hex: '#EB397A', rgb: '235, 57, 122' },
    { name: 'PMS 485 C', hex: '#DD2128', rgb: '221, 33, 40' },
    { name: 'PMS 7580 C', hex: '#CC5748', rgb: '204, 87, 72' },
    { name: 'PMS 180 C', hex: '#C14340', rgb: '193, 67, 64' },
  ];

  const JOYSTICK_CFG = { label: 'STICK · ↑ THRUST', keys: { left: 'ArrowLeft', right: 'ArrowRight', thrust: 'ArrowUp' } };

  // Literal left/right — not tied to the primary/accessory handedness
  // concept every game uses, so the panel's LEFT/RIGHT controls always
  // land on the side they say, regardless of the home screen's own toggle.
  const sideState = {
    left: { mode: 'buttons', count: 0 },
    right: { mode: 'buttons', count: 0 },
  };

  function buildButtons() {
    // accessory: true keeps these on the shell's plain --accent styling
    // (border/color at rest, filled on press) instead of the accent-2
    // class real games use for a secondary sprite color — accent-2 is a
    // fixed per-game color the picker below never touches, so without
    // this every button would sit at that default (blue) until pressed.
    const buttons = [];
    if (sideState.left.mode === 'buttons') {
      for (let i = 0; i < sideState.left.count; i++) buttons.push({ id: `l${i}`, label: '', side: 'left', accessory: true });
    }
    if (sideState.right.mode === 'buttons') {
      for (let i = 0; i < sideState.right.count; i++) buttons.push({ id: `r${i}`, label: '', side: 'right', accessory: true });
    }
    return buttons;
  }

  const shell = AtariShell.init({
    gameId: 'template',
    title: ' ', // visibly blank — the outline's "home (with blank name)"
    instructions: 'This is a template preview. Real instructions for your game would go here.',
    livesStart: 3,
    controlsDefaultSide: 'left',
    skipBoot: true,
    buttons: buildButtons(),
    onRender(ctx, s) {
      ctx.save();
      ctx.strokeStyle = 'rgba(255,255,255,.12)';
      ctx.setLineDash([6, 6]);
      ctx.lineWidth = 1;
      ctx.strokeRect(20, 20, s.width - 40, s.height - 40);
      ctx.setLineDash([]);
      ctx.font = "10px 'Press Start 2P', monospace";
      ctx.fillStyle = 'rgba(255,255,255,.25)';
      ctx.textAlign = 'center';
      ctx.fillText('GAMEPLAY AREA', s.width / 2, s.height / 2);
      ctx.restore();
    },
  });

  // The shared shell's rotate-device gate is for the games, which lock to
  // a landscape CRT box. This page's sidebar + preview stack fine in
  // portrait too, so it doesn't need that gate blocking the whole page.
  const rotatePrompt = document.querySelector('.rotate-prompt');
  if (rotatePrompt) rotatePrompt.remove();

  // ---- screen tabs -----------------------------------------------------
  const tabs = Array.from(document.querySelectorAll('#screen-tabs .tab-btn'));
  const screenActions = {
    home: () => shell.goHome(),
    playing: () => shell.startRun(),
    gameover: () => { shell.setScore(0); shell.gameOver(); },
    leaderboard: () => { shell.setScore(0); shell.showLeaderboard(); },
  };
  tabs.forEach((btn) => {
    btn.addEventListener('click', () => screenActions[btn.dataset.screen]());
  });
  const STATE_TO_TAB = { home: 'home', playing: 'playing', paused: 'playing', gameover: 'gameover', leaderboard: 'leaderboard' };
  let lastSyncedState = null;
  setInterval(() => {
    if (shell.state === lastSyncedState) return;
    lastSyncedState = shell.state;
    const activeTab = STATE_TO_TAB[shell.state];
    tabs.forEach((btn) => btn.classList.toggle('is-active', btn.dataset.screen === activeTab));
  }, 200);

  // ---- title -------------------------------------------------------
  const titleInput = document.getElementById('title-input');
  titleInput.addEventListener('input', () => {
    shell.setTitle(titleInput.value.trim() || ' ');
  });

  // ---- font — title header / game over / high score --------------------
  const fontButtons = Array.from(document.querySelectorAll('#font-tabs .tab-btn'));
  fontButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      shell.setTitleFont(btn.dataset.font);
      fontButtons.forEach((b) => b.classList.toggle('is-active', b === btn));
    });
  });

  // ---- color scheme — primary (8-sprite) + spectrum (full brand deck) --
  const swatchButtons = [];
  function addSwatch(row, scheme) {
    const btn = document.createElement('button');
    btn.className = 'swatch-btn';
    btn.style.background = scheme.hex;
    btn.title = scheme.name;
    btn.addEventListener('click', () => {
      shell.setAccentOverride(scheme.rgb);
      swatchButtons.forEach((b) => b.classList.toggle('is-active', b === btn));
    });
    row.appendChild(btn);
    swatchButtons.push(btn);
    return btn;
  }

  const primaryRow = document.getElementById('color-swatches');
  const autoBtn = document.createElement('button');
  autoBtn.className = 'swatch-btn is-auto is-active';
  autoBtn.textContent = 'AUTO';
  autoBtn.title = 'Default progressive color (starts white)';
  autoBtn.addEventListener('click', () => {
    shell.setAccentOverride(null);
    swatchButtons.forEach((b) => b.classList.toggle('is-active', b === autoBtn));
  });
  primaryRow.appendChild(autoBtn);
  swatchButtons.push(autoBtn);
  SCHEMES.forEach((scheme) => addSwatch(primaryRow, scheme));

  const spectrumRow = document.getElementById('spectrum-swatches');
  SPECTRUM.forEach((scheme) => addSwatch(spectrumRow, scheme));

  // ---- left/right: buttons vs. joystick, and button count --------------
  function renderDots(side) {
    const wrap = document.getElementById(`${side}-dots`);
    wrap.innerHTML = '';
    for (let i = 0; i < MAX_BUTTONS_PER_SIDE; i++) {
      const dot = document.createElement('span');
      dot.className = i < sideState[side].count ? 'is-filled' : '';
      wrap.appendChild(dot);
    }
  }
  function syncStepperDisabled() {
    document.querySelectorAll('.stepper').forEach((el) => {
      const side = el.dataset.side;
      el.querySelector('[data-dir="down"]').disabled = sideState[side].count <= 0;
      el.querySelector('[data-dir="up"]').disabled = sideState[side].count >= MAX_BUTTONS_PER_SIDE;
    });
  }
  function syncModeUI(side) {
    document.querySelector(`.mode-toggle[data-side="${side}"]`).querySelectorAll('.mode-btn').forEach((b) => {
      b.classList.toggle('is-active', b.dataset.mode === sideState[side].mode);
    });
    document.querySelector(`.side-group[data-side="${side}"] .stepper-row`)
      .classList.toggle('is-disabled', sideState[side].mode !== 'buttons');
  }
  // Applies the current sideState to the live shell: one joystick (on
  // whichever side is in 'joystick' mode, if any) plus buttons on every
  // side left in 'buttons' mode — 3 or fewer buttons stay a single row,
  // 4 wrap into a 2x2 cluster via the shared .multi-row zone class.
  function applyControls() {
    const joySide = sideState.left.mode === 'joystick' ? 'left' : sideState.right.mode === 'joystick' ? 'right' : null;
    shell.setJoystick(joySide ? Object.assign({ side: joySide }, JOYSTICK_CFG) : null);
    shell.setButtons(buildButtons());
    shell.dom.zoneLeft.classList.toggle('multi-row', sideState.left.mode === 'buttons' && sideState.left.count > 2);
    shell.dom.zoneRight.classList.toggle('multi-row', sideState.right.mode === 'buttons' && sideState.right.count > 2);
  }

  document.querySelectorAll('.mode-toggle').forEach((toggle) => {
    const side = toggle.dataset.side;
    toggle.querySelectorAll('.mode-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const mode = btn.dataset.mode;
        if (mode === sideState[side].mode) return;
        if (mode === 'joystick') {
          const other = side === 'left' ? 'right' : 'left';
          if (sideState[other].mode === 'joystick') { sideState[other].mode = 'buttons'; syncModeUI(other); }
        }
        sideState[side].mode = mode;
        syncModeUI(side);
        applyControls();
      });
    });
  });

  document.querySelectorAll('.stepper').forEach((el) => {
    const side = el.dataset.side;
    el.querySelector('[data-dir="down"]').addEventListener('click', () => {
      sideState[side].count = Math.max(0, sideState[side].count - 1);
      document.getElementById(`${side}-count`).textContent = sideState[side].count;
      renderDots(side);
      syncStepperDisabled();
      applyControls();
    });
    el.querySelector('[data-dir="up"]').addEventListener('click', () => {
      sideState[side].count = Math.min(MAX_BUTTONS_PER_SIDE, sideState[side].count + 1);
      document.getElementById(`${side}-count`).textContent = sideState[side].count;
      renderDots(side);
      syncStepperDisabled();
      applyControls();
    });
  });
  renderDots('left');
  renderDots('right');
  syncStepperDisabled();
  tabs.forEach((btn) => btn.classList.toggle('is-active', btn.dataset.screen === 'home'));
})();
