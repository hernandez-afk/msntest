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

  function buildButtons(leftCount, rightCount) {
    const buttons = [];
    for (let i = 0; i < leftCount; i++) buttons.push({ id: `l${i}`, label: '' });
    for (let i = 0; i < rightCount; i++) buttons.push({ id: `r${i}`, label: '', accessory: true });
    return buttons;
  }

  const counts = { left: 0, right: 0 };

  const shell = AtariShell.init({
    gameId: 'template',
    title: ' ', // visibly blank — the outline's "home (with blank name)"
    instructions: 'This is a template preview. Real instructions for your game would go here.',
    livesStart: 3,
    controlsDefaultSide: 'left',
    skipBoot: true,
    buttons: buildButtons(counts.left, counts.right),
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

  // ---- screen tabs -----------------------------------------------------
  const tabs = Array.from(document.querySelectorAll('.tab-btn'));
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

  // ---- color scheme --------------------------------------------------
  const swatchRow = document.getElementById('color-swatches');
  const autoBtn = document.createElement('button');
  autoBtn.className = 'swatch-btn is-auto is-active';
  autoBtn.textContent = 'AUTO';
  autoBtn.title = 'Default progressive color (starts white)';
  swatchRow.appendChild(autoBtn);
  const swatchButtons = [autoBtn];
  SCHEMES.forEach((scheme) => {
    const btn = document.createElement('button');
    btn.className = 'swatch-btn';
    btn.style.background = scheme.hex;
    btn.title = scheme.name;
    btn.addEventListener('click', () => {
      shell.setAccentOverride(scheme.rgb);
      swatchButtons.forEach((b) => b.classList.toggle('is-active', b === btn));
    });
    swatchRow.appendChild(btn);
    swatchButtons.push(btn);
  });
  autoBtn.addEventListener('click', () => {
    shell.setAccentOverride(null);
    swatchButtons.forEach((b) => b.classList.toggle('is-active', b === autoBtn));
  });

  // ---- button counts ---------------------------------------------------
  function renderDots(side) {
    const wrap = document.getElementById(`${side}-dots`);
    wrap.innerHTML = '';
    for (let i = 0; i < MAX_BUTTONS_PER_SIDE; i++) {
      const dot = document.createElement('span');
      dot.className = i < counts[side] ? 'is-filled' : '';
      wrap.appendChild(dot);
    }
  }
  function applyButtons() {
    shell.setButtons(buildButtons(counts.left, counts.right));
  }
  function syncStepperDisabled() {
    document.querySelectorAll('.stepper').forEach((el) => {
      const side = el.dataset.side;
      el.querySelector('[data-dir="down"]').disabled = counts[side] <= 0;
      el.querySelector('[data-dir="up"]').disabled = counts[side] >= MAX_BUTTONS_PER_SIDE;
    });
  }
  document.querySelectorAll('.stepper').forEach((el) => {
    const side = el.dataset.side;
    el.querySelector('[data-dir="down"]').addEventListener('click', () => {
      counts[side] = Math.max(0, counts[side] - 1);
      document.getElementById(`${side}-count`).textContent = counts[side];
      renderDots(side);
      syncStepperDisabled();
      applyButtons();
    });
    el.querySelector('[data-dir="up"]').addEventListener('click', () => {
      counts[side] = Math.min(MAX_BUTTONS_PER_SIDE, counts[side] + 1);
      document.getElementById(`${side}-count`).textContent = counts[side];
      renderDots(side);
      syncStepperDisabled();
      applyButtons();
    });
  });
  renderDots('left');
  renderDots('right');
  syncStepperDisabled();
  tabs.forEach((btn) => btn.classList.toggle('is-active', btn.dataset.screen === 'home'));
})();
