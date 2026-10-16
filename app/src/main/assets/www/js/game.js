'use strict';
// Game simulation: mowers, multitouch steering, cutting, combos, specials, autopilot,
// level flow (play → sweep → cleared → grow) and Zen mode.
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
      this.levelEarned = 0;
      this.sessionCuts = 0;
      this.ambientT = 0;
      this.flowerDecor = [];
      this.zen = false;
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

    // ---------------------------------------------------------------- levels
    startLevel(N, restore) {
      const save = this.save;
      this.zen = false;
      this.level = ZM.generateLevel(N);
      let layers = null, type = null;
      if (restore && save.field && save.field.level === N) {
        layers = ZM.Field.decode(save.field.layers);
        type = ZM.Field.decode(save.field.type);
        this.levelEarned = save.field.earned || 0;
      } else this.levelEarned = 0;
      this.field = new ZM.Field(this.level, layers, type);
      this.biome = this.level.biome;
      this.state = layers ? 'play' : 'growing';
      this.grow = layers ? 1 : 0;
      this.hint = 0;
      this.sweepRow = 0;
      this.placeMowers();
      this.buildDecor();
      this.particles.clear();
      this.texts.length = 0;
      this.butterflies.length = 0;
      if (this.hooks.onField) this.hooks.onField(this.field);
      if (this.audio) {
        this.audio.setBiome(this.biome);
        if (!layers) this.audio.sprout();
      }
      this.emit('level', { N, biome: this.biome, restore: !!layers });
    }

    startZen() {
      if (this.zen) return;
      this.saveFieldSnapshot();
      const N = this.save.level;
      const lv = ZM.generateLevel(N);
      // a calm, full meadow: same biome, no gems/clovers, everything regrows
      for (let i = 0; i < lv.type.length; i++) if (lv.type[i] >= 3) lv.type[i] = 0;
      this.level = lv;
      this.field = new ZM.Field(lv);
      this.field.regrow = [];
      this.biome = lv.biome;
      this.zen = true;
      this.state = 'growing'; this.grow = 0; this.hint = 0;
      this.placeMowers();
      this.buildDecor();
      if (this.hooks.onField) this.hooks.onField(this.field);
      if (this.audio) { this.audio.setBiome(this.biome); this.audio.sprout(); }
      this.emit('zen', true);
    }

    stopZen() {
      if (!this.zen) return;
      this.zen = false;
      this.startLevel(this.save.level, true);
      this.emit('zen', false);
    }

    saveFieldSnapshot() {
      if (!this.field || this.zen || this.state === 'cleared') return;
      const s = this.field.serialize();
      this.save.field = { level: this.level.N, layers: s.layers, type: s.type, earned: this.levelEarned };
    }

    placeMowers() {
      const lv = this.level;
      this.mowers.length = 0;
      this.touches.forEach((t) => (t.m = null));
      const cnt = this.stats.mowers;
      for (let k = 0; k < cnt; k++) {
        const fx = (k + 1) / (cnt + 1);
        let x = lv.W * fx, y = lv.H * 0.72;
        // nudge onto grass
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
        if (this.field.type[i] !== 2) continue;
        this.flowerDecor.push({ i, x: (i % lv.W) + 0.5 + r.range(-0.25, 0.25), y: ((i / lv.W) | 0) + 0.3 + r.range(-0.2, 0.2), c: r.pick(b.flowers), s: r.range(1.0, 1.35), rot: r() * 6 });
      }
      // flowers on beds (pure decoration)
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
      const canCut = (this.state === 'play' || (this.state === 'growing' && this.grow > 0.75));

      if (this.save.boostT > 0) this.save.boostT = Math.max(0, this.save.boostT - dt);
      if (this.frenzyT > 0) { this.frenzyT -= dt; if (this.frenzyT <= 0) this.emit('frenzyEnd'); }
      if (this.combo.timer > 0) {
        this.combo.timer -= dt;
        if (this.combo.timer <= 0) { this.combo.count = 0; if (this.combo.level > 0) this.emit('comboEnd', this.combo.level); this.combo.level = 0; }
      }

      const st = this.stats;
      const frenzy = this.frenzyT > 0;
      const R = st.radius * (frenzy ? 1.5 : 1);
      const comboMult = 1 + 0.1 * Math.min(15, this.combo.level);
      const valueBase = lv.value * st.valueMult * comboMult * (this.save.boostT > 0 ? 2 : 1) * (frenzy ? 2 : 1) * (this.zen ? 0.6 : 1);
      let cutsFrame = 0, earnedFrame = 0, thickSum = 0, panSum = 0, speedSum = 0;

      for (const m of this.mowers) {
        this.moveMower(m, dt);
        speedSum += m.speed01;
        if (m.spawnT > 0) m.spawnT = Math.max(0, m.spawnT - dt * 2);
        m.disc += dt * (14 + m.speed01 * 22);
        if (canCut) {
          const res = this.cutAround(m, R, valueBase, t);
          cutsFrame += res;
          if (res > 0) { panSum += ((m.x / lv.W) * 2 - 1) * res; }
          thickSum += m._thick || 0;
        }
        // floating earnings
        m.earnTimer -= dt;
        if (m.earnTimer <= 0 && m.earnAcc > 0) {
          m.textSide = -(m.textSide || 1);
          this.addText('+' + ZM.fmt(m.earnAcc), m.x + m.textSide * R * ZM.rand(0.25, 0.6), m.y - R * 0.5, m.goldAcc ? GOLD : WHITE, m.earnAcc);
          earnedFrame += 0;
          if (this.audio) this.audio.chime(this.combo.level, (m.x / lv.W) * 2 - 1, m.goldAcc);
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
          if (newLevel <= 15) this.emit('combo', newLevel);
          if (this.audio) this.audio.combo(newLevel);
        }
        this.sessionCuts += cutsFrame;
        this.save.stats.cells += cutsFrame;
      }
      this.cutRate = this.cutRate * Math.exp(-dt * 6) + cutsFrame * (1 - Math.exp(-dt * 6)) / Math.max(dt, 1e-3);
      if (this.audio) {
        this.audio.cut(cutsFrame, cutsFrame > 0 ? thickSum / Math.max(1, this.mowers.length) : 0, cutsFrame > 0 ? panSum / cutsFrame : 0, dt);
        this.audio.motor(speedSum / Math.max(1, this.mowers.length), this.mowers.length);
      }

      f.update(dt);
      if (this.zen) this.updateRegrow(t);

      // progress & level end
      if (!this.zen) {
        const p = f.progress;
        this.hint = p > 0.88 && this.state === 'play' ? Math.min(1, this.hint + dt) : Math.max(0, this.hint - dt * 2);
        if (this.state === 'play' && (p >= 0.978 || f.remaining <= 6)) this.beginSweep();
        if (this.state === 'sweep') this.updateSweep(dt, valueBase);
      }

      this.particles.update(dt, t);
      this.updateTexts(dt);
      this.updateButterflies(dt);
      this.updateFlyers(dt);
      this.ambient(dt);
      // GPU uniforms for grass pushing
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
      if (!hasT && st.botFrac > 0 && (this.state === 'play' || this.state === 'growing')) {
        hasT = this.botTarget(m);
        maxSpd *= st.botFrac;
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

    botTarget(m) {
      const f = this.field;
      if (m.botBlock < 0 || f.block[m.botBlock] <= 0 || this.time > m.botRetarget) {
        let best = -1, bs = 0;
        for (let b = 0; b < f.block.length; b++) {
          const rem = f.block[b];
          if (rem <= 0) continue;
          const cx = (b % f.BW) * f.BS + f.BS / 2, cy = ((b / f.BW) | 0) * f.BS + f.BS / 2;
          const d = Math.hypot(cx - m.x, cy - m.y);
          let score = rem / Math.pow(d + 3, 1.35);
          for (const o of this.mowers) {
            if (o === m) continue;
            const ob = o.pointer !== null ? null : o.botBlock;
            const ox = ob !== null && ob >= 0 ? (ob % f.BW) * f.BS + f.BS / 2 : o.x;
            const oy = ob !== null && ob >= 0 ? ((ob / f.BW) | 0) * f.BS + f.BS / 2 : o.y;
            if (Math.hypot(ox - cx, oy - cy) < this.stats.radius * 2 + 4) score *= 0.25;
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

    cutAround(m, R, valueBase, now) {
      const f = this.field, lv = this.level, W = lv.W, H = lv.H;
      const R2 = R * R;
      const x0 = Math.max(0, Math.floor(m.x - R)), x1 = Math.min(W - 1, Math.floor(m.x + R));
      const y0 = Math.max(0, Math.floor(m.y - R)), y1 = Math.min(H - 1, Math.floor(m.y + R));
      const interval = this.stats.interval;
      const hx = Math.sin(m.angle), hy = -Math.cos(m.angle);
      const layers = f.layers, cool = f.cool, grass = f.grass, type = f.type;
      let cuts = 0, thick = 0, budget = 6;
      const blades = this.biome.blades;
      for (let cy = y0; cy <= y1; cy++) {
        const dy = cy + 0.5 - m.y, dy2 = dy * dy;
        if (dy2 > R2) continue;
        for (let cx = x0; cx <= x1; cx++) {
          const i = cy * W + cx;
          if (!grass[i] || layers[i] === 0 || now < cool[i]) continue;
          const dx = cx + 0.5 - m.x;
          if (dx * dx + dy2 > R2) continue;
          const L = layers[i];
          const left = f.cut(i, hx, hy);
          cool[i] = now + interval;
          const typ = type[i];
          const v = valueBase * (typ === 1 ? 10 : typ === 2 ? 3 : 1);
          m.earnAcc += v;
          if (typ === 1) m.goldAcc = true;
          this.earn(v);
          cuts++;
          thick += L;
          if (budget > 0 && Math.random() < 0.55) {
            budget--;
            const d = Math.hypot(dx, dy) || 1;
            const sp = ZM.rand(4, 9);
            const c = typ === 1 ? this.biome.gold : blades[Math.min(6, L - 1)];
            const cc = [c[0] * ZM.rand(0.85, 1.1), c[1] * ZM.rand(0.85, 1.1), c[2] * ZM.rand(0.85, 1.1)];
            this.particles.spawn(0, cx + 0.5, cy + 0.5, (dx / d) * sp + m.vx * 0.3 - (dy / d) * 3, (dy / d) * sp + m.vy * 0.3 + (dx / d) * 3,
              ZM.rand(0.45, 0.85), ZM.rand(0.7, 1.1), 0.25, Math.random() * 6, ZM.rand(-12, 12), cc, 1, 0, 3.2);
          }
          if (typ === 1 && Math.random() < 0.25) this.particles.spawn(1, cx + 0.5, cy + 0.5, ZM.rand(-2, 2), ZM.rand(-4, -1), 0.7, 1.1, 0.2, 0, 3, this.biome.gold, 0.9, PF.ADD, 1.5);
          if (left === 0) {
            if (typ === 3) this.collectGem(i);
            else if (typ === 4) this.startFrenzy(i);
            else if (typ === 2) this.flowerPop(i);
          }
        }
      }
      m._thick = cuts > 0 ? thick / cuts : 0;
      return cuts;
    }

    earn(v) {
      this.save.cash += v;
      this.save.stats.totalEarned += v;
      this.levelEarned += v;
      this.earnRate += v;
    }

    collectGem(i) {
      const lv = this.level;
      const x = (i % lv.W) + 0.5, y = ((i / lv.W) | 0) + 0.5;
      const amount = 1 + (lv.N % 10 === 0 ? 1 : 0);
      this.save.gems += amount;
      this.field.type[i] = 0; this.field.writeCell(i);
      this.burst(x, y, 'spark', 22, [0.6, 1, 1], 9, PF.ADD);
      this.flyers.push({ spr: 'gem', x, y, t: 0, dur: 0.9, target: 'gem' });
      this.addText('+' + amount + ' ' + ZM.t('GEM'), x, y - 2, [0.6, 1, 1], 0, 1.2);
      this.emit('gem', amount);
      if (this.audio) this.audio.gem();
      ZM.Native.haptic('medium');
    }

    startFrenzy(i) {
      const lv = this.level;
      const x = (i % lv.W) + 0.5, y = ((i / lv.W) | 0) + 0.5;
      this.field.type[i] = 0; this.field.writeCell(i);
      this.frenzyT = ZM.FRENZY_SECONDS;
      this.burst(x, y, 'spark', 30, [0.6, 1, 0.5], 11, PF.ADD);
      this.addText(ZM.t('LUCKY FRENZY!'), x, y - 2, [0.7, 1, 0.5], 0, 1.4);
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
      if (d) d.dead = true;
      if (Math.random() < 0.35 && this.butterflies.length < 10) this.spawnButterfly(x, y, c);
      if (this.audio) this.audio.pop();
    }

    burst(x, y, spr, n, c, sp, flags) {
      for (let k = 0; k < n; k++) {
        const a = Math.random() * ZM.TAU, s = ZM.rand(0.3, 1) * sp;
        this.particles.spawn(spr, x, y, Math.cos(a) * s, Math.sin(a) * s, ZM.rand(0.5, 1.0), ZM.rand(0.8, 1.6), 0.1, a, ZM.rand(-4, 4), c, 1, flags, 2.5);
      }
    }

    addText(str, x, y, color, value, scale) {
      if (this.texts.length > 34) this.texts.shift();
      this.texts.push({ str, x, y, t: 0, life: 1.15, color, scale: scale || 1 });
    }

    updateTexts(dt) {
      let w = 0;
      for (const tx of this.texts) {
        tx.t += dt;
        if (tx.t < tx.life) this.texts[w++] = tx;
      }
      this.texts.length = w;
    }

    beginSweep() {
      this.state = 'sweep';
      this.sweepRow = 0;
      this.sweepT = 0;
      if (this.audio) this.audio.sweep();
    }

    updateSweep(dt, valueBase) {
      const f = this.field, lv = this.level;
      this.sweepT += dt / 0.85;
      const rows = Math.min(lv.H, Math.floor(this.sweepT * lv.H));
      for (let y = this.sweepRow; y < rows; y++) {
        for (let x = 0; x < lv.W; x++) {
          const i = y * lv.W + x;
          if (!f.grass[i] || f.layers[i] === 0) continue;
          const typ = f.type[i];
          const c = f.clear(i);
          this.earn(valueBase * c * (typ === 1 ? 10 : 1));
          if (typ === 3) this.collectGem(i);
          this.particles.spawn(1, x + 0.5, y + 0.5, ZM.rand(-1, 1), ZM.rand(-3, -1), 0.8, 1.2, 0.1, 0, 2, [1, 1, 0.85], 0.9, PF.ADD, 1.5);
        }
      }
      this.sweepRow = rows;
      if (this.sweepT >= 1) this.finishLevel();
    }

    finishLevel() {
      this.state = 'cleared';
      const lv = this.level;
      const reward = Math.max(1, Math.round(this.levelEarned * ZM.levelRewardFrac));
      this.pendingReward = reward;
      this.save.stats.levels++;
      this.save.field = null;
      for (let k = 0; k < 140; k++) {
        const x = ZM.rand(0, lv.W), y = ZM.rand(-2, lv.H * 0.3);
        const c = ZM.hueShift([1, 0.3, 0.4], ZM.rand(0, 360));
        this.particles.spawn(5, x, y, ZM.rand(-3, 3), ZM.rand(2, 9), ZM.rand(1.8, 3.2), 1.0, 0.9, Math.random() * 6, ZM.rand(-8, 8), c, 1, PF.GRAV | PF.FLUTTER, 1.2);
      }
      if (this.audio) this.audio.levelClear();
      ZM.Native.haptic('success');
      this.emit('cleared', { N: lv.N, reward });
    }

    collectReward(mult) {
      if (this.state !== 'cleared') return 0;
      const amount = (this.pendingReward || 0) * (mult || 1);
      this.save.cash += amount;
      this.save.stats.totalEarned += amount;
      this.pendingReward = 0;
      this.save.level = this.level.N + 1;
      this.startLevel(this.save.level, false);
      return amount;
    }

    updateRegrow(now) {
      const f = this.field, q = f.regrow;
      // queue freshly cut cells (cool > 0 marks "cut at least once since last regrow")
      if (!this._zenScanT || now > this._zenScanT) {
        this._zenScanT = now + 0.5;
        for (let i = 0; i < f.n; i++) {
          if (f.grass[i] && f.layers[i] === 0 && f.cool[i] > 0 && f.cool[i] < now) {
            q.push([now + ZM.rand(6, 12), i]);
            f.cool[i] = -1; // marks "queued"
          }
        }
      }
      let w = 0;
      for (let k = 0; k < q.length; k++) {
        const [tt, i] = q[k];
        if (now >= tt) { f.regrowCell(i, Math.max(1, f.maxLayers[i])); f.cool[i] = 0; }
        else q[w++] = q[k];
      }
      q.length = w;
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

      // buried treasures
      for (let i = 0; i < f.n; i++) {
        const typ = f.type[i];
        if (typ < 3 || f.layers[i] === 0) continue;
        const x = (i % lv.W) + 0.5, y = ((i / lv.W) | 0) + 0.5;
        const bob = Math.sin(t * 2 + i) * 0.08;
        ub.push(x, y + bob, 2.0, 2.0, 0, typ === 3 ? S.gem : S.clover, 1, 1, 1, 1);
        if (Math.sin(t * 2.6 + i * 1.7) > 0.86) ab.push(x + 0.3, y - 1.2, 1.6, 1.6, t, S.spark, 1, 1, 1, 0.8);
      }
      // flowers standing above the grass
      for (const d of this.flowerDecor) {
        if (d.dead || f.layers[d.i] === 0) continue;
        const sway = Math.sin(t * 1.6 + d.x * 0.3) * 0.12;
        nb.push(d.x + sway * 0.4, d.y - 0.35, 1.3 * d.s, 1.3 * d.s, d.rot + sway, S.petals, d.c[0], d.c[1], d.c[2], 1);
        nb.push(d.x + sway * 0.4, d.y - 0.35, 1.3 * d.s, 1.3 * d.s, 0, S.fcenter, 1, 1, 1, 1);
      }
      for (const d of this.bedDecor) {
        nb.push(d.x, d.y, 1.1 * d.s, 1.1 * d.s, d.rot, S.petals, d.c[0], d.c[1], d.c[2], 1);
        nb.push(d.x, d.y, 1.1 * d.s, 1.1 * d.s, 0, S.fcenter, 1, 1, 1, 1);
      }

      // mowers
      const frenzy = this.frenzyT > 0;
      const R = this.stats.radius * (frenzy ? 1.5 : 1);
      const skin = ZM.SKINS.find((s) => s.id === this.save.skin) || ZM.SKINS[0];
      for (const m of this.mowers) {
        const pop = m.spawnT > 0 ? ZM.easeOutBack(1 - m.spawnT) : 1;
        const size = Math.max(R * 1.3, 40 * px) * pop;
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
        const a = Math.min(1, b.life) * 1;
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
