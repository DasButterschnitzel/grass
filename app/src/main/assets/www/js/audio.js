'use strict';
// ASMR audio engine. Everything is synthesized at startup – no audio files.
//  • grass: granular crunch/snip/rustle grains whose density follows the real cut rate
//  • blade whirr that follows mower speed
//  • kalimba chimes that always land on the current chord of the generative music
//  • generative ambient pads + sparse melody, nature ambience per biome, lush reverb
(function (ZM) {
  const rnd = (a, b) => a + (b - a) * Math.random();
  const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

  class AudioEngine {
    constructor(settings) {
      this.settings = settings;
      this.ctx = null;
      this.ready = false;
      this.grainBudget = 0;
      this.rate = 0;
      this.chimeIdx = 0;
      this.biome = null;
      this.chordIdx = 0;
      this.muted = false;
    }

    unlock() {
      if (!this.ctx) {
        try { this.init(); } catch (e) { console.warn('audio init failed', e); return; }
      }
      if (this.ctx.state === 'suspended' && !this.paused) this.ctx.resume();
    }

    init() {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      const ctx = new AC({ latencyHint: 'interactive' });
      this.ctx = ctx;
      this.sr = ctx.sampleRate;
      // master chain
      this.master = ctx.createGain();
      this.master.gain.value = 0.9;
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -14; comp.knee.value = 12; comp.ratio.value = 3.5; comp.attack.value = 0.004; comp.release.value = 0.25;
      this.master.connect(comp); comp.connect(ctx.destination);
      this.sfx = ctx.createGain(); this.sfx.connect(this.master);
      this.music = ctx.createGain(); this.music.connect(this.master);
      this.amb = ctx.createGain(); this.amb.connect(this.master);
      this.reverb = ctx.createConvolver();
      this.reverb.buffer = this.makeIR(3.2);
      this.revOut = ctx.createGain(); this.revOut.gain.value = 0.55;
      this.reverb.connect(this.revOut); this.revOut.connect(this.master);
      this.sfxRev = ctx.createGain(); this.sfxRev.gain.value = 1; this.sfxRev.connect(this.reverb);
      this.musicRev = ctx.createGain(); this.musicRev.gain.value = 1; this.musicRev.connect(this.reverb);
      // shared lo-fi warmth on the grass bus: gentle top-end roll-off keeps it soft
      this.grassBus = ctx.createBiquadFilter();
      this.grassBus.type = 'lowshelf'; this.grassBus.frequency.value = 400; this.grassBus.gain.value = 3;
      const grassHi = ctx.createBiquadFilter();
      grassHi.type = 'lowpass'; grassHi.frequency.value = 7800; grassHi.Q.value = 0.5;
      this.grassBus.connect(grassHi); grassHi.connect(this.sfx);
      const grassSend = ctx.createGain(); grassSend.gain.value = 0.12; grassHi.connect(grassSend); grassSend.connect(this.reverb);

      this.buildBuffers();
      this.startLoops();
      this.applyVolumes();
      this.ready = true;
      if (this.biome) this.setBiome(this.biome);
      this.sched = setInterval(() => this.schedule(), 120);
    }

    applyVolumes() {
      if (!this.ctx) return;
      const s = this.settings, t = this.ctx.currentTime;
      const m = this.muted ? 0 : 1;
      this.sfx.gain.setTargetAtTime(s.sfx * m, t, 0.05);
      this.music.gain.setTargetAtTime(s.music * 0.85 * m, t, 0.2);
      this.amb.gain.setTargetAtTime(s.amb * m, t, 0.2);
      this.revOut.gain.setTargetAtTime(0.55 * m, t, 0.1);
    }
    setMuted(v) { this.muted = v; this.applyVolumes(); }
    ok() { return this.ready && !this.paused && this.ctx.state === 'running'; }
    pause() { this.paused = true; if (this.ctx && this.ctx.state === 'running') this.ctx.suspend(); }
    resume() { this.paused = false; if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); }

    // ------------------------------------------------------------ synthesis
    buf(sec, ch) { return this.ctx.createBuffer(ch || 1, Math.max(1, Math.floor(sec * this.sr)), this.sr); }

    makeIR(sec) {
      const b = this.buf(sec, 2), n = b.length, sr = this.sr;
      for (let c = 0; c < 2; c++) {
        const d = b.getChannelData(c);
        let lp = 0;
        for (let i = 0; i < n; i++) {
          const t = i / sr;
          const k = 0.15 + 0.8 * Math.min(1, t / sec); // damping grows over time
          lp += (Math.random() * 2 - 1 - lp) * (1 - k * 0.92);
          const pre = t < 0.012 ? t / 0.012 : 1;
          d[i] = lp * Math.exp(-t / (sec * 0.32)) * pre * 0.6;
        }
      }
      return b;
    }

    // State-variable band-pass filtered noise burst.
    grain(ms, fc, q, attackMs, tauMs, crackle, body) {
      const b = this.buf(ms / 1000), d = b.getChannelData(0), sr = this.sr;
      let low = 0, band = 0, low2 = 0, band2 = 0;
      const f = 2 * Math.sin((Math.PI * Math.min(fc, sr / 6)) / sr), damp = 1 / q;
      const f2 = 2 * Math.sin((Math.PI * body.fc) / sr);
      const att = attackMs / 1000, tau = tauMs / 1000;
      let peak = 0;
      for (let i = 0; i < d.length; i++) {
        const t = i / sr;
        let x = Math.random() * 2 - 1;
        if (crackle && Math.random() < crackle) x += (Math.random() < 0.5 ? -1 : 1) * rnd(2, 5);
        const high = x - low - damp * band; band += f * high; low += f * band;
        const high2 = x - low2 - 1.2 * band2; band2 += f2 * high2; low2 += f2 * band2;
        const env = t < att ? t / att : Math.exp(-(t - att) / tau);
        const v = (band + band2 * body.mix) * env;
        d[i] = v;
        peak = Math.max(peak, Math.abs(v));
      }
      const g = 0.9 / (peak || 1);
      // tiny fade-out to avoid clicks
      const fo = Math.min(d.length, Math.floor(0.003 * sr));
      for (let i = 0; i < d.length; i++) d[i] *= g * (i > d.length - fo ? (d.length - i) / fo : 1);
      return b;
    }

    buildBuffers() {
      // grass grains: snips (crisp), rustles (airy), crunches (thick grass)
      this.snips = [];
      for (let k = 0; k < 10; k++) this.snips.push(this.grain(rnd(9, 18), rnd(2800, 5600), rnd(1.0, 1.8), rnd(0.3, 0.8), rnd(2.2, 5), 0.002, { fc: 1200, mix: 0.3 }));
      this.rustles = [];
      for (let k = 0; k < 10; k++) this.rustles.push(this.grain(rnd(30, 70), rnd(1500, 3400), rnd(0.6, 1.1), rnd(2, 6), rnd(8, 18), 0.004, { fc: 800, mix: 0.4 }));
      this.crunches = [];
      for (let k = 0; k < 10; k++) this.crunches.push(this.grain(rnd(22, 45), rnd(1100, 2400), rnd(0.8, 1.5), rnd(0.5, 1.2), rnd(5, 12), 0.03, { fc: rnd(350, 650), mix: 0.85 }));

      // continuous rustle bed (seamless loop): dense micro-grains of band-limited noise
      {
        const sec = 2.6, b = this.buf(sec), d = b.getChannelData(0), sr = this.sr, n = d.length;
        let low = 0, band = 0;
        const f = 2 * Math.sin((Math.PI * 2500) / sr);
        let env = 0, envT = 0;
        for (let i = 0; i < n; i++) {
          if (--envT <= 0) { envT = Math.floor(rnd(0.004, 0.03) * sr); env = rnd(0.2, 1); }
          const x = Math.random() * 2 - 1;
          const high = x - low - 1.3 * band; band += f * high; low += f * band;
          d[i] = band * (0.35 + 0.65 * env);
        }
        const xf = Math.floor(0.08 * sr);
        for (let i = 0; i < xf; i++) { const a = i / xf; d[i] = d[i] * a + d[n - xf + i] * (1 - a); }
        let pk = 0; for (let i = 0; i < n - xf; i++) pk = Math.max(pk, Math.abs(d[i]));
        for (let i = 0; i < n; i++) d[i] *= 0.8 / pk;
        this.rustleBuf = this.trim(b, n - xf);
      }

      // brown noise (wind/waves/whirr)
      {
        const sec = 6, b = this.buf(sec), d = b.getChannelData(0), n = d.length, sr = this.sr;
        let last = 0;
        for (let i = 0; i < n; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; d[i] = last * 3.5; }
        const xf = Math.floor(0.2 * sr);
        for (let i = 0; i < xf; i++) { const a = i / xf; d[i] = d[i] * a + d[n - xf + i] * (1 - a); }
        this.brown = this.trim(b, n - xf);
      }
      {
        const sec = 3, b = this.buf(sec), d = b.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
        this.white = b;
      }

      // Karplus-Strong kalimba pluck at C5 (midi 72)
      this.pluckBuf = this.makePluck(72, 2.4, 0.9965, 0.5);
      this.softPluck = this.makePluck(60, 3.2, 0.998, 0.25);
      this.bellBuf = this.makeBell(84, 2.2);
    }

    trim(b, len) {
      const o = this.buf(len / this.sr);
      o.getChannelData(0).set(b.getChannelData(0).subarray(0, o.length));
      return o;
    }

    makePluck(midi, sec, decay, bright) {
      const b = this.buf(sec), d = b.getChannelData(0), sr = this.sr;
      const f0 = mtof(midi), N = Math.max(2, Math.round(sr / f0));
      const line = new Float32Array(N);
      let lp = 0;
      for (let i = 0; i < N; i++) { lp += (Math.random() * 2 - 1 - lp) * bright; line[i] = lp; }
      let idx = 0, prev = 0, peak = 0;
      for (let i = 0; i < d.length; i++) {
        const cur = line[idx];
        const next = (cur + prev) * 0.5 * decay;
        prev = cur;
        line[idx] = next;
        idx = (idx + 1) % N;
        const t = i / sr;
        // kalimba body: decaying sine partials add a woody, bell-like warmth
        const tine = Math.sin(ZM.TAU * f0 * t) * Math.exp(-t / 0.9) * 0.55 + Math.sin(ZM.TAU * f0 * 5.4 * t) * Math.exp(-t / 0.05) * 0.12;
        const v = cur * 0.75 + tine;
        d[i] = v * (t < 0.002 ? t / 0.002 : 1);
        peak = Math.max(peak, Math.abs(d[i]));
      }
      const fo = Math.floor(0.3 * sr);
      for (let i = 0; i < d.length; i++) d[i] *= (0.85 / peak) * (i > d.length - fo ? (d.length - i) / fo : 1);
      return b;
    }

    makeBell(midi, sec) {
      const b = this.buf(sec), d = b.getChannelData(0), sr = this.sr;
      const f0 = mtof(midi);
      const parts = [[1, 1, 1.4], [2.0, 0.45, 0.9], [2.76, 0.32, 0.55], [4.07, 0.18, 0.35], [5.43, 0.1, 0.22]];
      let peak = 0;
      for (let i = 0; i < d.length; i++) {
        const t = i / sr;
        let v = 0;
        for (const [r, a, dc] of parts) v += Math.sin(ZM.TAU * f0 * r * t) * a * Math.exp(-t / dc);
        v *= t < 0.003 ? t / 0.003 : 1;
        d[i] = v; peak = Math.max(peak, Math.abs(v));
      }
      for (let i = 0; i < d.length; i++) d[i] *= 0.8 / peak;
      return b;
    }

    // ------------------------------------------------------------ playback helpers
    play(buffer, opts) {
      const ctx = this.ctx;
      if (!ctx || this.paused || ctx.state !== 'running') return null;
      const o = opts || {};
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.playbackRate.value = o.rate || 1;
      const g = ctx.createGain();
      g.gain.value = o.gain === undefined ? 1 : o.gain;
      let node = src;
      if (o.filter) {
        const f = ctx.createBiquadFilter();
        f.type = o.filter.type; f.frequency.value = o.filter.freq; f.Q.value = o.filter.q || 0.7;
        node.connect(f); node = f;
      }
      node.connect(g);
      let out = g;
      if (o.pan && ctx.createStereoPanner) {
        const p = ctx.createStereoPanner(); p.pan.value = ZM.clamp(o.pan, -1, 1);
        g.connect(p); out = p;
      }
      out.connect(o.bus || this.sfx);
      if (o.rev) { const s = ctx.createGain(); s.gain.value = o.rev; out.connect(s); s.connect(o.revBus || this.sfxRev); }
      const when = o.when || ctx.currentTime;
      src.start(when, o.offset || 0);
      if (o.dur) src.stop(when + o.dur);
      return src;
    }

    note(midi, opts) {
      const o = Object.assign({}, opts);
      o.rate = Math.pow(2, (midi - 72) / 12);
      return this.play(this.pluckBuf, o);
    }

    // ------------------------------------------------------------ continuous layers
    startLoops() {
      const ctx = this.ctx;
      // rustle bed
      const r = ctx.createBufferSource(); r.buffer = this.rustleBuf; r.loop = true;
      this.rustleGain = ctx.createGain(); this.rustleGain.gain.value = 0;
      const rp = ctx.createStereoPanner ? ctx.createStereoPanner() : ctx.createGain();
      this.rustlePan = rp;
      r.connect(this.rustleGain); this.rustleGain.connect(rp); rp.connect(this.grassBus);
      r.start();

      // blade whirr: brown noise through a resonant band, amplitude-modulated by blade rotation
      const w = ctx.createBufferSource(); w.buffer = this.brown; w.loop = true;
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 520; bp.Q.value = 1.4;
      this.whirrFilter = bp;
      const am = ctx.createGain(); am.gain.value = 0.6;
      const lfo = ctx.createOscillator(); lfo.frequency.value = 22;
      const lfoAmt = ctx.createGain(); lfoAmt.gain.value = 0.35;
      lfo.connect(lfoAmt); lfoAmt.connect(am.gain); lfo.start();
      this.whirrLfo = lfo;
      this.whirrGain = ctx.createGain(); this.whirrGain.gain.value = 0;
      w.connect(bp); bp.connect(am); am.connect(this.whirrGain); this.whirrGain.connect(this.sfx);
      w.start();

      // wind
      const wind = ctx.createBufferSource(); wind.buffer = this.brown; wind.loop = true; wind.playbackRate.value = 0.8;
      this.windFilter = ctx.createBiquadFilter(); this.windFilter.type = 'lowpass'; this.windFilter.frequency.value = 500; this.windFilter.Q.value = 0.9;
      this.windGain = ctx.createGain(); this.windGain.gain.value = 0;
      wind.connect(this.windFilter); this.windFilter.connect(this.windGain); this.windGain.connect(this.amb);
      wind.start();

      // waves (ocean) – slow swells of filtered noise
      const wav = ctx.createBufferSource(); wav.buffer = this.brown; wav.loop = true; wav.playbackRate.value = 1.6;
      this.waveFilter = ctx.createBiquadFilter(); this.waveFilter.type = 'lowpass'; this.waveFilter.frequency.value = 900;
      this.waveGain = ctx.createGain(); this.waveGain.gain.value = 0;
      wav.connect(this.waveFilter); this.waveFilter.connect(this.waveGain); this.waveGain.connect(this.amb);
      wav.start();
      this.nextBird = 0; this.nextCricket = 0; this.nextWave = 0; this.nextWindMove = 0; this.nextChime = 0;
      this.nextChord = 0; this.nextMelody = 0; this.nextArp = 0;
    }

    // ------------------------------------------------------------ game hooks
    cut(n, thick, pan, dt) {
      if (!this.ready || this.paused || this.ctx.state !== 'running') return;
      const ctx = this.ctx, now = ctx.currentTime;
      const inst = n / Math.max(dt, 1 / 120);
      this.rate += (inst - this.rate) * (1 - Math.exp(-dt * (inst > this.rate ? 18 : 5)));
      const target = Math.min(1, this.rate / 160) * 0.5;
      this.rustleGain.gain.setTargetAtTime(target, now, target > 0.01 ? 0.04 : 0.12);
      if (this.rustlePan.pan) this.rustlePan.pan.setTargetAtTime(pan * 0.6, now, 0.1);
      if (n <= 0) return;
      const gps = Math.min(70, 10 + this.rate * 0.45);
      this.grainBudget = Math.min(6, this.grainBudget + gps * dt);
      while (this.grainBudget >= 1) {
        this.grainBudget -= 1;
        const th = ZM.clamp((thick - 1) / 3, 0, 1);
        const r = Math.random();
        let set, gain;
        if (r < 0.45 - th * 0.2) { set = this.snips; gain = rnd(0.25, 0.5); }
        else if (r < 0.75) { set = this.rustles; gain = rnd(0.2, 0.42); }
        else { set = this.crunches; gain = rnd(0.25, 0.5) * (0.6 + th * 0.6); }
        this.play(set[(Math.random() * set.length) | 0], {
          bus: this.grassBus, gain: gain * 0.9, rate: rnd(0.85, 1.3) - th * 0.12, pan: pan * 0.7 + rnd(-0.25, 0.25), when: now + Math.random() * 0.03,
        });
      }
    }

    motor(speed01, count) {
      if (!this.ok()) return;
      const now = this.ctx.currentTime;
      const g = (0.012 + speed01 * 0.05) * Math.min(1.6, 0.8 + count * 0.2);
      this.whirrGain.gain.setTargetAtTime(g, now, 0.15);
      this.whirrFilter.frequency.setTargetAtTime(420 + speed01 * 380, now, 0.2);
      this.whirrLfo.frequency.setTargetAtTime(16 + speed01 * 14, now, 0.2);
    }

    chordTones() {
      const mus = this.biome ? this.biome.music : { root: 60, prog: [[0, 4, 7, 11]] };
      const ch = mus.prog[this.chordIdx % mus.prog.length];
      const pcs = ch.map((s) => ((s % 12) + 12) % 12).sort((a, b) => a - b);
      return { root: mus.root, pcs: Array.from(new Set(pcs)) };
    }

    chime(comboLevel, pan, gold) {
      if (!this.ok()) return;
      const { root, pcs } = this.chordTones();
      // gentle ping-pong arpeggio that climbs with the combo
      this.chimeIdx++;
      const span = pcs.length * 2;
      const k = this.chimeIdx % (span * 2);
      const step = k < span ? k : span * 2 - k - 1;
      const oct = Math.floor(step / pcs.length);
      const lift = Math.min(2, Math.floor(comboLevel / 4)) * 12;
      const midi = root + 12 + pcs[step % pcs.length] + oct * 12 + lift * 0.5;
      this.note(Math.round(midi), { gain: (gold ? 0.32 : 0.2) * rnd(0.85, 1.1), pan: pan * 0.6, rev: 0.6 });
      if (gold) this.play(this.bellBuf, { gain: 0.12, rate: Math.pow(2, (midi + 12 - 84) / 12), pan, rev: 0.7 });
    }

    combo(level) {
      if (!this.ok()) return;
      if (level % 5 === 0) {
        const { root, pcs } = this.chordTones();
        const now = this.ctx.currentTime;
        pcs.slice(0, 4).forEach((pc, i) => this.play(this.bellBuf, { gain: 0.1, rate: Math.pow(2, (root + 24 + pc - 84) / 12), when: now + i * 0.06, rev: 0.8 }));
      }
    }

    gem() {
      if (!this.ok()) return;
      const { root, pcs } = this.chordTones();
      const now = this.ctx.currentTime;
      [0, 1, 2, 3].forEach((i) => {
        const pc = pcs[i % pcs.length] + (i >= pcs.length ? 12 : 0);
        this.play(this.bellBuf, { gain: 0.22, rate: Math.pow(2, (root + 24 + pc - 84) / 12), when: now + i * 0.075, rev: 0.8 });
      });
    }

    frenzy() {
      if (!this.ok()) return;
      const ctx = this.ctx, now = ctx.currentTime;
      const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 3;
      f.frequency.setValueAtTime(300, now); f.frequency.exponentialRampToValueAtTime(5000, now + 0.7);
      const src = ctx.createBufferSource(); src.buffer = this.white;
      const g = ctx.createGain(); g.gain.setValueAtTime(0, now); g.gain.linearRampToValueAtTime(0.35, now + 0.5); g.gain.linearRampToValueAtTime(0, now + 0.85);
      src.connect(f); f.connect(g); g.connect(this.sfx); const s = ctx.createGain(); s.gain.value = 0.5; g.connect(s); s.connect(this.sfxRev);
      src.start(now); src.stop(now + 0.9);
      const { root, pcs } = this.chordTones();
      pcs.forEach((pc, i) => this.note(root + 12 + pc, { gain: 0.22, when: now + 0.55 + i * 0.05, rev: 0.7 }));
    }

    pop() {
      if (!this.ok()) return;
      const ctx = this.ctx, now = ctx.currentTime;
      const o = ctx.createOscillator(); o.type = 'sine';
      o.frequency.setValueAtTime(rnd(700, 900), now); o.frequency.exponentialRampToValueAtTime(220, now + 0.09);
      const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, now); g.gain.exponentialRampToValueAtTime(0.18, now + 0.005); g.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);
      o.connect(g); g.connect(this.sfx); o.start(now); o.stop(now + 0.14);
    }

    sweep() {
      if (!this.ok()) return;
      const ctx = this.ctx, now = ctx.currentTime;
      const src = ctx.createBufferSource(); src.buffer = this.white;
      const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 1.2;
      f.frequency.setValueAtTime(600, now); f.frequency.exponentialRampToValueAtTime(7000, now + 0.9);
      const g = ctx.createGain(); g.gain.setValueAtTime(0, now); g.gain.linearRampToValueAtTime(0.28, now + 0.3); g.gain.linearRampToValueAtTime(0, now + 1.0);
      src.connect(f); f.connect(g); g.connect(this.sfx); const s = ctx.createGain(); s.gain.value = 0.6; g.connect(s); s.connect(this.sfxRev);
      src.start(now); src.stop(now + 1.05);
      const { root, pcs } = this.chordTones();
      for (let i = 0; i < 8; i++) {
        const pc = pcs[i % pcs.length] + Math.floor(i / pcs.length) * 12;
        this.play(this.bellBuf, { gain: 0.07, rate: Math.pow(2, (root + 12 + pc - 84) / 12), when: now + i * 0.09, rev: 0.9 });
      }
    }

    levelClear() {
      if (!this.ok()) return;
      const now = this.ctx.currentTime;
      const { root, pcs } = this.chordTones();
      const seq = [];
      for (let o = 0; o < 2; o++) for (const pc of pcs) seq.push(root + pc + o * 12);
      seq.push(root + 24);
      seq.forEach((m, i) => this.note(m, { gain: 0.3, when: now + 0.05 + i * 0.085, rev: 0.7, pan: (i / seq.length) * 1.2 - 0.6 }));
      this.play(this.bellBuf, { gain: 0.2, rate: Math.pow(2, (root + 24 - 84) / 12), when: now + 0.05 + seq.length * 0.085, rev: 1 });
      this.play(this.softPluck, { gain: 0.3, rate: Math.pow(2, (root - 12 - 60) / 12), when: now + 0.05, bus: this.music, rev: 0.6 });
    }

    sprout() {
      // new lawn growing in: a soft upward cascade of rustles plus a shimmer
      if (!this.ready || this.ctx.state !== 'running') return;
      const now = this.ctx.currentTime;
      for (let i = 0; i < 26; i++) {
        const k = i / 25;
        this.play(this.rustles[(Math.random() * this.rustles.length) | 0], {
          bus: this.grassBus, gain: 0.08 + 0.1 * Math.sin(k * Math.PI), rate: 0.75 + k * 0.6, pan: rnd(-0.7, 0.7), when: now + k * 1.3 + Math.random() * 0.04,
        });
      }
      const { root, pcs } = this.chordTones();
      pcs.forEach((pc, i) => this.play(this.bellBuf, { gain: 0.05, rate: Math.pow(2, (root + 12 + pc - 84) / 12), when: now + 0.2 + i * 0.18, rev: 1 }));
    }

    upgrade(level) {
      if (!this.ok()) return;
      const ctx = this.ctx, now = ctx.currentTime;
      const o = ctx.createOscillator(); o.type = 'triangle';
      o.frequency.setValueAtTime(380, now); o.frequency.exponentialRampToValueAtTime(980, now + 0.12);
      const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, now); g.gain.exponentialRampToValueAtTime(0.16, now + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);
      o.connect(g); g.connect(this.sfx); o.start(now); o.stop(now + 0.2);
      const { root, pcs } = this.chordTones();
      const pc = pcs[(level || 0) % pcs.length];
      this.note(root + 12 + pc + 12 * ((level || 0) % 2), { gain: 0.24, when: now + 0.05, rev: 0.5 });
    }

    coins() {
      if (!this.ok()) return;
      const now = this.ctx.currentTime;
      for (let i = 0; i < 6; i++) this.play(this.bellBuf, { gain: 0.1, rate: Math.pow(2, (rnd(0, 7) | 0) / 12) * 1.2, when: now + i * 0.05 + Math.random() * 0.02, rev: 0.5, pan: rnd(-0.5, 0.5) });
    }

    goldAppear() {
      // a soft, high "something shiny appeared" shimmer
      if (!this.ok()) return;
      const now = this.ctx.currentTime;
      const { root, pcs } = this.chordTones();
      for (let i = 0; i < 3; i++) {
        const pc = pcs[(pcs.length - 1 - i + pcs.length) % pcs.length];
        this.play(this.bellBuf, { gain: 0.06, rate: Math.pow(2, (root + 24 + pc - 84) / 12), when: now + i * 0.11, rev: 1, pan: rnd(-0.5, 0.5) });
      }
    }

    click() {
      if (!this.ok()) return;
      const ctx = this.ctx, now = ctx.currentTime;
      const o = ctx.createOscillator(); o.type = 'sine';
      o.frequency.setValueAtTime(1500, now); o.frequency.exponentialRampToValueAtTime(700, now + 0.03);
      const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, now); g.gain.exponentialRampToValueAtTime(0.12, now + 0.003); g.gain.exponentialRampToValueAtTime(0.0001, now + 0.05);
      o.connect(g); g.connect(this.sfx); o.start(now); o.stop(now + 0.06);
    }

    error() {
      if (!this.ok()) return;
      const ctx = this.ctx, now = ctx.currentTime;
      const o = ctx.createOscillator(); o.type = 'sine';
      o.frequency.setValueAtTime(240, now); o.frequency.exponentialRampToValueAtTime(150, now + 0.15);
      const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, now); g.gain.exponentialRampToValueAtTime(0.16, now + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);
      o.connect(g); g.connect(this.sfx); o.start(now); o.stop(now + 0.2);
    }

    // ------------------------------------------------------------ biome & music
    setBiome(b) {
      const changed = !this.biome || this.biome.id !== b.id || this.biome.cycle !== b.cycle;
      this.biome = b;
      if (!this.ok()) return;
      const now = this.ctx.currentTime;
      const a = b.ambience;
      this.windGain.gain.setTargetAtTime(a === 'winter' ? 0.22 : a === 'desert' ? 0.16 : a === 'neon' ? 0.05 : 0.09, now, 1.5);
      if (a !== 'ocean') this.waveGain.gain.setTargetAtTime(0, now, 1);
      if (changed) { this.chordIdx = 0; this.nextChord = now + 0.5; }
    }

    schedule() {
      if (!this.ready || this.paused || !this.biome || this.ctx.state !== 'running') return;
      const ctx = this.ctx, now = ctx.currentTime, ahead = now + 0.5;
      const b = this.biome, mus = b.music;
      // chords: every 8 seconds a new pad chord
      if (this.nextChord < ahead) {
        const t0 = Math.max(this.nextChord, now + 0.05);
        const ch = mus.prog[this.chordIdx % mus.prog.length];
        this.pad(ch.map((s) => mus.root + s), t0, 9.5);
        this.bass(mus.root - 24 + (((ch[0] % 12) + 12) % 12), t0, 9);
        this.chordIdx++;
        this.nextChord = t0 + 8;
      }
      // sparse kalimba melody from the pentatonic scale
      if (this.nextMelody < ahead) {
        const t0 = Math.max(this.nextMelody, now + 0.05);
        if (Math.random() < 0.42) {
          const sc = mus.scale;
          const deg = (Math.random() * sc.length * 2) | 0;
          const m = mus.root + 12 + sc[deg % sc.length] + (deg >= sc.length ? 12 : 0);
          this.play(this.softPluck, { bus: this.music, revBus: this.musicRev, gain: rnd(0.16, 0.26), rate: Math.pow(2, (m - 60) / 12), when: t0, rev: 0.8, pan: rnd(-0.4, 0.4) });
          if (Math.random() < 0.25) this.play(this.softPluck, { bus: this.music, revBus: this.musicRev, gain: 0.14, rate: Math.pow(2, (m + (Math.random() < 0.5 ? 5 : 7) - 60) / 12), when: t0 + 0.375, rev: 0.8 });
        }
        this.nextMelody = t0 + (b.ambience === 'night' ? 1.1 : 0.75);
      }
      // neon: soft arpeggiator
      if (b.ambience === 'neon' && this.nextArp < ahead) {
        const t0 = Math.max(this.nextArp, now + 0.05);
        const { root, pcs } = this.chordTones();
        const step = Math.floor(t0 / 0.1875) % (pcs.length * 2);
        const m = root + 12 + pcs[step % pcs.length] + (step >= pcs.length ? 12 : 0);
        this.synthBlip(m, t0);
        this.nextArp = t0 + 0.1875;
      }
      // ambience
      const a = b.ambience;
      if ((a === 'meadow' || a === 'desert') && this.nextBird < now) {
        this.bird(now + 0.1);
        this.nextBird = now + rnd(a === 'desert' ? 9 : 3.5, a === 'desert' ? 18 : 9);
      }
      if (a === 'night' && this.nextCricket < now) {
        this.cricket(now + 0.05, rnd(-0.7, 0.7));
        this.nextCricket = now + rnd(0.7, 1.6);
      }
      if (a === 'ocean' && this.nextWave < now) {
        const g = this.waveGain.gain;
        g.cancelScheduledValues(now);
        g.setValueAtTime(g.value, now);
        g.linearRampToValueAtTime(0.18, now + 2.6);
        g.linearRampToValueAtTime(0.03, now + 6.5);
        this.waveFilter.frequency.setValueAtTime(500, now);
        this.waveFilter.frequency.linearRampToValueAtTime(1300, now + 2.4);
        this.waveFilter.frequency.linearRampToValueAtTime(450, now + 6.5);
        this.nextWave = now + rnd(6.5, 8.5);
        if (Math.random() < 0.3) this.bird(now + rnd(1, 3), true);
      }
      if ((a === 'winter' || a === 'desert') && this.nextChime < now) {
        const { root, pcs } = this.chordTones();
        for (let i = 0; i < 3; i++) this.play(this.bellBuf, { bus: this.amb, gain: 0.04, rate: Math.pow(2, (root + 24 + pcs[(Math.random() * pcs.length) | 0] - 84) / 12), when: now + i * rnd(0.15, 0.4), rev: 1, pan: rnd(-0.6, 0.6) });
        this.nextChime = now + rnd(10, 22);
      }
      if (this.nextWindMove < now) {
        this.windFilter.frequency.setTargetAtTime(rnd(260, a === 'winter' ? 1200 : 750), now, 1.6);
        this.nextWindMove = now + rnd(2, 4);
      }
    }

    pad(notes, t0, dur) {
      const ctx = this.ctx;
      const filt = ctx.createBiquadFilter(); filt.type = 'lowpass'; filt.Q.value = 0.4;
      filt.frequency.setValueAtTime(500, t0);
      filt.frequency.linearRampToValueAtTime(1300, t0 + dur * 0.45);
      filt.frequency.linearRampToValueAtTime(600, t0 + dur);
      const env = ctx.createGain();
      env.gain.setValueAtTime(0, t0);
      env.gain.linearRampToValueAtTime(0.055, t0 + 2.8);
      env.gain.setValueAtTime(0.055, t0 + dur - 3.2);
      env.gain.linearRampToValueAtTime(0, t0 + dur);
      filt.connect(env); env.connect(this.music);
      const s = ctx.createGain(); s.gain.value = 0.9; env.connect(s); s.connect(this.musicRev);
      for (const m of notes) {
        for (const [type, det, amp] of [['sawtooth', -7, 0.35], ['triangle', 6, 0.8]]) {
          const o = ctx.createOscillator(); o.type = type;
          o.frequency.value = mtof(m); o.detune.value = det + rnd(-2, 2);
          const g = ctx.createGain(); g.gain.value = amp / notes.length;
          o.connect(g); g.connect(filt);
          o.start(t0); o.stop(t0 + dur + 0.1);
        }
      }
    }

    bass(m, t0, dur) {
      const ctx = this.ctx;
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = mtof(m);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(0.09, t0 + 1.5); g.gain.setValueAtTime(0.09, t0 + dur - 2.5); g.gain.linearRampToValueAtTime(0, t0 + dur);
      o.connect(g); g.connect(this.music); o.start(t0); o.stop(t0 + dur + 0.1);
    }

    synthBlip(m, t0) {
      const ctx = this.ctx;
      const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = mtof(m);
      const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 1400; f.Q.value = 2;
      const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.025, t0 + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.17);
      o.connect(f); f.connect(g); g.connect(this.music); const s = ctx.createGain(); s.gain.value = 0.6; g.connect(s); s.connect(this.musicRev);
      o.start(t0); o.stop(t0 + 0.2);
    }

    bird(t0, gull) {
      const ctx = this.ctx;
      const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : ctx.createGain();
      if (pan.pan) pan.pan.value = rnd(-0.8, 0.8);
      const out = ctx.createGain(); out.gain.value = gull ? 0.035 : 0.05;
      out.connect(pan); pan.connect(this.amb);
      const s = ctx.createGain(); s.gain.value = 0.7; out.connect(s); s.connect(this.sfxRev);
      const notes = gull ? 3 : (2 + Math.random() * 5) | 0;
      const base = gull ? rnd(900, 1300) : rnd(2400, 3600);
      let t = t0;
      for (let i = 0; i < notes; i++) {
        const o = ctx.createOscillator(); o.type = 'sine';
        const d = gull ? 0.28 : rnd(0.05, 0.12);
        const f0 = base * rnd(0.9, 1.15);
        o.frequency.setValueAtTime(f0 * (gull ? 1.3 : 0.8), t);
        o.frequency.exponentialRampToValueAtTime(f0 * (gull ? 0.75 : rnd(1.2, 1.6)), t + d);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(1, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
        o.connect(g); g.connect(out); o.start(t); o.stop(t + d + 0.02);
        t += d + rnd(0.03, 0.12);
      }
    }

    cricket(t0, p) {
      const ctx = this.ctx;
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = rnd(4200, 4800);
      const g = ctx.createGain(); g.gain.value = 0;
      const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : ctx.createGain();
      if (pan.pan) pan.pan.value = p;
      o.connect(g); g.connect(pan); pan.connect(this.amb);
      const pulses = 3 + ((Math.random() * 3) | 0);
      for (let i = 0; i < pulses; i++) {
        const t = t0 + i * 0.045;
        g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.018, t + 0.008); g.gain.linearRampToValueAtTime(0, t + 0.03);
      }
      o.start(t0); o.stop(t0 + pulses * 0.045 + 0.05);
    }
  }
  ZM.AudioEngine = AudioEngine;
})(window.ZM);
