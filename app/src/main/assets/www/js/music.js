'use strict';
// Harmony & generative music.
//
// Every garden has one key. All pitched sounds use the notes of its major pentatonic scale
// (e.g. C D E G A). A pentatonic scale contains no semitones and no tritone, so ANY
// combination of its notes is consonant – the melody you play while mowing, the bells,
// chimes, birds and crickets can never clash with each other or with the pads. The chords
// are pentatonic notes over a slowly moving bass (I – vi – IV – V and friends).
//
// Everything runs on one clock: pads change on the bar, the mowing melody is quantised to
// eighth notes, event jingles to sixteenths.
(function (ZM) {
  const PENTA = [0, 2, 4, 7, 9];
  // bass movements, in semitones above the key root
  const PROGS = {
    warm: [0, 9, 5, 7],     // I – vi – IV – V(sus)
    dreamy: [0, 2, 9, 5],   // I – ii(sus) – vi – IV
    minor: [9, 5, 0, 7],    // i – VI – III – VII of the relative minor
    calm: [0, 7, 9, 5],     // I – V(sus) – vi – IV
    still: [0, 9, 0, 5],    // zen: barely moves
    night: [9, 5, 9, 7],
  };
  // pad voicings over each bass (semitones above the root) – only pentatonic notes, spread
  // out in thirds, fourths and fifths so no two pad notes sit a second apart, and kept below
  // the melody. Over the IV bass the 3rd of the key is left out (no major seventh rub).
  const VOICING = { 0: [-5, 2, 9, 16], 2: [-3, 4, 7, 12], 4: [-5, 0, 4, 9], 5: [-3, 0, 7, 14], 7: [-5, 2, 9, 12], 9: [0, 4, 7, 14] };
  const mod = (a, n) => ((a % n) + n) % n;
  const rnd = (a, b) => a + (b - a) * Math.random();

  class Key {
    constructor(music) {
      const m = music || {};
      this.root = m.root || 60;
      this.progName = PROGS[m.prog] ? m.prog : 'warm';
      this.prog = PROGS[this.progName];
      this.bpm = m.bpm || 66;
      this.pcs = PENTA.map((p) => (this.root + p) % 12);
      this.stable = this.prog.map((b) => {
        const want = [b, b + 3, b + 4, b + 7].map((x) => mod(x, 12));
        return PENTA.map((p, i) => (want.includes(p) ? i : -1)).filter((i) => i >= 0);
      });
    }
    // MIDI note of pentatonic degree `deg` (5 degrees per octave) above root + 12·oct
    note(deg, oct) {
      const o = Math.floor(deg / 5);
      return this.root + 12 * ((oct || 0) + o) + PENTA[mod(deg, 5)];
    }
    // degree closest to `near` that is a chord tone over the current bass
    stableDeg(chordIdx, near) {
      const st = this.stable[mod(chordIdx || 0, this.prog.length)];
      let best = Math.round(near), bd = 1e9;
      for (let d = Math.floor(near) - 5; d <= Math.ceil(near) + 5; d++) {
        if (!st.includes(mod(d, 5))) continue;
        const dist = Math.abs(d - near);
        if (dist < bd) { bd = dist; best = d; }
      }
      return best;
    }
    bassNote(chordIdx) {
      let b = this.root - 12 + this.prog[mod(chordIdx, this.prog.length)];
      while (b > 52) b -= 12;
      while (b < 38) b += 12;
      return b;
    }
    voicing(chordIdx) {
      const v = VOICING[this.prog[mod(chordIdx, this.prog.length)]];
      const mid = (v[0] + v[v.length - 1]) / 2;
      let base = this.root;
      while (base + mid > 71) base -= 12;
      while (base + mid < 60) base += 12;
      return v.map((x) => base + x);
    }
    // nearest key note to a frequency (birds, crickets, owls are tuned with this)
    snapFreq(hz) {
      const m = 69 + 12 * Math.log2(hz / 440);
      let best = m, bd = 1e9;
      for (let o = -1; o <= 1; o++) for (const pc of this.pcs) {
        const cand = Math.round((m - pc) / 12) * 12 + pc + o * 12;
        if (Math.abs(cand - m) < bd) { bd = Math.abs(cand - m); best = cand; }
      }
      return best;
    }
    same(o) { return o && o.root === this.root && o.progName === this.progName && o.bpm === this.bpm; }
  }
  ZM.Key = Key;

  const P = ZM.AudioEngine.prototype;

  P.initMusic = function () {
    this.key = new Key(this.biome ? this.biome.music : null);
    this.clk = { t0: this.ctx.currentTime + 0.2, beat: 60 / this.key.bpm };
    this.step = 0;
    this.nextStepT = this.clk.t0;
    this.chordIdx = 0;
    this.chordSteps = 16; // eighths per chord (2 bars of 4/4)
    this.padVoices = [];
    this.mowLevel = 0; this.mowPan = 0; this.lastCutT = -10; this.goldT = -10;
    this.comboLevel = 0; this.mowers = 1;
    this.mel = { deg: 4, notes: 0, len: 5, rest: 0, center: 4 };
    this.idleMel = { deg: 4 };
    this.musicStyle = { melody: 1, idle: 1, pad: 1, zen: false };
  };

  // next point on the beat grid (div = subdivisions per beat)
  P.quant = function (div) {
    const now = this.ctx.currentTime + 0.03, g = this.clk.beat / (div || 4);
    return this.clk.t0 + Math.ceil((now - this.clk.t0) / g) * g;
  };

  // Switch key/tempo (new lawn or zen scene). Old pads fade fast and the reverb tail is
  // ducked, so two keys never ring together.
  P.setKey = function (music, style) {
    const key = new Key(music);
    if (style) this.musicStyle = Object.assign({ melody: 1, idle: 1, pad: 1, zen: false }, style);
    this.chordSteps = this.musicStyle.zen ? 24 : 16;
    if (key.same(this.key) && this.started) return;
    this.started = true;
    const now = this.ctx.currentTime;
    this.key = key;
    for (const v of this.padVoices) {
      for (const g of [v.env.gain, v.bg.gain]) {
        g.cancelScheduledValues(now); g.setValueAtTime(g.value, now); g.linearRampToValueAtTime(0, now + 0.7);
      }
      for (const o of v.oscs) { try { o.stop(now + 0.8); } catch (e) { /* not started */ } }
    }
    this.padVoices = [];
    // melody notes, bells and creatures of the old key: fade them (also the ones not yet started)
    for (const n of this.live) {
      const g = n.g.gain;
      g.cancelScheduledValues(now); g.setValueAtTime(g.value, now); g.linearRampToValueAtTime(0, now + 0.3);
    }
    this.live = [];
    const rv = this.revOut.gain;
    rv.cancelScheduledValues(now); rv.setValueAtTime(rv.value, now);
    rv.linearRampToValueAtTime(0.08, now + 0.25); rv.linearRampToValueAtTime(0.5, now + 2.5);
    this.clk = { t0: now + 0.35, beat: 60 / key.bpm };
    this.step = 0; this.nextStepT = this.clk.t0; this.chordIdx = 0;
    this.mel.deg = 4; this.mel.rest = 0; this.mel.notes = 0;
  };

  P.schedule = function () {
    if (!this.ready || this.paused || this.sleeping || this.ctx.state !== 'running') return;
    const now = this.ctx.currentTime, ahead = now + 0.5;
    const step8 = this.clk.beat / 2;
    if (this.nextStepT < now - 0.25) { // woke up after a pause: jump instead of bursting notes
      const k = Math.ceil((now - this.nextStepT) / step8);
      this.nextStepT += k * step8; this.step += k;
    }
    while (this.nextStepT < ahead) {
      this.onStep(this.step, Math.max(this.nextStepT, now + 0.01));
      this.step++;
      this.nextStepT += step8;
    }
    this.scheduleAmbience(now);
    if (this.live.length > 40) this.live = this.live.filter((n) => n.t > now - 5);
  };

  P.onStep = function (i, t) {
    if (i % this.chordSteps === 0) {
      this.chordIdx = Math.floor(i / this.chordSteps);
      this.startChord(this.chordIdx, t, this.chordSteps * this.clk.beat / 2);
    }
    const mowing = this.mowLevel > 0.06 && this.ctx.currentTime - this.lastCutT < 0.6;
    if (mowing) this.mowNote(i, t);
    else {
      this.mel.rest = 0;
      if (i % 2 === 0 && this.ctx.currentTime - this.lastCutT > 1.5) this.idleNote(i, t);
    }
    if (this.soundscape && this.soundscape.arp) this.arpNote(i, t);
  };

  // ------------------------------------------------------------ pads & bass
  P.startChord = function (ci, t0, dur) {
    const ctx = this.ctx, k = this.key, zen = this.musicStyle.zen;
    const lvl = 0.05 * this.musicStyle.pad;
    const att = dur * (zen ? 0.4 : 0.32), rel = dur * 0.45;
    const end = t0 + dur + rel;
    const filt = ctx.createBiquadFilter(); filt.type = 'lowpass'; filt.Q.value = 0.5;
    const fLo = zen ? 420 : 520, fHi = zen ? 1100 : 1400;
    filt.frequency.setValueAtTime(fLo, t0);
    filt.frequency.linearRampToValueAtTime(fHi, t0 + dur * 0.5);
    filt.frequency.linearRampToValueAtTime(fLo, end);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, t0);
    env.gain.linearRampToValueAtTime(lvl, t0 + att);
    env.gain.setValueAtTime(lvl, t0 + dur);
    env.gain.linearRampToValueAtTime(0, end);
    filt.connect(env); env.connect(this.musicIn);
    const s = ctx.createGain(); s.gain.value = 0.9; env.connect(s); s.connect(this.musicRev);
    const oscs = [];
    const notes = k.voicing(ci);
    for (const m of notes) {
      for (const [type, det, amp] of [['triangle', -6, 0.7], ['sine', 5, 0.6], ['sawtooth', 0, zen ? 0.06 : 0.12]]) {
        const o = ctx.createOscillator(); o.type = type;
        o.frequency.value = ZM.mtof(m); o.detune.value = det + rnd(-2, 2);
        const g = ctx.createGain(); g.gain.value = amp / notes.length;
        o.connect(g); g.connect(filt);
        o.start(t0); o.stop(end + 0.05);
        oscs.push(o);
      }
    }
    // soft shimmer an octave up on the top voice
    if (zen || Math.random() < 0.5) {
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = ZM.mtof(notes[notes.length - 1] + 12);
      const g = ctx.createGain(); g.gain.value = 0.08;
      const trem = ctx.createOscillator(); trem.frequency.value = rnd(0.15, 0.3);
      const ta = ctx.createGain(); ta.gain.value = 0.06; trem.connect(ta); ta.connect(g.gain);
      o.connect(g); g.connect(filt); o.start(t0); o.stop(end + 0.05); trem.start(t0); trem.stop(end + 0.05);
      oscs.push(o, trem);
    }
    // bass: sine + a touch of 2nd harmonic so small speakers can hear it
    const bm = k.bassNote(ci);
    const bg = ctx.createGain();
    const bl = 0.06 * this.musicStyle.pad * (zen ? 0.7 : 1);
    bg.gain.setValueAtTime(0, t0); bg.gain.linearRampToValueAtTime(bl, t0 + Math.min(1.6, dur * 0.25));
    bg.gain.setValueAtTime(bl, t0 + dur - 0.6); bg.gain.linearRampToValueAtTime(0, t0 + dur + 0.5);
    bg.connect(this.musicIn);
    for (const [mult, a] of [[1, 1], [2, 0.22]]) {
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = ZM.mtof(bm) * mult;
      const g = ctx.createGain(); g.gain.value = a; o.connect(g); g.connect(bg);
      o.start(t0); o.stop(t0 + dur + 0.6); oscs.push(o);
    }
    this.padVoices = this.padVoices.filter((v) => v.end > t0);
    this.padVoices.push({ env, bg, oscs, end: end + 0.05 });
  };

  // ------------------------------------------------------------ the melody you play by mowing
  P.mowNote = function (i, t) {
    const M = this.mel, k = this.key, now = this.ctx.currentTime;
    const lvl = this.mowLevel, onBeat = i % 2 === 0;
    if (M.rest > 0) { M.rest--; return; }
    const p = (0.3 + 0.55 * lvl) * (onBeat ? 1.15 : 0.75) * this.musicStyle.melody;
    if (Math.random() > p) return;
    // gentle random walk on the scale, pulled back towards the centre
    const center = M.center + Math.min(3, Math.floor((this.comboLevel || 0) / 3));
    const r = Math.random();
    let step = r < 0.32 ? 1 : r < 0.64 ? -1 : r < 0.76 ? 2 : r < 0.88 ? -2 : r < 0.94 ? 0 : (Math.random() < 0.5 ? 3 : -3);
    if (M.deg > center + 3) step = -Math.abs(step) || -1;
    if (M.deg < center - 3) step = Math.abs(step) || 1;
    M.deg += step;
    M.notes++;
    let phraseEnd = false;
    if (M.notes >= M.len) {
      M.deg = k.stableDeg(this.chordIdx, M.deg);
      M.rest = 1 + ((Math.random() * 3) | 0);
      M.notes = 0; M.len = 3 + ((Math.random() * 5) | 0);
      phraseEnd = true;
    }
    const gold = now - this.goldT < 1.6;
    const vel = (0.13 + 0.1 * lvl) * (onBeat ? 1.1 : 0.9) * (phraseEnd ? 1.1 : 1) * (this.musicStyle.zen ? 0.8 : 1);
    const when = t + rnd(0, 0.012);
    const pan = ZM.clamp(this.mowPan * 0.6 + rnd(-0.15, 0.15), -0.8, 0.8);
    const m = k.note(M.deg, 1);
    if (gold) {
      this.tone(m, 'bell', { gain: vel * 0.75, when, pan, rev: 0.7 });
      this.tone(m + 12, 'bell', { gain: vel * 0.25, when: when + 0.005, pan: -pan, rev: 0.9 });
    } else {
      this.tone(m, 'pluck', { gain: vel, when, pan, rev: 0.55 });
    }
    // two or more mowers: a second voice a pentatonic "third" below
    if (this.mowers > 1 && Math.random() < 0.4 + 0.1 * this.mowers) {
      this.tone(k.note(M.deg - 2, 1), 'pluck', { gain: vel * 0.5, when: when + 0.004, pan: -pan * 0.6, rev: 0.6 });
    }
  };

  // sparse kalimba while you rest
  P.idleNote = function (i, t) {
    const s = this.soundscape || {};
    const p = 0.24 * this.musicStyle.idle * (s.melody === undefined ? 1 : s.melody);
    if (Math.random() > p) return;
    const k = this.key, M = this.idleMel;
    M.deg += [-2, -1, -1, 1, 1, 2][(Math.random() * 6) | 0];
    if (M.deg < 0) M.deg = 2; if (M.deg > 9) M.deg = 7;
    if (Math.random() < 0.35) M.deg = k.stableDeg(this.chordIdx, M.deg);
    const m = k.note(M.deg, 0);
    this.tone(m, 'soft', { gain: rnd(0.14, 0.22) * (this.musicStyle.zen ? 0.85 : 1), when: t, rev: 0.85, pan: rnd(-0.4, 0.4), bus: this.musicIn });
    if (Math.random() < 0.2) this.tone(k.note(M.deg + 2, 0), 'soft', { gain: 0.1, when: t + this.clk.beat * 0.5, rev: 0.85, bus: this.musicIn });
  };

  // neon garden: soft arpeggio on sixteenths
  P.arpNote = function (i, t) {
    const k = this.key, v = k.voicing(this.chordIdx);
    const seq = [0, 1, 2, 3, 2, 1];
    for (let h = 0; h < 2; h++) {
      const n = i * 2 + h;
      const m = v[seq[n % seq.length]] + 12;
      this.synthBlip(m, t + h * this.clk.beat / 4);
    }
  };

  P.synthBlip = function (m, t0) {
    const ctx = this.ctx;
    const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = ZM.mtof(m);
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 1800; f.Q.value = 1.5;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.03, t0 + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.2);
    o.connect(f); f.connect(g); g.connect(this.tonal); const s = ctx.createGain(); s.gain.value = 0.6; g.connect(s); s.connect(this.musicRev);
    o.start(t0); o.stop(t0 + 0.22);
  };
})(window.ZM);
