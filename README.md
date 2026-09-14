# Atari Arcade — Shared Game Design System

A transferable HTML game layout for Atari-branded titles. Every game shares
the same structural chrome, flow, and vintage-CRT visual language; only the
playfield and control labels change per game.

Open `index.html` for the hub, or a game directly:

- `games/asteroids/` — glowing vector-line style (Asteroids/Tempest lineage)
- `games/pong/` — blocky-pixel style (Pong/Breakout lineage), perpetual-play
  rules (3 lives, chase the high score, per design notes)

No build step. Everything is static HTML/CSS/vanilla JS — open any
`games/<name>/index.html` directly or serve the repo root with any static
file server.

## Architecture

```
shared/
  theme.css       Atari brand tokens: colors, fonts, the 8 sprite colors
  shell.css       Structural layout: CRT viewport, HUD, screens, buttons
  game-shell.js   Runtime: state machine, HUD wiring, audio, particles,
                  input, leaderboard — the "engine" every game drives
games/
  <game>/
    index.html    Loads shared CSS/JS, then the game's own script
    <game>.js      AtariShell.init({ ...config, onUpdate, onRender })
```

A game **never** builds its own boot screen, HUD, buttons, or leaderboard —
it calls `AtariShell.init(config)` once and gets a `shell` object back to
drive gameplay (`shell.addScore()`, `shell.loseLife()`, `shell.particles`,
`shell.audio`, `shell.input`). This is what keeps every game feeling like a
sibling: the chrome is identical pixel-for-pixel; only the config and the
canvas drawing differ.

### Adding a new game

1. `mkdir games/<name>` and copy an existing `index.html` (update the title
   and script tag).
2. Write `<name>.js` that calls `AtariShell.init({...})`:

```js
AtariShell.init({
  gameId: 'breakout',              // localStorage namespace (scores, mute, side)
  title: 'BREAKOUT',
  instructions: 'Short how-to-play copy for the help panel.',
  accent: '--sprite-3',            // any theme.css var name or hex
  accent2: '--sprite-8',
  accent3: '--atari-red',
  livesStart: 3,
  controlsDefaultSide: 'right',    // which side the primary buttons default to
  buttons: [
    { id: 'left',  label: 'LEFT',  key: 'ArrowLeft',  hold: true },
    { id: 'right', label: 'RIGHT', key: 'ArrowRight', hold: true },
    { id: 'launch', label: 'LAUNCH', key: ' ', accessory: true },
  ],
  onInit(shell)   { /* set up your game object once */ },
  onStart(shell)  { /* reset state for a new run */ },
  onUpdate(dt, shell) { /* physics/logic, dt in seconds */ },
  onRender(ctx, shell) { /* draw to shell's canvas 2D context */ },
});
```

That's the entire integration surface. Button `label` and `id` are freely
renameable per game (as required by the spec); `accessory: true` puts a
button on the opposite side from the player's chosen handedness, mirroring
a cabinet's split control layout.

## The constant layout (never changes per game)

- **Top-left, always:** mute/unmute, then either **Home** (during gameplay)
  or **Help/language** (on the home screen).
- **Center, gameplay only:** lives (left of center) and score (right of
  center).
- **Bottom, split by handedness:** the player's chosen side (left/right,
  set on the home screen, persisted per game) holds the game's primary
  buttons; the opposite side holds accessory buttons.
- **Load flow:** Atari logo (fade) → Home (title, press-to-start, handedness
  toggle, help/language) → Gameplay HUD → Game Over → Leaderboard (initials
  entry if it's a high score, otherwise the board with your run highlighted)
  → Play Again returns to Home.
- **Viewport:** locked to landscape dimensions on both mobile and desktop
  (`min(100vw, 177.78vh)` × `min(100vh, 56.25vw)`); a rotate-device prompt
  covers portrait mobile.

## Visual language

- **Atari brand palette** (`shared/theme.css`) defines the full brand system
  from the style guide (reds, primaries, greys, spectrum), but sprites are
  restricted to **8 recognizable colors** (white, Atari red, yellow, orange,
  bright red, pink, purple, blue) — bright-on-dark, never a 9th color, per
  Andreas' direction. Backgrounds/UI stay on the low-saturation grey ramp so
  the bright sprites read clearly.
- **Two type families:** `Press Start 2P` (blocky pixel — HUD, Pong/Breakout)
  and `Orbitron` (vector-line feel — titles, Asteroids/Tempest). Swap the
  `@font-face` import in `theme.css` for the licensed Asteroids vector font
  if/when it's available; nothing else needs to change.
- **"Racing the beam" CRT treatment** (`shared/shell.css`): scanline overlay,
  radial vignette, a subtle flicker animation, and a perspective Vectrex-style
  grid that parallax-scrolls behind the playfield.
- **Vector lines** are drawn at one consistent `--line-width` (2px) with a
  faint `canvas` `shadowBlur` glow — no variable-width strokes.
- **Pixel dust**, not particle sparkle: VFX is small square sprites with
  real physics (velocity, drag, optional gravity), via
  `shell.particles.burst(x, y, { color, count, speed, size, gravity })`.
- **SFX only, no music**: `shell.audio.play('shoot' | 'hit' | 'bounce' | ...)`
  are short WebAudio synth blips. Mute is a single persisted toggle shared
  across the whole flow (localStorage `atari:muted`).

## Gameplay philosophy (per design notes)

- Prefer **perpetual play** (a lives pool, chasing a leaderboard high score)
  over race-to-N-points where it fits the game.
- Give simple mechanics a **skill layer** — e.g. Asteroids' drag-to-aim
  steering, Pong's hold-to-smash for a sharper return — rather than adding
  chaos/mayhem.
- Let something visible **change slowly with progress** (Pong's background
  hue drifts with score) instead of hard level-up spikes.

## Example: Asteroids' 3-button control set

Per the spec, Asteroids exposes exactly three labeled buttons — **THRUST**,
**SHOOT**, **HYPERSPACE** — configured in `games/asteroids/asteroids.js`.
Steering is drag-to-aim on the playfield itself (a mobile-friendly stand-in
for rotate-left/rotate-right, keeping the button count at three as
specified); both the button labels and their left/right placement are
one-line changes in that file's `config.buttons` array.
