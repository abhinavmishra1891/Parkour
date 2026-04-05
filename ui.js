/*
 * ui.js
 * UI module for Shadow Parkour.
 * Keeps DOM operations separate from gameplay + rendering logic.
 */
(function () {
  'use strict';

  class UIController {
    constructor() {
      this.scoreEl = document.getElementById('score');
      this.bestEl = document.getElementById('best');
      this.speedEl = document.getElementById('speed');
      this.coinsEl = document.getElementById('coins');
      this.stateEl = document.getElementById('state');
      this.fpsEl = document.getElementById('fps');
      this.overlayEl = document.getElementById('overlay');
      this.startBtn = document.getElementById('startBtn');
      this.musicInput = document.getElementById('musicInput');
      this.perfectEl = document.getElementById('perfectText');
      this.lyricEl = document.getElementById('lyric');

      this.bestScore = Number(localStorage.getItem('shadow_parkour_best') || 0);
      this.renderBest();

      this._perfectTimer = 0;
      this._lyricTimer = 0;
      this._state = 'WAITING';
      this.setState(this._state);
    }

    bindStart(onStart) {
      if (!this.startBtn) return;
      this.startBtn.addEventListener('click', () => {
        onStart?.(this.musicInput?.files?.[0] || null);
      });
    }

    showOverlay(show) {
      if (!this.overlayEl) return;
      this.overlayEl.style.display = show ? 'grid' : 'none';
    }

    setState(stateText) {
      this._state = stateText;
      if (this.stateEl) this.stateEl.textContent = stateText;
    }

    setScore(value) {
      if (this.scoreEl) this.scoreEl.textContent = Math.floor(value).toString();
      if (value > this.bestScore) {
        this.bestScore = Math.floor(value);
        localStorage.setItem('shadow_parkour_best', String(this.bestScore));
        this.renderBest();
      }
    }

    renderBest() {
      if (this.bestEl) this.bestEl.textContent = String(this.bestScore);
    }

    setCoins(value) {
      if (this.coinsEl) this.coinsEl.textContent = Math.floor(value).toString();
    }

    setSpeed(scale) {
      if (this.speedEl) this.speedEl.textContent = `${scale.toFixed(2)}x`;
    }

    setFps(fps) {
      if (!this.fpsEl) return;
      this.fpsEl.textContent = Number.isFinite(fps) ? String(Math.round(fps)) : '--';
    }

    flashPerfect() {
      if (!this.perfectEl) return;
      this._perfectTimer = 28;
      this.perfectEl.style.opacity = '1';
    }

    showLyric(text, durationMs = 900) {
      if (!this.lyricEl || !text) return;
      this.lyricEl.textContent = text;
      this.lyricEl.style.opacity = '1';
      this._lyricTimer = Math.max(1, Math.floor(durationMs / 16.67));
    }

    update() {
      if (this._perfectTimer > 0) {
        this._perfectTimer -= 1;
        if (this._perfectTimer <= 0 && this.perfectEl) {
          this.perfectEl.style.opacity = '0';
        }
      }

      if (this._lyricTimer > 0) {
        this._lyricTimer -= 1;
        if (this._lyricTimer <= 0 && this.lyricEl) {
          this.lyricEl.style.opacity = '0';
        }
      }
    }
  }

  window.UIController = UIController;
})();
