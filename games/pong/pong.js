/*
  Pong — same shared shell as Asteroids, proving the layout transfers.
  Blocky-pixel sprites instead of glowing vectors, perpetual-play rules
  (3 lives, chase the high score, per Andreas' notes) instead of race-to-11,
  and the grid's hue shifting a step with every paddle hit.
*/
(function () {
  'use strict';

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const cssColor = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#fff';

  const PADDLE_W = 10;
  const PADDLE_H = 64;
  const PADDLE_SPEED = 340;
  const BALL_SIZE = 10;
  const BALL_BASE_SPEED = 220;

  const game = {
    shell: null,
    player: null,
    cpu: null,
    ball: null,
    rallies: 0,
    hue: 210,

    init(shell) {
      this.shell = shell;
      // vertical drag on the field also moves the paddle (mobile-friendly)
      shell.dom.canvas.addEventListener('pointermove', (e) => {
        if (!e.buttons || !this.player) return;
        const rect = shell.dom.canvas.getBoundingClientRect();
        this.player.y = clamp(e.clientY - rect.top - PADDLE_H / 2, 0, shell.height - PADDLE_H);
      });
    },

    start(shell) {
      this.player = { x: shell.width - 26, y: shell.height / 2 - PADDLE_H / 2 };
      this.cpu = { x: 16, y: shell.height / 2 - PADDLE_H / 2 };
      this.rallies = 0;
      this.hue = 210;
      document.documentElement.style.setProperty('--bg-tint', this.hue);
      this._serve(shell, 1);
    },

    _serve(shell, dir) {
      this.ball = {
        x: shell.width / 2, y: shell.height / 2,
        vx: BALL_BASE_SPEED * dir, vy: (Math.random() - 0.5) * 160,
      };
    },

    update(dt, shell) {
      const input = shell.input;
      const player = this.player, cpu = this.cpu, ball = this.ball;

      player.y += input.moveY * PADDLE_SPEED * dt;
      player.y = clamp(player.y, 0, shell.height - PADDLE_H);

      // simple CPU tracking with imperfect speed
      const cpuTarget = ball.y - PADDLE_H / 2;
      cpu.y += clamp(cpuTarget - cpu.y, -PADDLE_SPEED * 0.72 * dt, PADDLE_SPEED * 0.72 * dt);
      cpu.y = clamp(cpu.y, 0, shell.height - PADDLE_H);

      ball.x += ball.vx * dt;
      ball.y += ball.vy * dt;

      if (ball.y <= 0 || ball.y >= shell.height - BALL_SIZE) {
        ball.vy *= -1;
        ball.y = clamp(ball.y, 0, shell.height - BALL_SIZE);
        shell.audio.play('bounce');
      }

      // player paddle collision
      if (ball.vx > 0 && ball.x + BALL_SIZE >= player.x && ball.x <= player.x + PADDLE_W &&
          ball.y + BALL_SIZE >= player.y && ball.y <= player.y + PADDLE_H) {
        const hit = (ball.y + BALL_SIZE / 2 - (player.y + PADDLE_H / 2)) / (PADDLE_H / 2);
        const smash = input.isDown('smash');
        const speed = Math.hypot(ball.vx, ball.vy) * (smash ? 1.18 : 1.05);
        ball.vx = -Math.abs(Math.cos(hit * 1.1) * speed);
        ball.vy = Math.sin(hit * 1.1) * speed + (smash ? hit * 60 : 0);
        ball.x = player.x - BALL_SIZE;
        this.rallies += 1;
        shell.addScore(smash ? 15 : 10);
        shell.audio.play(smash ? 'confirm' : 'hit');
        shell.particles.burst(ball.x, ball.y, { color: cssColor('--accent-2'), count: smash ? 14 : 7, speed: 90, size: 3 });
        this._shiftColor(smash ? 26 : 18);
      }

      // cpu paddle collision
      if (ball.vx < 0 && ball.x <= cpu.x + PADDLE_W && ball.x + BALL_SIZE >= cpu.x &&
          ball.y + BALL_SIZE >= cpu.y && ball.y <= cpu.y + PADDLE_H) {
        const hit = (ball.y + BALL_SIZE / 2 - (cpu.y + PADDLE_H / 2)) / (PADDLE_H / 2);
        const speed = Math.hypot(ball.vx, ball.vy) * 1.03;
        ball.vx = Math.abs(Math.cos(hit * 1.1) * speed);
        ball.vy = Math.sin(hit * 1.1) * speed;
        ball.x = cpu.x + PADDLE_W;
        shell.audio.play('bounce');
        this._shiftColor(8);
      }

      // scoring
      if (ball.x < -30) {
        this._serve(shell, 1);
      } else if (ball.x > shell.width + 30) {
        shell.particles.burst(player.x, player.y + PADDLE_H / 2, { color: cssColor('--accent-3'), count: 16, speed: 120, size: 3 });
        shell.loseLife();
        if (shell.lives > 0) this._serve(shell, -1);
      }
    },

    // Every paddle contact nudges the grid's hue — a bigger jump for the
    // player's own hits (more for a smash) than for the CPU's bounces, so
    // the field visibly cycles color as a rally goes on rather than
    // drifting only in proportion to score.
    _shiftColor(step) {
      this.hue = (this.hue + step) % 360;
      document.documentElement.style.setProperty('--bg-tint', this.hue.toFixed(0));
    },

    render(ctx, shell) {
      ctx.save();
      // center net — blocky dashes, no glow
      ctx.fillStyle = cssColor('--grey-70');
      for (let y = 6; y < shell.height; y += 22) {
        ctx.fillRect(shell.width / 2 - 2, y, 4, 12);
      }

      ctx.fillStyle = cssColor('--accent-3');
      ctx.fillRect(this.cpu.x, this.cpu.y, PADDLE_W, PADDLE_H);

      // fixed white, like Asteroids' ship — gameplay sprites stay put while
      // only the cabinet chrome grows its color with the run
      ctx.fillStyle = '#fff';
      ctx.fillRect(this.player.x, this.player.y, PADDLE_W, PADDLE_H);

      ctx.fillStyle = cssColor('--accent-2');
      ctx.fillRect(this.ball.x, this.ball.y, BALL_SIZE, BALL_SIZE);
      ctx.restore();
    },
  };

  AtariShell.init({
    gameId: 'pong',
    title: 'PONG',
    instructions: 'STICK MOVES YOUR PADDLE UP/DOWN.<br>HOLD SMASH ON CONTACT FOR A FASTER,<br>SHARPER-ANGLED RETURN. 3 MISSES AND IT\'S OVER —<br>CHASE THE HIGH SCORE.',
    accent: '--orange',
    accent2: '--orange',
    accent3: '--atari-red',
    titleFont: '--font-namco',
    livesStart: 3,
    controlsDefaultSide: 'right',
    joystick: {
      label: 'STICK',
      keys: { up: 'ArrowUp', down: 'ArrowDown' },
    },
    buttons: [
      { id: 'smash', label: 'SMASH', key: 'Shift', hold: true, accessory: true },
    ],
    onInit: (shell) => game.init(shell),
    onStart: (shell) => game.start(shell),
    onUpdate: (dt, shell) => game.update(dt, shell),
    onRender: (ctx, shell) => game.render(ctx, shell),
  });
})();
