/**
 * ══════════════════════════════════════════════════════════════════
 *  SHADOW RUN v2.0 — Production Parkour Runner
 *  Pure Canvas API · Zero external dependencies
 *
 *  SECTIONS:
 *   §1  CONFIG  — tweak all gameplay values here
 *   §2  PERSISTENCE  — localStorage: score, coins, unlocks
 *   §3  ECONOMY  — skins, trails, store items
 *   §4  AUDIO  — synthesised SFX + procedural music
 *   §5  CANVAS / RESIZE
 *   §6  BACKGROUND  — dynamic sky + 4-layer parallax
 *   §7  PLAYER  — physics, coyote time, jump buffer, variable jump
 *   §8  OBSTACLES  — spikes, gaps, barriers + perfect-jump detection
 *   §9  COINS  — collectible coins in-world
 *   §10 PARTICLES  — dust, trail, impact, coin-pop
 *   §11 COLLISION
 *   §12 SLOW MOTION  — perfect jump reward
 *   §13 GAME LOOP
 *   §14 UI / INPUT
 *   §15 MONETISATION HOOKS
 * ══════════════════════════════════════════════════════════════════
 */

/* ────────────────────────────────────────────────────────────────
   §1  CONFIG  ← tweak all values here
───────────────────────────────────────────────────────────────── */
const CFG = {
  // Physics
  GRAVITY:           0.55,   // px/frame² — lower = floatier
  GRAVITY_HOLD:      0.28,   // gravity while jump key held (variable jump)
  JUMP_VEL:         -15.0,   // initial jump velocity (negative = up)
  DOUBLE_JUMP_VEL:  -13.0,   // double-jump velocity
  MAX_FALL_SPEED:    22,     // terminal velocity downward
  COYOTE_FRAMES:     8,      // frames after leaving platform where jump still works
  JUMP_BUFFER_FRAMES:10,     // frames before landing where jump is pre-queued

  // Speed / difficulty
  SPEED_START:       4.2,    // initial game speed (px/frame)
  SPEED_MAX:         17,     // hard cap
  SPEED_RAMP:        0.0006, // added per frame (smooth ramp)
  SPEED_MILESTONE:   0.35,   // extra burst every 500 pts

  // Scoring
  SCORE_RATE:        3,      // frames between score increments
  SCORE_PER_COIN:    10,     // bonus points per coin
  PERFECT_BONUS:     25,     // perfect-jump bonus pts

  // Slow-motion (perfect jump)
  SLOW_MO_SCALE:     0.35,   // time scale during slo-mo
  SLOW_MO_FRAMES:    55,     // duration in real frames

  // Obstacles
  SPAWN_MIN_GAP:     50,     // minimum frames between spawns
  SPAWN_BASE:        155,    // frames between spawns at start

  // Player dimensions
  PLAYER_W:          30,
  PLAYER_H:          50,
  PLAYER_SLIDE_H:    24,
  SLIDE_DURATION:    42,     // frames slide lasts

  // Perfect-jump window (pixels before obstacle)
  PERFECT_WINDOW:    52,

  // Coins
  COIN_SPAWN_CHANCE: 0.55,   // probability per obstacle spawn
  COIN_VALUE:         1,

  // Ground position (fraction of screen height)
  GROUND_FRAC:       0.72,
};

/* ────────────────────────────────────────────────────────────────
   §2  PERSISTENCE
───────────────────────────────────────────────────────────────── */
const SAVE = {
  _data: null,

  defaults() {
    return {
      hiScore:   0,
      coins:     0,
      skin:      'shadow',
      trail:     'none',
      unlocked:  ['shadow', 'none'],
      // Persistent boosts
      boost_2xCoin: false,
    };
  },

  load() {
    try {
      const raw = localStorage.getItem('shadowRun_v2');
      this._data = raw ? { ...this.defaults(), ...JSON.parse(raw) } : this.defaults();
    } catch { this._data = this.defaults(); }
    return this._data;
  },

  save() {
    try { localStorage.setItem('shadowRun_v2', JSON.stringify(this._data)); } catch {}
  },

  get(k)    { return this._data[k]; },
  set(k, v) { this._data[k] = v; this.save(); },
  addCoins(n) {
    this._data.coins = (this._data.coins || 0) + n;
    this.save();
  },
  unlock(id) {
    if (!this._data.unlocked.includes(id)) {
      this._data.unlocked.push(id);
      this.save();
    }
  },
  isUnlocked(id) { return this._data.unlocked.includes(id); },
};

/* ────────────────────────────────────────────────────────────────
   §3  ECONOMY — skins, trails, boosts
───────────────────────────────────────────────────────────────── */

// Each skin defines how the player silhouette is coloured / glowed
const SKINS = [
  { id:'shadow',  name:'Shadow',   price:0,    free:true,  color:'#111111', glow:null,            icon:'⬛' },
  { id:'crimson', name:'Crimson',  price:80,   free:false, color:'#8b0000', glow:'#ff2200',        icon:'🔴' },
  { id:'neon',    name:'Neon',     price:150,  free:false, color:'#003333', glow:'#00ffcc',        icon:'💚' },
  { id:'gold',    name:'Gold',     price:220,  free:false, color:'#5a3e00', glow:'#ffd700',        icon:'🟡' },
  { id:'phantom', name:'Phantom',  price:350,  free:false, color:'rgba(120,0,200,0.7)', glow:'#bf00ff', icon:'🟣' },
  { id:'ice',     name:'Ice',      price:300,  free:false, color:'#003366', glow:'#00e5ff',        icon:'🔵' },
];

// Each trail defines particle behaviour behind the player
const TRAILS = [
  { id:'none',    name:'None',     price:0,    free:true,  particles:null,                         icon:'✖️' },
  { id:'dust',    name:'Dust',     price:60,   free:false, particles:'dust',                       icon:'💨' },
  { id:'fire',    name:'Fire',     price:180,  free:false, particles:'fire',                       icon:'🔥' },
  { id:'neon',    name:'Neon',     price:200,  free:false, particles:'neon',                       icon:'⚡' },
  { id:'smoke',   name:'Smoke',    price:150,  free:false, particles:'smoke',                      icon:'🌫️' },
];

// Boosts (consumable-style — here they persist per-run)
const BOOSTS = [
  { id:'boost_magnet',  name:'Coin Magnet',  price:120, icon:'🧲', desc:'Coins attracted' },
  { id:'boost_shield',  name:'Shield',       price:200, icon:'🛡️', desc:'1 free hit' },
];

/* ────────────────────────────────────────────────────────────────
   §4  AUDIO ENGINE — synthesised SFX + simple music
───────────────────────────────────────────────────────────────── */
let audioCtx = null;
let musicNodes = null; // hold refs to stop music

function getAC() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return audioCtx;
}

