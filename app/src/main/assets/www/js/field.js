'use strict';
// Runtime state of the lawn: remaining layers per cell + the GPU-facing byte buffers.
(function (ZM) {
  const LIGHT_X = 0.6, LIGHT_Y = 0.8;

  class Field {
    constructor(level, savedLayers, savedType) {
      this.level = level;
      const { W, H } = level;
      const n = W * H;
      this.W = W; this.H = H; this.n = n;
      this.layers = new Uint8Array(level.layers);
      this.maxLayers = new Uint8Array(level.layers);
      this.type = new Uint8Array(level.type);
      this.grass = level.grass;
      this.cool = new Float32Array(n);
      this.stripe = new Uint8Array(n).fill(128);
      this.fresh = new Float32Array(n);
      this.freshList = [];
      this.state = new Uint8Array(n * 4);
      this.fx = new Uint8Array(n * 4);
      this.total = level.total;
      this.BS = 4;
      this.BW = Math.ceil(W / this.BS); this.BH = Math.ceil(H / this.BS);
      this.block = new Int32Array(this.BW * this.BH);
      if (savedLayers && savedLayers.length === n) {
        this.layers.set(savedLayers);
        if (savedType && savedType.length === n) this.type.set(savedType);
      }
      this.remaining = 0;
      for (let i = 0; i < n; i++) {
        if (!this.grass[i]) continue;
        this.remaining += this.layers[i];
        this.block[this.blockOf(i)] += this.layers[i];
        if (this.layers[i] === 0) this.stripe[i] = 128 + ((i % W) % 6 < 3 ? 60 : -60);
        this.writeCell(i);
      }
      this.dirty = true;
      this.regrow = null; // zen mode queue
    }

    blockOf(i) {
      const x = i % this.W, y = (i / this.W) | 0;
      return ((y / this.BS) | 0) * this.BW + ((x / this.BS) | 0);
    }

    writeCell(i) {
      const o = i * 4, L = this.layers[i];
      this.state[o] = L * 20;
      this.state[o + 1] = this.type[i] * 40;
      this.state[o + 2] = this.maxLayers[i] * 20;
      this.state[o + 3] = this.grass[i] ? 255 : 0;
      this.fx[o] = L > 0 ? 255 : 0;
      this.fx[o + 1] = Math.min(255, this.fresh[i] * 255) | 0;
      this.fx[o + 2] = this.stripe[i];
      this.fx[o + 3] = 0;
    }

    get progress() {
      return this.total > 0 ? 1 - this.remaining / this.total : 1;
    }

    // Removes one layer. Returns the number of layers left (or -1 if nothing happened).
    cut(i, dx, dy) {
      const L = this.layers[i];
      if (L === 0) return -1;
      this.layers[i] = L - 1;
      this.remaining--;
      this.block[this.blockOf(i)]--;
      if (L === 1) {
        const len = Math.hypot(dx, dy) || 1;
        const s = (dx * LIGHT_X + dy * LIGHT_Y) / len;
        this.stripe[i] = Math.round(128 + 127 * Math.max(-1, Math.min(1, s * 1.25)));
        if (this.fresh[i] <= 0) this.freshList.push(i);
        this.fresh[i] = 1;
      }
      this.writeCell(i);
      this.dirty = true;
      return L - 1;
    }

    // Instantly clear (used by the end-of-level sweep).
    clear(i) {
      let c = 0;
      while (this.layers[i] > 0) { this.cut(i, 0, 1); c++; }
      return c;
    }

    regrowCell(i, L) {
      const before = this.layers[i];
      if (before >= L) return;
      this.layers[i] = L;
      this.remaining += L - before;
      this.block[this.blockOf(i)] += L - before;
      this.writeCell(i);
      this.dirty = true;
    }

    update(dt) {
      if (this.freshList.length) {
        const list = this.freshList;
        let w = 0;
        for (let k = 0; k < list.length; k++) {
          const i = list[k];
          const f = this.fresh[i] - dt * 1.6;
          this.fresh[i] = f > 0 ? f : 0;
          this.fx[i * 4 + 1] = f > 0 ? (f * 255) | 0 : 0;
          if (f > 0) list[w++] = i;
        }
        list.length = w;
        this.dirty = true;
      }
    }

    // Nearest cell (centre) that still has grass, used by hints & autopilot fallback.
    nearestUncut(x, y) {
      let best = -1, bd = 1e9;
      const { W, n } = this;
      for (let i = 0; i < n; i++) {
        if (this.layers[i] === 0) continue;
        const cx = (i % W) + 0.5, cy = ((i / W) | 0) + 0.5;
        const d = (cx - x) * (cx - x) + (cy - y) * (cy - y);
        if (d < bd) { bd = d; best = i; }
      }
      return best;
    }

    serialize() {
      const toB64 = (u8) => {
        let s = '';
        for (let i = 0; i < u8.length; i += 4096) s += String.fromCharCode.apply(null, u8.subarray(i, i + 4096));
        return btoa(s);
      };
      return { layers: toB64(this.layers), type: toB64(this.type) };
    }
    static decode(b64) {
      try {
        const s = atob(b64);
        const u = new Uint8Array(s.length);
        for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
        return u;
      } catch (e) { return null; }
    }
  }
  ZM.Field = Field;
})(window.ZM);
