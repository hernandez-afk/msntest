/*
  Asteroids — built entirely on the shared Atari shell.
  Analog joystick (turn + thrust) on the player's chosen side, SHOOT and
  HYPERSPACE on the other. Destroyed asteroids scatter collectible dust:
  hold still nearby to magnet it in, fill the meter, and a short random
  buff (spread shot / rapid fire / shield) kicks in.
*/
(function () {
  'use strict';

  const TAU = Math.PI * 2;
  const wrap = (v, max) => ((v % max) + max) % max;
  const cssColor = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#fff';

  const SIZES = { large: { r: 40, score: 20 }, medium: { r: 22, score: 50 }, small: { r: 12, score: 100 } };
  const NEXT_SIZE = { large: 'medium', medium: 'small', small: null };
  const SHOOT_COOLDOWN = 0.22;
  const SHIP_TURN_RATE = 3.6;     // rad/sec at full stick deflection
  const SHIP_ACCEL = 220;
  const SHIP_DRAG = 0.992;
  const SHIP_RADIUS = 11;

  // ---- Dust pickup + buffs -------------------------------------------
  const DUST_THRESHOLD = 100;
  const BUFF_DURATION = 8;          // seconds
  const MAGNET_RADIUS = 140;
  const MAGNET_SPEED_THRESHOLD = 130; // px/sec — stand still-ish to magnet dust in
  const BUFF_TYPES = ['spread', 'rapid', 'shield'];
  const BUFF_NAMES = { spread: 'SPREAD SHOT', rapid: 'RAPID FIRE', shield: 'SHIELD' };
  const SHIELD_RADIUS_MULT = 3.2;
  const DUST_COLOR = '#FCCE01';
  const THRUST_COLOR = '#FF6B00';

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

  function pickRandomBuffType() { return BUFF_TYPES[Math.floor(Math.random() * BUFF_TYPES.length)]; }

  const game = {
    shell: null,
    ship: null,
    bullets: [],
    asteroids: [],
    dust: [],
    stars: [],
    shootCd: 0,
    invuln: 0,
    thrustPulse: 0,
    level: 1,
    dustCollected: 0,
    activeBuff: null,
    nextBuffType: null,

    init(shell) {
      this.shell = shell;
      this.stars = Array.from({ length: 70 }, () => ({
        x: Math.random(), y: Math.random(), r: Math.random() * 1.4 + 0.3, drift: 4 + Math.random() * 10,
      }));
    },

    start(shell) {
      this.ship = { x: shell.width / 2, y: shell.height / 2, vx: 0, vy: 0, angle: -Math.PI / 2 };
      this.bullets = [];
      this.asteroids = [];
      this.dust = [];
      this.level = 1;
      this.invuln = 2;
      this.shootCd = 0;
      this.thrustPulse = 0;
      this.dustCollected = 0;
      this.activeBuff = null;
      this.nextBuffType = pickRandomBuffType();
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
      shell.particles.burst(this.ship.x, this.ship.y, { color: '#fff', count: 16, speed: 160, size: 3 });
      this.ship.x = Math.random() * shell.width;
      this.ship.y = Math.random() * shell.height;
      this.ship.vx = 0; this.ship.vy = 0;
      this.invuln = Math.max(this.invuln, 1);
      shell.audio.play('hyper');
      shell.particles.burst(this.ship.x, this.ship.y, { color: '#fff', count: 16, speed: 160, size: 3 });
    },

    _respawn() {
      this.ship.x = this.shell.width / 2;
      this.ship.y = this.shell.height / 2;
      this.ship.vx = 0; this.ship.vy = 0;
      this.invuln = 2.2;
    },

    _spawnDust(x, y, count) {
      for (let i = 0; i < count; i++) {
        const a = Math.random() * TAU;
        const speed = 60 + Math.random() * 190;
        const life = 6 + Math.random() * 5;
        this.dust.push({ x, y, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, life, age: 0, size: 1 + Math.random() * 2 });
      }
      if (this.dust.length > 400) this.dust.splice(0, this.dust.length - 400);
    },

    _collectDust(shell) {
      this.dustCollected++;
      shell.audio.play('collect');
      if (this.dustCollected >= DUST_THRESHOLD) {
        this.dustCollected = 0;
        this._triggerBuff(shell);
      }
    },

    _triggerBuff(shell) {
      if (!this.nextBuffType) this.nextBuffType = pickRandomBuffType();
      this.activeBuff = { type: this.nextBuffType, timer: BUFF_DURATION };
      shell.audio.play('levelup');
      this.nextBuffType = pickRandomBuffType();
    },

    _updateDust(dt, shell) {
      const ship = this.ship;
      const shipSpeed = ship ? Math.hypot(ship.vx, ship.vy) : 0;
      const magnetActive = !!ship && shipSpeed < MAGNET_SPEED_THRESHOLD;
      const drag = Math.pow(0.55, dt);

      for (let i = this.dust.length - 1; i >= 0; i--) {
        const d = this.dust[i];
        d.age += dt;
        if (d.age >= d.life) { this.dust.splice(i, 1); continue; }
        d.vx *= drag; d.vy *= drag;

        if (ship) {
          const dx = ship.x - d.x, dy = ship.y - d.y;
          const distance = Math.hypot(dx, dy) || 0.01;
          if (magnetActive && distance < MAGNET_RADIUS) {
            const pull = 240 * (1 - distance / MAGNET_RADIUS);
            d.vx += (dx / distance) * pull * dt;
            d.vy += (dy / distance) * pull * dt;
            if (distance < SHIP_RADIUS * 0.9) { this.dust.splice(i, 1); this._collectDust(shell); continue; }
          } else {
            const minDist = SHIP_RADIUS + 2.5;
            if (distance < minDist) {
              const nx = -dx / distance, ny = -dy / distance;
              const overlap = minDist - distance;
              d.x += nx * overlap; d.y += ny * overlap;
              d.vx += nx * 80 + ship.vx * 0.5; d.vy += ny * 80 + ship.vy * 0.5;
            }
          }
        }
        for (const a of this.asteroids) {
          const adx = d.x - a.x, ady = d.y - a.y;
          const minDist = a.r + 2.5;
          const distance2 = Math.hypot(adx, ady) || 0.01;
          if (distance2 < minDist) {
            const nx = adx / distance2, ny = ady / distance2;
            const overlap = minDist - distance2;
            d.x += nx * overlap; d.y += ny * overlap;
            d.vx += nx * 80 + a.vx * 0.5; d.vy += ny * 80 + a.vy * 0.5;
          }
        }
        d.x = wrap(d.x, shell.width);
        d.y = wrap(d.y, shell.height);
      }
    },

    _fire(shell) {
      const ship = this.ship;
      const spreadActive = this.activeBuff && this.activeBuff.type === 'spread';
      const rapidActive = this.activeBuff && this.activeBuff.type === 'rapid';
      const maxBullets = spreadActive ? 12 : rapidActive ? 20 : 5;
      if (this.bullets.length >= maxBullets) return;
      const offsets = spreadActive ? [-0.22, 0, 0.22] : [0];
      for (const offset of offsets) {
        const a = ship.angle + offset;
        this.bullets.push({
          x: ship.x + Math.cos(a) * SHIP_RADIUS,
          y: ship.y + Math.sin(a) * SHIP_RADIUS,
          vx: Math.cos(a) * 420 + ship.vx,
          vy: Math.sin(a) * 420 + ship.vy,
          life: 0.9,
        });
      }
      shell.audio.play('shoot');
      this.shootCd = rapidActive ? SHOOT_COOLDOWN * 0.3 : SHOOT_COOLDOWN;
    },

    update(dt, shell) {
      const ship = this.ship;
      const input = shell.input;

      // steering + thrust — analog from the joystick (drag or keyboard)
      ship.angle += input.turn * SHIP_TURN_RATE * dt;
      const thrustInput = input.thrust;
      const thrusting = thrustInput > 0;
      if (thrusting) {
        ship.vx += Math.cos(ship.angle) * SHIP_ACCEL * thrustInput * dt;
        ship.vy += Math.sin(ship.angle) * SHIP_ACCEL * thrustInput * dt;
        this.thrustPulse -= dt;
        if (this.thrustPulse <= 0) {
          shell.audio.play('thrust');
          shell.particles.burst(
            ship.x - Math.cos(ship.angle) * SHIP_RADIUS,
            ship.y - Math.sin(ship.angle) * SHIP_RADIUS,
            { color: THRUST_COLOR, count: 2, speed: 60, size: 2, life: 0.3, angle: ship.angle + Math.PI, spread: 0.6 }
          );
          this.thrustPulse = 0.08;
        }
      }
      const dragFactor = Math.pow(SHIP_DRAG, dt * 60);
      ship.vx *= dragFactor;
      ship.vy *= dragFactor;
      ship.x = wrap(ship.x + ship.vx * dt, shell.width);
      ship.y = wrap(ship.y + ship.vy * dt, shell.height);

      // shoot
      this.shootCd -= dt;
      if (input.isDown('shoot') && this.shootCd <= 0) this._fire(shell);

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

      this._updateDust(dt, shell);
      if (this.activeBuff) {
        this.activeBuff.timer -= dt;
        if (this.activeBuff.timer <= 0) this.activeBuff = null;
      }

      // bullet vs asteroid
      outer: for (let i = this.asteroids.length - 1; i >= 0; i--) {
        const a = this.asteroids[i];
        for (let j = this.bullets.length - 1; j >= 0; j--) {
          const b = this.bullets[j];
          if (Math.hypot(a.x - b.x, a.y - b.y) < a.r) {
            shell.audio.play('hit');
            shell.addScore(SIZES[a.size].score);
            this._spawnDust(a.x, a.y, 16);
            this.bullets.splice(j, 1);
            this.asteroids.splice(i, 1);
            this.asteroids.push(...splitAsteroid(a));
            continue outer;
          }
        }
      }

      // shield buff: large auto-destroy radius around the ship
      const shieldActive = !!(this.activeBuff && this.activeBuff.type === 'shield');
      if (shieldActive) {
        const shieldRadius = SHIP_RADIUS * SHIELD_RADIUS_MULT;
        for (let j = this.asteroids.length - 1; j >= 0; j--) {
          const a = this.asteroids[j];
          if (Math.hypot(a.x - ship.x, a.y - ship.y) < a.r + shieldRadius) {
            shell.audio.play('hit');
            shell.addScore(SIZES[a.size].score);
            this._spawnDust(a.x, a.y, 16);
            this.asteroids.splice(j, 1);
            this.asteroids.push(...splitAsteroid(a));
          }
        }
      }

      // ship vs asteroid
      this.invuln -= dt;
      if (this.invuln <= 0 && !shieldActive) {
        for (const a of this.asteroids) {
          if (Math.hypot(a.x - ship.x, a.y - ship.y) < a.r + SHIP_RADIUS * 0.7) {
            this._spawnDust(ship.x, ship.y, 40);
            shell.loseLife();
            if (shell.lives > 0) this._respawn();
            break;
          }
        }
      }

      // wave clear
      if (this.asteroids.length === 0) {
        this.level += 1;
        shell.setLevel(this.level);
        shell.audio.play('levelup');
        this._spawnWave();
      }

      // HUD readout
      const pct = (this.dustCollected / DUST_THRESHOLD) * 100;
      const buffLabel = this.activeBuff ? BUFF_NAMES[this.activeBuff.type] : null;
      shell.setDust(pct, buffLabel, this.activeBuff ? this.activeBuff.timer : null);
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

      // asteroids — fixed sprite color, doesn't shift with the cabinet accent
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

      // dust — small glowing squares, physics-driven pickups
      ctx.shadowColor = DUST_COLOR;
      ctx.shadowBlur = 4;
      for (const d of this.dust) {
        const t = 1 - d.age / d.life;
        ctx.globalAlpha = 0.35 + t * 0.65;
        ctx.fillStyle = DUST_COLOR;
        const s = Math.max(1, Math.round(d.size * (0.5 + t * 0.5)));
        ctx.fillRect(Math.round(d.x - s / 2), Math.round(d.y - s / 2), s, s);
      }
      ctx.globalAlpha = 1;

      // bullets — fixed white, same as the ship
      ctx.fillStyle = '#fff';
      ctx.shadowColor = '#fff';
      ctx.shadowBlur = 8;
      for (const b of this.bullets) {
        ctx.beginPath();
        ctx.arc(b.x, b.y, 2, 0, TAU);
        ctx.fill();
      }

      // ship — fixed white regardless of the cabinet's progressive accent
      if (this.ship && !(this.invuln > 0 && Math.floor(performance.now() / 100) % 2 === 0)) {
        const s = this.ship;
        const shieldActive = !!(this.activeBuff && this.activeBuff.type === 'shield');
        if (shieldActive) {
          const pulse = 0.7 + 0.3 * Math.sin(Date.now() / 120);
          ctx.save();
          ctx.strokeStyle = `rgba(63,224,95,${pulse})`;
          ctx.shadowColor = 'rgba(63,224,95,1)';
          ctx.shadowBlur = 10;
          ctx.beginPath();
          ctx.arc(s.x, s.y, SHIP_RADIUS * SHIELD_RADIUS_MULT, 0, TAU);
          ctx.stroke();
          ctx.restore();
        }

        ctx.strokeStyle = '#fff';
        ctx.shadowColor = '#fff';
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

        if (shell.input.thrust > 0) {
          ctx.strokeStyle = THRUST_COLOR;
          ctx.shadowColor = THRUST_COLOR;
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
    instructions: 'USE THE STICK TO TURN AND THRUST.<br>SHOOT TO FIRE, HYPERSPACE TO TELEPORT.<br>COLLECT DUST FROM BROKEN ASTEROIDS —<br>HOLD STILL NEARBY TO PULL IT IN — FOR A BUFF.',
    accent2: '--yellow',
    accent3: '--atari-red',
    livesStart: 3,
    controlsDefaultSide: 'left',
    joystick: {
      label: 'STICK · ↑ THRUST',
      keys: { left: 'ArrowLeft', right: 'ArrowRight', thrust: 'ArrowUp' },
    },
    buttons: [
      { id: 'shoot', label: 'SHOOT', key: ' ', hold: true, accessory: true },
      { id: 'hyper', label: 'HYPERSPACE', key: 'Shift', hold: false, accessory: true },
    ],
    onInit: (shell) => game.init(shell),
    onStart: (shell) => game.start(shell),
    onUpdate: (dt, shell) => game.update(dt, shell),
    onRender: (ctx, shell) => game.render(ctx, shell),
  });
})();