function playSound(type) {
  try {
    const ac = getAC();
    const now = ac.currentTime;

    const mkOsc = (t, f, gVal, dur, fEnd) => {
      const g = ac.createGain();
      g.connect(ac.destination);
      g.gain.setValueAtTime(gVal, now);
      g.gain.exponentialRampToValueAtTime(0.001, now + dur);
      const o = ac.createOscillator();
      o.type = t; o.frequency.setValueAtTime(f, now);
      if (fEnd) o.frequency.exponentialRampToValueAtTime(fEnd, now + dur);
      o.connect(g); o.start(now); o.stop(now + dur);
    };

    const mkNoise = (gVal, dur) => {
      const ac2 = getAC();
      const buf = ac2.createBuffer(1, ac2.sampleRate * dur, ac2.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = (Math.random()*2-1);
      const g = ac2.createGain();
      g.gain.setValueAtTime(gVal, now);
      g.gain.exponentialRampToValueAtTime(0.001, now + dur);
      const s = ac2.createBufferSource(); s.buffer = buf;
      s.connect(g); g.connect(ac2.destination);
      s.start(now); s.stop(now + dur);
    };

    if (type === 'jump')   { mkOsc('sine',    260, 0.16, 0.18, 520); }
    if (type === 'dbjump') { mkOsc('sine',    400, 0.16, 0.14, 800); mkOsc('triangle',600,0.08,0.12,900); }
    if (type === 'land')   { mkNoise(0.18, 0.07); mkOsc('sine',80,0.12,0.1); }
    if (type === 'hit')    { mkOsc('sawtooth',120, 0.35, 0.4, 38); mkNoise(0.2,0.3); }
    if (type === 'coin')   { mkOsc('sine',    880, 0.1,  0.12, 1200); }
    if (type === 'perfect'){ mkOsc('sine',    660, 0.15, 0.22, 1320); mkOsc('sine',990,0.1,0.22,1980); }
    if (type === 'slide')  { mkNoise(0.08, 0.15); }
  } catch { /* audio unavailable */ }
}

// Procedural background music: a simple arpeggiated loop
function startMusic() {
  try {
    const ac = getAC();
    if (musicNodes) stopMusic();

    // Simple 4-note drone chord
    const notes = [110, 138.6, 164.8, 220]; // A2, C#3, E3, A3
    const gainMaster = ac.createGain();
    gainMaster.gain.setValueAtTime(0.06, ac.currentTime);
    gainMaster.connect(ac.destination);

    const oscs = notes.map(freq => {
      const o = ac.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(freq, ac.currentTime);
      const g = ac.createGain(); g.gain.setValueAtTime(0.25, ac.currentTime);
      // Slight LFO tremolo per note
      const lfo = ac.createOscillator(); lfo.frequency.setValueAtTime(0.8 + Math.random()*0.4, ac.currentTime);
      const lfoG = ac.createGain(); lfoG.gain.setValueAtTime(0.04, ac.currentTime);
      lfo.connect(lfoG); lfoG.connect(g.gain);
      lfo.start(); o.connect(g); g.connect(gainMaster); o.start();
      return [o, lfo];
    });

    musicNodes = { gain: gainMaster, oscs };
  } catch {}
}

function stopMusic() {
  try {
    if (!musicNodes) return;
    musicNodes.gain.gain.exponentialRampToValueAtTime(0.001, getAC().currentTime + 0.5);
    musicNodes.oscs.forEach(([o, l]) => { o.stop(getAC().currentTime + 0.6); l.stop(getAC().currentTime + 0.6); });
    musicNodes = null;
  } catch {}
}

/* ────────────────────────────────────────────────────────────────
   §5  CANVAS / RESIZE
───────────────────────────────────────────────────────────────── */
const canvas = document.getElementById('gameCanvas');
const ctx    = canvas.getContext('2d');

let W = 0, H = 0, GROUND_Y = 0;

function resizeCanvas() {
  const dpr = window.devicePixelRatio || 1;
  W = window.innerWidth; H = window.innerHeight;
  canvas.width  = W * dpr; canvas.height = H * dpr;
  canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
  ctx.scale(dpr, dpr);
  GROUND_Y = H * CFG.GROUND_FRAC;
  // Invalidate mountain cache so it rebuilds at new size
  if (drawMountains._cache) drawMountains._cache = {};
}

window.addEventListener('resize', () => { resizeCanvas(); });

/* ────────────────────────────────────────────────────────────────
   §6  BACKGROUND — dynamic sky + 4-layer parallax
───────────────────────────────────────────────────────────────── */
const BG = {
  // Parallax layer offsets
  stars:  { x:0, speed:0.06 },
  far:    { x:0, speed:0.18 },
  mid:    { x:0, speed:0.38 },
  near:   { x:0, speed:0.65 },

  // Day/night cycle: 0=night, 0.5=dawn, 1=day (cycles slowly)
  timeOfDay: 0,        // 0..1
  timeDir:   1,        // direction of time movement

  update(dt) {
    if (gameState !== 'playing') return;
    const spd = gameSpeed;
    this.stars.x -= spd * this.stars.speed;
    this.far.x   -= spd * this.far.speed;
    this.mid.x   -= spd * this.mid.speed;
    this.near.x  -= spd * this.near.speed;

    // Slowly shift time of day for colour transition
    this.timeOfDay += 0.00008 * dt;
    if (this.timeOfDay > 1) this.timeOfDay = 0;
  },

  draw() {
    this._drawSky();
    this._drawStars();
    this._drawCelestial();
    drawMountains(this.far.x,  GROUND_Y, '#1a2050', 7,  180, 320, 0);
    drawMountains(this.mid.x,  GROUND_Y, '#0f1635', 5,  120, 240, 1);
    drawMountains(this.near.x, GROUND_Y, '#080d22', 4,   60, 140, 2);
    this._drawGround();
  },

  _drawSky() {
    // Lerp between night and dawn palette based on timeOfDay
    const t = this.timeOfDay;
    // Night: deep navy → Dawn: orange/purple tinge
    const topC   = lerpColor([10,12,30],   [40,20,60],  Math.sin(t*Math.PI));
    const midC   = lerpColor([18,24,64],   [80,40,80],  Math.sin(t*Math.PI));
    const botC   = lerpColor([46,58,114],  [140,80,60], Math.sin(t*Math.PI));
    const sky = ctx.createLinearGradient(0, 0, 0, GROUND_Y);
    sky.addColorStop(0,    `rgb(${topC})`);
    sky.addColorStop(0.45, `rgb(${midC})`);
    sky.addColorStop(1,    `rgb(${botC})`);
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, GROUND_Y);
  },

  _drawStars() {
    const ox = ((-this.stars.x % W) + W) % W;
    STARS.forEach(s => {
      s.t += 0.012;
      const alpha = (0.4 + Math.sin(s.t) * 0.3) * (1 - this.timeOfDay * 0.7);
      if (alpha < 0.05) return;
      const sx = (s.x * W + ox) % W;
      ctx.beginPath();
      ctx.arc(sx, s.y * GROUND_Y * 0.9, s.r, 0, Math.PI*2);
      ctx.fillStyle = `rgba(220,230,255,${alpha})`;
      ctx.fill();
    });
  },

  _drawCelestial() {
    // Moon fades out at dawn, sun rises
    const moonAlpha = Math.max(0, 1 - this.timeOfDay * 3);
    const sunAlpha  = Math.max(0, this.timeOfDay * 2 - 0.5);

    if (moonAlpha > 0.05) {
      const mx = W*0.78, my = H*0.11, mr = 34;
      ctx.globalAlpha = moonAlpha;
      const g = ctx.createRadialGradient(mx,my,0,mx,my,mr*2.4);
      g.addColorStop(0,'rgba(200,210,255,0.16)'); g.addColorStop(1,'rgba(0,0,0,0)');
      ctx.fillStyle=g; ctx.beginPath(); ctx.arc(mx,my,mr*2.4,0,Math.PI*2); ctx.fill();
      ctx.beginPath(); ctx.arc(mx,my,mr,0,Math.PI*2); ctx.fillStyle='#d8e2ff'; ctx.fill();
      ctx.beginPath(); ctx.arc(mx+9,my-5,mr*0.87,0,Math.PI*2); ctx.fillStyle='#111840'; ctx.fill();
      ctx.globalAlpha = 1;
    }

    if (sunAlpha > 0.05) {
      const sx = W*0.5, sy = H*0.08, sr = 28;
      ctx.globalAlpha = sunAlpha;
      const g = ctx.createRadialGradient(sx,sy,0,sx,sy,sr*3);
      g.addColorStop(0,'rgba(255,200,80,0.4)'); g.addColorStop(1,'rgba(0,0,0,0)');
      ctx.fillStyle=g; ctx.beginPath(); ctx.arc(sx,sy,sr*3,0,Math.PI*2); ctx.fill();
      ctx.beginPath(); ctx.arc(sx,sy,sr,0,Math.PI*2); ctx.fillStyle='#ffe080'; ctx.fill();
      ctx.globalAlpha = 1;
    }
  },

  _drawGround() {
    // Moving grid on ground for speed feel
    const scrollOff = ((-this.near.x / 1) % 60 + 60) % 60;

    const g = ctx.createLinearGradient(0, GROUND_Y, 0, H);
    g.addColorStop(0, '#0c1226'); g.addColorStop(1, '#06080f');
    ctx.fillStyle = g; ctx.fillRect(0, GROUND_Y, W, H - GROUND_Y);

    // Grid lines (vertical — scroll with game)
    ctx.strokeStyle = 'rgba(58,74,138,0.22)'; ctx.lineWidth = 1;
    for (let x = scrollOff; x < W; x += 60) {
      ctx.beginPath(); ctx.moveTo(x, GROUND_Y); ctx.lineTo(x + 30, H); ctx.stroke();
    }
    // Horizontal lines
    for (let y = GROUND_Y + 24; y < H; y += 24) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    }

    // Top ledge glow
    ctx.strokeStyle = '#3a4a8a'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, GROUND_Y); ctx.lineTo(W, GROUND_Y); ctx.stroke();

    // Speed-based motion blur overlay on ground
    if (gameSpeed > 9) {
      const alpha = Math.min(0.18, (gameSpeed - 9) * 0.025);
      ctx.fillStyle = `rgba(0,229,255,${alpha})`;
      ctx.fillRect(0, GROUND_Y, W, 3);
    }
  },
};

