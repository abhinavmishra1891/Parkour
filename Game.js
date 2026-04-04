/**
 * ═══════════════════════════════════════════════════════════════
 *  SHADOW RUN — Endless Parkour Runner
 *  Pure Canvas API · No external libraries
 *
 *  Architecture (all in one file, clearly sectioned):
 *  1. SETUP & GLOBALS
 *  2. AUDIO ENGINE (Web Audio API)
 *  3. BACKGROUND / PARALLAX
 *  4. PLAYER
 *  5. OBSTACLES  (spikes, gaps, barriers)
 *  6. PARTICLES
 *  7. COLLISION
 *  8. GAME LOOP
 *  9. UI / INPUT
 * ═══════════════════════════════════════════════════════════════
 */

/* ────────────────────────────────────────────────────────────────
   1. SETUP & GLOBALS
───────────────────────────────────────────────────────────────── */

const canvas = document.getElementById('gameCanvas');
const ctx    = canvas.getContext('2d');

// Resize canvas to match physical pixels (sharp on retina screens)
function resizeCanvas() {
  const dpr = window.devicePixelRatio || 1;
  canvas.width  = window.innerWidth  * dpr;
  canvas.height = window.innerHeight * dpr;
  canvas.style.width  = window.innerWidth  + 'px';
  canvas.style.height = window.innerHeight + 'px';
  ctx.scale(dpr, dpr);

  // Recalculate layout-dependent values
  W = window.innerWidth;
  H = window.innerHeight;
  GROUND_Y = H * 0.72;           // Where the ground surface sits
  updateLayerPositions();
}

let W, H, GROUND_Y;

// ── Game state ──
let gameState = 'start';   // 'start' | 'playing' | 'dead'
let score     = 0;
let hiScore   = parseInt(localStorage.getItem('shadowRunHs') || '0');
let gameSpeed = 4;          // px/frame — increases over time
let frameCount = 0;

// ── DOM refs ──
const startScreen   = document.getElementById('startScreen');
const gameOverScreen = document.getElementById('gameOverScreen');
const hud            = document.getElementById('hud');
const scoreDisplay   = document.getElementById('scoreDisplay');
const finalScore     = document.getElementById('finalScore');
const finalHs        = document.getElementById('finalHs');
const hudHs          = document.getElementById('hudHs');
const startHs        = document.getElementById('startHs');

/* ────────────────────────────────────────────────────────────────
   2. AUDIO ENGINE  (Web Audio API — no files needed)
   We synthesise bleeps procedurally so the game has zero deps.
───────────────────────────────────────────────────────────────── */

let audioCtx = null;

function getAudioCtx() {
  // AudioContext must be created after user gesture
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return audioCtx;
}

/**
 * Play a short synthesised sound.
 * @param {string} type  'jump' | 'dbjump' | 'land' | 'hit'
 */
