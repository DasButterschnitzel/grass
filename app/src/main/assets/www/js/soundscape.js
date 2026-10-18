'use strict';
// Nature soundscapes: wind (with soft singing wind tones), rain, thunder far away, ocean
// waves, a brook, birds, crickets, an owl, gulls, rustling leaves, wind chimes and a singing
// bowl. Everything that has a pitch is tuned to the garden's pentatonic key (music.js).
(function (ZM) {
  const rnd = (a, b) => a + (b - a) * Math.random();
  const pick = (a) => a[(Math.random() * a.length) | 0];
  const P = ZM.AudioEngine.prototype;

  const DEFAULT = {
    wind: 0.3, gust: 0.5, air: 0.4, aeolian: 0, rain: 0, thunder: 0, waves: 0, brook: 0,
    birds: 0, crickets: 0, owl: 0, gulls: 0, leaves: 0, chimes: 0, bowl: 0, arp: false, melody: 1,
  };

  P.initSoundscape = function () {
    this.soundscape = Object.assign({}, DEFAULT);
    this.layers = {};
    this.gust = 0.4; this.gustTarget = 0.4; this.nextGust = 0;
    this.ev = { bird: 0, owl: 0, gull: 0, chime: 0, bowl: 0, thunder: 0, wave: 0, rainMove: 0 };
    this.crickets = [];
  };

  // A garden (or zen scene): its key, music style and soundscape.
  P.setBiome = function (b, opts) {
    this.biome = b; this.biomeOpts = opts;
    if (!this.ready) return;
    this.setKey(b.music, opts && opts.style);
    this.setSoundscape(b.sound || {});
  };

  P.setSoundscape = function (s) {
    const S = this.soundscape = Object.assign({}, DEFAULT, s);
    const now = this.ctx.currentTime;
    for (const name of ['wind', 'aeolian', 'rain', 'brook']) this.layer(name, S[name] > 0);
    if (this.layers.aeolian) this.tuneAeolian(this.layers.aeolian);
    if (this.layers.brook && this.layers.brook.root !== this.key.root) { this.layer('brook', false); this.layer('brook', true); }
    // a small, steady cricket choir on two neighbouring key notes
    this.crickets = [];
    if (S.crickets > 0) {
      // two crickets a fourth or fifth apart: consonant even at 4 kHz, where neighbours rub
      const k = this.key, base = k.snapFreq(4300);
      const alt = k.pcs.includes(((base - 7) % 12 + 12) % 12) ? base - 7 : base - 5;
      this.crickets = [
        { f: ZM.mtof(base), period: rnd(0.78, 0.92), pan: -0.55, a: 0.012, next: now + rnd(0.2, 1) },
        { f: ZM.mtof(alt), period: rnd(1.05, 1.25), pan: 0.6, a: 0.01, next: now + rnd(0.2, 1.2) },
        { f: ZM.mtof(base), period: rnd(1.5, 1.8), pan: 0.1, a: 0.006, next: now + rnd(0.5, 1.5) },
      ];
    }
    const e = this.ev;
    e.bird = now + rnd(1, 4); e.owl = now + rnd(6, 14); e.gull = now + rnd(4, 9); e.chime = now + rnd(2, 6);
    e.bowl = now + rnd(14, 24); e.thunder = now + rnd(20, 40); e.wave = now + 0.3;
  };

  // continuous layers are only built while they are needed (saves CPU on phones)
  P.layer = function (name, on) {
    const L = this.layers[name], now = this.ctx.currentTime;
    if (on && !L) {
      const made = this['make_' + name]();
      made.out.gain.setValueAtTime(0, now);
      made.out.gain.linearRampToValueAtTime(1, now + 2.5);
      this.layers[name] = made;
    } else if (!on && L) {
      L.out.gain.cancelScheduledValues(now);
      L.out.gain.setValueAtTime(L.out.gain.value, now);
      L.out.gain.linearRampToValueAtTime(0, now + 1.5);
      for (const s of L.srcs) { try { s.stop(now + 1.6); } catch (err) { /* already stopped */ } }
      for (const b of L.beds || []) this.stopBed(b, now + 1.6);
      delete this.layers[name];
    }
  };

  // Wind: a soft body (no sub rumble – 1.3 had 70 % of the wind's energy below 250 Hz) and
  // two airy bands left and right that open up with the gusts. All from never-repeating beds.
  P.make_wind = function () {
    const ctx = this.ctx, out = ctx.createGain(); out.connect(this.windBus);
    const bhp = ctx.createBiquadFilter(); bhp.type = 'highpass'; bhp.frequency.value = 150; bhp.Q.value = 0.6;
    const blp = ctx.createBiquadFilter(); blp.type = 'lowpass'; blp.frequency.value = 400; blp.Q.value = 0.5;
    const bg = ctx.createGain(); bg.gain.value = 0;
    bhp.connect(blp); blp.connect(bg); bg.connect(out);
    const beds = [this.bed(this.pink, bhp, { rate: 0.8, seg: [3, 5.5], xf: 1.5 })];
    const air = [];
    for (const side of [-1, 1]) {
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 0.8; bp.frequency.value = 700;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3200; lp.Q.value = 0.5;
      const g = ctx.createGain(); g.gain.value = 0;
      const pan = ctx.createStereoPanner(); pan.pan.value = side * 0.6;
      bp.connect(lp); lp.connect(g); g.connect(pan); pan.connect(out);
      beds.push(this.bed(this.pink, bp, { rate: side < 0 ? 0.94 : 1.06, seg: [2.5, 4.5], xf: 1.2 }));
      air.push({ bp, g, side });
    }
    return { out, srcs: [], beds, bg, blp, air };
  };

  // "Aeolian harp": the wind makes soft tones – a stack of fifths from the key.
  P.make_aeolian = function () {
    const ctx = this.ctx, out = ctx.createGain(); out.connect(this.windBus);
    const s = ctx.createGain(); s.gain.value = 0.9; out.connect(s); s.connect(this.windWet);
    const voices = [], srcs = [];
    for (let i = 0; i < 3; i++) {
      const o = ctx.createOscillator(); o.type = 'sine';
      const vib = ctx.createOscillator(); vib.frequency.value = rnd(0.12, 0.3);
      const va = ctx.createGain(); va.gain.value = 3; vib.connect(va); va.connect(o.detune);
      const g = ctx.createGain(); g.gain.value = 0;
      o.connect(g); g.connect(out); o.start(); vib.start();
      voices.push({ o, g, ph: Math.random() * 6 }); srcs.push(o, vib);
    }
    return { out, srcs, voices };
  };
  P.tuneAeolian = function (L) {
    const k = this.key, degs = [0, 3, 6], now = this.ctx.currentTime;
    L.voices.forEach((v, i) => v.o.frequency.setTargetAtTime(ZM.mtof(k.note(degs[i], 2)), now, 0.05));
  };

  P.make_rain = function () {
    if (!this.rainBuf) this.rainBuf = this.makeRain(9);
    const ctx = this.ctx, out = ctx.createGain(); out.connect(this.waterBus);
    const g = ctx.createGain(); g.gain.value = 0.8;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 6000; lp.Q.value = 0.4;
    lp.connect(g); g.connect(out);
    const s = ctx.createGain(); s.gain.value = 0.25; g.connect(s); s.connect(this.waterWet);
    const beds = [this.bed(this.rainBuf, lp, { seg: [2.5, 4.5], xf: 1 })];
    return { out, srcs: [], beds, g, lp };
  };

  P.make_brook = function () {
    const root = this.key.root;
    if (!this.brookBuf || this.brookRoot !== root) { this.brookBuf = this.makeBrook(8); this.brookRoot = root; }
    const ctx = this.ctx, out = ctx.createGain(); out.connect(this.waterBus);
    const g = ctx.createGain(); g.gain.value = 0.7;
    g.connect(out);
    const s = ctx.createGain(); s.gain.value = 0.3; g.connect(s); s.connect(this.waterWet);
    const beds = [this.bed(this.brookBuf, g, { seg: [2, 4], xf: 0.8 })];
    return { out, srcs: [], beds, g, root };
  };

  // ------------------------------------------------------------ per tick (every 100 ms)
  P.scheduleAmbience = function (now) {
    const S = this.soundscape, e = this.ev;
    // gusts: a slow random process shared by wind, singing tones, leaves and chimes
    if (now > this.nextGust) {
      const v = Math.random();
      this.gustTarget = 0.12 + 0.88 * Math.pow(v, 1.4 - S.gust * 0.6);
      this.nextGust = now + rnd(2.5, 6.5) / (0.6 + S.gust * 0.8);
    }
    const prevG = this.gust;
    this.gust += (this.gustTarget - this.gust) * 0.026; // ~4 s to swell: a breeze, not a blast
    const g = this.gust;
    const W = this.layers.wind;
    if (W) {
      W.bg.gain.setTargetAtTime(S.wind * (0.35 + 0.65 * g) * 0.26, now, 0.6);
      W.blp.frequency.setTargetAtTime(320 + 460 * g, now, 0.8);
      for (const a of W.air) {
        a.g.gain.setTargetAtTime(S.wind * S.air * (0.06 + 0.94 * Math.pow(g, 1.6)) * 0.3, now, 0.7);
        a.bp.frequency.setTargetAtTime((450 + 950 * g) * (a.side < 0 ? 0.85 : 1.15), now, 0.9);
      }
    }
    const A = this.layers.aeolian;
    if (A) {
      A.voices.forEach((v, i) => {
        const sw = 0.5 + 0.5 * Math.sin(now * (0.11 + i * 0.05) + v.ph);
        v.g.gain.setTargetAtTime(S.aeolian * Math.pow(Math.max(0, g - 0.3) / 0.7, 1.5) * 0.016 * sw, now, 0.8);
      });
    }
    const R = this.layers.rain;
    if (R && now > e.rainMove) {
      R.g.gain.setTargetAtTime(S.rain * rnd(0.75, 1), now, 2.5);
      R.lp.frequency.setTargetAtTime(rnd(4800, 6500), now, 3);
      e.rainMove = now + rnd(4, 9);
    }
    const B = this.layers.brook;
    if (B) B.g.gain.setTargetAtTime(S.brook * 0.9, now, 1);

    const t = now + 0.15;
    if (S.birds > 0 && now > e.bird) { this.bird(t); e.bird = now + rnd(3.5, 10) / S.birds; }
    if (S.owl > 0 && now > e.owl) { this.owl(t); e.owl = now + rnd(24, 50) / S.owl; }
    if (S.gulls > 0 && now > e.gull) { this.gull(t); e.gull = now + rnd(12, 30) / S.gulls; }
    if (S.waves > 0 && now > e.wave) { this.wave(t); e.wave = now + rnd(6.5, 10); }
    if (S.thunder > 0 && now > e.thunder) { this.thunder(t); e.thunder = now + rnd(45, 100) / S.thunder; }
    if (S.bowl > 0 && now > e.bowl) { this.zenBowl(t); e.bowl = now + rnd(38, 75) / S.bowl; }
    // while you mow, the grass is the star: chimes wait for a pause (zen scenes excepted)
    const busy = !(this.musicStyle && this.musicStyle.zen) && this.mowLevel > 0.12;
    if (S.chimes > 0 && now > e.chime && g > 0.55 && g > prevG && !busy) { this.windChimes(t); e.chime = now + rnd(5, 14) / S.chimes; }
    // leaves tumbling in the gusts: soft and sparse (1.3: a crackle of 3–4 clicks a second)
    if (S.leaves > 0 && Math.random() < S.leaves * g * g * 0.45) {
      this.play(this.rustles[(Math.random() * this.rustles.length) | 0], {
        bus: this.windBus, gain: rnd(0.025, 0.06) * S.leaves, rate: rnd(1.0, 1.3), pan: rnd(-0.85, 0.85),
        filter: { type: 'bandpass', freq: rnd(1400, 2400), q: 0.7 }, when: now + Math.random() * 0.1, rev: 0.35,
      });
    }
    for (const c of this.crickets) {
      if (c.next < now - 1) c.next = now + rnd(0, c.period);
      if (c.next < now + 0.5) { this.cricket(c, c.next); c.next += c.period * rnd(0.97, 1.03); }
    }
  };

  // ------------------------------------------------------------ creatures (tuned)
  P.bird = function (t0) {
    const ctx = this.ctx, k = this.key;
    const dist = Math.random();
    const out = ctx.createGain(); out.gain.value = 0.022 + 0.03 * (1 - dist);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 7000 - dist * 3000;
    const pan = ctx.createStereoPanner(); pan.pan.value = rnd(-0.85, 0.85);
    out.connect(lp); lp.connect(pan); pan.connect(this.lifeBus);
    const s = ctx.createGain(); s.gain.value = 0.35 + dist * 0.6; pan.connect(s); s.connect(this.lifeWet);
    this.track(out, t0);
    const kind = pick(['whistle', 'trill', 'warble', 'warble', 'song']);
    const oct = kind === 'song' ? 2 : 3;
    let deg = (Math.random() * 5) | 0;
    const seq = [];
    if (kind === 'whistle') {
      deg += 2;
      seq.push([deg, 0.26, 0.1], [deg - 2, 0.3, 0.35]);
      if (Math.random() < 0.6) seq.push([deg, 0.22, 0.08], [deg - 2, 0.3, 0]);
    } else if (kind === 'trill') {
      const n = 6 + ((Math.random() * 7) | 0), d2 = deg + (Math.random() < 0.5 ? 1 : 0);
      for (let i = 0; i < n; i++) seq.push([i % 2 ? d2 : deg, 0.045, 0.028]);
    } else if (kind === 'warble') {
      const n = 4 + ((Math.random() * 4) | 0);
      for (let i = 0; i < n; i++) { deg += pick([-2, -1, 1, 1, 2]); seq.push([deg, rnd(0.06, 0.11), rnd(0.015, 0.05)]); }
    } else {
      const n = 3 + ((Math.random() * 4) | 0);
      for (let i = 0; i < n; i++) { deg += pick([-3, -2, -1, 1, 2, 3]); seq.push([deg, rnd(0.12, 0.26), rnd(0.04, 0.12)]); }
    }
    let t = t0, prevF = 0;
    for (const [d, dur, gap] of seq) {
      const f = ZM.mtof(k.note(d, oct));
      const o = ctx.createOscillator(); o.type = 'sine';
      const from = prevF && kind === 'warble' ? prevF : f * 0.93;
      o.frequency.setValueAtTime(from, t);
      o.frequency.exponentialRampToValueAtTime(f, t + Math.min(0.03, dur * 0.35));
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(1, t + 0.012);
      g.gain.setValueAtTime(1, t + dur * 0.6); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(out); o.start(t); o.stop(t + dur + 0.02);
      prevF = f; t += dur + gap;
    }
  };

  P.cricket = function (c, t0) {
    const ctx = this.ctx;
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = c.f;
    const g = ctx.createGain(); g.gain.value = 0;
    const pan = ctx.createStereoPanner(); pan.pan.value = c.pan;
    o.connect(g); g.connect(pan); pan.connect(this.lifeBus);
    const n = 3 + ((Math.random() * 2) | 0), a = c.a * this.soundscape.crickets;
    for (let i = 0; i < n; i++) {
      const t = t0 + i * 0.034;
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(a, t + 0.006); g.gain.linearRampToValueAtTime(0, t + 0.02);
    }
    o.start(t0); o.stop(t0 + n * 0.034 + 0.03);
  };

  P.lowerKeyNote = function (m) {
    let x = m - 1;
    while (!this.key.pcs.includes(((x % 12) + 12) % 12)) x--;
    return x;
  };

  // "hoo … hoo-hooo", soft and far away
  P.owl = function (t0) {
    const ctx = this.ctx, k = this.key;
    const m = k.snapFreq(rnd(360, 420)), lo = this.lowerKeyNote(m);
    const out = ctx.createGain(); out.gain.value = 0.05 * this.soundscape.owl;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1100;
    const pan = ctx.createStereoPanner(); pan.pan.value = rnd(-0.7, 0.7);
    out.connect(lp); lp.connect(pan); pan.connect(this.lifeBus);
    const s = ctx.createGain(); s.gain.value = 0.9; pan.connect(s); s.connect(this.lifeWet);
    this.track(out, t0);
    let t = t0;
    for (const [mm, dur, gap] of [[m, 0.42, 0.32], [m, 0.2, 0.08], [lo, 0.62, 0]]) {
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = ZM.mtof(mm);
      const h = ctx.createOscillator(); h.type = 'sine'; h.frequency.value = ZM.mtof(mm) * 2;
      const hg = ctx.createGain(); hg.gain.value = 0.1; h.connect(hg);
      const vib = ctx.createOscillator(); vib.frequency.value = 4.5;
      const va = ctx.createGain(); va.gain.value = 9; vib.connect(va); va.connect(o.detune); va.connect(h.detune);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(1, t + 0.07);
      g.gain.setValueAtTime(1, t + dur * 0.7); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); hg.connect(g); g.connect(out);
      for (const x of [o, h, vib]) { x.start(t); x.stop(t + dur + 0.05); }
      t += dur + gap;
    }
  };

  P.gull = function (t0) {
    const ctx = this.ctx, k = this.key;
    const out = ctx.createGain(); out.gain.value = 0.016 * this.soundscape.gulls;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1500; bp.Q.value = 2.5;
    const pan = ctx.createStereoPanner(); pan.pan.value = rnd(-0.8, 0.8);
    out.connect(bp); bp.connect(pan); pan.connect(this.lifeBus);
    const s = ctx.createGain(); s.gain.value = 0.9; pan.connect(s); s.connect(this.lifeWet);
    this.track(out, t0);
    let t = t0;
    const n = 2 + ((Math.random() * 3) | 0);
    for (let i = 0; i < n; i++) {
      const hi = k.snapFreq(rnd(1250, 1500));
      let lo = this.lowerKeyNote(hi); if (Math.random() < 0.5) lo = this.lowerKeyNote(lo);
      const dur = rnd(0.2, 0.3);
      const o = ctx.createOscillator(); o.type = 'sawtooth';
      o.frequency.setValueAtTime(ZM.mtof(hi) * 0.96, t);
      o.frequency.linearRampToValueAtTime(ZM.mtof(hi), t + 0.04);
      o.frequency.exponentialRampToValueAtTime(ZM.mtof(lo), t + dur);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(1, t + 0.03); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(out); o.start(t); o.stop(t + dur + 0.02);
      t += dur + rnd(0.1, 0.2);
    }
  };

  // ------------------------------------------------------------ water & weather
  P.wave = function (t0) {
    const ctx = this.ctx, S = this.soundscape;
    const dur = rnd(6.5, 9), peak = t0 + dur * 0.38, end = t0 + dur;
    const pan = ctx.createStereoPanner(); pan.pan.value = rnd(-0.5, 0.5); pan.connect(this.waterBus);
    const rs = ctx.createGain(); rs.gain.value = 0.3; pan.connect(rs); rs.connect(this.waterWet);
    // the swell & crash
    const src = ctx.createBufferSource(); src.buffer = this.pink; src.loop = true;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 0.4;
    lp.frequency.setValueAtTime(220, t0); lp.frequency.exponentialRampToValueAtTime(rnd(1500, 2300), peak); lp.frequency.exponentialRampToValueAtTime(260, end);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t0); g.gain.linearRampToValueAtTime(0.55 * S.waves, peak); g.gain.linearRampToValueAtTime(0.0001, end);
    src.connect(lp); lp.connect(g); g.connect(pan);
    src.start(t0, Math.random() * 3); src.stop(end + 0.1);
    // low weight
    const low = ctx.createBufferSource(); low.buffer = this.brown; low.loop = true;
    const llp = ctx.createBiquadFilter(); llp.type = 'lowpass'; llp.frequency.value = 190;
    const lg = ctx.createGain(); lg.gain.setValueAtTime(0.0001, t0); lg.gain.linearRampToValueAtTime(0.28 * S.waves, peak); lg.gain.linearRampToValueAtTime(0.0001, end);
    low.connect(llp); llp.connect(lg); lg.connect(pan);
    low.start(t0, Math.random() * 4); low.stop(end + 0.1);
    // foam fizzing back over the sand
    const fz = ctx.createBufferSource(); fz.buffer = this.pink; fz.loop = true;
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 2400;
    const fg = ctx.createGain();
    fg.gain.setValueAtTime(0.0001, t0); fg.gain.setValueAtTime(0.0001, peak - 0.2);
    fg.gain.linearRampToValueAtTime(0.16 * S.waves, peak + 0.4); fg.gain.exponentialRampToValueAtTime(0.0001, end + 1.6);
    fz.connect(hp); hp.connect(fg); fg.connect(pan);
    fz.start(t0, Math.random() * 3); fz.stop(end + 1.7);
  };

  P.thunder = function (t0) {
    const ctx = this.ctx, S = this.soundscape;
    for (let i = 0; i < 2; i++) {
      const t = t0 + i * rnd(0.6, 1.8);
      const src = ctx.createBufferSource(); src.buffer = this.brown; src.loop = true;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = rnd(110, 170);
      const g = ctx.createGain(); const a = (i ? 0.25 : 0.45) * S.thunder;
      g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(a, t + rnd(0.8, 1.6)); g.gain.exponentialRampToValueAtTime(0.0001, t + rnd(6, 9));
      const pan = ctx.createStereoPanner(); pan.pan.value = rnd(-0.6, 0.6);
      src.connect(lp); lp.connect(g); g.connect(pan); pan.connect(this.waterBus);
      const s = ctx.createGain(); s.gain.value = 0.6; pan.connect(s); s.connect(this.waterWet);
      src.start(t, Math.random() * 4); src.stop(t + 9.5);
    }
  };

  P.windChimes = function (t0) {
    this.ensureChime();
    const k = this.key, S = this.soundscape;
    let t = t0;
    const n = 2 + ((Math.random() * 4) | 0);
    for (let i = 0; i < n; i++) {
      this.tone(k.note((Math.random() * 10) | 0, 1) + 12, 'chime', { gain: rnd(0.02, 0.05) * S.chimes, when: t, pan: rnd(-0.7, 0.7), rev: 0.9, bus: this.lifeBus });
      t += rnd(0.08, 0.5);
    }
  };

  P.zenBowl = function (t0) {
    this.ensureBowl();
    const k = this.key;
    this.tone(pick([k.root, k.root, k.note(3, 0) - 12]), 'bowl', { gain: 0.26 * this.soundscape.bowl, when: t0, rev: 0.9, bus: this.musicIn, pan: rnd(-0.3, 0.3) });
  };

  // Breathing guide: a soft "ocean breath" that rises with the inhale and falls with the exhale.
  P.breathCycle = function (inhale, hold, exhale) {
    if (!this.ok()) return;
    const ctx = this.ctx, t = ctx.currentTime + 0.02, a = t + inhale, b = a + hold, c = b + exhale;
    const src = ctx.createBufferSource(); src.buffer = this.pink; src.loop = true;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 0.7;
    bp.frequency.setValueAtTime(360, t); bp.frequency.linearRampToValueAtTime(980, a); bp.frequency.setValueAtTime(980, b); bp.frequency.linearRampToValueAtTime(300, c);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.11, a); g.gain.setValueAtTime(0.11, b); g.gain.linearRampToValueAtTime(0.0001, c);
    src.connect(bp); bp.connect(g); g.connect(this.amb);
    src.start(t, Math.random() * 3); src.stop(c + 0.1);
  };

  // ------------------------------------------------------------ rendered loops & instruments
  // makes a Float32Array of length n+xf loopable and returns the first n samples
  const loopable = (d, n, xf) => {
    for (let i = 0; i < xf; i++) { const a = i / xf; d[i] = d[i] * a + d[n + i] * (1 - a); }
    return d.subarray(0, n);
  };

  P.makeRain = function (sec) {
    const sr = this.sr, n = Math.floor(sec * sr), xf = Math.floor(0.3 * sr);
    const b = this.buf(sec, 2), ch = [b.getChannelData(0), b.getChannelData(1)];
    for (let c = 0; c < 2; c++) {
      const d = new Float32Array(n + xf);
      let b0 = 0, b1 = 0, b2 = 0, hp = 0, prev = 0, lp = 0;
      for (let i = 0; i < n + xf; i++) {
        const w = Math.random() * 2 - 1;
        b0 = 0.99765 * b0 + w * 0.099046; b1 = 0.963 * b1 + w * 0.2965164; b2 = 0.57 * b2 + w * 1.0526913;
        const pink = (b0 + b1 + b2 + w * 0.1848) * 0.06;
        hp = 0.93 * (hp + pink - prev); prev = pink;
        lp += (hp - lp) * 0.6;
        d[i] = lp;
      }
      ch[c].set(loopable(d, n, xf));
    }
    // drops: tiny resonant clicks on leaves, a few deeper plops into puddles
    const drops = Math.floor(sec * 62);
    for (let k = 0; k < drops; k++) {
      const at = Math.floor(Math.random() * n);
      const big = Math.random() < 0.08;
      const f = big ? rnd(450, 1000) : rnd(1400, 4800);
      const q = big ? rnd(3, 6) : rnd(1.2, 3);
      const tau = big ? rnd(0.012, 0.028) : rnd(0.0016, 0.005);
      const amp = big ? rnd(0.05, 0.12) : Math.pow(Math.random(), 2.4) * 0.3;
      const pan = Math.random();
      const len = Math.floor(tau * 7 * sr);
      const w0 = (2 * Math.PI * f) / sr, al = Math.sin(w0) / (2 * q), cw = Math.cos(w0);
      const a0 = 1 + al, a1 = -2 * cw, a2 = 1 - al;
      let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
      for (let j = 0; j < len; j++) {
        const x = (Math.random() * 2 - 1) * Math.exp(-j / sr / tau);
        const y = (al * x - al * x2 - a1 * y1 - a2 * y2) / a0;
        x2 = x1; x1 = x; y2 = y1; y1 = y;
        const idx = (at + j) % n;
        ch[0][idx] += y * amp * (1.2 - pan); ch[1][idx] += y * amp * (0.2 + pan);
      }
    }
    this.normRms(b, 0.11);
    return b;
  };

  P.makeBrook = function (sec) {
    const sr = this.sr, n = Math.floor(sec * sr), xf = Math.floor(0.3 * sr);
    const b = this.buf(sec, 2), ch = [b.getChannelData(0), b.getChannelData(1)];
    for (let c = 0; c < 2; c++) {
      const d = new Float32Array(n + xf);
      let low = 0, band = 0, env = 0.5, envT = 0, envTarget = 0.5;
      const f = 2 * Math.sin((Math.PI * rnd(900, 1300)) / sr);
      for (let i = 0; i < n + xf; i++) {
        if (--envT <= 0) { envT = Math.floor(rnd(0.006, 0.03) * sr); envTarget = Math.pow(Math.random(), 1.5); }
        env += (envTarget - env) * 0.004;
        const x = Math.random() * 2 - 1;
        const high = x - low - 1.4 * band; band += f * high; low += f * band;
        d[i] = band * (0.25 + 0.9 * env) * 0.35;
      }
      ch[c].set(loopable(d, n, xf));
    }
    // bubbles: little upward "bloops" that start and end on key notes
    const k = this.key, notes = [];
    for (let d = -5; d < 20; d++) { const m = k.note(d, 0); const hz = ZM.mtof(m); if (hz > 550 && hz < 2300) notes.push(m); }
    const count = Math.floor(sec * 24);
    for (let i = 0; i < count; i++) {
      const at = Math.floor(Math.random() * n);
      const ni = (Math.random() * (notes.length - 1)) | 0;
      const f0 = ZM.mtof(notes[ni]), f1 = ZM.mtof(notes[ni + 1]);
      const dur = rnd(0.015, 0.05), len = Math.floor(dur * sr);
      const amp = Math.pow(Math.random(), 1.8) * 0.16, pan = Math.random();
      let ph = 0;
      for (let j = 0; j < len; j++) {
        const u = j / len;
        const fr = f0 * Math.pow(f1 / f0, Math.min(1, u * 1.6));
        ph += (ZM.TAU * fr) / sr;
        const e = (j < 80 ? j / 80 : 1) * Math.exp(-u * 4);
        const v = Math.sin(ph) * e * amp;
        const idx = (at + j) % n;
        ch[0][idx] += v * (1.1 - pan); ch[1][idx] += v * (0.1 + pan);
      }
    }
    this.normRms(b, 0.1);
    return b;
  };

  P.normRms = function (b, target) {
    let s = 0, pk = 0, cnt = 0;
    for (let c = 0; c < b.numberOfChannels; c++) {
      const d = b.getChannelData(c);
      for (let i = 0; i < d.length; i++) { s += d[i] * d[i]; pk = Math.max(pk, Math.abs(d[i])); }
      cnt += d.length;
    }
    const g = Math.min(target / Math.sqrt(s / cnt + 1e-12), 0.95 / (pk || 1));
    for (let c = 0; c < b.numberOfChannels; c++) { const d = b.getChannelData(c); for (let i = 0; i < d.length; i++) d[i] *= g; }
  };

  // wind chime at C6: harmonic tube tone with a short metallic strike
  P.ensureChime = function () {
    if (this.chimeBuf) return;
    const sec = 3.2, b = this.buf(sec), d = b.getChannelData(0), sr = this.sr, f0 = ZM.mtof(84);
    let pk = 0;
    for (let i = 0; i < d.length; i++) {
      const t = i / sr;
      let v = Math.sin(ZM.TAU * f0 * t) * Math.exp(-t / 1.4) + Math.sin(ZM.TAU * f0 * 2 * t) * 0.16 * Math.exp(-t / 0.6) +
        Math.sin(ZM.TAU * f0 * 3 * t) * 0.06 * Math.exp(-t / 0.3) + Math.sin(ZM.TAU * f0 * 2.76 * t) * 0.12 * Math.exp(-t / 0.012);
      v *= t < 0.002 ? t / 0.002 : 1;
      d[i] = v; pk = Math.max(pk, Math.abs(v));
    }
    const fo = Math.floor(0.3 * sr);
    for (let i = 0; i < d.length; i++) d[i] *= (0.8 / pk) * (i > d.length - fo ? (d.length - i) / fo : 1);
    this.chimeBuf = b;
  };

  // singing bowl at C4: harmonic partials, each split in two to give the slow shimmering beat
  P.ensureBowl = function () {
    if (this.bowlBuf) return;
    const rate = Math.max(22050, Math.round(this.sr / 2));
    const sec = 10, b = this.buf(sec, 1, rate), d = b.getChannelData(0), f0 = ZM.mtof(60);
    const parts = [[1, 1, 8, 0.55], [2, 0.42, 5.5, 0.9], [3, 0.26, 3.6, 1.3], [4, 0.12, 2.4, 1.7], [5, 0.07, 1.6, 2.2]];
    let pk = 0, lp = 0;
    for (let i = 0; i < d.length; i++) {
      const t = i / rate;
      let v = 0;
      for (const [r, a, dc, beat] of parts) {
        const f = f0 * r;
        v += a * Math.exp(-t / dc) * 0.5 * (Math.sin(ZM.TAU * (f - beat / 2) * t) + Math.sin(ZM.TAU * (f + beat / 2) * t + 0.7));
      }
      lp += (Math.random() * 2 - 1 - lp) * 0.2;
      v += lp * Math.exp(-t / 0.012) * 0.6;
      v *= t < 0.004 ? t / 0.004 : 1;
      d[i] = v; pk = Math.max(pk, Math.abs(v));
    }
    const fo = Math.floor(0.8 * rate);
    for (let i = 0; i < d.length; i++) d[i] *= (0.8 / pk) * (i > d.length - fo ? (d.length - i) / fo : 1);
    this.bowlBuf = b;
  };
})(window.ZM);