/* Stars array (persistent across frames) */
const STARS = Array.from({length:100}, () => ({
  x: Math.random(), y: Math.random() * 0.6,
  r: Math.random() * 1.7 + 0.3,
  t: Math.random() * Math.PI * 2,
}));

/** Linearly interpolate between two RGB arrays */
function lerpColor(a, b, t) {
  return a.map((v, i) => Math.round(v + (b[i] - v) * t)).join(',');
}

/**
 * Draw a procedurally-generated, tiling mountain silhouette.
 * Results are cached per unique parameter set to avoid recomputing.
 */
function drawMountains(offsetX, baseY, color, peaks, minH, maxH, seed) {
  if (!drawMountains._cache) drawMountains._cache = {};
  const key = `${peaks}-${minH}-${maxH}-${seed}-${W}`;
  if (!drawMountains._cache[key]) {
    const pts = [];
    const seg = W / peaks;
    for (let i = 0; i <= peaks * 2 + 1; i++) {
      const px = i * seg;
      const ph = minH + pseudoRand(i * 7.3 + seed * 31.1) * (maxH - minH);
      // Smooth the curve using cubic interpolation hint
      pts.push({ x: px, y: ph });
    }
    drawMountains._cache[key] = pts;
  }
  const pts = drawMountains._cache[key];
  const ox = ((-offsetX % W) + W) % W;

  ctx.beginPath();
  for (let tile = -1; tile <= 1; tile++) {
    const dx = tile * W - ox;
    ctx.moveTo(dx, baseY);
    // Smooth curve through mountain peaks
    for (let i = 0; i < pts.length - 1; i++) {
      const cpx = dx + (pts[i].x + pts[i+1].x) / 2;
      const cpy = baseY - (pts[i].y + pts[i+1].y) / 2;
      ctx.quadraticCurveTo(dx + pts[i].x, baseY - pts[i].y, cpx, cpy);
    }
    ctx.lineTo(dx + W, baseY);
    ctx.closePath();
  }
  ctx.fillStyle = color; ctx.fill();
}

/** Deterministic pseudo-random 0..1 from any float seed */
function pseudoRand(s) { const v = Math.sin(s*127.1+311.7)*43758.5; return v-Math.floor(v); }

/* ────────────────────────────────────────────────────────────────
   §7  PLAYER — physics, coyote time, jump buffer, variable jump
───────────────────────────────────────────────────────────────── */
const PLAYER = {
  x: 0, y: 0,
  w: CFG.PLAYER_W,
  h: CFG.PLAYER_H,

  vy: 0,
  isOnGround: false,
  wasOnGround: false,

  // Coyote time: frames since leaving ground (jump still valid)
  coyoteFrames: 0,
  // Jump buffer: frames since jump pressed before landing
  jumpBuffer: 0,
  // Variable jump: key held = reduced gravity
  jumpHeld: false,
  jumpsLeft: 2,

  // Sliding
  sliding: false,
  slideTimer: 0,

  // Animation
  legAngle: 0,
  squash: 1,    // y scale for squash/stretch on land
  stretch: 1,   // x scale

  // Death shake
  shakeX: 0, shakeY: 0,

  // Shield (purchasable)
  shielded: false,

  // Trail
  trailTimer: 0,

  // Skin refs (set from SAVE)
  skinColor: '#111',
  skinGlow:  null,
};

function initPlayer() {
  const p = PLAYER;
  p.x = W * 0.18;
  p.y = GROUND_Y - p.h;
  p.vy = 0;
  p.isOnGround = true;
  p.wasOnGround = true;
  p.coyoteFrames = 0;
  p.jumpBuffer = 0;
  p.jumpHeld = false;
  p.jumpsLeft = 2;
  p.sliding = false;
  p.slideTimer = 0;
  p.shakeX = p.shakeY = 0;
  p.legAngle = 0;
  p.squash = 1; p.stretch = 1;
  p.trailTimer = 0;

  // Apply equipped skin
  const sk = SKINS.find(s => s.id === SAVE.get('skin')) || SKINS[0];
  p.skinColor = sk.color;
  p.skinGlow  = sk.glow;

  // Apply shield boost if purchased this session
  p.shielded = sessionBoosts.shield;
}

function doJump(isDouble) {
  const p = PLAYER;
  const vel = isDouble ? CFG.DOUBLE_JUMP_VEL : CFG.JUMP_VEL;
  p.vy = vel;
  p.isOnGround = false;
  p.coyoteFrames = 0;
  p.jumpBuffer = 0;
  p.jumpHeld = true;
  if (!isDouble) spawnParticles(p.x + p.w/2, GROUND_Y, 'jump');
  else           spawnParticles(p.x + p.w/2, p.y + p.h, 'dbjump');
  playSound(isDouble ? 'dbjump' : 'jump');
  // Stretch upward
  p.squash = 0.7; p.stretch = 1.3;
}