function playSound(type) {
  try {
    const ac   = getAudioCtx();
    const gain = ac.createGain();
    gain.connect(ac.destination);

    const osc = ac.createOscillator();
    osc.connect(gain);

    const now = ac.currentTime;

    if (type === 'jump') {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(260, now);
      osc.frequency.exponentialRampToValueAtTime(520, now + 0.12);
      gain.gain.setValueAtTime(0.18, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
      osc.start(now); osc.stop(now + 0.18);

    } else if (type === 'dbjump') {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(380, now);
      osc.frequency.exponentialRampToValueAtTime(760, now + 0.12);
      gain.gain.setValueAtTime(0.18, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.16);
      osc.start(now); osc.stop(now + 0.16);

    } else if (type === 'land') {
      // White-noise thud
      const bufSize = ac.sampleRate * 0.06;
      const buf     = ac.createBuffer(1, bufSize, ac.sampleRate);
      const data    = buf.getChannelData(0);
      for (let i = 0; i < bufSize; i++) data[i] = (Math.random() * 2 - 1) * 0.4;
      const src = ac.createBufferSource();
      src.buffer = buf;
      const g2 = ac.createGain();
      g2.gain.setValueAtTime(0.22, now);
      g2.gain.exponentialRampToValueAtTime(0.001, now + 0.06);
      src.connect(g2); g2.connect(ac.destination);
      src.start(now); src.stop(now + 0.06);
      return; // early return, osc not used

    } else if (type === 'hit') {
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(120, now);
      osc.frequency.exponentialRampToValueAtTime(40, now + 0.35);
      gain.gain.setValueAtTime(0.35, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
      osc.start(now); osc.stop(now + 0.35);
    }
  } catch(e) {
    // Audio not available — silently skip
  }
}

/* ────────────────────────────────────────────────────────────────
   3. BACKGROUND — Parallax layers
   Layers (back→front): stars, far mountains, mid mountains, ground
───────────────────────────────────────────────────────────────── */

// Parallax scrolling offsets, each at a different speed
const layers = {
  stars:    { x: 0, speed: 0.3 },
  farMtn:   { x: 0, speed: 0.7 },
  midMtn:   { x: 0, speed: 1.4 },
  ground:   { x: 0, speed: 1.0 },
};

function updateLayerPositions() {
  // Called on resize — nothing to pre-compute here
}

/** Move parallax layers each frame */
function updateBackground() {
  if (gameState !== 'playing') return;
  layers.stars.x  -= gameSpeed * layers.stars.speed  * 0.08;
  layers.farMtn.x -= gameSpeed * layers.farMtn.speed * 0.18;
  layers.midMtn.x -= gameSpeed * layers.midMtn.speed * 0.32;
}

/** Draw the full scenic background */
function drawBackground() {
  // ── Sky gradient ──
  const sky = ctx.createLinearGradient(0, 0, 0, GROUND_Y);
  sky.addColorStop(0,   '#0a0c1e');
  sky.addColorStop(0.4, '#111840');
  sky.addColorStop(0.75,'#1e2a60');
  sky.addColorStop(1,   '#2e3a72');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, GROUND_Y);

  drawStars();
  drawMoonOrSun();
  drawMountains(layers.farMtn.x, GROUND_Y, 0.52, '#1a2250', 8, 200, 340);
  drawMountains(layers.midMtn.x, GROUND_Y, 0.35, '#0f1635', 6, 130, 260);
  drawGroundStrip();
}

// ── Stars ──
const STARS = Array.from({ length: 90 }, () => ({
  x: Math.random(),   // 0‒1 (proportional)
  y: Math.random() * 0.55,
  r: Math.random() * 1.6 + 0.3,
  t: Math.random() * Math.PI * 2,  // twinkle phase
}));

function drawStars() {
  const ox = ((layers.stars.x % W) + W) % W;
  STARS.forEach(s => {
    s.t += 0.015;
    const alpha = 0.45 + Math.sin(s.t) * 0.3;
    ctx.beginPath();
    // tile the stars so they wrap seamlessly
    const sx = ((s.x * W + ox) % W);
    ctx.arc(sx, s.y * GROUND_Y, s.r, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(220,230,255,${alpha})`;
    ctx.fill();
  });
}

// ── Moon ──
function drawMoonOrSun() {
  const mx = W * 0.78, my = H * 0.12, mr = 38;
  // Outer glow
  const grd = ctx.createRadialGradient(mx, my, 0, mx, my, mr * 2.5);
  grd.addColorStop(0, 'rgba(200,210,255,0.18)');
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grd; ctx.beginPath();
  ctx.arc(mx, my, mr * 2.5, 0, Math.PI * 2); ctx.fill();
  // Moon disk
  ctx.beginPath(); ctx.arc(mx, my, mr, 0, Math.PI * 2);
  ctx.fillStyle = '#d8e2ff'; ctx.fill();
  // Shadow crescent
  ctx.beginPath(); ctx.arc(mx + 10, my - 6, mr * 0.88, 0, Math.PI * 2);
  ctx.fillStyle = '#111840'; ctx.fill();
}

/**
 * Draw a procedural mountain silhouette that tiles seamlessly.
 * @param {number} offsetX   Current parallax offset
 * @param {number} baseY     Bottom of the mountains
 * @param {number} heightFrac  How tall as fraction of GROUND_Y
 * @param {string} color
 * @param {number} peaks     Number of peaks per tile width
 * @param {number} minH      Min peak height
 * @param {number} maxH      Max peak height
 */
function drawMountains(offsetX, baseY, heightFrac, color, peaks, minH, maxH) {
  const tileW = W;
  // We generate points deterministically using a simple seeded approach
  // so the mountains look the same every frame (we just shift them)

  const mtnKey = `${heightFrac}-${peaks}-${minH}-${maxH}`;
  if (!drawMountains._cache) drawMountains._cache = {};
  if (!drawMountains._cache[mtnKey]) {
    // Generate 2 tiles worth of mountain points
    const pts = [];
    const seg = tileW / peaks;
    for (let i = 0; i <= peaks * 2; i++) {
      const px = i * seg;
      const ph = minH + pseudoRand(i + heightFrac * 100) * (maxH - minH);
      pts.push({ x: px, y: ph });
    }
    drawMountains._cache[mtnKey] = pts;
  }
  const pts = drawMountains._cache[mtnKey];

  ctx.beginPath();
  const ox = ((offsetX % tileW) + tileW) % tileW;

  // Draw 3 tiles for seamless wrapping
  for (let tile = -1; tile <= 1; tile++) {
    const dx = tile * tileW - ox;
    ctx.moveTo(dx, baseY);
    pts.forEach(p => {
      ctx.lineTo(dx + p.x, baseY - p.y);
    });
    ctx.lineTo(dx + tileW, baseY);
    ctx.closePath();
  }

  ctx.fillStyle = color;
  ctx.fill();
}

/** Cheap pseudo-random based on a seed integer */
function pseudoRand(seed) {
  const s = Math.sin(seed * 127.1 + 311.7) * 43758.5;
  return s - Math.floor(s);
}

/** Ground strip with a subtle ledge line */
function drawGroundStrip() {
  // Ground fill (below ground line)
  const grd = ctx.createLinearGradient(0, GROUND_Y, 0, H);
  grd.addColorStop(0, '#0d1428');
  grd.addColorStop(1, '#080b18');
  ctx.fillStyle = grd;
  ctx.fillRect(0, GROUND_Y, W, H - GROUND_Y);

  // Bright ledge line
  ctx.strokeStyle = '#3a4a8a';
  ctx.lineWidth   = 2;
  ctx.beginPath();
  ctx.moveTo(0, GROUND_Y); ctx.lineTo(W, GROUND_Y);
  ctx.stroke();

  // Subtle grid lines on ground
  ctx.strokeStyle = 'rgba(58,74,138,0.25)';
  ctx.lineWidth   = 1;
  for (let y = GROUND_Y + 20; y < H; y += 20) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
  }
}

/* ────────────────────────────────────────────────────────────────
   4. PLAYER
───────────────────────────────────────────────────────────────── */

const PLAYER = {
  x: 0,          // set in init
  y: 0,
  w: 32,
  h: 52,

  vy: 0,          // vertical velocity
  isOnGround: false,
  jumpsLeft: 2,   // 2 = double jump available

  sliding: false,
  slideTimer: 0,
  SLIDE_DURATION: 38,  // frames

  // Slide dimensions
  slideH: 26,

  // Animation
  legAngle: 0,
  armAngle: 0,
  animSpeed: 0.22,

  // Screen-shake on death
  shakeX: 0,
  shakeY: 0,

  wasOnGround: false,  // for land detection
};

const GRAVITY  = 0.6;
const JUMP_VEL = -14.5;

function initPlayer() {
  PLAYER.x = W * 0.18;
  PLAYER.y = GROUND_Y - PLAYER.h;
  PLAYER.vy = 0;
  PLAYER.isOnGround = true;
  PLAYER.jumpsLeft = 2;
  PLAYER.sliding = false;
  PLAYER.slideTimer = 0;
  PLAYER.shakeX = PLAYER.shakeY = 0;
  PLAYER.wasOnGround = true;
  PLAYER.legAngle = 0;
}

function jump() {
  if (PLAYER.jumpsLeft <= 0) return;
  const isDouble = PLAYER.jumpsLeft === 1;
  PLAYER.vy = JUMP_VEL;
  PLAYER.jumpsLeft--;
  PLAYER.isOnGround = false;
  PLAYER.sliding = false;
  playSound(isDouble ? 'dbjump' : 'jump');
  // Burst of jump particles
  spawnParticles(PLAYER.x + PLAYER.w / 2, GROUND_Y, 'jump');
}

function startSlide() {
  if (!PLAYER.isOnGround) return;
  PLAYER.sliding = true;
  PLAYER.slideTimer = PLAYER.SLIDE_DURATION;
}

function updatePlayer() {
  const p = PLAYER;

  // Slide countdown
  if (p.sliding) {
    p.slideTimer--;
    if (p.slideTimer <= 0) p.sliding = false;
  }

  // Gravity
  p.vy += GRAVITY;
  p.y  += p.vy;

  // Effective height (crouched or normal)
  const effH = p.sliding ? p.slideH : p.h;

  // Ground collision
  const groundTop = GROUND_Y;  // default ground (gaps use platform list)
  if (p.y + effH >= groundTop) {
    const wasAir = !p.wasOnGround;
    p.y = groundTop - effH;
    p.vy = 0;
    p.isOnGround = true;
    p.jumpsLeft  = 2;
    if (wasAir) {
      playSound('land');
      spawnParticles(p.x + p.w / 2, GROUND_Y, 'land');
    }
  } else {
    p.isOnGround = false;
  }
  p.wasOnGround = p.isOnGround;

  // Running animation
  if (p.isOnGround && !p.sliding) {
    p.legAngle += p.animSpeed * (gameSpeed / 4);
    p.armAngle += p.animSpeed * (gameSpeed / 4);
  }

  // Death by falling off screen
  if (p.y > H + 80) triggerDeath();
}

/** Draw the black silhouette character */
function drawPlayer() {
  const p = PLAYER;
  ctx.save();
  ctx.translate(p.x + p.w / 2 + p.shakeX, p.y + p.shakeY);

  if (p.sliding) {
    drawSlidePlayer();
  } else {
    drawRunPlayer(p);
  }

  ctx.restore();
}

function drawRunPlayer(p) {
  const w = p.w, h = p.h;
  const cx = 0, cy = 0;
  const half = h / 2;

  ctx.fillStyle = '#111';  // shadow black

  // ── Torso ──
  const torsoH = h * 0.35;
  const torsoW = w * 0.55;
  roundRect(ctx, cx - torsoW/2, cy - half + h*0.18, torsoW, torsoH, 4);
  ctx.fill();

  // ── Head ──
  ctx.beginPath();
  ctx.arc(cx, cy - half + h * 0.09, w * 0.24, 0, Math.PI * 2);
  ctx.fill();

  // ── Legs (animated) ──
  const legLen  = h * 0.42;
  const legW    = w * 0.18;
  const hipY    = cy - half + h * 0.52;
  const swing1  = Math.sin(p.legAngle) * 0.55;
  const swing2  = Math.sin(p.legAngle + Math.PI) * 0.55;

  drawLimb(cx - w*0.1, hipY, legLen, swing1, legW);
  drawLimb(cx + w*0.1, hipY, legLen, swing2, legW);

  // ── Arms ──
  const armLen  = h * 0.32;
  const armW    = w * 0.13;
  const shoulderY = cy - half + h * 0.25;
  const as1 = Math.sin(p.armAngle + Math.PI) * 0.45;
  const as2 = Math.sin(p.armAngle) * 0.45;

  drawLimb(cx - w*0.22, shoulderY, armLen, as1, armW);
  drawLimb(cx + w*0.22, shoulderY, armLen, as2, armW);
}

function drawSlidePlayer() {
  const w = PLAYER.w, sh = PLAYER.slideH;
  ctx.fillStyle = '#111';
  // Compact shape
  roundRect(ctx, -w*0.5, -sh/2, w*1.1, sh * 0.7, 8);
  ctx.fill();
  // Head at front
  ctx.beginPath();
  ctx.arc(w*0.35, -sh*0.1, sh*0.38, 0, Math.PI*2);
  ctx.fill();
}

/**
 * Draw a single limb (leg or arm) as a rounded line rotated from its origin.
 */
function drawLimb(sx, sy, len, angle, thick) {
  ctx.save();
  ctx.translate(sx, sy);
  ctx.rotate(angle);
  roundRect(ctx, -thick/2, 0, thick, len, thick/2);
  ctx.fill();
  ctx.restore();
}

/** CanvasRenderingContext2D helper for rounded rectangle paths */
function roundRect(ctx, x, y, w, h, r) {
  if (ctx.roundRect) {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
  } else {
    // Polyfill for older browsers
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }
}

/* ────────────────────────────────────────────────────────────────
   5. OBSTACLES
   Types:
     'spikes'  — static spikes on ground
     'gap'     — missing ground section (fall through)
     'barrier' — moving vertical bar (must jump over or slide under)
───────────────────────────────────────────────────────────────── */

let obstacles = [];       // active obstacle list
let spawnTimer = 0;       // frames until next spawn
let gapActive  = false;   // track if a gap is "current" so we don't overlap

/**
 * Obstacle templates
 * Each returns an obstacle object placed at the right edge of the screen
 */
const OBSTACLE_TYPES = ['spikes', 'barrier', 'gap'];

function spawnObstacle() {
  // Pick a random type, but not gap if one is very recent
  let type;
  do {
    type = OBSTACLE_TYPES[Math.floor(Math.random() * OBSTACLE_TYPES.length)];
  } while (type === 'gap' && gapActive);

  const o = { type, x: W + 60, dead: false };

  if (type === 'spikes') {
    const count = 1 + Math.floor(Math.random() * 3);  // 1-3 spikes
    o.count  = count;
    o.w      = count * 28;
    o.h      = 26;
    o.y      = GROUND_Y - o.h;

  } else if (type === 'barrier') {
    o.w     = 16;
    o.h     = 60 + Math.random() * 30;
    o.gap   = Math.random() < 0.5 ? 'top' : 'bottom'; // which half is passable
    o.moveY = 0;                // vertical oscillation
    o.movePhase = Math.random() * Math.PI * 2;
    // For 'top' gap: player must slide; 'bottom' gap: player must jump
    o.y = (o.gap === 'bottom') ? GROUND_Y - o.h : GROUND_Y - o.h * 1.6;

  } else if (type === 'gap') {
    o.w   = 90 + Math.random() * 80;
    o.h   = H - GROUND_Y + 20;
    o.y   = GROUND_Y;
    gapActive = true;
  }

  obstacles.push(o);
}

function updateObstacles() {
  // Spawn logic: interval shrinks as speed increases
  spawnTimer--;
  if (spawnTimer <= 0) {
    spawnObstacle();
    // Spawn interval: 80‒150 frames, narrows with speed
    const base = Math.max(55, 150 - gameSpeed * 7);
    spawnTimer = base + Math.random() * 50;
  }

  for (let i = obstacles.length - 1; i >= 0; i--) {
    const o = obstacles[i];
    o.x -= gameSpeed;

    // Animate barrier vertical movement
    if (o.type === 'barrier') {
      o.movePhase += 0.04;
      o.moveY = Math.sin(o.movePhase) * 22;
    }

    // Remove off-screen obstacles
    if (o.x + (o.w || 100) < -80) {
      if (o.type === 'gap') gapActive = false;
      obstacles.splice(i, 1);
    }
  }
}

function drawObstacles() {
  obstacles.forEach(o => {
    if (o.type === 'spikes')  drawSpikes(o);
    if (o.type === 'barrier') drawBarrier(o);
    if (o.type === 'gap')     drawGap(o);
  });
}

function drawSpikes(o) {
  const spikeW = o.w / o.count;
  ctx.fillStyle = '#c0392b';

  for (let i = 0; i < o.count; i++) {
    const sx = o.x + i * spikeW;
    ctx.beginPath();
    ctx.moveTo(sx + spikeW * 0.1, GROUND_Y);
    ctx.lineTo(sx + spikeW / 2, o.y);
    ctx.lineTo(sx + spikeW * 0.9, GROUND_Y);
    ctx.closePath();
    ctx.fill();
    // Shiny highlight
    ctx.strokeStyle = '#e74c3c';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(sx + spikeW * 0.32, GROUND_Y - 6);
    ctx.lineTo(sx + spikeW / 2, o.y + 4);
    ctx.stroke();
  }
  // Red glow
  ctx.shadowColor = '#e74c3c';
  ctx.shadowBlur  = 14;
  ctx.shadowBlur  = 0;
}

function drawBarrier(o) {
  const ry = o.y + o.moveY;
  // Main body
  const grad = ctx.createLinearGradient(o.x, 0, o.x + o.w, 0);
  grad.addColorStop(0, '#ff6b2b');
  grad.addColorStop(1, '#e84393');
  ctx.fillStyle = grad;
  roundRect(ctx, o.x, ry, o.w, o.h, 4);
  ctx.fill();

  // Danger stripes
  ctx.save();
  ctx.beginPath();
  roundRect(ctx, o.x, ry, o.w, o.h, 4);
  ctx.clip();
  ctx.strokeStyle = 'rgba(255,255,255,0.15)';
  ctx.lineWidth = 8;
  for (let yy = ry - o.h; yy < ry + o.h * 2; yy += 18) {
    ctx.beginPath();
    ctx.moveTo(o.x - 4, yy); ctx.lineTo(o.x + o.w + 4, yy + 18);
    ctx.stroke();
  }
  ctx.restore();

  // Glow
  ctx.shadowColor = '#ff6b2b';
  ctx.shadowBlur  = 18;
  roundRect(ctx, o.x, ry, o.w, o.h, 4);
  ctx.fillStyle = 'transparent';
  ctx.fill();
  ctx.shadowBlur = 0;
}

function drawGap(o) {
  // The gap is just a black hole in the ground — we punch out the ground color
  ctx.fillStyle = '#050810';
  ctx.fillRect(o.x, GROUND_Y, o.w, H - GROUND_Y);

  // Dark void glow at the edge
  const lg = ctx.createLinearGradient(o.x, GROUND_Y, o.x, GROUND_Y + 60);
  lg.addColorStop(0, 'rgba(30,40,120,0.5)');
  lg.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = lg;
  ctx.fillRect(o.x, GROUND_Y, o.w, 60);
}

/* ────────────────────────────────────────────────────────────────
   6. PARTICLES
   Used for dust on landing and jump bursts.
───────────────────────────────────────────────────────────────── */

let particles = [];

/**
 * @param {number} x  Origin x
 * @param {number} y  Origin y
 * @param {string} kind  'land' | 'jump'
 */
function spawnParticles(x, y, kind) {
  const count = kind === 'land' ? 8 : 6;
  for (let i = 0; i < count; i++) {
    particles.push({
      x, y,
      vx: (Math.random() - 0.5) * (kind === 'land' ? 3 : 4),
      vy: Math.random() * -2.5 - 0.5,
      life: 1,
      decay: 0.04 + Math.random() * 0.04,
      r: 2 + Math.random() * 3,
      color: kind === 'land' ? '#4a5a9a' : '#ffd166',
    });
  }
}

function updateParticles() {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.x   += p.vx;
    p.y   += p.vy;
    p.vy  += 0.12;  // small gravity
    p.life -= p.decay;
    if (p.life <= 0) particles.splice(i, 1);
  }
}

function drawParticles() {
  particles.forEach(p => {
    ctx.globalAlpha = Math.max(0, p.life);
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
    ctx.fillStyle = p.color;
    ctx.fill();
  });
  ctx.globalAlpha = 1;
}

/* ────────────────────────────────────────────────────────────────
   7. COLLISION DETECTION
───────────────────────────────────────────────────────────────── */

/**
 * Returns the AABB (axis-aligned bounding box) of the player,
 * slightly inset so short clips don't count as hits.
 */
function getPlayerBox() {
  const p = PLAYER;
  const effH = p.sliding ? p.slideH : p.h;
  const inset = 5;  // forgiveness margin
  return {
    x:  p.x + inset,
    y:  p.y + inset,
    x2: p.x + p.w - inset,
    y2: p.y + effH - inset,
  };
}

function checkCollisions() {
  const pb = getPlayerBox();

  for (const o of obstacles) {
    if (o.type === 'spikes') {
      // Spike triangle hitbox (conservative rect)
      const ox1 = o.x + 4, oy1 = o.y + 6;
      const ox2 = o.x + o.w - 4, oy2 = GROUND_Y;
      if (rectsOverlap(pb, { x: ox1, y: oy1, x2: ox2, y2: oy2 })) {
        triggerDeath(); return;
      }

    } else if (o.type === 'barrier') {
      const ry = o.y + o.moveY;
      const ob = { x: o.x, y: ry, x2: o.x + o.w, y2: ry + o.h };
      if (rectsOverlap(pb, ob)) { triggerDeath(); return; }

    } else if (o.type === 'gap') {
      // Falling into gap: player centre is over gap, player not on ground
      const pc = (pb.x + pb.x2) / 2;
      if (pc > o.x && pc < o.x + o.w && !PLAYER.isOnGround) {
        // They're floating in air over gap — fine; only die when they land below screen
        // (handled in updatePlayer → falls past H)
      }
    }
  }
}

function rectsOverlap(a, b) {
  return a.x < b.x2 && a.x2 > b.x && a.y < b.y2 && a.y2 > b.y;
}

/* ────────────────────────────────────────────────────────────────
   8. GAME LOOP
───────────────────────────────────────────────────────────────── */

let lastTime = 0;
let animId   = null;
let deathShake = 0;

function startGame() {
  score      = 0;
  gameSpeed  = 4;
  frameCount = 0;
  obstacles  = [];
  particles  = [];
  spawnTimer = 80;
  gapActive  = false;
  deathShake = 0;
  initPlayer();

  gameState = 'playing';
  showScreen('hud');
  updateHUD();
}

function triggerDeath() {
  if (gameState !== 'playing') return;
  gameState = 'dead';
  deathShake = 18;
  playSound('hit');
  // Burst of hit particles
  spawnParticles(PLAYER.x + PLAYER.w/2, PLAYER.y + PLAYER.h/2, 'jump');

  // Save high score
  if (score > hiScore) {
    hiScore = score;
    localStorage.setItem('shadowRunHs', hiScore);
  }

  // Show game-over screen after short delay (let particles play)
  setTimeout(() => showScreen('gameover'), 600);
}

function gameLoop(ts) {
  animId = requestAnimationFrame(gameLoop);
  ctx.clearRect(0, 0, W, H);

  if (gameState === 'start') {
    // Static start screen — draw animated background only
    updateBackground();
    drawBackground();
    return;
  }

  // ── Update phase ──
  if (gameState === 'playing') {
    frameCount++;
    // Increase speed gradually every 300 frames
    if (frameCount % 300 === 0) gameSpeed = Math.min(gameSpeed + 0.4, 16);

    // Score = distance (1 pt per 3 frames, scales with speed)
    if (frameCount % 3 === 0) { score++; updateHUD(); }

    updateBackground();
    updatePlayer();
    updateObstacles();
    updateParticles();
    checkCollisions();
  }

  if (gameState === 'dead') {
    // Keep animating a bit
    updateBackground();
    updateParticles();
    // Camera shake
    if (deathShake > 0) {
      deathShake--;
      PLAYER.shakeX = (Math.random() - 0.5) * deathShake * 0.8;
      PLAYER.shakeY = (Math.random() - 0.5) * deathShake * 0.8;
    }
  }

  // ── Draw phase ──
  drawBackground();

  // Ground-level obstacles drawn before player (spikes/gaps look right)
  drawObstacles();
  drawParticles();
  drawPlayer();

  lastTime = ts;
}

/* ────────────────────────────────────────────────────────────────
   9. UI / INPUT
───────────────────────────────────────────────────────────────── */

function showScreen(which) {
  startScreen.classList.remove('active');
  gameOverScreen.classList.remove('active');
  hud.style.display = 'none';

  if (which === 'start') {
    startScreen.classList.add('active');
    startHs.textContent = hiScore;

  } else if (which === 'gameover') {
    gameOverScreen.classList.add('active');
    finalScore.textContent = score;
    finalHs.textContent    = hiScore;
    // Pulse if new high score
    if (score >= hiScore) finalHs.classList.add('new-hs');
    else finalHs.classList.remove('new-hs');

  } else if (which === 'hud') {
    hud.style.display = 'flex';
    hudHs.textContent = hiScore;
  }
}

function updateHUD() {
  scoreDisplay.textContent = score;
  // Subtle "pop" animation on score change
  scoreDisplay.style.transform = 'scale(1.15)';
  setTimeout(() => scoreDisplay.style.transform = 'scale(1)', 80);
}

// ── Button events ──
document.getElementById('startBtn').addEventListener('click', () => {
  startGame();
});
document.getElementById('restartBtn').addEventListener('click', () => {
  gameOverScreen.classList.remove('active');
  startGame();
});

// ── Keyboard input ──
const keys = {};
document.addEventListener('keydown', e => {
  if (keys[e.code]) return;  // prevent key repeat
  keys[e.code] = true;

  if (gameState === 'playing') {
    if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'KeyW') {
      e.preventDefault();
      jump();
    }
    if (e.code === 'ArrowDown' || e.code === 'KeyS') {
      e.preventDefault();
      startSlide();
    }
  }
});
document.addEventListener('keyup', e => { keys[e.code] = false; });

// ── Touch input (mobile) ──
let touchStartY = 0;
document.addEventListener('touchstart', e => {
  touchStartY = e.touches[0].clientY;
  if (gameState === 'playing') jump();
}, { passive: true });

document.addEventListener('touchend', e => {
  const dy = e.changedTouches[0].clientY - touchStartY;
  if (dy > 40 && gameState === 'playing') startSlide();  // swipe down = slide
}, { passive: true });

// ── Window resize ──
window.addEventListener('resize', () => {
  resizeCanvas();
  if (gameState !== 'playing') initPlayer();
});

// ── Bootstrap ──
resizeCanvas();
showScreen('start');
requestAnimationFrame(gameLoop);