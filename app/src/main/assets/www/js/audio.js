'use strict';
// ASMR audio engine. Everything is synthesized at runtime – no audio files.
//  • grass: granular crunch/snip/rustle grains whose density follows the real cut rate
//  • one musical key per garden (music.js): every pitched sound – pads, the melody you
//    play while mowing, bells, chimes, birds, crickets – comes from its pentatonic scale,
//    so nothing can ever clash
//  • nature soundscapes: wind, rain, waves, brook, birds, crickets … (soundscape.js)
(function (ZM) {
  const rnd = (a, b) => a + (b - a) * Math.random();
  const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
  ZM.mtof = mtof;

  class AudioEngine {
    constructor(settings) {
      this.settings = settings;
      this.ctx = null;
      this.ready = false;
      this.grainBudget = 0;
      this.rate = 0;
      this.biome = null;
      this.muted = false;
      this.mix = { grass: 1, wind: 1, water: 1, life: 1, music: 1 };
      this.lastPop = 0; this.lastPopNote = 0;
      this.lastUpg = -1; this.upgRun = 0;
      this.live = [];
      this.voices = [];
    }

    unlock() {
      if (!this.ctx) {
        try { this.init(); } catch (e) { console.warn('audio init failed', e); return; }
      }
      if (this.ctx && this.ctx.state === 'suspended' && !this.paused && !this.sleeping) this.ctx.resume();
    }

    init() {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      const ctx = new AC({ latencyHint: 'playback' });
      this.ctx = ctx;
      this.sr = ctx.sampleRate;
      // master chain: gentle top-end taming → glue compressor → safety limiter
      this.out = ctx.createGain();
      this.master = ctx.createGain();
      this.master.gain.value = 0.9;
      const shelf = ctx.createBiquadFilter();
      shelf.type = 'highshelf'; shelf.frequency.value = 8500; shelf.gain.value = -2.5;
      const sub = ctx.createBiquadFilter(); // no rumble below what anyone can hear
      sub.type = 'highpass'; sub.frequency.value = 38; sub.Q.value = 0.6;
      const glue = ctx.createDynamicsCompressor();
      glue.threshold.value = -16; glue.knee.value = 10; glue.ratio.value = 3; glue.attack.value = 0.006; glue.release.value = 0.3;
      const lim = ctx.createDynamicsCompressor();
      lim.threshold.value = -2.5; lim.knee.value = 0; lim.ratio.value = 20; lim.attack.value = 0.002; lim.release.value = 0.12;
      this.master.connect(sub); sub.connect(shelf); shelf.connect(glue); glue.connect(lim); lim.connect(this.out); this.out.connect(ctx.destination);

      // category buses (settings: effects / music / nature) …
      this.sfx = ctx.createGain(); this.sfx.connect(this.master);
      this.music = ctx.createGain(); this.music.connect(this.master);
      this.amb = ctx.createGain(); this.amb.connect(this.master);
      this.reverb = ctx.createConvolver();
      this.reverb.buffer = this.makeIR(3.4);
      this.revOut = ctx.createGain(); this.revOut.gain.value = 0.5;
      this.reverb.connect(this.revOut); this.revOut.connect(this.master);

      // … and the channels inside them (the zen mixer moves these; in the game they stay at 1)
      this.grassGain = ctx.createGain(); this.grassGain.connect(this.sfx);
      this.jingle = ctx.createGain(); this.jingle.connect(this.sfx);    // event sounds: gems, rounds …
      this.tonal = ctx.createGain(); this.tonal.connect(this.music);    // the melody
      this.musicIn = ctx.createGain(); this.musicIn.connect(this.music); // pads, bass, bowls
      this.windBus = ctx.createGain(); this.windBus.connect(this.amb);
      this.waterBus = ctx.createGain(); this.waterBus.connect(this.amb);
      this.lifeBus = ctx.createGain(); this.lifeBus.connect(this.amb);
      // grass bus: a little warmth, soft top end
      this.grassBus = ctx.createBiquadFilter();
      this.grassBus.type = 'lowshelf'; this.grassBus.frequency.value = 400; this.grassBus.gain.value = 3;
      const grassHi = ctx.createBiquadFilter();
      grassHi.type = 'lowpass'; grassHi.frequency.value = 7600; grassHi.Q.value = 0.5;
      this.grassBus.connect(grassHi); grassHi.connect(this.grassGain);

      // Every channel has a reverb send AFTER its volume, so turning a slider down also
      // silences the echo of that channel (in 1.1 the reverb bypassed the sliders).
      const wet = () => { const g = ctx.createGain(); g.connect(this.reverb); return g; };
      this.sfxWet = wet(); this.jingleWet = wet(); this.grassWet = wet(); this.tonalWet = wet();
      this.padWet = wet(); this.windWet = wet(); this.waterWet = wet(); this.lifeWet = wet();
      const grassSend = ctx.createGain(); grassSend.gain.value = 0.1; grassHi.connect(grassSend); grassSend.connect(this.grassWet);
      this.wetFor = new Map([[this.sfx, this.sfxWet], [this.jingle, this.jingleWet], [this.grassBus, this.grassWet], [this.tonal, this.tonalWet],
        [this.musicIn, this.padWet], [this.windBus, this.windWet], [this.waterBus, this.waterWet], [this.lifeBus, this.lifeWet]]);

      this.buildBuffers();
      this.startLoops();
      this.initMusic();
      this.initSoundscape();
      this.applyVolumes();
      this.ready = true;
      if (this.biome) this.setBiome(this.biome, this.biomeOpts);
      this.sched = setInterval(() => this.schedule(), 100);
    }

    applyVolumes() {
      if (!this.ctx) return;
      const s = this.settings, t = this.ctx.currentTime, x = this.mix;
      const vol = (v, d) => (v === undefined ? d : v);
      const sfx = vol(s.sfx, 0.9), mus = vol(s.music, 0.55) * 0.9, amb = vol(s.amb, 0.7);
      const set = (node, v, tc) => node.gain.setTargetAtTime(v, t, tc || 0.05);
      this.out.gain.setTargetAtTime(this.muted || this.sleeping ? 0 : this.fade === undefined ? 1 : this.fade, t, 0.08);
      set(this.master, 0.9 * vol(s.master, 1));
      set(this.sfx, sfx); set(this.music, mus); set(this.amb, amb);
      set(this.grassGain, x.grass); set(this.tonal, x.music); set(this.musicIn, x.music);
      set(this.windBus, x.wind); set(this.waterBus, x.water); set(this.lifeBus, x.life);
      // post-fader reverb sends
      set(this.sfxWet, sfx); set(this.jingleWet, sfx); set(this.grassWet, sfx * x.grass);
      set(this.tonalWet, mus * x.music); set(this.padWet, mus * x.music);
      set(this.windWet, amb * x.wind * 0.8); set(this.waterWet, amb * x.water * 0.8); set(this.lifeWet, amb * x.life * 0.8);
    }
    setMuted(v) { this.muted = v; this.applyVolumes(); }
    setMix(m) { Object.assign(this.mix, m); this.applyVolumes(); }
    // Sleep timer: fade everything out over `sec` seconds (fadeTo(1, …) brings it back).
    fadeTo(v, sec) {
      this.fade = v;
      if (!this.ctx) return;
      const g = this.out.gain, t = this.ctx.currentTime;
      g.cancelScheduledValues(t); g.setValueAtTime(g.value, t); g.linearRampToValueAtTime(this.muted ? 0 : v, t + Math.max(0.05, sec));
    }
    ok() { return this.ready && !this.paused && this.ctx.state === 'running'; }
    pause() { this.paused = true; if (this.ctx && this.ctx.state === 'running') this.ctx.suspend(); }
    resume() { this.paused = false; if (this.ctx && this.ctx.state === 'suspended' && !this.sleeping) this.ctx.resume(); }
    sleep(v) {
      this.sleeping = v;
      if (!this.ctx) return;
      if (v) this.ctx.suspend();
      else if (!this.paused) { this.ctx.resume(); this.applyVolumes(); }
    }

    // ------------------------------------------------------------ synthesis helpers
    buf(sec, ch, rate) {
      const r = rate || this.sr;
      return this.ctx.createBuffer(ch || 1, Math.max(1, Math.floor(sec * r)), r);
    }

    makeIR(sec) {
      const b = this.buf(sec, 2), n = b.length, sr = this.sr;
      for (let c = 0; c < 2; c++) {
        const d = b.getChannelData(c);
        let lp = 0;
        for (let i = 0; i < n; i++) {
          const t = i / sr;
          const k = 0.15 + 0.8 * Math.min(1, t / sec); // high frequencies die first
          lp += (Math.random() * 2 - 1 - lp) * (1 - k * 0.92);
          const pre = t < 0.015 ? t / 0.015 : 1;
          d[i] = lp * Math.exp(-t / (sec * 0.3)) * pre * 0.6;
        }
        // a few sparse early reflections give the room some shape
        for (let e = 0; e < 6; e++) {
          const at = Math.floor(rnd(0.008, 0.07) * sr);
          if (at < n) d[at] += rnd(-0.35, 0.35);
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
      const fo = Math.min(d.length, Math.floor(0.003 * sr));
      for (let i = 0; i < d.length; i++) d[i] *= g * (i > d.length - fo ? (d.length - i) / fo : 1);
      return b;
    }

    // Seamless noise loops: 'white', 'pink' (Kellet) or 'brown'.
    noiseLoop(kind, sec, ch, rate) {
      const b = this.buf(sec, ch || 1, rate), n = b.length, sr = b.sampleRate;
      for (let c = 0; c < b.numberOfChannels; c++) {
        const d = b.getChannelData(c);
        let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, last = 0;
        for (let i = 0; i < n; i++) {
          const w = Math.random() * 2 - 1;
          if (kind === 'white') d[i] = w * 0.5;
          else if (kind === 'brown') { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; }
          else {
            b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
            b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
            d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11; b6 = w * 0.115926;
          }
        }
        const xf = Math.floor(0.25 * sr);
        for (let i = 0; i < xf; i++) { const a = i / xf; d[i] = d[i] * a + d[n - xf + i] * (1 - a); }
      }
      return this.trim(b, n - Math.floor(0.25 * sr));
    }

    trim(b, len) {
      const o = this.buf(len / b.sampleRate, b.numberOfChannels, b.sampleRate);
      for (let c = 0; c < b.numberOfChannels; c++) o.getChannelData(c).set(b.getChannelData(c).subarray(0, o.length));
      return o;
    }

    buildBuffers() {
      // grass grains: snips (crisp), rustles (airy), crunches (thick grass)
      this.snips = [];
      for (let k = 0; k < 10; k++) this.snips.push(this.grain(rnd(9, 18), rnd(2800, 5200), rnd(1.0, 1.6), rnd(0.3, 0.8), rnd(2.2, 5), 0.002, { fc: 1200, mix: 0.3 }));
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

      const half = Math.max(22050, Math.round(this.sr / 2));
      this.brown = this.noiseLoop('brown', 6, 1, half);
      this.pink = this.noiseLoop('pink', 5, 2);
      this.white = this.noiseLoop('white', 3, 1);

      // instruments – all harmonic, so the key decides everything
      this.pluckBuf = this.makePluck(72, 2.4, 0.9965, 0.5);   // kalimba, C5
      this.softPluck = this.makePluck(60, 3.2, 0.998, 0.25);  // warm kalimba, C4
      this.bellBuf = this.makeBell(84, 2.4);                  // celesta / music box, C6
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
        // kalimba tine: a warm sine body plus a very short metallic tick at the attack
        const tine = Math.sin(ZM.TAU * f0 * t) * Math.exp(-t / 0.9) * 0.55 + Math.sin(ZM.TAU * f0 * 5.4 * t) * Math.exp(-t / 0.02) * 0.07;
        const v = cur * 0.75 + tine;
        d[i] = v * (t < 0.002 ? t / 0.002 : 1);
        peak = Math.max(peak, Math.abs(d[i]));
      }
      const fo = Math.floor(0.3 * sr);
      for (let i = 0; i < d.length; i++) d[i] *= (0.85 / peak) * (i > d.length - fo ? (d.length - i) / fo : 1);
      return b;
    }

    // Harmonic bell (partials 1,2,3,4,6) with a tiny struck transient – sparkly but in tune.
    makeBell(midi, sec) {
      const b = this.buf(sec), d = b.getChannelData(0), sr = this.sr;
      const f0 = mtof(midi);
      const parts = [[1, 1, 1.3], [2, 0.3, 0.55], [3, 0.12, 0.3], [4, 0.06, 0.18], [6, 0.03, 0.1]];
      let peak = 0, lp = 0;
      for (let i = 0; i < d.length; i++) {
        const t = i / sr;
        let v = 0;
        for (const [r, a, dc] of parts) v += Math.sin(ZM.TAU * f0 * r * t) * a * Math.exp(-t / dc);
        lp += (Math.random() * 2 - 1 - lp) * 0.6;
        v += lp * Math.exp(-t / 0.0025) * 0.25;
        v *= t < 0.0015 ? t / 0.0015 : 1;
        d[i] = v; peak = Math.max(peak, Math.abs(v));
      }
      const fo = Math.floor(0.2 * sr);
      for (let i = 0; i < d.length; i++) d[i] *= (0.8 / peak) * (i > d.length - fo ? (d.length - i) / fo : 1);
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
      if (o.loop) src.loop = true;
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
      const bus = o.bus || this.sfx;
      out.connect(bus);
      if (o.rev) { const s = ctx.createGain(); s.gain.value = o.rev; out.connect(s); s.connect(this.wetFor.get(bus) || this.sfxWet); }
      const when = Math.max(o.when || 0, ctx.currentTime);
      src.start(when, o.offset || 0);
      if (o.dur) src.stop(when + o.dur);
      src.gainNode = g;
      return src;
    }

    // Remember pitched sounds for a few seconds so a key change can silence them.
    track(g, t) {
      if (g) this.live.push({ g, t });
    }

    // Play an instrument at a MIDI pitch. inst: 'pluck' | 'soft' | 'bell' | 'chime' | 'bowl'.
    // Low-priority notes (prio 0: the melody) are dropped while 6 notes already ring.
    tone(midi, inst, opts) {
      const base = { pluck: [this.pluckBuf, 72], soft: [this.softPluck, 60], bell: [this.bellBuf, 84], chime: [this.chimeBuf, 84], bowl: [this.bowlBuf, 60] }[inst || 'pluck'];
      if (!base || !base[0] || !this.ctx) return null;
      const o = Object.assign({ bus: this.jingle }, opts);
      o.rate = Math.pow(2, (midi - base[1]) / 12);
      const now = this.ctx.currentTime, when = Math.max(o.when || 0, now);
      this.voices = this.voices.filter((v) => v > now);
      if ((o.prio === undefined ? 1 : o.prio) < 1 && this.voices.length >= 6) return null;
      const src = this.play(base[0], o);
      if (src) {
        this.track(src.gainNode, when);
        this.voices.push(when + Math.min(2.5, base[0].duration / o.rate));
      }
      return src;
    }

    // ------------------------------------------------------------ continuous grass layers
    startLoops() {
      const ctx = this.ctx;
      // rustle bed
      const r = ctx.createBufferSource(); r.buffer = this.rustleBuf; r.loop = true;
      this.rustleGain = ctx.createGain(); this.rustleGain.gain.value = 0;
      const rp = ctx.createStereoPanner ? ctx.createStereoPanner() : ctx.createGain();
      this.rustlePan = rp;
      r.connect(this.rustleGain); this.rustleGain.connect(rp); rp.connect(this.grassBus);
      r.start();

      // blade swish: soft, unpitched air from the spinning blade (no motor hum)
      const w = ctx.createBufferSource(); w.buffer = this.brown; w.loop = true;
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 420; bp.Q.value = 0.6;
      this.whirrFilter = bp;
      const am = ctx.createGain(); am.gain.value = 0.85;
      const lfo = ctx.createOscillator(); lfo.frequency.value = 9;
      const lfoAmt = ctx.createGain(); lfoAmt.gain.value = 0.15;
      lfo.connect(lfoAmt); lfoAmt.connect(am.gain); lfo.start();
      this.whirrLfo = lfo;
      this.whirrGain = ctx.createGain(); this.whirrGain.gain.value = 0;
      w.connect(bp); bp.connect(am); am.connect(this.whirrGain); this.whirrGain.connect(this.grassGain);
      w.start();
    }

    // ------------------------------------------------------------ game hooks
    cut(n, thick, pan, dt) {
      if (!this.ready || this.paused || this.ctx.state !== 'running') return;
      const now = this.ctx.currentTime;
      const inst = n / Math.max(dt, 1 / 120);
      this.rate += (inst - this.rate) * (1 - Math.exp(-dt * (inst > this.rate ? 18 : 5)));
      // how much mowing is going on (0..1) – drives the melody
      const lvl = Math.min(1, this.rate / 110);
      this.mowLevel += (lvl - this.mowLevel) * (1 - Math.exp(-dt * (lvl > this.mowLevel ? 6 : 1.5)));
      if (n > 0) { this.lastCutT = now; this.mowPan += (pan - this.mowPan) * Math.min(1, dt * 4); }
      const target = Math.min(1, this.rate / 160) * 0.42;
      this.rustleGain.gain.setTargetAtTime(target, now, target > 0.01 ? 0.04 : 0.12);
      if (this.rustlePan.pan) this.rustlePan.pan.setTargetAtTime(pan * 0.6, now, 0.1);
      if (n <= 0) return;
      // more mowers → a denser, richer crunch, but not a louder one
      const gps = Math.min(48, 9 + this.rate * 0.35);
      const norm = Math.sqrt(22 / Math.max(22, gps));
      this.grainBudget = Math.min(6, this.grainBudget + gps * dt);
      while (this.grainBudget >= 1) {
        this.grainBudget -= 1;
        const th = ZM.clamp((thick - 1) / 3, 0, 1);
        const r = Math.random();
        let set, gain;
        if (r < 0.45 - th * 0.2) { set = this.snips; gain = rnd(0.25, 0.48); }
        else if (r < 0.75) { set = this.rustles; gain = rnd(0.2, 0.42); }
        else { set = this.crunches; gain = rnd(0.25, 0.5) * (0.6 + th * 0.6); }
        this.play(set[(Math.random() * set.length) | 0], {
          bus: this.grassBus, gain: gain * 0.9 * norm, rate: rnd(0.85, 1.28) - th * 0.12, pan: pan * 0.7 + rnd(-0.25, 0.25), when: now + Math.random() * 0.03,
        });
      }
    }

    motor(speed01, count) {
      if (!this.ok()) return;
      const now = this.ctx.currentTime;
      const g = (0.01 + speed01 * 0.04) * Math.min(1.6, 0.8 + count * 0.2);
      this.whirrGain.gain.setTargetAtTime(g, now, 0.2);
      this.whirrFilter.frequency.setTargetAtTime(330 + speed01 * 260, now, 0.3);
      this.whirrLfo.frequency.setTargetAtTime(7 + speed01 * 6, now, 0.3);
      this.mowers = count;
    }

    // ------------------------------------------------------------ event sounds (all in key)
    goldCut() { if (this.ctx) this.goldT = this.ctx.currentTime; }

    // a quarter of the round done: one soft bell, a step higher each time – you hear the lawn
    // getting done without a single extra note while you mow
    progressNote(step) {
      if (!this.ok()) return;
      const k = this.key, t = this.quant(2);
      this.tone(k.note(k.stableDeg(this.chordIdx, 3 + step * 2), 0), 'bell', { gain: 0.06 + step * 0.008, when: t, rev: 0.8, pan: -0.25 + step * 0.12 });
    }

    // round complete: rising arpeggio, a warm low note and a soft whoosh
    roundComplete(big) {
      if (!this.ok()) return;
      const t = this.quant(4), k = this.key, step = this.clk.beat / 4;
      const n = big ? 7 : 4, top = k.stableDeg(this.chordIdx, 10);
      for (let i = 0; i < n; i++) this.tone(k.note(top - (n - 1 - i) * 1, 1), i % 2 ? 'bell' : 'pluck', { gain: 0.14, when: t + i * step * 0.6, rev: 0.7, pan: -0.5 + i * (1 / n) });
      if (big) {
        this.tone(k.root - 12, 'soft', { gain: 0.26, when: t, rev: 0.6 });
        this.whoosh(t, 0.22, 400, 4000);
      }
    }

    autoStart() {
      if (!this.ok()) return;
      const t = this.quant(4), k = this.key, step = this.clk.beat / 4, d0 = k.stableDeg(this.chordIdx, 5);
      this.whoosh(this.ctx.currentTime, 0.2, 300, 3000);
      [0, 2, 4].forEach((d, i) => this.tone(k.note(d0 + d, 1), 'pluck', { gain: 0.13, when: t + i * step * 0.5, rev: 0.6 }));
    }

    autoEnd() {
      if (!this.ok()) return;
      const t = this.quant(4), k = this.key, d0 = k.stableDeg(this.chordIdx, 6);
      [0, -2].forEach((d, i) => this.tone(k.note(d0 + d, 1), 'pluck', { gain: 0.09, when: t + i * this.clk.beat / 2, rev: 0.6 }));
    }

    whoosh(t0, gain, f0, f1) {
      const ctx = this.ctx;
      const src = ctx.createBufferSource(); src.buffer = this.white;
      const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 1.2;
      f.frequency.setValueAtTime(f0, t0); f.frequency.exponentialRampToValueAtTime(f1, t0 + 0.6);
      const g = ctx.createGain(); g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(gain, t0 + 0.3); g.gain.linearRampToValueAtTime(0, t0 + 0.8);
      src.connect(f); f.connect(g); g.connect(this.sfx); const s = ctx.createGain(); s.gain.value = 0.5; g.connect(s); s.connect(this.sfxWet);
      src.start(t0); src.stop(t0 + 0.85);
    }

    gem() {
      if (!this.ok()) return;
      const t = this.quant(4), k = this.key, d0 = k.stableDeg(this.chordIdx, 5), step = this.clk.beat / 4;
      [0, 1, 2, 3].forEach((i) => {
        const deg = d0 + [0, 2, 3, 5][i];
        this.tone(k.note(deg, 1), 'bell', { gain: 0.15 - i * 0.015, when: t + i * step, rev: 0.75, pan: -0.3 + i * 0.2 });
      });
    }

    // golden patch collected: a sparkling cascade down the scale
    coins() {
      if (!this.ok()) return;
      const t = this.quant(4), k = this.key, step = this.clk.beat / 4;
      const top = k.stableDeg(this.chordIdx, 12);
      for (let i = 0; i < 6; i++) this.tone(k.note(top - i, 1), 'bell', { gain: 0.11 - i * 0.01, when: t + i * step * 0.75, rev: 0.7, pan: rnd(-0.5, 0.5) });
      this.tone(k.note(top - 10, 1), 'pluck', { gain: 0.12, when: t + 6 * step * 0.75, rev: 0.6 });
    }

    goldAppear() {
      if (!this.ok()) return;
      const t = this.quant(4), k = this.key, step = this.clk.beat / 4;
      const top = k.stableDeg(this.chordIdx, 11);
      for (let i = 0; i < 2; i++) this.tone(k.note(top - i * 2, 1), 'bell', { gain: 0.045, when: t + i * step, rev: 1, pan: rnd(-0.5, 0.5) });
    }

    frenzy() {
      if (!this.ok()) return;
      const ctx = this.ctx, now = ctx.currentTime;
      const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 2.5;
      f.frequency.setValueAtTime(300, now); f.frequency.exponentialRampToValueAtTime(5000, now + 0.7);
      const src = ctx.createBufferSource(); src.buffer = this.white;
      const g = ctx.createGain(); g.gain.setValueAtTime(0, now); g.gain.linearRampToValueAtTime(0.3, now + 0.5); g.gain.linearRampToValueAtTime(0, now + 0.85);
      src.connect(f); f.connect(g); g.connect(this.sfx); const s = ctx.createGain(); s.gain.value = 0.5; g.connect(s); s.connect(this.sfxWet);
      src.start(now); src.stop(now + 0.9);
      const t = this.quant(4), k = this.key, step = this.clk.beat / 4, d0 = k.stableDeg(this.chordIdx, 3);
      for (let i = 0; i < 6; i++) this.tone(k.note(d0 + i, 1), i % 2 ? 'bell' : 'pluck', { gain: 0.14, when: t + i * step * 0.5, rev: 0.7, pan: -0.5 + i * 0.2 });
    }

    pop() {
      // flower bursting into bloom: a soft pop plus a tiny high pluck in key
      if (!this.ok()) return;
      const now = this.ctx.currentTime;
      if (now - this.lastPop < 0.16) return;
      this.lastPop = now;
      this.play(this.crunches[(Math.random() * this.crunches.length) | 0], { bus: this.grassBus, gain: 0.25, rate: 1.7 });
      if (now - this.lastPopNote < 5) return; // a bed of flowers must not turn into a xylophone
      this.lastPopNote = now;
      const k = this.key;
      this.tone(k.note(9 + ((Math.random() * 5) | 0), 1), 'pluck', { gain: 0.045, when: now + 0.01, rev: 0.6, pan: rnd(-0.4, 0.4) });
    }

    sweep() { this.sprout(); }

    levelClear() {
      if (!this.ok()) return;
      const t = this.quant(4), k = this.key, step = this.clk.beat / 4;
      for (let i = 0; i <= 10; i++) {
        this.tone(k.note(i, 0) + 12, 'pluck', { gain: 0.22 - i * 0.008, when: t + i * step * 0.55, rev: 0.7, pan: (i / 10) * 1.2 - 0.6 });
      }
      this.tone(k.note(10, 0) + 12, 'bell', { gain: 0.14, when: t + 11 * step * 0.55, rev: 1 });
      this.tone(k.root - 12, 'soft', { gain: 0.3, when: t, rev: 0.6 });
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
      const k = this.key, t = this.quant(2), beat = this.clk.beat;
      [0, 2, 4].forEach((d, i) => this.tone(k.note(k.stableDeg(0, 7) + d, 1), 'bell', { gain: 0.05, when: t + 0.2 + i * beat * 0.5, rev: 1 }));
    }

    upgrade() {
      // immediate (it answers a tap) but always in key. Holding a card buys fast: the notes
      // then climb the scale one by one instead of piling up.
      if (!this.ok()) return;
      const now = this.ctx.currentTime, k = this.key;
      if (now - this.lastUpg < 0.11) return;
      this.upgRun = now - this.lastUpg < 0.7 ? (this.upgRun + 1) % 11 : 0;
      this.lastUpg = now;
      const d = k.stableDeg(this.chordIdx, 3) + this.upgRun;
      this.tone(k.note(d, 1), 'pluck', { gain: 0.2, when: now, rev: 0.4 });
      if (this.upgRun === 0) this.tone(k.note(d + 2, 1), 'pluck', { gain: 0.15, when: now + 0.08, rev: 0.5 });
      this.play(this.snips[(Math.random() * this.snips.length) | 0], { bus: this.grassBus, gain: 0.25, rate: 1.4 });
    }

    click() {
      // soft, unpitched tick
      if (!this.ok()) return;
      this.play(this.snips[(Math.random() * this.snips.length) | 0], { bus: this.sfx, gain: 0.16, rate: 1.6, filter: { type: 'highpass', freq: 1800 } });
    }

    error() {
      // muted wooden knock – no pitch
      if (!this.ok()) return;
      this.play(this.crunches[(Math.random() * this.crunches.length) | 0], { bus: this.sfx, gain: 0.5, rate: 0.55, filter: { type: 'lowpass', freq: 700 } });
    }

    zenChime() {
      if (!this.ok()) return;
      this.ensureBowl();
      const t = this.ctx.currentTime + 0.05, k = this.key;
      this.tone(k.root, 'bowl', { gain: 0.32, when: t, rev: 0.9, bus: this.musicIn });
    }
  }
  ZM.AudioEngine = AudioEngine;
})(window.ZM);