function tryJump() {
  const p = PLAYER;
  // Already handled by buffer or direct call
  if (p.isOnGround || p.coyoteFrames > 0) {
    // First / grounded jump
    p.jumpsLeft = 1; // used one, still have double
    doJump(false);
  } else if (p.jumpsLeft > 0) {
    // Double jump
    p.jumpsLeft--;
    doJump(true);
  } else {
    // Queue in buffer
    p.jumpBuffer = CFG.JUMP_BUFFER_FRAMES;
  }
}

function trySlide() {
  const p = PLAYER;
  if (!p.isOnGround || p.sliding) return;
  p.sliding = true;
  p.slideTimer = CFG.SLIDE_DURATION;
  playSound('slide');
  spawnParticles(p.x + p.w/2, GROUND_Y, 'slide');
}

function updatePlayer(dt) {
  const p = PLAYER;

  // ── Coyote time ──
  if (!p.isOnGround) {
    if (p.coyoteFrames > 0) p.coyoteFrames--;
  }

  // ── Jump buffer check ──
  if (p.jumpBuffer > 0) {
    p.jumpBuffer--;
    if (p.isOnGround && p.jumpBuffer > 0) {
      p.jumpsLeft = 1; doJump(false); return;
    }
  }

  // ── Slide countdown ──
  if (p.sliding) {
    p.slideTimer -= dt;
    if (p.slideTimer <= 0) p.sliding = false;
  }

  // ── Variable jump gravity ──
  const grav = (p.jumpHeld && p.vy < 0) ? CFG.GRAVITY_HOLD : CFG.GRAVITY;
  p.vy = Math.min(p.vy + grav * dt, CFG.MAX_FALL_SPEED);
  p.y += p.vy * dt;

  // ── Squash/stretch ease back ──
  p.squash  += (1 - p.squash)  * 0.18;
  p.stretch += (1 - p.stretch) * 0.18;

  // ── Ground collision (main floor) ──
  const effH = p.sliding ? CFG.PLAYER_SLIDE_H : p.h;
  const inGap = isOverGap(p.x + p.w/2);

  if (!inGap && p.y + effH >= GROUND_Y) {
    const wasAir = !p.wasOnGround;
    p.y = GROUND_Y - effH;
    p.vy = 0;
    p.isOnGround = true;
    p.jumpsLeft = 2;
    p.coyoteFrames = CFG.COYOTE_FRAMES;

    if (wasAir) {
      playSound('land');
      spawnParticles(p.x + p.w/2, GROUND_Y, 'land');
      // Landing squash
      p.squash = 1.35; p.stretch = 0.75;
      // Screen shake
      screenShake(4);
    }
  } else if (inGap || p.y + effH < GROUND_Y) {
    p.isOnGround = false;
  }

  p.wasOnGround = p.isOnGround;

  // ── Running animation ──
  if (p.isOnGround && !p.sliding) {
    p.legAngle += 0.22 * (gameSpeed / CFG.SPEED_START) * (dt / 16);
  }

  // ── Trail particles ──
  const trailId = SAVE.get('trail');
  if (trailId !== 'none' && SAVE.isUnlocked(trailId)) {
    p.trailTimer -= dt;
    if (p.trailTimer <= 0) {
      p.trailTimer = 35 - gameSpeed * 1.5;
      spawnParticles(p.x, p.y + p.h * 0.6, 'trail_' + trailId);
    }
  }

  // ── Coin magnet ──
  if (sessionBoosts.magnet) {
    worldCoins.forEach(c => {
      const dx = (p.x + p.w/2) - c.x;
      const dy = (p.y + p.h/2) - c.y;
      const dist = Math.sqrt(dx*dx + dy*dy);
      if (dist < 200) {
        c.x += dx * 0.07;
        c.y += dy * 0.07;
      }
    });
  }

  // ── Fall off screen ──
  if (p.y > H + 100) triggerDeath();
}

function drawPlayer() {
  const p = PLAYER;
  if (gameState === 'dead' && deathShakeTimer <= 0) return;

  ctx.save();
  ctx.translate(p.x + p.w/2 + p.shakeX + camShakeX, p.y + p.shakeY + camShakeY);
  ctx.scale(p.stretch, p.squash);

  // Glow effect for premium skins
  if (p.skinGlow) {
    ctx.shadowColor = p.skinGlow;
    ctx.shadowBlur  = 18;
  }

  ctx.fillStyle = p.skinColor;

  if (p.sliding) {
    _drawSlide(p);
  } else {
    _drawRun(p);
  }

  // Shield visual
  if (p.shielded) {
    ctx.shadowBlur = 0;
    ctx.strokeStyle = 'rgba(0,229,255,0.6)';
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(0, 0, p.w * 0.9, 0, Math.PI*2); ctx.stroke();
  }

  ctx.shadowBlur = 0;
  ctx.restore();
}

function _drawRun(p) {
  const w = p.w, h = p.h;
  const half = h / 2;

  // Head
  ctx.beginPath();
  ctx.arc(0, -half + h*0.1, w*0.24, 0, Math.PI*2);
  ctx.fill();

  // Torso
  _rrect(-w*0.27, -half + h*0.19, w*0.54, h*0.34, 4);
  ctx.fill();

  // Legs
  const legLen = h * 0.42, legW = w * 0.17;
  const hipY = -half + h * 0.52;
  _drawLimb(-w*0.1, hipY, legLen, Math.sin(p.legAngle) * 0.55, legW);
  _drawLimb( w*0.1, hipY, legLen, Math.sin(p.legAngle + Math.PI) * 0.55, legW);

  // Arms
  const armLen = h * 0.30, armW = w * 0.13;
  const shouldY = -half + h * 0.26;
  _drawLimb(-w*0.24, shouldY, armLen, Math.sin(p.legAngle + Math.PI) * 0.42, armW);
  _drawLimb( w*0.24, shouldY, armLen, Math.sin(p.legAngle) * 0.42, armW);
}

function _drawSlide(p) {
  const w = p.w, sh = CFG.PLAYER_SLIDE_H;
  _rrect(-w*0.5, -sh*0.5, w * 1.1, sh * 0.7, 8); ctx.fill();
  ctx.beginPath(); ctx.arc(w*0.35, -sh*0.1, sh*0.37, 0, Math.PI*2); ctx.fill();
}

function _drawLimb(sx, sy, len, angle, thick) {
  ctx.save(); ctx.translate(sx, sy); ctx.rotate(angle);
  _rrect(-thick/2, 0, thick, len, thick/2); ctx.fill();
  ctx.restore();
}

function _rrect(x, y, w, h, r) {
  if (ctx.roundRect) {
    ctx.beginPath(); ctx.roundRect(x, y, w, h, r);
  } else {
    ctx.beginPath();
    ctx.moveTo(x+r, y); ctx.lineTo(x+w-r, y);
    ctx.quadraticCurveTo(x+w, y, x+w, y+r);
    ctx.lineTo(x+w, y+h-r);
    ctx.quadraticCurveTo(x+w, y+h, x+w-r, y+h);
    ctx.lineTo(x+r, y+h);
    ctx.quadraticCurveTo(x, y+h, x, y+h-r);
    ctx.lineTo(x, y+r);
    ctx.quadraticCurveTo(x, y, x+r, y);
    ctx.closePath();
  }
}

/* ────────────────────────────────────────────────────────────────
   §8  OBSTACLES
───────────────────────────────────────────────────────────────── */
let obstacles  = [];
let spawnTimer = 0;
let gapActive  = false;
let lastObstacleType = '';

