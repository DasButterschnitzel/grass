'use strict';
// Struct-of-arrays particle system: clippings, sparkles, petals, confetti, rain, ambience.
(function (ZM) {
  const MAX = 3000;
  const F_ADD = 1, F_GRAV = 2, F_FLUTTER = 4, F_FADEIN = 8, F_SPIN_SCALE = 16;
  ZM.PF = { ADD: F_ADD, GRAV: F_GRAV, FLUTTER: F_FLUTTER, FADEIN: F_FADEIN, SPINSCALE: F_SPIN_SCALE };
  ZM.SPR = ['clip', 'spark', 'dot', 'petal', 'leaf', 'confetti', 'glow', 'coin', 'gem', 'clover', 'butterfly', 'arrow', 'white', 'drop', 'ring'];
  const SPR_INDEX = {};
  ZM.SPR.forEach((n, i) => (SPR_INDEX[n] = i));

  class Particles {
    constructor() {
      this.n = 0;
      this.vis = 1; // world units per "normal" cell: big lawns are seen from further away
      const f = () => new Float32Array(MAX);
      this.x = f(); this.y = f(); this.vx = f(); this.vy = f();
      this.life = f(); this.max = f(); this.s0 = f(); this.s1 = f();
      this.rot = f(); this.vr = f(); this.r = f(); this.g = f(); this.b = f(); this.a = f();
      this.drag = f(); this.ph = f();
      this.spr = new Uint8Array(MAX); this.flags = new Uint8Array(MAX);
    }
    clear() { this.n = 0; }
    spawn(spr, x, y, vx, vy, life, s0, s1, rot, vr, c, a, flags, drag) {
      if (this.n >= MAX) return;
      const i = this.n++;
      this.spr[i] = typeof spr === 'number' ? spr : SPR_INDEX[spr];
      const v = this.vis;
      this.x[i] = x; this.y[i] = y; this.vx[i] = vx * v; this.vy[i] = vy * v;
      this.life[i] = life; this.max[i] = life; this.s0[i] = s0 * v; this.s1[i] = s1 * v;
      this.rot[i] = rot; this.vr[i] = vr;
      this.r[i] = c[0]; this.g[i] = c[1]; this.b[i] = c[2]; this.a[i] = a;
      this.flags[i] = flags || 0; this.drag[i] = drag === undefined ? 2.5 : drag;
      this.ph[i] = Math.random() * 6.283;
    }
    update(dt, t) {
      let w = 0;
      for (let i = 0; i < this.n; i++) {
        const life = this.life[i] - dt;
        if (life <= 0) continue;
        const fl = this.flags[i];
        const k = Math.exp(-this.drag[i] * dt);
        let vx = this.vx[i] * k, vy = this.vy[i] * k;
        if (fl & F_GRAV) vy += 3.0 * this.vis * dt;
        if (fl & F_FLUTTER) { vx += Math.sin(t * 2.3 + this.ph[i]) * 1.6 * this.vis * dt; }
        if (w !== i) {
          this.spr[w] = this.spr[i]; this.flags[w] = fl;
          this.max[w] = this.max[i]; this.s0[w] = this.s0[i]; this.s1[w] = this.s1[i];
          this.vr[w] = this.vr[i]; this.r[w] = this.r[i]; this.g[w] = this.g[i]; this.b[w] = this.b[i];
          this.a[w] = this.a[i]; this.drag[w] = this.drag[i]; this.ph[w] = this.ph[i];
        }
        this.x[w] = this.x[i] + vx * dt; this.y[w] = this.y[i] + vy * dt;
        this.vx[w] = vx; this.vy[w] = vy;
        this.rot[w] = this.rot[i] + this.vr[i] * dt;
        this.life[w] = life;
        w++;
      }
      this.n = w;
    }
    draw(rend, uvs) {
      const nb = rend.batch, ab = rend.addBatch;
      for (let i = 0; i < this.n; i++) {
        const u = this.life[i] / this.max[i]; // 1 → 0
        const fl = this.flags[i];
        let alpha = this.a[i] * Math.min(1, u / 0.4);
        if (fl & F_FADEIN) alpha *= Math.min(1, (1 - u) / 0.15);
        const s = this.s1[i] + (this.s0[i] - this.s1[i]) * u;
        let sx = s, sy = s;
        const spr = this.spr[i];
        if (spr === 0) { sx = s * 0.4; } // clipping is a thin blade
        else if (spr === 5) { sx = s * 0.7; sy = s * Math.abs(Math.cos(this.rot[i] * 1.7)) + s * 0.1; }
        else if (spr === 3) { sx = s * 0.75; }
        else if (spr === 13) { sx = s * 0.09; } // rain streak
        const b = fl & F_ADD ? ab : nb;
        b.push(this.x[i], this.y[i], sx, sy, this.rot[i], uvs[spr], this.r[i], this.g[i], this.b[i], alpha);
      }
    }
  }
  ZM.Particles = Particles;
})(window.ZM);
