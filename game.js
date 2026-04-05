/*
 * game.js
 * Shadow Parkour: high-performance endless 2D runner.
 * No external dependencies. Modularized into Physics, Audio, Renderer, and Game classes.
 */
(function () {
  'use strict';

  const CONFIG = {
    gravity: 2350,
    jumpVelocity: -780,
    doubleJumpVelocity: -720,
    terminalVelocity: 1450,
    baseSpeed: 360,
    maxSpeed: 860,
    speedRampPerSecond: 11,
    obstacleMinDistance: 260,
    obstacleMaxDistance: 640,
    coinChancePerSpawn: 0.75,
    perfectWindowPx: 46,
    perfectSlowMoDuration: 0.22,
    perfectSlowMoScale: 0.5,
    worldHeight: 720,
    groundY: 600,
    scorePerSecond: 14,
    maxEntities: {
      particles: 500,
      ghost: 30,
      obstacles: 20,
      coins: 120
    },
    evolutionScoreThreshold: 350,
    impactShakeMs: 250,
    beatFlashMax: 0.35
  };

  function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
  }

  function rand(min, max) {
    return min + Math.random() * (max - min);
  }

  function pick(arr) {
    return arr[(Math.random() * arr.length) | 0];
  }

  class Pool {
    constructor(factory, max) {
      this.factory = factory;
      this.max = max;
      this.items = [];
      this.free = [];
      for (let i = 0; i < max; i += 1) {
        const item = factory();
        item.active = false;
        this.items.push(item);
        this.free.push(item);
      }
    }

    acquire() {
      const item = this.free.pop();
      if (!item) return null;
      item.active = true;
      return item;
    }

    release(item) {
      if (!item || !item.active) return;
      item.active = false;
      this.free.push(item);
    }

    forEachActive(fn) {
      for (let i = 0; i < this.items.length; i += 1) {
        const it = this.items[i];
        if (it.active) fn(it);
      }
    }
  }

  class Physics {
    static stepPlayer(player, dt) {
      if (!player) return;
      player.vy += CONFIG.gravity * dt;
      player.vy = Math.min(player.vy, CONFIG.terminalVelocity);
      player.y += player.vy * dt;

      if (player.y + player.h >= CONFIG.groundY) {
        player.y = CONFIG.groundY - player.h;
        if (!player.onGround && player.vy > 120) {
          player.justLanded = true;
        }
        player.vy = 0;
        player.onGround = true;
        player.jumpCount = 0;
      } else {
        player.onGround = false;
      }
    }

    static aabb(a, b) {
      if (!a || !b) return false;
      return (
        a.x < b.x + b.w &&
        a.x + a.w > b.x &&
        a.y < b.y + b.h &&
        a.y + a.h > b.y
      );
    }

    static circleRect(circle, rect) {
      if (!circle || !rect) return false;
      const cx = clamp(circle.x, rect.x, rect.x + rect.w);
      const cy = clamp(circle.y, rect.y, rect.y + rect.h);
      const dx = circle.x - cx;
      const dy = circle.y - cy;
      return (dx * dx + dy * dy) <= circle.r * circle.r;
    }
  }

  class AudioEngine {
    constructor() {
      this.context = null;
      this.analyser = null;
      this.source = null;
      this.buffer = null;
      this.isReady = false;
      this.beatEnergy = 0;
      this.flash = 0;
      this._history = new Float32Array(30);
      this._historyPos = 0;
      this._data = null;
      this._nextLyricAt = 0;
      this.lyrics = [
        'Run the skyline',
        'Neon in motion',
        'Pulse of the city',
        'Shadow in flight',
        'Beat hits harder'
      ];
    }

    async init() {
      if (this.context) return;
      const AC = window.AudioContext || window.webkitAudioContext;
      this.context = new AC();
      this.analyser = this.context.createAnalyser();
      this.analyser.fftSize = 512;
      this._data = new Uint8Array(this.analyser.frequencyBinCount);
      this.isReady = true;
    }

    async loadFile(file) {
      if (!file) return;
      await this.init();
      if (!this.context) return;
      const arrayBuffer = await file.arrayBuffer();
      this.buffer = await this.context.decodeAudioData(arrayBuffer.slice(0));
    }

    play() {
      if (!this.context || !this.buffer) return;
      this.stop();
      this.source = this.context.createBufferSource();
      this.source.buffer = this.buffer;
      this.source.loop = true;
      this.source.connect(this.analyser);
      this.analyser.connect(this.context.destination);
      this.source.start(0);
    }

    stop() {
      if (this.source) {
        try { this.source.stop(0); } catch (_) {}
        this.source.disconnect();
        this.source = null;
      }
    }

    resumeContext() {
      if (this.context && this.context.state === 'suspended') {
        this.context.resume();
      }
    }

    update(nowSec) {
      if (!this.analyser || !this._data) {
        this.beatEnergy *= 0.9;
        this.flash *= 0.92;
        return null;
      }

      this.analyser.getByteFrequencyData(this._data);

      let lowBand = 0;
      let allBand = 0;
      const len = this._data.length;
      const lowLen = Math.max(6, Math.floor(len * 0.08));

      for (let i = 0; i < len; i += 1) {
        const v = this._data[i] / 255;
        allBand += v;
        if (i < lowLen) lowBand += v;
      }

      lowBand /= lowLen;
      allBand /= len;

      this._history[this._historyPos] = lowBand;
      this._historyPos = (this._historyPos + 1) % this._history.length;

      let mean = 0;
      for (let i = 0; i < this._history.length; i += 1) mean += this._history[i];
      mean /= this._history.length;

      const beat = lowBand > mean * 1.26 && lowBand > 0.12;
      this.beatEnergy = allBand;

      if (beat) this.flash = CONFIG.beatFlashMax;
      this.flash *= 0.9;

      if (beat && nowSec > this._nextLyricAt) {
        this._nextLyricAt = nowSec + rand(2.4, 4.2);
        return pick(this.lyrics);
      }
      return null;
    }
  }

  class Renderer {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d', { alpha: false });
      this.width = 0;
      this.height = 0;
      this.dpr = 1;
      this.scale = 1;
      this.screenShakeT = 0;
      this.screenShakePower = 0;
      this.resize();
      window.addEventListener('resize', () => this.resize());
    }

    resize() {
      const w = window.innerWidth;
      const h = window.innerHeight;
      this.dpr = Math.min(2, window.devicePixelRatio || 1);
      this.canvas.width = Math.floor(w * this.dpr);
      this.canvas.height = Math.floor(h * this.dpr);
      this.canvas.style.width = `${w}px`;
      this.canvas.style.height = `${h}px`;
      this.ctx.setTransform(1, 0, 0, 1, 0, 0);
      this.ctx.scale(this.dpr, this.dpr);
      this.width = w;
      this.height = h;
      this.scale = h / CONFIG.worldHeight;
    }

    triggerShake(ms, power) {
      this.screenShakeT = ms / 1000;
      this.screenShakePower = power;
    }

    beginFrame(beatFlash) {
      const ctx = this.ctx;
      if (!ctx) return;

      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

      let ox = 0;
      let oy = 0;
      if (this.screenShakeT > 0) {
        const m = this.screenShakePower * this.screenShakeT * 60;
        ox = rand(-m, m);
        oy = rand(-m, m);
      }
      ctx.translate(ox, oy);

      const bgGrad = ctx.createLinearGradient(0, 0, 0, this.height);
      bgGrad.addColorStop(0, '#101c3d');
      bgGrad.addColorStop(0.5, '#0a1023');
      bgGrad.addColorStop(1, '#03050a');
      ctx.fillStyle = bgGrad;
      ctx.fillRect(-8, -8, this.width + 16, this.height + 16);

      if (beatFlash > 0.001) {
        ctx.fillStyle = `rgba(255, 44, 255, ${beatFlash * 0.5})`;
        ctx.fillRect(0, 0, this.width, this.height);
      }
    }

    drawParallax(game, beatEnergy) {
      const ctx = this.ctx;
      if (!ctx || !game) return;

      const t = game.time;
      const groundScreenY = game.worldToScreenY(CONFIG.groundY);

      // clouds layer
      for (let i = 0; i < 10; i += 1) {
        const x = ((i * 220 - (t * 18) % 2400) % (this.width + 260)) - 130;
        const y = 56 + (i % 3) * 26;
        const w = 110 + (i % 4) * 20;
        const h = 24;
        ctx.fillStyle = `rgba(167,196,255,${0.045 + beatEnergy * 0.02})`;
        ctx.beginPath();
        ctx.ellipse(x, y, w * 0.45, h * 0.55, 0, 0, Math.PI * 2);
        ctx.fill();
      }

      // mountains layer
      ctx.fillStyle = 'rgba(90,110,160,0.18)';
      ctx.beginPath();
      ctx.moveTo(0, groundScreenY);
      for (let i = 0; i <= 9; i += 1) {
        const mx = i * (this.width / 8) - ((t * 42) % (this.width / 8));
        const my = groundScreenY - 140 - (i % 3) * 50;
        ctx.lineTo(mx, my);
      }
      ctx.lineTo(this.width, groundScreenY);
      ctx.closePath();
      ctx.fill();

      // skyline layer
      for (let i = 0; i < 24; i += 1) {
        const bw = 24 + (i % 5) * 12;
        const bx = ((i * 70 - (t * 120) % 2000) % (this.width + 100)) - 20;
        const bh = 110 + (i % 7) * 22;
        const by = groundScreenY - bh;
        ctx.fillStyle = 'rgba(35,57,108,0.55)';
        ctx.fillRect(bx, by, bw, bh);

        if (i % 2 === 0) {
          ctx.fillStyle = `rgba(0,234,255,${0.15 + beatEnergy * 0.2})`;
          for (let wx = bx + 4; wx < bx + bw - 3; wx += 6) {
            for (let wy = by + 6; wy < by + bh - 4; wy += 10) {
              ctx.fillRect(wx, wy, 2, 2);
            }
          }
        }
      }

      // ground
      const g = ctx.createLinearGradient(0, groundScreenY, 0, this.height);
      g.addColorStop(0, '#0a1022');
      g.addColorStop(1, '#020205');
      ctx.fillStyle = g;
      ctx.fillRect(0, groundScreenY, this.width, this.height - groundScreenY);

      ctx.strokeStyle = `rgba(0,234,255,${0.45 + beatEnergy * 0.35})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, groundScreenY + 1);
      ctx.lineTo(this.width, groundScreenY + 1);
      ctx.stroke();
    }

    drawGlowRect(x, y, w, h, color) {
      const ctx = this.ctx;
      if (!ctx) return;
      ctx.save();
      ctx.shadowColor = color;
      ctx.shadowBlur = 22;
      ctx.fillStyle = color;
      ctx.fillRect(x, y, w, h);
      ctx.restore();
    }

    drawPlayer(game) {
      const ctx = this.ctx;
      const p = game.player;
      if (!ctx || !p) return;

      const sx = game.worldToScreenX(p.x);
      const sy = game.worldToScreenY(p.y);
      const sw = p.w * this.scale;
      const sh = p.h * this.scale;

      // motion / ghost trail
      for (let i = game.ghostTrail.length - 1; i >= 0; i -= 1) {
        const g = game.ghostTrail[i];
        if (!g || !g.active) continue;
        const alpha = g.life;
        const gx = game.worldToScreenX(g.x);
        const gy = game.worldToScreenY(g.y);
        ctx.fillStyle = `rgba(0, 234, 255, ${alpha * 0.2})`;
        ctx.fillRect(gx, gy, g.w * this.scale, g.h * this.scale);
      }

      // evolved form: simple stick figure + animation
      if (p.form === 'human') {
        const cx = sx + sw * 0.5;
        const headR = sw * 0.16;
        const anim = p.formAnim;

        ctx.save();
        ctx.strokeStyle = 'rgba(255, 220, 140, 0.95)';
        ctx.lineWidth = 3;
        ctx.shadowColor = '#ffd54f';
        ctx.shadowBlur = 14;

        // head
        ctx.beginPath();
        ctx.arc(cx, sy + sh * 0.2, headR, 0, Math.PI * 2);
        ctx.stroke();

        // body
        ctx.beginPath();
        ctx.moveTo(cx, sy + sh * 0.28);
        ctx.lineTo(cx, sy + sh * 0.66);
        ctx.stroke();

        // arms: dab/high-five animation cycle
        const cycle = Math.sin(anim * 12);
        ctx.beginPath();
        ctx.moveTo(cx, sy + sh * 0.4);
        ctx.lineTo(cx - sw * 0.35, sy + sh * (0.36 + cycle * 0.2));
        ctx.moveTo(cx, sy + sh * 0.4);
        ctx.lineTo(cx + sw * 0.35, sy + sh * (0.36 - cycle * 0.2));
        ctx.stroke();

        // legs
        ctx.beginPath();
        ctx.moveTo(cx, sy + sh * 0.66);
        ctx.lineTo(cx - sw * 0.22, sy + sh * 0.98);
        ctx.moveTo(cx, sy + sh * 0.66);
        ctx.lineTo(cx + sw * 0.24, sy + sh * 0.98);
        ctx.stroke();

        ctx.restore();
      } else {
        this.drawGlowRect(sx, sy, sw, sh, '#00eaff');
      }
    }

    drawObstacles(game) {
      const ctx = this.ctx;
      if (!ctx || !game) return;
      game.obstacles.forEach((o) => {
        if (!o || !o.active) return;
        const x = game.worldToScreenX(o.x);
        const y = game.worldToScreenY(o.y);
        const w = o.w * this.scale;
        const h = o.h * this.scale;

        const color = o.kind === 'small' ? '#ff5d5d' : o.kind === 'tall' ? '#ff2cff' : '#8f5bff';
        this.drawGlowRect(x, y, w, h, color);
      });
    }

    drawCoins(game) {
      const ctx = this.ctx;
      if (!ctx || !game) return;
      game.coins.forEach((c) => {
        if (!c || !c.active) return;
        const x = game.worldToScreenX(c.x);
        const y = game.worldToScreenY(c.y);
        const r = c.r * this.scale;
        ctx.save();
        ctx.shadowColor = '#ffd54f';
        ctx.shadowBlur = 14;
        ctx.fillStyle = '#ffd54f';
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      });
    }

    drawParticles(game) {
      const ctx = this.ctx;
      if (!ctx || !game) return;
      game.particlePool.forEachActive((p) => {
        const x = game.worldToScreenX(p.x);
        const y = game.worldToScreenY(p.y);
        const s = p.size * this.scale;
        ctx.fillStyle = `rgba(${p.cr}, ${p.cg}, ${p.cb}, ${clamp(p.life / p.maxLife, 0, 1)})`;
        ctx.fillRect(x, y, s, s);
      });
    }

    endFrame(dt) {
      if (this.screenShakeT > 0) this.screenShakeT = Math.max(0, this.screenShakeT - dt);
    }
  }

  class Game {
    constructor(canvas, ui) {
      this.ui = ui;
      this.renderer = new Renderer(canvas);
      this.audio = new AudioEngine();

      this.running = false;
      this.gameOver = false;
      this.time = 0;
      this.lastTs = 0;
      this.score = 0;
      this.coinTotal = 0;
      this.speed = CONFIG.baseSpeed;
      this.timeScale = 1;
      this.slowMoT = 0;
      this.nextObstacleAt = 0;
      this.spawnCounter = 0;
      this.fpsAccumulator = 0;
      this.fpsFrames = 0;
      this.currentFps = 0;

      this.player = this.createPlayer();

      this.obstaclePool = new Pool(() => ({ active: false, x: 0, y: 0, w: 0, h: 0, vx: 0, kind: 'small' }), CONFIG.maxEntities.obstacles);
      this.coinPool = new Pool(() => ({ active: false, x: 0, y: 0, r: 9 }), CONFIG.maxEntities.coins);
      this.particlePool = new Pool(() => ({ active: false, x: 0, y: 0, vx: 0, vy: 0, life: 0, maxLife: 0, size: 3, cr: 255, cg: 255, cb: 255 }), CONFIG.maxEntities.particles);
      this.ghostPool = new Pool(() => ({ active: false, x: 0, y: 0, w: 0, h: 0, life: 0 }), CONFIG.maxEntities.ghost);

      this.obstacles = this.obstaclePool.items;
      this.coinEntities = this.coinPool.items;
      this.coinTotal = 0;
      this.ghostTrail = this.ghostPool.items;

      this.keys = { jump: false };

      this.bindInput();
    }

    createPlayer() {
      return {
        x: 130,
        y: CONFIG.groundY - 68,
        w: 52,
        h: 68,
        vy: 0,
        onGround: true,
        jumpCount: 0,
        justLanded: false,
        form: 'shadow',
        formAnim: 0,
        formTimer: 0,
        jumpedNearObstacle: false
      };
    }

    get obstaclesList() {
      return this.obstacles;
    }

    worldToScreenX(worldX) {
      return worldX * this.renderer.scale;
    }

    worldToScreenY(worldY) {
      return worldY * this.renderer.scale;
    }

    bindInput() {
      const jump = () => this.tryJump();
      window.addEventListener('keydown', (e) => {
        if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'KeyW') {
          e.preventDefault();
          jump();
        }
        if (e.code === 'KeyR' && this.gameOver) this.restart();
      }, { passive: false });

      // mobile touch controls
      let lastTap = 0;
      window.addEventListener('touchstart', (e) => {
        e.preventDefault();
        const now = performance.now();
        if (now - lastTap < 220) {
          this.tryJump();
        }
        this.tryJump();
        lastTap = now;
      }, { passive: false });

      window.addEventListener('mousedown', () => jump());
    }

    async startWithMusic(file) {
      try {
        if (file) await this.audio.loadFile(file);
      } catch (_) {
        // Error-safe: game still runs without loaded audio.
      }
      this.audio.resumeContext();
      this.audio.play();
      this.start();
    }

    start() {
      this.running = true;
      this.gameOver = false;
      this.lastTs = performance.now();
      this.ui.showOverlay(false);
      this.ui.setState('RUNNING');
      requestAnimationFrame((ts) => this.loop(ts));
    }

    restart() {
      this.audio.resumeContext();
      this.player = this.createPlayer();
      this.running = true;
      this.gameOver = false;
      this.time = 0;
      this.score = 0;
      this.coinTotal = 0;
      this.speed = CONFIG.baseSpeed;
      this.timeScale = 1;
      this.slowMoT = 0;
      this.nextObstacleAt = 0;
      this.spawnCounter = 0;
      this.clearPools();
      this.ui.setScore(0);
      this.ui.setCoins(0);
      this.ui.setState('RUNNING');
      this.ui.showOverlay(false);
      this.lastTs = performance.now();
      requestAnimationFrame((ts) => this.loop(ts));
    }

    clearPools() {
      this.obstaclePool.items.forEach((it) => { it.active = false; });
      this.obstaclePool.free = [...this.obstaclePool.items];
      this.coinPool.items.forEach((it) => { it.active = false; });
      this.coinPool.free = [...this.coinPool.items];
      this.particlePool.items.forEach((it) => { it.active = false; });
      this.particlePool.free = [...this.particlePool.items];
      this.ghostPool.items.forEach((it) => { it.active = false; });
      this.ghostPool.free = [...this.ghostPool.items];
    }

    loop(ts) {
      if (!this.running) return;
      const rawDt = clamp((ts - this.lastTs) / 1000, 0, 0.05);
      this.lastTs = ts;

      const scaledDt = rawDt * this.timeScale;
      this.update(rawDt, scaledDt);
      this.render(rawDt);

      if (this.running) requestAnimationFrame((t) => this.loop(t));
    }

    update(rawDt, dt) {
      if (this.gameOver) return;
      this.time += rawDt;
      this.spawnCounter += dt;

      // beat detection + optional lyric output
      const lyric = this.audio.update(this.time);
      if (lyric) this.ui.showLyric(lyric, 1000);

      // slowdown timer
      if (this.slowMoT > 0) {
        this.slowMoT -= rawDt;
        if (this.slowMoT <= 0) {
          this.timeScale = 1;
        }
      }

      // score and speed
      this.score += CONFIG.scorePerSecond * dt;
      this.speed = clamp(this.speed + CONFIG.speedRampPerSecond * dt, CONFIG.baseSpeed, CONFIG.maxSpeed);
      this.ui.setScore(this.score);
      this.ui.setSpeed(this.speed / CONFIG.baseSpeed);

      // evolution + animation
      if (this.score >= CONFIG.evolutionScoreThreshold && this.player.form === 'shadow') {
        this.player.form = 'human';
        this.player.formTimer = 1.4;
      }
      if (this.player.form === 'human') {
        this.player.formTimer -= dt;
        this.player.formAnim += dt;
        if (this.player.formTimer <= 0) {
          this.player.form = 'shadow';
          this.player.formAnim = 0;
        }
      }

      Physics.stepPlayer(this.player, dt);

      if (this.player.justLanded) {
        this.spawnLandingParticles();
        this.player.justLanded = false;
      }

      this.updateObstacles(dt);
      this.updateCoins(dt);
      this.updateParticles(dt);
      this.updateGhostTrail(dt);

      this.spawnIfNeeded();
      this.checkCollisions();

      this.ui.update();
      this.measureFps(rawDt);
    }

    render(dt) {
      const beatFlash = this.audio.flash;
      this.renderer.beginFrame(beatFlash);
      this.renderer.drawParallax(this, this.audio.beatEnergy);
      this.renderer.drawObstacles(this);
      this.renderer.drawCoins(this);
      this.renderer.drawParticles(this);
      this.renderer.drawPlayer(this);
      this.renderer.endFrame(dt);
    }

    measureFps(rawDt) {
      this.fpsAccumulator += rawDt;
      this.fpsFrames += 1;
      if (this.fpsAccumulator >= 0.45) {
        this.currentFps = this.fpsFrames / this.fpsAccumulator;
        this.ui.setFps(this.currentFps);
        this.fpsAccumulator = 0;
        this.fpsFrames = 0;
      }
    }

    tryJump() {
      if (this.gameOver) return;
      const p = this.player;
      if (p.onGround) {
        p.vy = CONFIG.jumpVelocity;
        p.onGround = false;
        p.jumpCount = 1;
        this.checkPerfectJump();
      } else if (p.jumpCount < 2) {
        p.vy = CONFIG.doubleJumpVelocity;
        p.jumpCount += 1;
      } else {
        return;
      }

      this.spawnJumpParticles();
      this.audio.resumeContext();
    }

    checkPerfectJump() {
      const p = this.player;
      let nearest = null;
      let dist = Infinity;
      this.obstacles.forEach((o) => {
        if (!o.active) return;
        const d = o.x - (p.x + p.w);
        if (d >= 0 && d < dist) {
          dist = d;
          nearest = o;
        }
      });

      if (nearest && dist <= CONFIG.perfectWindowPx) {
        this.ui.flashPerfect();
        this.score += 15;
        this.slowMoT = CONFIG.perfectSlowMoDuration;
        this.timeScale = CONFIG.perfectSlowMoScale;
      }
    }

    spawnIfNeeded() {
      const furthest = this.findFurthestObstacleX();
      const targetDistance = rand(CONFIG.obstacleMinDistance, CONFIG.obstacleMaxDistance);
      if (furthest < 960 || (furthest - this.player.x) < targetDistance) {
        this.spawnObstacleGroup(Math.max(furthest + targetDistance, 920));
      }
    }

    findFurthestObstacleX() {
      let maxX = this.player.x;
      this.obstacles.forEach((o) => {
        if (o.active) maxX = Math.max(maxX, o.x + o.w);
      });
      return maxX;
    }

    spawnObstacleGroup(startX) {
      const count = Math.random() < 0.2 ? 2 : 1;
      for (let i = 0; i < count; i += 1) {
        this.spawnObstacle(startX + i * rand(72, 132));
      }
      if (Math.random() < CONFIG.coinChancePerSpawn) {
        this.spawnCoinPattern(startX + rand(26, 90));
      }
    }

    spawnObstacle(x) {
      const o = this.obstaclePool.acquire();
      if (!o) return;

      const kind = pick(['small', 'tall', 'moving']);
      o.kind = kind;
      o.x = x;

      if (kind === 'small') {
        o.w = 42;
        o.h = 46;
        o.y = CONFIG.groundY - o.h;
        o.vx = 0;
      } else if (kind === 'tall') {
        o.w = 56;
        o.h = 110;
        o.y = CONFIG.groundY - o.h;
        o.vx = 0;
      } else {
        o.w = 48;
        o.h = 60;
        o.y = CONFIG.groundY - o.h - rand(0, 52);
        o.vx = rand(-65, 65);
      }
    }

    spawnCoinPattern(baseX) {
      const pattern = pick(['arc', 'line', 'burst']);
      const centerY = CONFIG.groundY - rand(90, 180);

      if (pattern === 'line') {
        const count = 6;
        for (let i = 0; i < count; i += 1) {
          this.spawnCoin(baseX + i * 36, centerY);
        }
      } else if (pattern === 'arc') {
        const count = 8;
        for (let i = 0; i < count; i += 1) {
          const t = i / (count - 1);
          const x = baseX + t * 200;
          const y = centerY - Math.sin(t * Math.PI) * 76;
          this.spawnCoin(x, y);
        }
      } else {
        const count = 10;
        for (let i = 0; i < count; i += 1) {
          const ang = (i / count) * Math.PI * 2;
          const r = 12 + i * 3;
          this.spawnCoin(baseX + Math.cos(ang) * r * 0.8, centerY + Math.sin(ang) * r * 0.8);
        }
      }
    }

    spawnCoin(x, y) {
      const c = this.coinPool.acquire();
      if (!c) return;
      c.x = x;
      c.y = y;
      c.r = 9;
    }

    updateObstacles(dt) {
      this.obstacles.forEach((o) => {
        if (!o.active) return;
        o.x -= this.speed * dt;
        if (o.kind === 'moving') {
          o.y += o.vx * dt;
          const top = CONFIG.groundY - 180;
          const bottom = CONFIG.groundY - o.h;
          if (o.y < top || o.y > bottom) o.vx *= -1;
        }

        if (o.x + o.w < -80) {
          this.obstaclePool.release(o);
        }
      });
    }

    updateCoins(dt) {
      this.coinEntities.forEach((c) => {
        if (!c.active) return;
        c.x -= this.speed * dt;
        if (c.x + c.r < -80) this.coinPool.release(c);
      });
    }

    updateParticles(dt) {
      this.particlePool.forEachActive((p) => {
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vy += 600 * dt;
        p.life -= dt;
        if (p.life <= 0) this.particlePool.release(p);
      });
    }

    updateGhostTrail(dt) {
      // emit snapshot at fixed cadence
      if ((this.time * 1000) % 34 < 16) {
        const g = this.ghostPool.acquire();
        if (g) {
          g.x = this.player.x;
          g.y = this.player.y;
          g.w = this.player.w;
          g.h = this.player.h;
          g.life = 1;
        }
      }

      this.ghostPool.forEachActive((g) => {
        g.x -= this.speed * dt * 0.08;
        g.life -= dt * 2.1;
        if (g.life <= 0) this.ghostPool.release(g);
      });
    }

    checkCollisions() {
      const pRect = this.player;

      // obstacle collision
      for (let i = 0; i < this.obstacles.length; i += 1) {
        const o = this.obstacles[i];
        if (!o.active) continue;
        if (Physics.aabb(pRect, o)) {
          this.onCrash();
          return;
        }
      }

      // coin collision
      this.coinEntities.forEach((c) => {
        if (!c.active) return;
        if (Physics.circleRect(c, pRect)) {
          this.coinPool.release(c);
          this.coinTotal += 1;
          this.score += 5;
          this.ui.setCoins(this.coinTotal);
          this.spawnCoinPickupParticles(pRect.x + pRect.w * 0.6, pRect.y + pRect.h * 0.4);
        }
      });
    }

    onCrash() {
      if (this.gameOver) return;
      this.gameOver = true;
      this.running = false;
      this.ui.setState('CRASHED - Press R to restart');
      this.renderer.triggerShake(CONFIG.impactShakeMs, 8);
      this.spawnImpactParticles(this.player.x + this.player.w * 0.5, this.player.y + this.player.h * 0.5);
      this.audio.stop();
      this.ui.showOverlay(true);
    }

    spawnParticle(x, y, vx, vy, life, size, rgb) {
      const p = this.particlePool.acquire();
      if (!p) return;
      p.x = x;
      p.y = y;
      p.vx = vx;
      p.vy = vy;
      p.life = life;
      p.maxLife = life;
      p.size = size;
      p.cr = rgb[0];
      p.cg = rgb[1];
      p.cb = rgb[2];
    }

    spawnJumpParticles() {
      const x = this.player.x + this.player.w * 0.4;
      const y = this.player.y + this.player.h;
      for (let i = 0; i < 12; i += 1) {
        this.spawnParticle(x, y, rand(-90, 80), rand(-50, -10), rand(0.2, 0.45), rand(2, 4), [0, 234, 255]);
      }
    }

    spawnLandingParticles() {
      const x = this.player.x + this.player.w * 0.4;
      const y = CONFIG.groundY - 2;
      for (let i = 0; i < 16; i += 1) {
        this.spawnParticle(x, y, rand(-110, 110), rand(-180, -70), rand(0.28, 0.55), rand(2, 4), [255, 44, 255]);
      }
    }

    spawnCoinPickupParticles(x, y) {
      for (let i = 0; i < 10; i += 1) {
        this.spawnParticle(x, y, rand(-120, 120), rand(-130, 20), rand(0.25, 0.5), rand(2, 4), [255, 213, 79]);
      }
    }

    spawnImpactParticles(x, y) {
      for (let i = 0; i < 48; i += 1) {
        this.spawnParticle(x, y, rand(-220, 220), rand(-280, 130), rand(0.45, 0.9), rand(2, 5), [255, 69, 104]);
      }
    }
  }

  function safeInit() {
    const canvas = document.getElementById('gameCanvas');
    if (!canvas || typeof window.UIController !== 'function') return;

    const ui = new window.UIController();
    const game = new Game(canvas, ui);

    ui.bindStart(async (file) => {
      await game.startWithMusic(file);
    });
  }

  if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', safeInit);
  } else {
    safeInit();
  }
})();