function resetObstacles() {
  obstacles = [];
  spawnTimer = 80;
  gapActive  = false;
  lastObstacleType = '';
}

function isOverGap(px) {
  return obstacles.some(o => o.type === 'gap' && px > o.x && px < o.x + o.w);
}

function spawnObstacle() {
  // Weighted random — gaps less frequent
  const roll = Math.random();
  let type;
  if      (roll < 0.38) type = 'spikes';
  else if (roll < 0.70) type = 'barrier';
  else                   type = 'gap';

  // Prevent double-gap
  if (type === 'gap' && (gapActive || lastObstacleType === 'gap')) type = 'spikes';

  lastObstacleType = type;
  const o = { type, x: W + 80, dead: false, passed: false };

  if (type === 'spikes') {
    const count = 1 + Math.floor(Math.random() * 3);
    o.count = count; o.w = count * 28; o.h = 26;
    o.y = GROUND_Y - o.h;

  } else if (type === 'barrier') {
    o.w = 18;
    o.h = 55 + Math.random() * 35;
    // gap: 'bottom' means player must jump; 'top' means player must slide
    o.gap = Math.random() < 0.5 ? 'bottom' : 'top';
    o.movePhase = Math.random() * Math.PI * 2;
    o.moveY = 0;
    o.y = (o.gap === 'bottom') ? GROUND_Y - o.h : GROUND_Y - o.h * 1.55;

  } else if (type === 'gap') {
    o.w = 95 + Math.random() * 85;
    o.y = GROUND_Y;
    gapActive = true;
  }

  obstacles.push(o);

  // Maybe spawn coins above obstacle
  if (Math.random() < CFG.COIN_SPAWN_CHANCE) spawnCoinsNear(o);
}

function updateObstacles(dt) {
  spawnTimer -= dt;
  if (spawnTimer <= 0) {
    spawnObstacle();
    const base = Math.max(CFG.SPAWN_MIN_GAP, CFG.SPAWN_BASE - gameSpeed * 8);
    spawnTimer = base + Math.random() * 55;
  }

  for (let i = obstacles.length - 1; i >= 0; i--) {
    const o = obstacles[i];
    o.x -= gameSpeed * (slowMoActive ? CFG.SLOW_MO_SCALE : 1) * (dt / 16);

    if (o.type === 'barrier') {
      o.movePhase += 0.038 * dt / 16;
      o.moveY = Math.sin(o.movePhase) * 24;
    }

    // Perfect-jump detection: player just passed a close obstacle
    if (!o.passed && !o.dead) {
      const px = PLAYER.x + PLAYER.w;
      if (px > o.x && px < o.x + (o.w||30) + CFG.PERFECT_WINDOW) {
        // Player is in the perfect window just before/at obstacle
        if (!PLAYER.isOnGround && PLAYER.vy < 0) {
          // Rising over obstacle — perfect timing!
          triggerPerfectJump(o);
          o.passed = true;
        }
      }
      if (px >= o.x + (o.w||30) + CFG.PERFECT_WINDOW) {
        o.passed = true; // window closed without perfect
      }
    }

    if (o.x + (o.w || 120) < -100) {
      if (o.type === 'gap') gapActive = false;
      obstacles.splice(i, 1);
    }
  }
}

function drawObstacles() {
  obstacles.forEach(o => {
    if (o.type === 'spikes')  _drawSpikes(o);
    if (o.type === 'barrier') _drawBarrier(o);
    if (o.type === 'gap')     _drawGap(o);
  });
}

function _drawSpikes(o) {
  const sw = o.w / o.count;
  for (let i = 0; i < o.count; i++) {
    const sx = o.x + i * sw;
    ctx.beginPath();
    ctx.moveTo(sx + sw*0.1, GROUND_Y);
    ctx.lineTo(sx + sw/2, o.y);
    ctx.lineTo(sx + sw*0.9, GROUND_Y);
    ctx.closePath();
    ctx.fillStyle = '#c0392b'; ctx.fill();
    // Glow
    ctx.shadowColor = '#ff2200'; ctx.shadowBlur = 10;
    ctx.strokeStyle = '#e74c3c'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(sx + sw*0.34, GROUND_Y - 5); ctx.lineTo(sx + sw/2, o.y+3); ctx.stroke();
    ctx.shadowBlur = 0;
  }
}

function _drawBarrier(o) {
  const ry = o.y + o.moveY;
  const gr = ctx.createLinearGradient(o.x, 0, o.x + o.w, 0);
  gr.addColorStop(0, '#ff6b2b'); gr.addColorStop(1, '#e84393');
  ctx.fillStyle = gr;
  _rrect(o.x, ry, o.w, o.h, 4); ctx.fill();

  // Stripe decoration
  ctx.save();
  ctx.beginPath(); _rrect(o.x, ry, o.w, o.h, 4); ctx.clip();
  ctx.strokeStyle = 'rgba(255,255,255,0.13)'; ctx.lineWidth = 7;
  for (let yy = ry - o.h; yy < ry + o.h*2; yy += 16) {
    ctx.beginPath(); ctx.moveTo(o.x-2, yy); ctx.lineTo(o.x + o.w+2, yy+16); ctx.stroke();
  }
  ctx.restore();

  ctx.shadowColor = '#ff6b2b'; ctx.shadowBlur = 16;
  _rrect(o.x, ry, o.w, o.h, 4); ctx.fill();
  ctx.shadowBlur = 0;
}

function _drawGap(o) {
  ctx.fillStyle = '#030508';
  ctx.fillRect(o.x, GROUND_Y, o.w, H - GROUND_Y);
  // Void abyss gradient
  const vg = ctx.createLinearGradient(o.x, GROUND_Y, o.x, GROUND_Y + 80);
  vg.addColorStop(0,'rgba(20,30,120,0.6)'); vg.addColorStop(1,'rgba(0,0,0,0)');
  ctx.fillStyle = vg; ctx.fillRect(o.x, GROUND_Y, o.w, 80);
  // Thin glowing edge lines
  ctx.strokeStyle='rgba(58,74,255,0.5)'; ctx.lineWidth=2;
  ctx.beginPath(); ctx.moveTo(o.x, GROUND_Y); ctx.lineTo(o.x, H); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(o.x+o.w, GROUND_Y); ctx.lineTo(o.x+o.w, H); ctx.stroke();
}

/* ────────────────────────────────────────────────────────────────
   §9  WORLD COINS
───────────────────────────────────────────────────────────────── */
let worldCoins = [];

function spawnCoinsNear(obstacle) {
  // Float 3-5 coins in an arc above the obstacle
  const count = 3 + Math.floor(Math.random() * 3);
  const cx = obstacle.x + (obstacle.w || 30) / 2;
  for (let i = 0; i < count; i++) {
    worldCoins.push({
      x: cx + (i - count/2) * 26,
      y: GROUND_Y - 80 - Math.random() * 50,
      r: 7,
      collected: false,
      bobPhase: Math.random() * Math.PI * 2,
    });
  }
}

