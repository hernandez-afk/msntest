/*
  Asteroids — built entirely on the shared Atari shell.
  Classic 5-button cabinet layout: ROTATE LEFT / ROTATE RIGHT (a paired
  directional unit, always adjacent), THRUST, SHOOT and HYPERSPACE.
*/
(function () {
  'use strict';

  const TAU = Math.PI * 2;
  const wrap = (v, max) => ((v % max) + max) % max;
  const cssColor = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#fff';

  const SIZES = { large: { r: 40, score: 20 }, medium: { r: 22, score: 50 }, small: { r: 12, score: 100 } };
  const NEXT_SIZE = { large: 'medium', medium: 'small', small: null };
  const MAX_BULLETS = 5;
  const SHOOT_COOLDOWN = 0.22;
  const SHIP_TURN_RATE = 3.4;     // rad/sec while a rotate button is held
  const SHIP_ACCEL = 220;
  const SHIP_DRAG = 0.992;
  const SHIP_RADIUS = 11;

  function makeAsteroid(x, y, size) {
    const { r } = SIZES[size];
    const points = 8 + Math.floor(Math.random() * 4);
    const verts = [];
    for (let i = 0; i < points; i++) {
      const a = (i / points) * TAU;
      const rad = r * (0.72 + Math.random() * 0.5);
      verts.push({ a, rad });
    }
    const dir = Math.random() * TAU;
    const speed = size === 'large' ? 22 + Math.random() * 18 : size === 'medium' ? 35 + Math.random() * 25 : 55 + Math.random() * 35;
    return {
      x, y, size, r, verts,
      vx: Math.cos(dir) * speed,
      vy: Math.sin(dir) * speed,
      rot: 0,
      rotSpeed: (Math.random() - 0.5) * 1.2,
    };
  }

  function splitAsteroid(a) {
    const next = NEXT_SIZE[a.size];
    if (!next) return [];
    return [makeAsteroid(a.x, a.y, next), makeAsteroid(a.x, a.y, next)];
  }

  const game = {
    shell: null,
    canvasEl: null,
    ship: null,
    bullets: [],
    asteroids: [],
    stars: [],
    shootCd: 0,
    invuln: 0,
    thrustPulse: 0,
    level: 1,

    init(shell) {
      this.shell = shell;
      this.canvasEl = shell.dom.canvas;
      this.stars = Array.from({ length: 70 }, () => ({
        x: Math.random(), y: Math.random(), r: Math.random() * 1.4 + 0.3, drift: 4 + Math.random() * 10,
      }));
    },

    start(shell) {
      this.ship = { x: shell.width / 2, y: shell.height / 2, vx: 0, vy: 0, angle: -Math.PI / 2 };
      this.bullets = [];
      this.asteroids = [];
      this.level = 1;
      this.invuln = 2;
      this.shootCd = 0;
      this.thrustPulse = 0;
      this._spawnWave();
    },

    _spawnWave() {
      const { width, height } = this.shell;
      const count = 3 + this.level;
      for (let i = 0; i < count; i++) {
        let x, y;
        do {
          x = Math.random() * width;
          y = Math.random() * height;
        } while (Math.hypot(x - this.ship.x, y - this.ship.y) < 140);
        this.asteroids.push(makeAsteroid(x, y, 'large'));
      }
    },

    _hyperspace() {
      const shell = this.shell;
      shell.particles.burst(this.ship.x, this.ship.y, { color: cssColor('--accent'), count: 16, speed: 160, size: 3 });
      this.ship.x = Math.random() * shell.width;
      this.ship.y = Math.random() * shell.height;
      this.ship.vx = 0; this.ship.vy = 0;
      this.invuln = Math.max(this.invuln, 1);
      shell.audio.play('hyper');
      shell.particles.burst(this.ship.x, this.ship.y, { color: cssColor('--accent'), count: 16, speed: 160, size: 3 });
      // small classic risk: rare unstable arrival costs a bit of shield time only (kept non-punishing)
    },

    _respawn() {
      this.ship.x = this.shell.width / 2;
      this.ship.y = this.shell.height / 2;
      this.ship.vx = 0; this.ship.vy = 0;
      this.invuln = 2.2;
    },

    update(dt, shell) {
      const ship = this.ship;
      const input = shell.input;

      // steering — rotate-left/rotate-right are a paired directional unit
      if (input.isDown('rotateLeft')) ship.angle -= SHIP_TURN_RATE * dt;
      if (input.isDown('rotateRight')) ship.angle += SHIP_TURN_RATE * dt;

      // thrust
      if (input.isDown('thrust')) {
        ship.vx += Math.cos(ship.angle) * SHIP_ACCEL * dt;
        ship.vy += Math.sin(ship.angle) * SHIP_ACCEL * dt;
        this.thrustPulse -= dt;
        if (this.thrustPulse <= 0) {
          shell.audio.play('thrust');
          shell.particles.burst(
            ship.x - Math.cos(ship.angle) * SHIP_RADIUS,
            ship.y - Math.sin(ship.angle) * SHIP_RADIUS,
            { color: cssColor('--accent-3'), count: 2, speed: 60, size: 2, life: 0.3, angle: ship.angle + Math.PI, spread: 0.6 }
          );
          this.thrustPulse = 0.08;
        }
      }
      ship.vx *= SHIP_DRAG;
      ship.vy *= SHIP_DRAG;
      ship.x = wrap(ship.x + ship.vx * dt, shell.width);
      ship.y = wrap(ship.y + ship.vy * dt, shell.height);

      // shoot
      this.shootCd -= dt;
      if (input.isDown('shoot') && this.shootCd <= 0 && this.bullets.length < MAX_BULLETS) {
        this.bullets.push({
          x: ship.x + Math.cos(ship.angle) * SHIP_RADIUS,
          y: ship.y + Math.sin(ship.angle) * SHIP_RADIUS,
          vx: Math.cos(ship.angle) * 420 + ship.vx,
          vy: Math.sin(ship.angle) * 420 + ship.vy,
          life: 0.9,
        });
        shell.audio.play('shoot');
        this.shootCd = SHOOT_COOLDOWN;
      }

      // hyperspace
      if (input.wasPressed('hyper')) this._hyperspace();

      // bullets
      for (let i = this.bullets.length - 1; i >= 0; i--) {
        const b = this.bullets[i];
        b.life -= dt;
        b.x = wrap(b.x + b.vx * dt, shell.width);
        b.y = wrap(b.y + b.vy * dt, shell.height);
        if (b.life <= 0) this.bullets.splice(i, 1);
      }

      // asteroids
      for (const a of this.asteroids) {
        a.x = wrap(a.x + a.vx * dt, shell.width);
        a.y = wrap(a.y + a.vy * dt, shell.height);
        a.rot += a.rotSpeed * dt;
      }

      // bullet vs asteroid
      outer: for (let i = this.asteroids.length - 1; i >= 0; i--) {
        const a = this.asteroids[i];
        for (let j = this.bullets.length - 1; j >= 0; j--) {
          const b = this.bullets[j];
          if (Math.hypot(a.x - b.x, a.y - b.y) < a.r) {
            shell.audio.play('hit');
            shell.particles.burst(a.x, a.y, { color: cssColor('--accent'), count: 10, speed: 90, size: 2.5 });
            shell.addScore(SIZES[a.size].score);
            this.bullets.splice(j, 1);
            this.asteroids.splice(i, 1);
            this.asteroids.push(...splitAsteroid(a));
            continue outer;
          }
        }
      }

      // ship vs asteroid
      this.invuln -= dt;
      if (this.invuln <= 0) {
        for (const a of this.asteroids) {
          if (Math.hypot(a.x - ship.x, a.y - ship.y) < a.r + SHIP_RADIUS * 0.7) {
            shell.particles.burst(ship.x, ship.y, { color: cssColor('--accent-3'), count: 20, speed: 150, size: 3 });
            shell.loseLife();
            if (shell.lives > 0) this._respawn();
            break;
          }
        }
      }

      // wave clear
      if (this.asteroids.length === 0) {
        this.level += 1;
        shell.audio.play('levelup');
        this._spawnWave();
      }
    },

    render(ctx, shell) {
      const lineWidth = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--line-width')) || 2;
      ctx.save();
      ctx.lineWidth = lineWidth;
      ctx.lineJoin = 'round';

      // parallax stars, in front of the CSS grid layer, behind sprites
      ctx.fillStyle = cssColor('--grey-25');
      for (const s of this.stars) {
        const x = s.x * shell.width;
        const y = wrap(s.y * shell.height + performance.now() / 1000 * s.drift, shell.height);
        ctx.globalAlpha = 0.5;
        ctx.fillRect(x, y, s.r, s.r);
      }
      ctx.globalAlpha = 1;

      // asteroids
      ctx.strokeStyle = cssColor('--accent-2');
      ctx.shadowColor = cssColor('--accent-2');
      ctx.shadowBlur = 6;
      for (const a of this.asteroids) {
        ctx.beginPath();
        a.verts.forEach((v, i) => {
          const ang = v.a + a.rot;
          const px = a.x + Math.cos(ang) * v.rad;
          const py = a.y + Math.sin(ang) * v.rad;
          if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        });
        ctx.closePath();
        ctx.stroke();
      }

      // bullets
      ctx.fillStyle = cssColor('--accent');
      ctx.shadowColor = cssColor('--accent');
      ctx.shadowBlur = 8;
      for (const b of this.bullets) {
        ctx.beginPath();
        ctx.arc(b.x, b.y, 2, 0, TAU);
        ctx.fill();
      }

      // ship
      if (this.ship && !(this.invuln > 0 && Math.floor(performance.now() / 100) % 2 === 0)) {
        const s = this.ship;
        ctx.strokeStyle = cssColor('--accent');
        ctx.shadowColor = cssColor('--accent');
        ctx.shadowBlur = 8;
        ctx.beginPath();
        const nose = { x: s.x + Math.cos(s.angle) * SHIP_RADIUS, y: s.y + Math.sin(s.angle) * SHIP_RADIUS };
        const back1 = { x: s.x + Math.cos(s.angle + 2.5) * SHIP_RADIUS, y: s.y + Math.sin(s.angle + 2.5) * SHIP_RADIUS };
        const back2 = { x: s.x + Math.cos(s.angle - 2.5) * SHIP_RADIUS, y: s.y + Math.sin(s.angle - 2.5) * SHIP_RADIUS };
        const notch = { x: s.x + Math.cos(s.angle + Math.PI) * SHIP_RADIUS * 0.35, y: s.y + Math.sin(s.angle + Math.PI) * SHIP_RADIUS * 0.35 };
        ctx.moveTo(nose.x, nose.y);
        ctx.lineTo(back1.x, back1.y);
        ctx.lineTo(notch.x, notch.y);
        ctx.lineTo(back2.x, back2.y);
        ctx.closePath();
        ctx.stroke();

        if (shell.input.isDown('thrust')) {
          ctx.strokeStyle = cssColor('--accent-3');
          ctx.shadowColor = cssColor('--accent-3');
          ctx.beginPath();
          const flame = { x: s.x - Math.cos(s.angle) * (SHIP_RADIUS + 6 + Math.random() * 4), y: s.y - Math.sin(s.angle) * (SHIP_RADIUS + 6 + Math.random() * 4) };
          ctx.moveTo(back1.x, back1.y);
          ctx.lineTo(flame.x, flame.y);
          ctx.lineTo(back2.x, back2.y);
          ctx.stroke();
        }
      }

      ctx.restore();
    },
  };

  AtariShell.init({
    gameId: 'asteroids',
    title: 'ASTEROIDS',
    instructions: 'ROTATE LEFT/RIGHT TO TURN.<br>THRUST TO ACCELERATE, SHOOT TO FIRE,<br>HYPERSPACE TO TELEPORT OUT OF DANGER.',
    accent: '--white',
    accent2: '--yellow',
    accent3: '--atari-red',
    livesStart: 3,
    controlsDefaultSide: 'right',
    buttons: [
      { id: 'rotateLeft', label: 'LEFT', key: 'ArrowLeft', hold: true, pair: 'rotate', dir: 'left' },
      { id: 'rotateRight', label: 'RIGHT', key: 'ArrowRight', hold: true, pair: 'rotate', dir: 'right' },
      { id: 'thrust', label: 'THRUST', key: 'ArrowUp', hold: true },
      { id: 'shoot', label: 'SHOOT', key: ' ', hold: true },
      { id: 'hyper', label: 'HYPERSPACE', key: 'Shift', hold: false, accessory: true },
    ],
    onInit: (shell) => game.init(shell),
    onStart: (shell) => game.start(shell),
    onUpdate: (dt, shell) => game.update(dt, shell),
    onRender: (ctx, shell) => game.render(ctx, shell),
  });
})();
