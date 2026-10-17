'use strict';
// Runtime state of the lawn. Every grass cell has a continuous height (in "layers") that
// grows back towards its maximum after being cut – like the original game. The byte
// buffers mirror that state for the GPU.
(function (ZM) {
  const LIGHT_X = 0.6, LIGHT_Y = 0.8;
  const Q = 20; // height quantisation for the texture (h * 20 → byte)
  ZM.CUT_MIN = 0.35; // grass must regrow at least this far before it can be cut again

  class Field {
    constructor(level, savedQ, savedType) {
      this.level = level;
      const { W, H } = level;
      const n = W * H;
      this.W = W; this.H = H; this.n = n;
      this.grass = level.grass;
      this.maxH = new Uint8Array(level.layers);
      this.baseType = new Uint8Array(level.type); // static: flowers
      this.type = new Uint8Array(level.type);     // + dynamic specials (gold, gem, clover)
      this.h = new Float32Array(n);
      this.q = new Uint8Array(n);
      this.jit = new Float32Array(n);
      this.stripe = new Uint8Array(n).fill(128);
      this.fresh = new Float32Array(n);
      this.freshList = [];
      this.pass = new Uint8Array(n); // mowed at least once in the current round
      this.passCount = 0;
      this.state = new Uint8Array(n * 4);
      this.fx = new Uint8Array(n * 4);
      const cells = [];
      const r = ZM.rng(level.seed ^ 0x7777);
      for (let i = 0; i < n; i++) {
        if (!this.grass[i]) continue;
        cells.push(i);
        this.jit[i] = 0.75 + 0.5 * r();
      }
      this.cells = Int32Array.from(cells);
      this.passTotal = cells.length;
      const restore = savedQ && savedQ.length === n;
      for (const i of this.cells) {
        this.h[i] = restore ? Math.min(this.maxH[i], savedQ[i] / Q) : this.maxH[i];
        if (restore && savedType && savedType.length === n && savedType[i] === 2) this.type[i] = 2;
        if (this.h[i] < this.maxH[i]) this.stripe[i] = 128 + ((i % W) % 6 < 3 ? 60 : -60);
        this.q[i] = Math.round(this.h[i] * Q);
        this.writeCell(i);
      }
      this.BS = 4;
      this.BW = Math.ceil(W / this.BS); this.BH = Math.ceil(H / this.BS);
      this.blockH = new Float32Array(this.BW * this.BH);
      this.recomputeBlocks();
      this.dirty = true;
    }

    writeCell(i) {
      const o = i * 4, h = this.h[i];
      this.state[o] = this.q[i];
      this.state[o + 1] = this.type[i] * 40;
      this.state[o + 2] = this.maxH[i] * Q;
      this.state[o + 3] = this.grass[i] ? 255 : 0;
      this.fx[o] = h >= 1 ? 255 : (h * 255) | 0;
      this.fx[o + 1] = Math.min(255, this.fresh[i] * 255) | 0;
      this.fx[o + 2] = this.stripe[i];
      this.fx[o + 3] = 0;
    }

    setType(i, t) {
      this.type[i] = t;
      this.state[i * 4 + 1] = t * 40;
      this.dirty = true;
    }

    // Cuts the cell down to stubble. Returns the height that was cut (0 if too short).
    cut(i, dx, dy) {
      const h = this.h[i];
      if (h < ZM.CUT_MIN) return 0;
      this.h[i] = 0;
      this.q[i] = 0;
      if (!this.pass[i]) { this.pass[i] = 1; this.passCount++; }
      const len = Math.hypot(dx, dy) || 1;
      const s = (dx * LIGHT_X + dy * LIGHT_Y) / len;
      this.stripe[i] = Math.round(128 + 127 * Math.max(-1, Math.min(1, s * 1.25)));
      if (this.fresh[i] <= 0) this.freshList.push(i);
      this.fresh[i] = 1;
      this.writeCell(i);
      this.dirty = true;
      return h;
    }

    // Regrowth: `rate` layers per second (Sprinkler upgrade), slightly different per cell.
    grow(dt, rate) {
      const cells = this.cells, h = this.h, maxH = this.maxH, q = this.q, jit = this.jit;
      const st = this.state, fx = this.fx;
      const k = rate * dt;
      let changed = false;
      for (let c = 0; c < cells.length; c++) {
        const i = cells[c];
        const m = maxH[i];
        let v = h[i];
        if (v >= m) continue;
        v += k * jit[i];
        if (v > m) v = m;
        h[i] = v;
        const qq = (v * Q + 0.5) | 0;
        if (qq !== q[i]) {
          q[i] = qq;
          const o = i * 4;
          st[o] = qq;
          fx[o] = v >= 1 ? 255 : (v * 255) | 0;
          changed = true;
        }
      }
      if (changed) this.dirty = true;
    }

    resetPass() { this.pass.fill(0); this.passCount = 0; }

    fillAll() {
      for (const i of this.cells) { this.h[i] = this.maxH[i]; this.q[i] = Math.round(this.h[i] * Q); this.writeCell(i); }
      this.dirty = true;
    }

    // Sum of cuttable grass per 4×4 block – used by the autopilot to find tall grass.
    recomputeBlocks() {
      const b = this.blockH, W = this.W, BS = this.BS, BW = this.BW;
      b.fill(0);
      for (const i of this.cells) {
        const v = this.h[i];
        if (v < ZM.CUT_MIN) continue;
        const x = i % W, y = (i / W) | 0;
        b[((y / BS) | 0) * BW + ((x / BS) | 0)] += v * (this.type[i] === 1 ? 6 : 1);
      }
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

    // Fraction of the lawn that is currently tall (for stats / QA).
    get coverage() {
      let s = 0, m = 0;
      for (const i of this.cells) { s += this.h[i]; m += this.maxH[i]; }
      return m > 0 ? s / m : 1;
    }

    // Closest cell with cuttable grass (QA bots, hints).
    nearestTall(x, y, minH) {
      let best = -1, bd = 1e9;
      const W = this.W, th = minH || ZM.CUT_MIN;
      for (const i of this.cells) {
        if (this.h[i] < th) continue;
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
      return { q: toB64(this.q), type: toB64(this.baseType) };
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
