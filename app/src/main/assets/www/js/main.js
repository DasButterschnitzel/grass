'use strict';
// Bootstrap: save data, renderer, audio, input, main loop, offline earnings, ads cadence.
(function (ZM) {
  const KEY = 'zenmower.save.v1';
  const $ = (id) => document.getElementById(id);

  const defaults = () => ({
    v: 1, cash: 0, gems: 0, level: 1,
    upg: { blade: 0, sharp: 0, engine: 0, fert: 0, fleet: 0, bots: 0 },
    skin: 'classic', skins: ['classic'],
    settings: { sfx: 0.9, music: 0.55, amb: 0.7, haptics: true, control: 'follow', quality: 'auto' },
    stats: { totalEarned: 0, cells: 0, levels: 0, playTime: 0 },
    rate: 0, lastSeen: Date.now(), field: null, boostT: 0,
    tutorial: { move: false, fleet: false },
    ads: { lastInter: 0, levelsSince: 0 },
    freeGemsAt: 0, created: Date.now(),
  });

  function merge(def, obj) {
    if (!obj || typeof obj !== 'object') return def;
    for (const k of Object.keys(def)) {
      if (obj[k] === undefined) continue;
      if (def[k] && typeof def[k] === 'object' && !Array.isArray(def[k])) def[k] = merge(def[k], obj[k]);
      else def[k] = obj[k];
    }
    // keep keys that have no default (e.g. field snapshot)
    if (obj.field) def.field = obj.field;
    return def;
  }

  function loadSave() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) return merge(defaults(), JSON.parse(raw));
    } catch (e) { console.warn('save corrupt, starting fresh', e); }
    return defaults();
  }

  const setLoad = (p) => { const f = $('loadFill'); if (f) f.style.width = Math.round(p * 100) + '%'; };
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  async function main() {
    const save = loadSave();
    ZM.save = save;
    setLoad(0.15);
    try {
      await Promise.race([Promise.all([document.fonts.load('64px Lilita'), document.fonts.load('16px Varela')]), wait(2500)]);
    } catch (e) { /* fall back to system fonts */ }
    ZM.fontFamily = 'Lilita, sans-serif';
    setLoad(0.35);
    await wait(16);

    const canvas = $('gl');
    let renderer;
    try { renderer = new ZM.Renderer(canvas); } catch (e) {
      console.error(e);
      $('loading').innerHTML = '<div class="load-logo"><h1>Oops</h1><p>' + ZM.t('unsupported') + '</p></div>';
      return;
    }
    ZM.renderer = renderer;
    setLoad(0.6);
    await wait(16);

    ZM.audio = new ZM.AudioEngine(save.settings);
    try { ZM.audio.init(); } catch (e) { console.warn('audio deferred', e); }
    setLoad(0.8);

    const game = new ZM.Game(save, { onField: (f) => renderer.setField(f) });
    ZM.game = game;
    const ui = new ZM.UI(game);
    ZM.ui = ui;
    game.startLevel(save.level, true);
    setLoad(1);

    // ---------------------------------------------------------------- layout & quality
    let dprCap = 2, dpr = 1;
    const qualityCap = () => {
      const q = save.settings.quality, dev = window.devicePixelRatio || 1;
      return q === 'high' ? Math.min(dev, 3) : q === 'low' ? Math.min(dev, 1.25) : Math.min(dev, 2);
    };
    const layout = () => {
      dprCap = qualityCap();
      dpr = Math.min(dpr > 1 ? dpr : dprCap, dprCap);
      renderer.resize(window.innerWidth, window.innerHeight, dpr);
      game.playRect = ui.playRect();
    };
    ZM.onQuality = () => { dpr = qualityCap(); layout(); };
    dpr = qualityCap();
    layout();
    window.addEventListener('resize', layout);
    ZM.Native.on('insets', () => setTimeout(layout, 30));

    // ---------------------------------------------------------------- input (multitouch)
    canvas.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      if (ZM.audio) ZM.audio.unlock();
      game.pointerDown(e.pointerId, e.clientX, e.clientY);
    });
    canvas.addEventListener('pointermove', (e) => game.pointerMove(e.pointerId, e.clientX, e.clientY));
    const up = (e) => game.pointerUp(e.pointerId);
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    canvas.addEventListener('lostpointercapture', up);
    document.addEventListener('contextmenu', (e) => e.preventDefault());

    // ---------------------------------------------------------------- persistence
    const persist = () => {
      try {
        game.saveFieldSnapshot();
        save.lastSeen = Date.now();
        localStorage.setItem(KEY, JSON.stringify(save));
      } catch (e) { console.warn('save failed', e); }
    };
    ZM.onSaveNeeded = () => { clearTimeout(ZM._saveT); ZM._saveT = setTimeout(persist, 400); };
    ZM.resetProgress = () => { try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ } location.reload(); };

    // ---------------------------------------------------------------- offline earnings
    const sessionStart = performance.now();
    const checkOffline = (awaySec) => {
      if (awaySec < 120 || save.rate <= 0) return;
      const bots = save.upg.bots || 0;
      const factor = bots > 0 ? 0.08 + 0.025 * bots : 0.03;
      const secs = Math.min(awaySec, (2 + bots * 0.4) * 3600);
      const amount = Math.floor(save.rate * secs * factor);
      if (amount >= 1 && !ui.modalOpen) ui.openOffline(amount, secs);
    };
    checkOffline((Date.now() - save.lastSeen) / 1000);

    // ---------------------------------------------------------------- ads cadence
    ZM.lastRewardedAt = 0;
    ZM.onLevelAdvance = () => {
      save.ads.levelsSince++;
      const now = Date.now();
      const session = (performance.now() - sessionStart) / 1000;
      const recentReward = now - ZM.lastRewardedAt < 90000;
      if (save.level >= 5 && save.ads.levelsSince >= 3 && now - save.ads.lastInter > 150000 && session > 120 && !recentReward) {
        ZM.Native.showInterstitial(() => {});
        save.ads.lastInter = now;
        save.ads.levelsSince = 0;
      }
      persist();
    };
    ZM.Native.on('adShowing', (v) => { if (ZM.audio) ZM.audio.setMuted(v); if (!v) ZM.lastRewardedAt = Date.now(); });

    // ---------------------------------------------------------------- lifecycle
    let pausedAt = 0;
    const onPause = () => {
      if (pausedAt) return;
      pausedAt = Date.now();
      persist();
      if (ZM.audio) ZM.audio.pause();
    };
    const onResume = () => {
      if (!pausedAt) return;
      const away = (Date.now() - pausedAt) / 1000;
      pausedAt = 0;
      if (ZM.audio) ZM.audio.resume();
      last = performance.now();
      checkOffline(away);
    };
    ZM.Native.on('pause', onPause);
    ZM.Native.on('resume', onResume);
    document.addEventListener('visibilitychange', () => (document.hidden ? onPause() : onResume()));
    window.addEventListener('pagehide', persist);
    ZM.Native.on('back', () => ui.onBack());

    canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); lost = true; });
    canvas.addEventListener('webglcontextrestored', () => {
      try { renderer.init(); renderer.setField(game.field); lost = false; } catch (e) { location.reload(); }
    });

    if (!save.tutorial.move) ui.showTutorial('move');

    // ---------------------------------------------------------------- main loop
    let last = performance.now(), lost = false, saveT = 0, rateT = 0, rateAcc = 0;
    let perfT = 0, perfN = 0, perfSum = 0, goodT = 0;
    const frame = (now) => {
      requestAnimationFrame(frame);
      if (ZM.debug && ZM.debug.paused) { last = now; return; }
      let dt = (now - last) / 1000;
      last = now;
      if (dt <= 0) return;
      const rawDt = dt;
      dt = Math.min(dt, 1 / 20);
      game.update(dt);
      ui.update(dt);
      save.stats.playTime += dt;

      // earning rate (for offline income)
      rateT += dt; rateAcc += game.earnRate; game.earnRate = 0;
      if (rateT >= 2) {
        const perSec = rateAcc / rateT;
        if (perSec > 0) save.rate = save.rate > 0 ? save.rate * 0.85 + perSec * 0.15 : perSec;
        rateT = 0; rateAcc = 0;
      }
      if (!lost) {
        game.draw(renderer);
        renderer.render(game, game.time);
      }
      saveT += dt;
      if (saveT > 6) { saveT = 0; persist(); }

      // adaptive resolution
      if (save.settings.quality === 'auto' && rawDt < 0.25) {
        perfSum += rawDt; perfN++; perfT += rawDt;
        if (perfT > 2) {
          const avg = perfSum / perfN;
          if (avg > 0.024 && dpr > 1) { dpr = Math.max(1, dpr - 0.25); layout(); goodT = 0; }
          else if (avg < 0.0145) { goodT += perfT; if (goodT > 8 && dpr < dprCap) { dpr = Math.min(dprCap, dpr + 0.25); layout(); goodT = 0; } }
          perfT = 0; perfN = 0; perfSum = 0;
        }
      }
    };
    requestAnimationFrame(frame);
    // Deterministic hooks for automated tests (headless browsers render slowly).
    ZM.debug = {
      step(n, h) { for (let i = 0; i < n; i++) { game.update(h || 1 / 60); ui.update(h || 1 / 60); } },
      draw() { game.draw(renderer); renderer.render(game, game.time); },
      persist,
    };
    setTimeout(() => { const l = $('loading'); if (l) l.classList.add('done'); }, 150);
    setTimeout(() => { const l = $('loading'); if (l) l.remove(); }, 900);
    ZM.ready = true;
  }

  window.addEventListener('load', () => { main().catch((e) => { console.error(e); }); });
})(window.ZM);