function updateCoins(dt) {
  const px = PLAYER.x, py = PLAYER.y;
  const effH = PLAYER.sliding ? CFG.PLAYER_SLIDE_H : PLAYER.h;

  for (let i = worldCoins.length - 1; i >= 0; i--) {
    const c = worldCoins[i];
    c.x -= gameSpeed * (slowMoActive ? CFG.SLOW_MO_SCALE : 1) * (dt / 16);
    c.bobPhase += 0.06;
    c.y += Math.sin(c.bobPhase) * 0.4; // gentle bob

    // Collect
    if (!c.collected) {
      if (c.x > px - 10 && c.x < px + PLAYER.w + 10 &&
          c.y > py - 10 && c.y < py + effH + 10) {
        c.collected = true;
        coinsThisRun++;
        score += CFG.SCORE_PER_COIN;
        playSound('coin');
        spawnParticles(c.x, c.y, 'coin');
        updateHUD();
      }
    }

    if (c.x < -20 || c.collected) worldCoins.splice(i, 1);
  }
}

function drawCoins() {
  worldCoins.forEach(c => {
    if (c.collected) return;
    // Coin body
    ctx.save();
    ctx.shadowColor = '#ffd700'; ctx.shadowBlur = 10;
    ctx.fillStyle = '#ffd700';
    ctx.beginPath(); ctx.arc(c.x, c.y, c.r, 0, Math.PI*2); ctx.fill();
    // Inner shine
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#ffe566';
    ctx.beginPath(); ctx.arc(c.x - 2, c.y - 2, c.r * 0.45, 0, Math.PI*2); ctx.fill();
    ctx.restore();
  });
}

/* ────────────────────────────────────────────────────────────────
   §10  PARTICLES
───────────────────────────────────────────────────────────────── */
let particles = [];

/**
 * Spawn particles at (x, y) of a given kind.
 * Kinds: 'land','jump','dbjump','slide','coin','hit',
 *        'trail_dust','trail_fire','trail_neon','trail_smoke'
 */
function spawnParticles(x, y, kind) {
  const defs = {
    land:       { n:10, vx:2.5,  vy:2.5, life:1, decay:0.04, r:[2,4], col:()=>'#4a5a9a' },
    jump:       { n:7,  vx:3,    vy:3,   life:1, decay:0.045,r:[2,4], col:()=>'#ffd166' },
    dbjump:     { n:9,  vx:3.5,  vy:3.5, life:1, decay:0.04, r:[2,5], col:()=>`hsl(${Math.random()*40+200},80%,70%)` },
    slide:      { n:6,  vx:4,    vy:1.5, life:0.8,decay:0.05,r:[2,3], col:()=>'#8899cc' },
    coin:       { n:6,  vx:3,    vy:3,   life:1, decay:0.055,r:[2,3], col:()=>'#ffd700' },
    hit:        { n:14, vx:5,    vy:5,   life:1, decay:0.035,r:[3,6], col:()=>`hsl(${Math.random()*30},90%,55%)` },
    trail_dust: { n:2,  vx:1.5,  vy:1,   life:0.7,decay:0.06,r:[2,4], col:()=>'rgba(140,150,200,0.7)' },
    trail_fire: { n:3,  vx:1.5,  vy:2,   life:0.6,decay:0.07,r:[2,5], col:()=>`hsl(${Math.random()*40+10},100%,60%)` },
    trail_neon: { n:2,  vx:2,    vy:1.5, life:0.8,decay:0.07,r:[2,4], col:()=>`hsl(${Math.random()*60+160},100%,65%)` },
    trail_smoke:{ n:3,  vx:1,    vy:1.5, life:0.9,decay:0.04,r:[3,7], col:()=>'rgba(80,80,100,0.4)' },
  };
  const d = defs[kind];
  if (!d) return;

  for (let i = 0; i < d.n; i++) {
    particles.push({
      x, y,
      vx: (Math.random()-0.5) * d.vx * 2,
      vy: -(Math.random() * d.vy + 0.5),
      life: d.life, decay: d.decay,
      r: d.r[0] + Math.random() * (d.r[1]-d.r[0]),
      color: d.col(),
    });
  }
}

function updateParticles(dt) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.x += p.vx * (dt/16); p.y += p.vy * (dt/16);
    p.vy += 0.12 * (dt/16);
    p.life -= p.decay * (dt/16);
    if (p.life <= 0) particles.splice(i, 1);
  }
}

function drawParticles() {
  particles.forEach(p => {
    ctx.globalAlpha = Math.max(0, p.life);
    ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI*2);
    ctx.fillStyle = p.color; ctx.fill();
  });
  ctx.globalAlpha = 1;
}

/* ────────────────────────────────────────────────────────────────
   §11  COLLISION
───────────────────────────────────────────────────────────────── */
function getPlayerBox() {
  const p = PLAYER, inset = 5;
  const effH = p.sliding ? CFG.PLAYER_SLIDE_H : p.h;
  return { x:p.x+inset, y:p.y+inset, x2:p.x+p.w-inset, y2:p.y+effH-inset };
}

function rectsOverlap(a,b) { return a.x<b.x2 && a.x2>b.x && a.y<b.y2 && a.y2>b.y; }

function checkCollisions() {
  const pb = getPlayerBox();
  for (const o of obstacles) {
    if (o.type === 'spikes') {
      const hb = { x:o.x+4, y:o.y+6, x2:o.x+o.w-4, y2:GROUND_Y };
      if (rectsOverlap(pb, hb)) { hitObstacle(); return; }

    } else if (o.type === 'barrier') {
      const ry = o.y + o.moveY;
      const hb = { x:o.x, y:ry, x2:o.x+o.w, y2:ry+o.h };
      if (rectsOverlap(pb, hb)) { hitObstacle(); return; }
    }
  }
}

function hitObstacle() {
  if (PLAYER.shielded) {
    // Shield absorbs one hit
    PLAYER.shielded = false;
    screenShake(8);
    spawnParticles(PLAYER.x + PLAYER.w/2, PLAYER.y + PLAYER.h/2, 'hit');
    playSound('hit');
    return;
  }
  triggerDeath();
}

/* ────────────────────────────────────────────────────────────────
   §12  SLOW MOTION + PERFECT JUMP
───────────────────────────────────────────────────────────────── */
let slowMoActive = false;
let slowMoTimer  = 0;

function triggerPerfectJump(obstacle) {
  score += CFG.PERFECT_BONUS;
  playSound('perfect');
  showPerfectBanner();
  slowMoActive = true;
  slowMoTimer  = CFG.SLOW_MO_FRAMES;
  spawnParticles(PLAYER.x + PLAYER.w/2, PLAYER.y, 'dbjump');
}

function updateSlowMo(dt) {
  if (!slowMoActive) return;
  slowMoTimer -= dt;
  if (slowMoTimer <= 0) { slowMoActive = false; slowMoTimer = 0; }
  // Update the HUD slow-mo bar
  const fill = document.getElementById('slowMoFill');
  if (fill) fill.style.width = Math.max(0, (slowMoTimer / CFG.SLOW_MO_FRAMES) * 100) + '%';
}

function showPerfectBanner() {
  const el = document.getElementById('perfectBanner');
  if (!el) return;
  el.textContent = '✦ PERFECT +' + CFG.PERFECT_BONUS;
  el.classList.add('show');
  clearTimeout(showPerfectBanner._t);
  showPerfectBanner._t = setTimeout(() => el.classList.remove('show'), 1200);
}

/* ────────────────────────────────────────────────────────────────
   CAMERA SHAKE
───────────────────────────────────────────────────────────────── */
let camShakeX = 0, camShakeY = 0, camShakeMag = 0;

function screenShake(mag) { camShakeMag = Math.max(camShakeMag, mag); }

