'use strict';
// Game simulation: mowers, multitouch steering, cutting, regrowth, combos, golden patches,
// gems, lucky clovers, autopilot and buying the next lawn.
(function (ZM) {
  const PF = ZM.PF;
  const WHITE = [1, 1, 1];
  const GOLD = [1, 0.85, 0.3];

  class Mower {
    constructor(idx, x, y) {
      this.idx = idx;
      this.x = x; this.y = y; this.vx = 0; this.vy = 0;
      this.angle = 0; this.disc = Math.random() * 6;
      this.pointer = null; this.tx = x; this.ty = y; this.hasTarget = false;
      this.botBlock = -1; this.botRetarget = 0; this.botWobble = Math.random() * 10;
      this.earnAcc = 0; this.earnTimer = 0; this.goldAcc = false;
      this.spawnT = 0;
      this.speed01 = 0;
    }
  }

  class Game {
    constructor(save, hooks) {
      this.save = save;
      this.hooks = hooks || {};
      this.particles = new ZM.Particles();
      this.texts = [];
      this.butterflies = [];
      this.flyers = [];
      this.touches = new Map();
      this.mowers = [];
      this.mowUniform = new Float32Array(16);
      this.wind = [0.9, 0.3, 0.3];
      this.windA = 0.3;
      this.time = 0;
      this.playRect = { x: 0, y: 0, w: 400, h: 700 };
      this.cam = { scale: 10, offX: 0, offY: 0 };
      this.grow = 1;
      this.hint = 0;
      this.combo = { count: 0, timer: 0, level: 0 };
      this.frenzyT = 0;
      this.state = 'play';
      this.events = [];
      this.cutRate = 0;
      this.earnRate = 0;
      this.sessionCuts = 0;
      this.ambientT = 0;
      this.flowerDecor = [];
      this.bedDecor = [];
      this.zenView = false;
      this.patch = null;
      this.blockT = 0;
      this.recalc();
    }

    emit(type, data) { this.events.push({ type, data }); }
    get audio() { return ZM.audio; }

    recalc() {
      this.stats = ZM.stats(this.save.upg);
      const want = this.stats.mowers;
      if (this.field) {
        while (this.mowers.length < want) {
          const m = new Mower(this.mowers.length, this.level.W / 2 + (Math.random() - 0.5) * 6, this.level.H * 0.6);
          m.spawnT = 1;
          this.mowers.push(m);
          this.burst(m.x, m.y, 'spark', 18, [1, 1, 0.8], 7, PF.ADD);
        }
      }
    }

    // ---------------------------------------------------------------- lawns
    startLevel(N, restore) {
      const save = this.save;
      this.level = ZM.generateLevel(N);
      let q = null, type = null;
      if (restore && save.field && save.field.level === N && save.field.q) {
        q = ZM.Field.decode(save.field.q);
        type = ZM.Field.decode(save.field.type);
      }
      this.field = new ZM.Field(this.level, q, type);
      this.biome = this.level.biome;
      this.state = restore ? 'play' : 'growing';
      this.grow = restore ? 1 : 0;
      this.patch = null;
      this.frenzyT = 0;
      const t = this.time;
      this.nextGold = t + ZM.rand(8, 16);
      this.nextGem = t + ZM.rand(35, 60);
      this.nextClover = t + ZM.rand(90, 150);
      this.gemCell = -1; this.cloverCell = -1;
      this.placeMowers();
      this.buildDecor();
      this.particles.clear();
      this.texts.length = 0;
      this.butterflies.length = 0;
      if (this.hooks.onField) this.hooks.onField(this.field);
      if (this.audio) {
        this.audio.setBiome(this.biome);
        if (!restore) this.audio.sprout();
      }
      this.emit('level', { N, biome: this.biome, restore: !!restore });
    }

    get nextLawnCost() { return ZM.lawnCost(this.level.N); }
    get canBuyLawn() { return this.save.cash >= this.nextLawnCost; }

    // Spend coins to move on to the next, more valuable lawn (like the original).
    buyNextLawn() {
      const cost = this.nextLawnCost;
      if (this.save.cash < cost) return false;
      this.save.cash -= cost;
      this.save.level = this.level.N + 1;
      this.save.stats.levels++;
      this.save.field = null;
      this.startLevel(this.save.level, false);
      const lv = this.level;
      for (let k = 0; k < 140; k++) {
        const x = ZM.rand(0, lv.W), y = ZM.rand(-2, lv.H * 0.3);
        const c = ZM.hueShift([1, 0.3, 0.4], ZM.rand(0, 360));
        this.particles.spawn(5, x, y, ZM.rand(-3, 3), ZM.rand(2, 9), ZM.rand(1.8, 3.2), 1.0, 0.9, Math.random() * 6, ZM.rand(-8, 8), c, 1, PF.GRAV | PF.FLUTTER, 1.2);
      }
      if (this.audio) this.audio.levelClear();
      ZM.Native.haptic('success');
      this.emit('newLawn', { N: lv.N, biome: this.biome });
      return true;
    }

    saveFieldSnapshot() {
      if (!this.field) return;
      const s = this.field.serialize();
      this.save.field = { level: this.level.N, q: s.q, type: s.type };
    }

    placeMowers() {
      const lv = this.level;
      this.mowers.length = 0;
      this.touches.forEach((t) => (t.m = null));
      const cnt = this.stats.mowers;
      for (let k = 0; k < cnt; k++) {
        const fx = (k + 1) / (cnt + 1);
        let x = lv.W * fx, y = lv.H * 0.72;
        const c = this.findGrassNear(x, y);
        if (c >= 0) { x = (c % lv.W) + 0.5; y = ((c / lv.W) | 0) + 0.5; }
        this.mowers.push(new Mower(k, x, y));
      }
    }

    findGrassNear(x, y) {
      const lv = this.level;
      let best = -1, bd = 1e9;
      for (let i = 0; i < lv.grass.length; i++) {
        if (!lv.grass[i]) continue;
        const cx = (i % lv.W) + 0.5, cy = ((i / lv.W) | 0) + 0.5;
        const d = (cx - x) ** 2 + (cy - y) ** 2;
        if (d < bd) { bd = d; best = i; }
      }
      return best;
    }

    buildDecor() {
      const lv = this.level, b = this.biome;
      const r = ZM.rng(lv.seed ^ 0x55aa);
      this.flowerDecor = [];
      for (let i = 0; i < lv.type.length; i++) {
        if (this.field.baseType[i] !== 2) continue;
        this.flowerDecor.push({ i, x: (i % lv.W) + 0.5 + r.range(-0.25, 0.25), y: ((i / lv.W) | 0) + 0.3 + r.range(-0.2, 0.2), c: r.pick(b.flowers), s: r.range(1.0, 1.35), rot: r() * 6 });
      }
      this.bedDecor = [];
      const { TW, TH, terrain, S } = lv;
      for (let k = 0; k < 400 && this.bedDecor.length < 40; k++) {
        const tx = Math.floor(r() * TW), ty = Math.floor(r() * TH);
        if (terrain[(ty * TW + tx) * 4 + 3] > 150) this.bedDecor.push({ x: (tx + 0.5) / S, y: (ty + 0.5) / S, c: r.pick(b.flowers), s: r.range(0.9, 1.3), rot: r() * 6 });
      }
    }

    // ---------------------------------------------------------------- input
    toWorld(sx, sy) {
      const c = this.cam;
      return [(sx - c.offX) / c.scale, (sy - c.offY) / c.scale];
    }

    pointerDown(id, sx, sy) {
      if (!this.field) return;
      const [wx, wy] = this.toWorld(sx, sy);
      let best = null, bd = 1e9;
      for (const m of this.mowers) {
        if (m.pointer !== null) continue;
        const d = (m.x - wx) ** 2 + (m.y - wy) ** 2;
        if (d < bd) { bd = d; best = m; }
      }
      const t = { id, sx, sy, wx, wy, m: best, startMX: best ? best.x : 0, startMY: best ? best.y : 0, startWX: wx, startWY: wy, born: this.time };
      this.touches.set(id, t);
      if (best) { best.pointer = id; best.botBlock = -1; this.applyTouch(t); }
      if (this.audio) this.audio.unlock();
    }
    pointerMove(id, sx, sy) {
      const t = this.touches.get(id);
      if (!t) return;
      t.sx = sx; t.sy = sy;
      const w = this.toWorld(sx, sy);
      t.wx = w[0]; t.wy = w[1];
      this.applyTouch(t);
    }
    pointerUp(id) {
      const t = this.touches.get(id);
      if (!t) return;
      if (t.m && t.m.pointer === id) { t.m.pointer = null; t.m.hasTarget = false; }
      this.touches.delete(id);
    }
    applyTouch(t) {
      const m = t.m;
      if (!m) return;
      if (this.save.settings.control === 'drag') {
        m.tx = t.startMX + (t.wx - t.startWX) * 1.15;
        m.ty = t.startMY + (t.wy - t.startWY) * 1.15;
      } else { m.tx = t.wx; m.ty = t.wy; }
      m.tx = ZM.clamp(m.tx, 0, this.level.W); m.ty = ZM.clamp(m.ty, 0, this.level.H);
      m.hasTarget = true;
    }

    // ---------------------------------------------------------------- update
    update(dt) {
      if (!this.field) return;
      this.time += dt;
      const t = this.time, f = this.field, lv = this.level;

      // wind slowly wanders
      this.windA += (Math.sin(t * 0.05) * 0.4) * dt;
      const ws = 0.18 + 0.22 * (0.5 + 0.5 * Math.sin(t * 0.13)) + (this.biome.ambience === 'winter' ? 0.15 : 0);
      this.wind[0] = Math.cos(this.windA); this.wind[1] = Math.sin(this.windA) * 0.5; this.wind[2] = ws;

      if (this.state === 'growing') {
        this.grow = Math.min(1, this.grow + dt / 1.5);
        if (this.grow >= 1) this.state = 'play';
      }
      const canCut = this.state === 'play' || this.grow > 0.75;

      if (this.save.boostT > 0) this.save.boostT = Math.max(0, this.save.boostT - dt);
      if (this.frenzyT > 0) { this.frenzyT -= dt; if (this.frenzyT <= 0) this.emit('frenzyEnd'); }
      if (this.combo.timer > 0) {
        this.combo.timer -= dt;
        if (this.combo.timer <= 0) { this.combo.count = 0; if (this.combo.level > 0) this.emit('comboEnd', this.combo.level); this.combo.level = 0; }
      }

      const st = this.stats;
      const frenzy = this.frenzyT > 0;
      const R = st.radius * (frenzy ? 1.5 : 1);
      const comboMult = 1 + 0.1 * Math.min(10, this.combo.level);
      const valueBase = lv.value * st.valueMult * comboMult * (this.save.boostT > 0 ? 2 : 1) * (frenzy ? 2 : 1);
      let cutsFrame = 0, thickSum = 0, panSum = 0, speedSum = 0;

      for (const m of this.mowers) {
        this.moveMower(m, dt);
        speedSum += m.speed01;
        if (m.spawnT > 0) m.spawnT = Math.max(0, m.spawnT - dt * 2);
        m.disc += dt * (14 + m.speed01 * 22);
        if (canCut) {
          const res = this.cutAround(m, R, valueBase);
          cutsFrame += res;
          if (res > 0) panSum += ((m.x / lv.W) * 2 - 1) * res;
          thickSum += m._thick || 0;
        }
        // floating earnings
        m.earnTimer -= dt;
        // show a number every ~0.35 s, but don't spam tiny trims of regrowing grass
        const minShow = lv.value * st.valueMult * 2.5;
        if (m.earnTimer <= 0 && m.earnAcc > 0 && (m.earnAcc >= minShow || m.earnTimer < -1.5)) {
          m.textSide = -(m.textSide || 1);
          if (!this.zenView) this.addText('+' + ZM.fmt(m.earnAcc), m.x + m.textSide * R * ZM.rand(0.25, 0.6), m.y - R * 0.5, m.goldAcc ? GOLD : WHITE);
          if (this.audio && !this.zenView) this.audio.chime(this.combo.level, (m.x / lv.W) * 2 - 1, m.goldAcc);
          m.earnAcc = 0; m.goldAcc = false; m.earnTimer = 0.36;
        }
      }
      this.separateMowers();

      if (cutsFrame > 0) {
        this.combo.timer = 0.9;
        this.combo.count += cutsFrame;
        const newLevel = Math.floor(this.combo.count / 140);
        if (newLevel > this.combo.level) {
          this.combo.level = newLevel;
          if (newLevel <= 10) this.emit('combo', newLevel);
          if (this.audio && !this.zenView) this.audio.combo(newLevel);
        }
        this.sessionCuts += cutsFrame;
        this.save.stats.cells += cutsFrame;
      }
      this.cutRate = this.cutRate * Math.exp(-dt * 6) + cutsFrame * (1 - Math.exp(-dt * 6)) / Math.max(dt, 1e-3);
      if (this.audio) {
        this.audio.cut(cutsFrame, cutsFrame > 0 ? thickSum / Math.max(1, this.mowers.length) : 0, cutsFrame > 0 ? panSum / cutsFrame : 0, dt);
        this.audio.motor(speedSum / Math.max(1, this.mowers.length), this.mowers.length);
      }

      // the lawn grows back
      f.grow(dt, st.regrow);
      f.update(dt);
      this.blockT -= dt;
      if (this.blockT <= 0) { this.blockT = 0.4; f.recomputeBlocks(); }
      this.updateSpecials(dt);

      this.particles.update(dt, t);
      this.updateTexts(dt);
      this.updateButterflies(dt);
      this.updateFlyers(dt);
      this.ambient(dt);
      for (let k = 0; k < 4; k++) {
        const m = this.mowers[k], o = k * 4;
        if (m) { this.mowUniform[o] = m.x; this.mowUniform[o + 1] = m.y; this.mowUniform[o + 2] = R; this.mowUniform[o + 3] = 1; }
        else this.mowUniform[o + 3] = 0;
      }
    }

    moveMower(m, dt) {
      const st = this.stats, lv = this.level;
      let maxSpd = st.speed * (this.frenzyT > 0 ? 1.2 : 1);
      let hasT = m.pointer !== null && m.hasTarget;
      const auto = this.autoAll || st.botFrac > 0;
      if (!hasT && auto) {
        hasT = this.botTarget(m);
        maxSpd *= this.autoAll ? 1 : st.botFrac;
      }
      let dvx = 0, dvy = 0;
      if (hasT) {
        const dx = m.tx - m.x, dy = m.ty - m.y, d = Math.hypot(dx, dy);
        if (d > 0.05) {
          const s = Math.min(maxSpd, d * 7);
          dvx = (dx / d) * s; dvy = (dy / d) * s;
        }
      }
      const k = 1 - Math.exp(-dt * 11);
      m.vx += (dvx - m.vx) * k; m.vy += (dvy - m.vy) * k;
      m.x = ZM.clamp(m.x + m.vx * dt, 0.5, lv.W - 0.5);
      m.y = ZM.clamp(m.y + m.vy * dt, 0.5, lv.H - 0.5);
      const sp = Math.hypot(m.vx, m.vy);
      m.speed01 = Math.min(1, sp / Math.max(1, st.speed));
      if (sp > 0.6) {
        const target = Math.atan2(m.vx, -m.vy);
        let da = target - m.angle;
        while (da > Math.PI) da -= ZM.TAU;
        while (da < -Math.PI) da += ZM.TAU;
        m.angle += da * (1 - Math.exp(-dt * 10));
      }
    }

    separateMowers() {
      const ms = this.mowers;
      const minD = this.stats.radius * 0.9 + 1.2;
      for (let a = 0; a < ms.length; a++) for (let b = a + 1; b < ms.length; b++) {
        const A = ms[a], B = ms[b];
        const dx = B.x - A.x, dy = B.y - A.y, d = Math.hypot(dx, dy);
        if (d < minD && d > 1e-4) {
          const push = (minD - d) * 0.25;
          A.x -= (dx / d) * push; A.y -= (dy / d) * push;
          B.x += (dx / d) * push; B.y += (dy / d) * push;
        }
      }
    }

    // Autopilot: head for the block with the most (and tallest) grass nearby.
    botTarget(m) {
      const f = this.field;
      if (m.botBlock < 0 || f.blockH[m.botBlock] < 1 || this.time > m.botRetarget) {
        let best = -1, bs = 0;
        const R = this.stats.radius;
        for (let b = 0; b < f.blockH.length; b++) {
          const rem = f.blockH[b];
          if (rem < 1) continue;
          const cx = (b % f.BW) * f.BS + f.BS / 2, cy = ((b / f.BW) | 0) * f.BS + f.BS / 2;
          const d = Math.hypot(cx - m.x, cy - m.y);
          let score = rem / Math.pow(d + 3, 1.35);
          for (const o of this.mowers) {
            if (o === m) continue;
            const ob = o.pointer !== null ? null : o.botBlock;
            const ox = ob !== null && ob >= 0 ? (ob % f.BW) * f.BS + f.BS / 2 : o.x;
            const oy = ob !== null && ob >= 0 ? ((ob / f.BW) | 0) * f.BS + f.BS / 2 : o.y;
            if (Math.hypot(ox - cx, oy - cy) < R * 2 + 4) score *= 0.25;
          }
          if (score > bs) { bs = score; best = b; }
        }
        m.botBlock = best;
        m.botRetarget = this.time + 0.6;
      }
      if (m.botBlock < 0) return false;
      const b = m.botBlock;
      m.tx = (b % f.BW) * f.BS + f.BS / 2 + Math.sin(this.time * 1.3 + m.botWobble) * 1.2;
      m.ty = ((b / f.BW) | 0) * f.BS + f.BS / 2 + Math.cos(this.time * 1.1 + m.botWobble) * 1.2;
      return true;
    }

    // Cut everything tall enough under the blade; coins scale with how tall the grass was.
    cutAround(m, R, valueBase) {
      const f = this.field, lv = this.level, W = lv.W, H = lv.H;
      const R2 = R * R;
      const x0 = Math.max(0, Math.floor(m.x - R)), x1 = Math.min(W - 1, Math.floor(m.x + R));
      const y0 = Math.max(0, Math.floor(m.y - R)), y1 = Math.min(H - 1, Math.floor(m.y + R));
      const hx = Math.sin(m.angle), hy = -Math.cos(m.angle);
      const hh = f.h, grass = f.grass, type = f.type, maxH = f.maxH;
      const cutMin = ZM.CUT_MIN;
      let cuts = 0, thick = 0, budget = 6;
      const blades = this.biome.blades;
      for (let cy = y0; cy <= y1; cy++) {
        const dy = cy + 0.5 - m.y, dy2 = dy * dy;
        if (dy2 > R2) continue;
        for (let cx = x0; cx <= x1; cx++) {
          const i = cy * W + cx;
          if (!grass[i] || hh[i] < cutMin) continue;
          const dx = cx + 0.5 - m.x;
          if (dx * dx + dy2 > R2) continue;
          const typ = type[i];
          const bloom = typ === 2 && hh[i] >= maxH[i] * 0.85;
          const h = f.cut(i, hx, hy);
          const v = valueBase * h * (typ === 1 ? ZM.GOLD_MULT : bloom ? 3 : 1);
          m.earnAcc += v;
          this.earn(v);
          cuts++;
          thick += h;
          if (budget > 0 && Math.random() < 0.55) {
            budget--;
            const d = Math.hypot(dx, dy) || 1;
            const sp = ZM.rand(4, 9);
            const c = typ === 1 ? this.biome.gold : blades[Math.min(6, Math.max(0, Math.ceil(h) - 1))];
            const cc = [c[0] * ZM.rand(0.85, 1.1), c[1] * ZM.rand(0.85, 1.1), c[2] * ZM.rand(0.85, 1.1)];
            this.particles.spawn(0, cx + 0.5, cy + 0.5, (dx / d) * sp + m.vx * 0.3 - (dy / d) * 3, (dy / d) * sp + m.vy * 0.3 + (dx / d) * 3,
              ZM.rand(0.45, 0.85), ZM.rand(0.7, 1.1) * Math.min(1, 0.4 + h * 0.6), 0.25, Math.random() * 6, ZM.rand(-12, 12), cc, 1, 0, 3.2);
          }
          if (typ === 1) { m.goldAcc = true; this.cutGold(i, v); }
          else if (typ === 3) this.collectGem(i);
          else if (typ === 4) this.startFrenzy(i);
          else if (bloom) this.flowerPop(i);
        }
      }
      m._thick = cuts > 0 ? thick / cuts : 0;
      return cuts;
    }

    earn(v) {
      this.save.cash += v;
      this.save.stats.totalEarned += v;
      this.earnRate += v;
    }

    // ---------------------------------------------------------------- specials
    updateSpecials(dt) {
      const t = this.time;
      if (this.state !== 'play') return;
      if (!this.patch && t > this.nextGold) this.spawnGoldenPatch();
      if (this.patch) {
        const p = this.patch;
        if (Math.random() < dt * 6) this.particles.spawn(1, p.x + ZM.rand(-p.r, p.r), p.y + ZM.rand(-p.r, p.r) - 0.5, 0, -1.5, 0.9, 1.3, 0.1, 0, 2, this.biome.gold, 0.9, PF.ADD, 1);
        if (t > p.expire) this.endGoldenPatch(false);
      }
      if (this.gemCell < 0 && t > this.nextGem) this.gemCell = this.spawnSpecial(3);
      if (this.cloverCell < 0 && t > this.nextClover) this.cloverCell = this.spawnSpecial(4);
    }

    randomTallCell(minDistFromMowers) {
      const f = this.field, W = this.level.W;
      for (let tries = 0; tries < 60; tries++) {
        const i = f.cells[Math.floor(Math.random() * f.cells.length)];
        if (f.type[i] !== 0 || f.h[i] < f.maxH[i] * 0.8) continue;
        const x = (i % W) + 0.5, y = ((i / W) | 0) + 0.5;
        if (this.mowers.some((m) => Math.hypot(m.x - x, m.y - y) < minDistFromMowers)) continue;
        return i;
      }
      return -1;
    }

    spawnSpecial(typ) {
      const i = this.randomTallCell(this.stats.radius + 6);
      if (i < 0) return -1;
      this.field.setType(i, typ);
      return i;
    }

    // A golden patch appears every ~20–40 s, like in the original.
    spawnGoldenPatch() {
      const f = this.field, W = this.level.W, H = this.level.H;
      const c = this.randomTallCell(this.stats.radius + 8);
      this.nextGold = this.time + ZM.rand(18, 34);
      if (c < 0) return;
      const r = ZM.rand(1.4, 2.3);
      const cx = c % W, cy = (c / W) | 0;
      const cells = [];
      for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
        const x = cx + dx, y = cy + dy;
        if (x < 0 || y < 0 || x >= W || y >= H || dx * dx + dy * dy > r * r) continue;
        const j = y * W + x;
        if (!f.grass[j] || f.type[j] !== 0) continue;
        f.setType(j, 1);
        if (f.h[j] < 1) { f.h[j] = Math.min(f.maxH[j], 1); f.q[j] = Math.round(f.h[j] * 20); f.writeCell(j); }
        cells.push(j);
      }
      if (!cells.length) return;
      this.patch = { cells, left: cells.length, earned: 0, x: cx + 0.5, y: cy + 0.5, r, expire: this.time + 32 };
      if (this.audio && !this.zenView) this.audio.goldAppear();
    }

    cutGold(i, v) {
      const p = this.patch;
      this.field.setType(i, this.field.baseType[i]);
      if (!p) return;
      p.earned += v;
      p.left--;
      if (p.left <= 0) this.endGoldenPatch(true);
    }

    endGoldenPatch(collected) {
      const p = this.patch;
      if (!p) return;
      this.patch = null;
      if (collected) {
        // bonus: ~8 s of your recent income on top of what the golden grass paid
        const bonus = Math.max(p.earned * 0.5, (this.save.rate || 0) * 8);
        this.earn(bonus);
        const total = p.earned + bonus;
        this.burst(p.x, p.y, 'spark', 26, this.biome.gold, 10, PF.ADD);
        this.addText(ZM.t('GOLDEN PATCH!') + ' +' + ZM.fmt(total), p.x, p.y - 3, GOLD, 1.25);
        if (this.audio) this.audio.coins();
        ZM.Native.haptic('medium');
        this.emit('golden', total);
      } else {
        for (const j of p.cells) if (this.field.type[j] === 1) this.field.setType(j, this.field.baseType[j]);
      }
    }

    collectGem(i) {
      const lv = this.level;
      const x = (i % lv.W) + 0.5, y = ((i / lv.W) | 0) + 0.5;
      const amount = 1;
      this.save.gems += amount;
      this.field.setType(i, this.field.baseType[i]);
      this.gemCell = -1;
      this.nextGem = this.time + ZM.rand(55, 95);
      this.burst(x, y, 'spark', 22, [0.6, 1, 1], 9, PF.ADD);
      this.flyers.push({ spr: 'gem', x, y, t: 0, dur: 0.9, target: 'gem' });
      this.addText('+' + amount + ' ' + ZM.t('GEM'), x, y - 2, [0.6, 1, 1], 1.2);
      this.emit('gem', amount);
      if (this.audio) this.audio.gem();
      ZM.Native.haptic('medium');
    }

    startFrenzy(i) {
      const lv = this.level;
      const x = (i % lv.W) + 0.5, y = ((i / lv.W) | 0) + 0.5;
      this.field.setType(i, this.field.baseType[i]);
      this.cloverCell = -1;
      this.nextClover = this.time + ZM.rand(150, 240);
      this.frenzyT = ZM.FRENZY_SECONDS;
      this.burst(x, y, 'spark', 30, [0.6, 1, 0.5], 11, PF.ADD);
      this.addText(ZM.t('LUCKY FRENZY!'), x, y - 2, [0.7, 1, 0.5], 1.4);
      this.emit('frenzy');
      if (this.audio) this.audio.frenzy();
      ZM.Native.haptic('heavy');
    }

    flowerPop(i) {
      const d = this.flowerDecor.find((q) => q.i === i);
      const lv = this.level;
      const x = (i % lv.W) + 0.5, y = ((i / lv.W) | 0) + 0.5;
      const c = d ? d.c : [1, 1, 1];
      for (let k = 0; k < 7; k++) {
        const a = Math.random() * ZM.TAU, s = ZM.rand(2, 6);
        this.particles.spawn(3, x, y, Math.cos(a) * s, Math.sin(a) * s - 1, ZM.rand(0.9, 1.6), 0.7, 0.4, a, ZM.rand(-6, 6), c, 1, PF.FLUTTER, 2.2);
      }
      if (Math.random() < 0.3 && this.butterflies.length < 10) this.spawnButterfly(x, y, c);
      if (this.audio) this.audio.pop();
    }

    burst(x, y, spr, n, c, sp, flags) {
      for (let k = 0; k < n; k++) {
        const a = Math.random() * ZM.TAU, s = ZM.rand(0.3, 1) * sp;
        this.particles.spawn(spr, x, y, Math.cos(a) * s, Math.sin(a) * s, ZM.rand(0.5, 1.0), ZM.rand(0.8, 1.6), 0.1, a, ZM.rand(-4, 4), c, 1, flags, 2.5);
      }
    }

    addText(str, x, y, color, scale) {
      if (this.texts.length > 34) this.texts.shift();
      this.texts.push({ str, x, y, t: 0, life: scale > 1.1 ? 1.8 : 1.15, color, scale: scale || 1 });
    }

    updateTexts(dt) {
      let w = 0;
      for (const tx of this.texts) {
        tx.t += dt;
        if (tx.t < tx.life) this.texts[w++] = tx;
      }
      this.texts.length = w;
    }

    spawnButterfly(x, y, c) {
      this.butterflies.push({ x, y, vx: ZM.rand(-2, 2), vy: ZM.rand(-3, -1), c, ph: Math.random() * 6, life: ZM.rand(6, 11), s: ZM.rand(1.4, 2.0), seed: Math.random() * 100 });
    }

    updateButterflies(dt) {
      const t = this.time;
      let w = 0;
      for (const b of this.butterflies) {
        b.life -= dt;
        b.ph += dt * 14;
        b.vx += Math.sin(t * 1.3 + b.seed) * 6 * dt;
        b.vy += Math.cos(t * 1.1 + b.seed * 1.7) * 6 * dt - 0.6 * dt;
        const sp = Math.hypot(b.vx, b.vy);
        if (sp > 4) { b.vx *= 4 / sp; b.vy *= 4 / sp; }
        b.x += b.vx * dt; b.y += b.vy * dt;
        if (b.life > 0) this.butterflies[w++] = b;
      }
      this.butterflies.length = w;
    }

    updateFlyers(dt) {
      let w = 0;
      for (const f of this.flyers) {
        f.t += dt / f.dur;
        if (f.t < 1) this.flyers[w++] = f;
        else this.emit('flyerArrived', f.target);
      }
      this.flyers.length = w;
    }

    ambient(dt) {
      const b = this.biome, lv = this.level;
      this.ambientT -= dt;
      if (this.ambientT > 0) return;
      this.ambientT = 0.22;
      const x = ZM.rand(0, lv.W), y = ZM.rand(0, lv.H);
      switch (b.fx) {
        case 'pollen': this.particles.spawn(2, x, y, ZM.rand(-0.6, 0.6), ZM.rand(-0.6, 0.2), ZM.rand(4, 7), 0.32, 0.32, 0, 0, [1, 1, 0.75], 0.55, PF.ADD | PF.FLUTTER | PF.FADEIN, 0.2); break;
        case 'petals': this.particles.spawn(3, x, ZM.rand(-4, lv.H * 0.5), ZM.rand(0.6, 1.6), ZM.rand(1.2, 2.2), ZM.rand(5, 8), 0.75, 0.6, Math.random() * 6, ZM.rand(-2, 2), ZM.mixc(b.flowers[2], [1, 1, 1], 0.4), 0.9, PF.FLUTTER | PF.FADEIN, 0.1); break;
        case 'leaves': if (Math.random() < 0.6) this.particles.spawn(4, x, ZM.rand(-4, lv.H * 0.5), ZM.rand(0.6, 1.8), ZM.rand(1.3, 2.4), ZM.rand(5, 8), 1.0, 0.9, Math.random() * 6, ZM.rand(-2.5, 2.5), ZM.hueShift([1, 0.55, 0.15], ZM.rand(-25, 20)), 0.95, PF.FLUTTER | PF.FADEIN, 0.1); break;
        case 'snow': this.particles.spawn(2, x, ZM.rand(-4, lv.H), ZM.rand(-0.4, 0.8), ZM.rand(1.0, 2.0), ZM.rand(5, 8), ZM.rand(0.3, 0.55), 0.3, 0, 0, [1, 1, 1], 0.85, PF.FLUTTER | PF.FADEIN, 0.05); break;
        case 'fireflies': this.particles.spawn(6, x, y, ZM.rand(-0.8, 0.8), ZM.rand(-0.8, 0.8), ZM.rand(3, 6), 1.3, 1.0, 0, 0, [0.75, 1, 0.45], 0.8, PF.ADD | PF.FLUTTER | PF.FADEIN, 0.05); break;
        case 'dust': this.particles.spawn(2, x, y, ZM.rand(0.8, 2), ZM.rand(-0.3, 0.3), ZM.rand(3, 5), 0.5, 0.7, 0, 0, [1, 0.92, 0.7], 0.35, PF.FADEIN, 0.1); break;
        case 'sparkle': this.particles.spawn(1, x, y, 0, 0, ZM.rand(0.8, 1.4), 0.2, 1.2, 0, 1, ZM.hueShift([1, 0.6, 0.9], ZM.rand(0, 360)), 0.8, PF.ADD | PF.FADEIN, 0.1); break;
      }
      if (b.ambience === 'meadow' && Math.random() < 0.012 && this.butterflies.length < 4) {
        this.spawnButterfly(ZM.rand(0, lv.W), lv.H + 1, ZM.rand(0, 1) < 0.5 ? b.flowers[1] : b.flowers[2]);
      }
    }

    // ---------------------------------------------------------------- draw
    draw(rend) {
      if (!this.field) return;
      const S = rend.sprites, t = this.time, f = this.field, lv = this.level;
      const nb = rend.batch, ab = rend.addBatch, ub = rend.underBatch;
      nb.reset(); ab.reset(); rend.textBatch.reset(); ub.reset();
      if (!this.uvs) this.uvs = ZM.SPR.map((n) => S[n]);
      const px = 1 / this.cam.scale; // world units per css px

      // hidden treasures (drawn before the grass so blades cover them)
      for (const i of [this.gemCell, this.cloverCell]) {
        if (i < 0) continue;
        const typ = f.type[i];
        if (typ < 3) continue;
        const x = (i % lv.W) + 0.5, y = ((i / lv.W) | 0) + 0.5;
        const bob = Math.sin(t * 2 + i) * 0.08;
        ub.push(x, y + bob, 2.0, 2.0, 0, typ === 3 ? S.gem : S.clover, 1, 1, 1, 1);
        if (Math.sin(t * 2.6 + i * 1.7) > 0.8) ab.push(x + 0.3, y - 1.2, 1.7, 1.7, t, S.spark, 1, 1, 1, 0.85);
      }
      // flowers bloom on top of the grass once it has grown back
      for (const d of this.flowerDecor) {
        const g = f.h[d.i] / f.maxH[d.i];
        if (g < 0.6) continue;
        const k = ZM.smoothstep(0.6, 0.85, g);
        const sway = Math.sin(t * 1.6 + d.x * 0.3) * 0.12;
        nb.push(d.x + sway * 0.4, d.y - 0.35, 1.3 * d.s * k, 1.3 * d.s * k, d.rot + sway, S.petals, d.c[0], d.c[1], d.c[2], 1);
        nb.push(d.x + sway * 0.4, d.y - 0.35, 1.3 * d.s * k, 1.3 * d.s * k, 0, S.fcenter, 1, 1, 1, 1);
      }
      for (const d of this.bedDecor) {
        nb.push(d.x, d.y, 1.1 * d.s, 1.1 * d.s, d.rot, S.petals, d.c[0], d.c[1], d.c[2], 1);
        nb.push(d.x, d.y, 1.1 * d.s, 1.1 * d.s, 0, S.fcenter, 1, 1, 1, 1);
      }
      // golden patch beacon
      if (this.patch) {
        const p = this.patch, pulse = 0.6 + 0.4 * Math.sin(t * 5);
        ab.push(p.x, p.y, (p.r * 2 + 3) * (0.9 + 0.1 * pulse), (p.r * 2 + 3) * (0.9 + 0.1 * pulse), 0, S.glow, this.biome.gold[0], this.biome.gold[1], this.biome.gold[2], 0.35 * pulse);
      }

      // mowers
      const frenzy = this.frenzyT > 0;
      const R = this.stats.radius * (frenzy ? 1.5 : 1);
      const skin = ZM.SKINS.find((s) => s.id === this.save.skin) || ZM.SKINS[0];
      for (const m of this.mowers) {
        const pop = m.spawnT > 0 ? ZM.easeOutBack(1 - m.spawnT) : 1;
        const size = Math.max(Math.min(R * 1.3, 7), 40 * px) * pop;
        nb.push(m.x + 0.5, m.y + 0.8, size * 1.1, size * 1.1, 0, S.shadow, 1, 1, 1, 0.55);
        const discC = frenzy ? ZM.hueShift([1, 0.4, 0.4], (t * 240) % 360) : [1, 1, 1];
        nb.push(m.x, m.y, R * 2, R * 2, m.disc, S.disc, discC[0], discC[1], discC[2], 0.55);
        const ringA = m.pointer !== null ? 0.75 : 0.45;
        nb.push(m.x, m.y, R * 2.04, R * 2.04, 0, S.ring, 1, 1, 1, ringA);
        let tint = [1, 1, 1];
        if (skin.rainbow) tint = ZM.mixc(ZM.hueShift([1, 0.5, 0.5], (t * 90 + m.idx * 60) % 360), [1, 1, 1], 0.35);
        nb.push(m.x, m.y, size, size, m.angle, S['mower_' + skin.id], tint[0], tint[1], tint[2], 1);
        if (frenzy && Math.random() < 0.6) {
          const c = ZM.hueShift([1, 0.45, 0.45], Math.random() * 360);
          this.particles.spawn(1, m.x + ZM.rand(-R, R), m.y + ZM.rand(-R, R), 0, -2, 0.6, 1.2, 0.1, 0, 3, c, 0.9, PF.ADD, 1);
        }
      }
      // finger indicators
      this.touches.forEach((tc) => {
        const a = Math.min(1, (t - tc.born) * 6);
        nb.push(tc.wx, tc.wy, 26 * px, 26 * px, 0, S.ring, 1, 1, 1, 0.7 * a);
      });

      // butterflies
      for (const b of this.butterflies) {
        const flap = 0.25 + 0.75 * Math.abs(Math.cos(b.ph));
        const a = Math.min(1, b.life);
        const ang = Math.atan2(b.vx, -b.vy) * 0.4;
        nb.push(b.x + 0.4, b.y + 1.2, b.s * flap * 0.8, b.s * 0.5, ang, S.shadow, 1, 1, 1, 0.25 * a);
        nb.push(b.x, b.y, b.s * flap, b.s, ang, S.butterfly, b.c[0], b.c[1], b.c[2], a);
      }

      this.particles.draw(rend, this.uvs);

      // flyers (gems flying to the HUD)
      for (const fl of this.flyers) {
        const tgt = ZM.ui ? ZM.ui.targetPos(fl.target) : null;
        let tx = fl.x, ty = fl.y - 20;
        if (tgt) { tx = (tgt[0] - this.cam.offX) / this.cam.scale; ty = (tgt[1] - this.cam.offY) / this.cam.scale; }
        const e = ZM.easeOutCubic(fl.t);
        const x = ZM.lerp(fl.x, tx, e), y = ZM.lerp(fl.y, ty, e) - Math.sin(fl.t * Math.PI) * 6;
        const s = 2.4 * (1 - fl.t * 0.4);
        ab.push(x, y, s * 2, s * 2, 0, S.glow, 0.5, 1, 1, 0.6);
        nb.push(x, y, s, s, Math.sin(fl.t * 10) * 0.3, S[fl.spr], 1, 1, 1, 1);
      }

      // floating earnings
      for (const tx of this.texts) {
        const u = tx.t / tx.life;
        const pop = tx.t < 0.18 ? ZM.easeOutBack(tx.t / 0.18) : 1;
        const a = u > 0.65 ? 1 - (u - 0.65) / 0.35 : 1;
        const size = 17 * px * tx.scale * pop;
        rend.text(tx.str, tx.x, tx.y - ZM.easeOutCubic(u) * 3.6 - u * 1.5, size, tx.color, a);
      }
    }
  }
  ZM.Game = Game;
})(window.ZM);