function updateCamShake(dt) {
  if (camShakeMag > 0) {
    camShakeX = (Math.random()-0.5) * camShakeMag * 2;
    camShakeY = (Math.random()-0.5) * camShakeMag * 2;
    camShakeMag -= 0.9 * (dt/16);
    if (camShakeMag < 0.1) { camShakeMag = 0; camShakeX = 0; camShakeY = 0; }
  }
}

/* ────────────────────────────────────────────────────────────────
   §13  GAME LOOP
───────────────────────────────────────────────────────────────── */
let gameState    = 'start';
let score        = 0;
let coinsThisRun = 0;
let gameSpeed    = CFG.SPEED_START;
let frameCount   = 0;
let lastTs       = 0;
let deathShakeTimer = 0;

// Per-run session boosts
const sessionBoosts = { magnet: false, shield: false, x2coins: false };

function startGame() {
  score        = 0;
  coinsThisRun = 0;
  gameSpeed    = CFG.SPEED_START;
  frameCount   = 0;
  lastTs       = 0;
  deathShakeTimer = 0;
  slowMoActive = false;
  slowMoTimer  = 0;
  camShakeMag  = 0; camShakeX = 0; camShakeY = 0;
  worldCoins   = [];
  particles    = [];
  sessionBoosts.magnet = false;
  sessionBoosts.shield = false;
  sessionBoosts.x2coins = false;

  resetObstacles();
  initPlayer();
  BG.timeOfDay = 0;

  // Apply purchased boosts for this run
  // (in a real game, deduct from inventory here)
  startMusic();
  gameState = 'playing';
  showScreen('hud');
  updateHUD();
}

function triggerDeath() {
  if (gameState !== 'playing') return;
  gameState = 'dead';
  playSound('hit');
  stopMusic();
  spawnParticles(PLAYER.x + PLAYER.w/2, PLAYER.y + PLAYER.h/2, 'hit');
  screenShake(14);
  deathShakeTimer = 30;

  // Persist score + coins
  const hs = SAVE.get('hiScore');
  if (score > hs) SAVE.set('hiScore', score);
  const earned = sessionBoosts.x2coins ? coinsThisRun * 2 : coinsThisRun;
  SAVE.addCoins(earned);

  setTimeout(() => showScreen('gameover'), 700);
}

function gameLoop(ts) {
  requestAnimationFrame(gameLoop);

  const rawDt = lastTs ? Math.min(ts - lastTs, 50) : 16; // cap dt at 50ms
  lastTs = ts;
  // Apply slow-mo to game dt
  const dt = slowMoActive ? rawDt * CFG.SLOW_MO_SCALE : rawDt;

  ctx.clearRect(0, 0, W, H);

  /* ── Update ── */
  if (gameState === 'start') {
    BG.update(rawDt);
    BG.draw();
    return;
  }

  if (gameState === 'playing') {
    frameCount++;
    // Smooth speed ramp
    gameSpeed = Math.min(CFG.SPEED_MAX, gameSpeed + CFG.SPEED_RAMP * dt);
    // Milestone burst
    if (score > 0 && score % 500 === 0) gameSpeed = Math.min(CFG.SPEED_MAX, gameSpeed + CFG.SPEED_MILESTONE);

    // Score tick
    if (frameCount % CFG.SCORE_RATE === 0) { score++; updateHUD(); }

    BG.update(rawDt);
    updatePlayer(dt);
    updateObstacles(dt);
    updateCoins(dt);
    updateParticles(dt);
    updateSlowMo(rawDt);
    updateCamShake(rawDt);
    checkCollisions();
  }

  if (gameState === 'dead') {
    BG.update(rawDt);
    updateParticles(rawDt);
    deathShakeTimer -= rawDt / 16;
    if (deathShakeTimer > 0) {
      PLAYER.shakeX = (Math.random()-0.5) * deathShakeTimer * 0.6;
      PLAYER.shakeY = (Math.random()-0.5) * deathShakeTimer * 0.6;
    }
    updateCamShake(rawDt);
  }

  /* ── Draw ── */
  // Camera shake applied via ctx.translate
  ctx.save();
  ctx.translate(camShakeX, camShakeY);

  BG.draw();
  drawObstacles();
  drawCoins();
  drawParticles();
  drawPlayer();

  // Motion blur overlay at high speed
  if (gameState === 'playing' && gameSpeed > 10) {
    const blurAlpha = Math.min(0.06, (gameSpeed - 10) * 0.01);
    ctx.fillStyle = `rgba(0,0,0,${blurAlpha})`;
    ctx.fillRect(-camShakeX, -camShakeY, W, H);
  }

  ctx.restore();
}

/* ────────────────────────────────────────────────────────────────
   §14  UI / INPUT
───────────────────────────────────────────────────────────────── */

/* ── Screen management ── */
const $ss  = document.getElementById('startScreen');
const $go  = document.getElementById('gameOverScreen');
const $sto = document.getElementById('storeScreen');
const $hud = document.getElementById('hud');

function showScreen(which) {
  $ss.classList.remove('active');
  $go.classList.remove('active');
  $sto.classList.remove('active');
  $hud.style.display = 'none';

  if (which === 'start') {
    $ss.classList.add('active');
    document.getElementById('startHs').textContent    = SAVE.get('hiScore');
    document.getElementById('startCoins').textContent = SAVE.get('coins');
    buildSkinRow();

  } else if (which === 'gameover') {
    $go.classList.add('active');
    document.getElementById('finalScore').textContent  = score;
    document.getElementById('finalHs').textContent     = SAVE.get('hiScore');
    const earned = sessionBoosts.x2coins ? coinsThisRun * 2 : coinsThisRun;
    document.getElementById('finalCoins').textContent  = earned;
    if (score >= SAVE.get('hiScore')) {
      document.getElementById('finalHs').classList.add('new-hs');
    } else {
      document.getElementById('finalHs').classList.remove('new-hs');
    }

  } else if (which === 'store') {
    $sto.classList.add('active');
    document.getElementById('storeCoinCount').textContent = SAVE.get('coins');
    buildStore();

  } else if (which === 'hud') {
    $hud.style.display = 'block';
    updateHUD();
  }
}

function updateHUD() {
  const sd = document.getElementById('scoreDisplay');
  if (sd) {
    sd.textContent = score;
    sd.style.transform = 'scale(1.13)';
    clearTimeout(updateHUD._t);
    updateHUD._t = setTimeout(() => sd.style.transform = 'scale(1)', 80);
  }
  const cc = document.getElementById('coinCount');
  if (cc) cc.textContent = coinsThisRun;
  const sv = document.getElementById('speedVal');
  if (sv) sv.textContent = (gameSpeed / CFG.SPEED_START).toFixed(1);
  const hh = document.getElementById('hudHs');
  if (hh) hh.textContent = SAVE.get('hiScore');
}

/* ── Skin row on start screen ── */
function buildSkinRow() {
  const row = document.getElementById('startSkinRow');
  if (!row) return;
  row.innerHTML = '';
  const equippedSkin = SAVE.get('skin');
  SKINS.forEach(sk => {
    const el = document.createElement('div');
    el.className = 'skin-swatch' + (sk.id === equippedSkin ? ' selected' : '');
    el.title = sk.name;
    el.innerHTML = sk.icon;
    el.style.background = sk.glow
      ? `radial-gradient(circle, ${sk.glow}44 0%, ${sk.color}88 100%)`
      : sk.color;
    if (!SAVE.isUnlocked(sk.id)) el.style.opacity = '0.35';
    el.addEventListener('click', () => {
      if (!SAVE.isUnlocked(sk.id)) return;
      SAVE.set('skin', sk.id);
      buildSkinRow();
    });
    row.appendChild(el);
  });
}

/* ── Store ── */
function buildStore() {
  buildStoreGrid('skinGrid', SKINS, 'skin');
  buildStoreGrid('trailGrid', TRAILS, 'trail');
  buildBoostGrid();
  document.getElementById('storeCoinCount').textContent = SAVE.get('coins');
}

function buildStoreGrid(containerId, items, equipKey) {
  const grid = document.getElementById(containerId);
  if (!grid) return;
  grid.innerHTML = '';
  const equipped = SAVE.get(equipKey);

  items.forEach(item => {
    const owned    = SAVE.isUnlocked(item.id);
    const isEq     = item.id === equipped;
    const el = document.createElement('div');
    el.className = 'store-item' + (owned ? ' owned' : ' locked') + (isEq ? ' equipped' : '');

    const badge = isEq ? '<div class="si-badge">EQUIPPED</div>'
      : owned ? '<div class="si-badge owned-badge">OWNED</div>'
      : `<div class="si-price">💰 ${item.price}</div>`;

    el.innerHTML = `
      <div class="si-icon">${item.icon}</div>
      <div class="si-name">${item.name}</div>
      ${badge}`;

    el.addEventListener('click', () => {
      if (owned) {
        SAVE.set(equipKey, item.id);
        buildStore();
      } else {
        // Try to buy
        if (SAVE.get('coins') >= item.price) {
          SAVE.addCoins(-item.price);
          SAVE.unlock(item.id);
          SAVE.set(equipKey, item.id);
          buildStore();
        } else {
          el.style.animation = 'shakeAnim .3s ease';
          setTimeout(() => el.style.animation = '', 400);
        }
      }
    });
    grid.appendChild(el);
  });
}

function buildBoostGrid() {
  const grid = document.getElementById('boostGrid');
  if (!grid) return;
  grid.innerHTML = '';
  BOOSTS.forEach(b => {
    const el = document.createElement('div');
    el.className = 'store-item';
    el.innerHTML = `
      <div class="si-icon">${b.icon}</div>
      <div class="si-name">${b.name}</div>
      <div class="si-price" style="font-size:10px">${b.desc}</div>
      <div class="si-price">💰 ${b.price}/run</div>`;
    el.addEventListener('click', () => {
      if (SAVE.get('coins') >= b.price) {
        SAVE.addCoins(-b.price);
        // Activate for next run
        if (b.id === 'boost_magnet') sessionBoosts.magnet = true;
        if (b.id === 'boost_shield') sessionBoosts.shield = true;
        buildStore();
      }
    });
    grid.appendChild(el);
  });
}

/* ── Input ── */
const keys = {};
document.addEventListener('keydown', e => {
  if (keys[e.code]) return;
  keys[e.code] = true;
  if (gameState === 'playing') {
    if (['Space','ArrowUp','KeyW'].includes(e.code)) { e.preventDefault(); tryJump(); }
    if (['ArrowDown','KeyS'].includes(e.code))       { e.preventDefault(); trySlide(); }
  }
  // Release jump key means variable jump ends
  if (e.code === 'Space' || e.code === 'ArrowUp') PLAYER.jumpHeld = true;
});
document.addEventListener('keyup', e => {
  keys[e.code] = false;
  if (['Space','ArrowUp','KeyW'].includes(e.code)) PLAYER.jumpHeld = false;
});

// Touch
let touchY0 = 0;
document.addEventListener('touchstart', e => {
  touchY0 = e.touches[0].clientY;
  if (gameState === 'playing') tryJump();
}, { passive: true });
document.addEventListener('touchend', e => {
  PLAYER.jumpHeld = false;
  if (e.changedTouches[0].clientY - touchY0 > 50 && gameState === 'playing') trySlide();
}, { passive: true });

/* ── Button wiring ── */
document.getElementById('startBtn').onclick = () => startGame();
document.getElementById('storeBtn').onclick = () => showScreen('store');
document.getElementById('storeCloseBtn').onclick = () => showScreen('start');
document.getElementById('restartBtn').onclick   = () => startGame();
document.getElementById('goStoreBtn').onclick   = () => showScreen('store');

/* ────────────────────────────────────────────────────────────────
   §15  MONETISATION HOOKS (mock — ready for real SDK)
───────────────────────────────────────────────────────────────── */

/**
 * CONTINUE (watch-ad) — grants the player one more life.
 * Replace mockShowAd() with your real ad SDK call.
 */
document.getElementById('watchAdBtn').onclick = () => {
  mockShowAd(() => {
    // Called when ad completes
    $go.classList.remove('active');
    // Respawn player in same position, clear nearby obstacles
    obstacles = obstacles.filter(o => o.x < PLAYER.x - 200);
    PLAYER.y = GROUND_Y - PLAYER.h;
    PLAYER.vy = 0;
    PLAYER.isOnGround = true;
    PLAYER.jumpsLeft = 2;
    PLAYER.shielded = true; // grace period
    gameState = 'playing';
    showScreen('hud');
    startMusic();
  });
};

/**
 * DOUBLE COINS — doubles coins earned this run.
 * Replace mockShowAd() with real SDK.
 */
document.getElementById('dblCoinsBtn').onclick = () => {
  const btn = document.getElementById('dblCoinsBtn');
  if (btn.dataset.used === '1') return;
  mockShowAd(() => {
    btn.dataset.used = '1';
    const bonus = coinsThisRun; // double
    SAVE.addCoins(bonus);
    document.getElementById('finalCoins').textContent = coinsThisRun * 2;
    btn.textContent = '✓ COINS DOUBLED!';
    btn.style.opacity = '0.5';
  });
};

/**
 * mockShowAd — simulates a rewarded ad with a 2-second "loading" delay.
 * In production: replace with AdMob / Unity Ads / IronSource callback.
 * @param {Function} onComplete — called when ad is "watched"
 */
function mockShowAd(onComplete) {
  const overlay = document.createElement('div');
  overlay.style.cssText = `
    position:fixed;inset:0;background:rgba(0,0,0,.85);
    display:flex;flex-direction:column;align-items:center;justify-content:center;
    z-index:9999;font-family:'Share Tech Mono',monospace;color:#fff;gap:16px;
  `;
  let secs = 5;
  overlay.innerHTML = `
    <div style="font-size:14px;letter-spacing:3px;color:#00e5ff;">📺 SIMULATED AD</div>
    <div style="font-family:'Bebas Neue',sans-serif;font-size:64px;color:#ffd166;" id="_adCnt">${secs}</div>
    <div style="font-size:11px;color:rgba(255,255,255,.5)">Watching ad… (mock)</div>
  `;
  document.body.appendChild(overlay);
  const iv = setInterval(() => {
    secs--;
    const el = document.getElementById('_adCnt');
    if (el) el.textContent = secs;
    if (secs <= 0) {
      clearInterval(iv);
      document.body.removeChild(overlay);
      onComplete();
    }
  }, 1000);
}

/* ────────────────────────────────────────────────────────────────
   BOOTSTRAP
───────────────────────────────────────────────────────────────── */
SAVE.load();
resizeCanvas();
showScreen('start');
requestAnimationFrame(gameLoop);
