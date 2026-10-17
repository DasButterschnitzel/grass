'use strict';
// Upgrades, level scaling and rewards. All tuning numbers live here.
(function (ZM) {
  // The four upgrades of the original game (Blade, Engine, Fertilizer, Sprinkler) plus our
  // multi-touch Fleet and the Autopilot for mowers you are not steering.
  const E0 = window.__econ || {};
  ZM.UPGRADES = [
    { id: 'blade', name: 'Blade', desc: 'desc_blade', base: 40, growth: E0.gb || 1.6, max: 60 },
    { id: 'engine', name: 'Engine', desc: 'desc_engine', base: 30, growth: E0.ge || 1.55, max: 60 },
    { id: 'fert', name: 'Fertilizer', desc: 'desc_fert', base: 70, growth: E0.gf || 1.6, max: Infinity },
    { id: 'sprinkler', name: 'Sprinkler', desc: 'desc_sprinkler', base: 55, growth: E0.gs || 1.65, max: 50 },
    { id: 'fleet', name: 'Fleet', desc: 'desc_fleet', base: 4000, growth: E0.gfl || 40, max: 3 },
    { id: 'bots', name: 'Autopilot', desc: 'desc_bots', base: 2000, growth: E0.gbo || 3.2, max: 10 },
  ];
  ZM.UPG = {};
  for (const u of ZM.UPGRADES) ZM.UPG[u.id] = u;

  ZM.upgradeCost = (id, lvl) => {
    const u = ZM.UPG[id];
    return Math.ceil(u.base * Math.pow(u.growth, lvl));
  };

  // Effects (world unit = one grass cell, grass height in "layers").
  ZM.stats = function (upg) {
    const blade = upg.blade || 0, engine = upg.engine || 0, fert = upg.fert || 0;
    const sprinkler = upg.sprinkler || 0, fleet = upg.fleet || 0, bots = upg.bots || 0;
    return {
      radius: 2.4 + 0.16 * blade,
      speed: 14 + 0.3 * engine,
      regrow: 0.05 * (1 + 0.2 * sprinkler), // layers per second
      valueMult: 1 + fert,                    // like the original: +100% coins per level
      mowers: 1 + fleet,
      botFrac: bots === 0 ? 0 : Math.min(0.85, 0.35 + 0.05 * bots),
    };
  };

  // Zen garden: one calm, medium-size mower; the lawn grows back quickly so it never ends.
  ZM.zenStats = () => ({ radius: 3.0, speed: 9.5, regrow: 0.1, valueMult: 0, mowers: 1, botFrac: 0 });

  // Effect label for upgrade cards: "now → next".
  ZM.upgradeEffect = function (id, lvl, next) {
    const s = ZM.stats({ [id]: lvl });
    switch (id) {
      case 'blade': return Math.round(s.radius / 2.4 * 100) + '%';
      case 'engine': return Math.round(s.speed / 14 * 100) + '%';
      case 'fert': return '×' + ZM.fmt(s.valueMult);
      case 'sprinkler': return Math.round(s.regrow / 0.05 * 100) + '%';
      case 'fleet': return String(s.mowers);
      case 'bots': return lvl === 0 ? ZM.t('off') : Math.round(s.botFrac * 100) + '%';
    }
    return '';
  };

  // Lawns (levels): the original's "Next lawn" progression, but endless. Prices grow a bit
  // faster than the lawn's value so upgrades keep mattering.
  const E = window.__econ || {}; // test-only overrides for the balancing bot
  ZM.LAWN_MULT = E.vm || 6;   // each lawn pays ×6 per blade
  ZM.LAWN_BASE = E.c0 || 6000;
  // Price growth per lawn starts steep (your mower is still growing fast) and eases towards
  // the value growth, so lawns keep a steady rhythm forever.
  const CA = E.a !== undefined ? E.a : 1.0, CB = E.b !== undefined ? E.b : 2.0, CC = E.c || 4;
  ZM.lawnValue = (N) => Math.pow(ZM.LAWN_MULT, N - 1);
  ZM.lawnCost = (N) => { // price to leave lawn N
    let c = ZM.LAWN_BASE;
    for (let k = 1; k < N; k++) c *= ZM.LAWN_MULT * (1 + CA / k + CB * Math.exp(-(k - 1) / CC));
    return c;
  };
  ZM.levelWidth = (N) => Math.min(52, 36 + 2 * (N - 1));
  ZM.MAX_LAYERS = 4;
  ZM.levelMaxLayers = (N) => Math.min(ZM.MAX_LAYERS, 1 + Math.floor(N / 2));
  ZM.levelThickness = (N) => 1 + Math.min(1.6, 0.3 * (N - 1)); // target average layers

  ZM.SKINS = [
    { id: 'classic', name: 'Classic', price: 0, body: '#e8423f', dark: '#a8221f', accent: '#2b2b33' },
    { id: 'mint', name: 'Mint Breeze', price: 25, body: '#3fd6a6', dark: '#1f9a76', accent: '#21313a' },
    { id: 'ocean', name: 'Ocean', price: 40, body: '#3f8cff', dark: '#2559c4', accent: '#1d2433' },
    { id: 'sunny', name: 'Sunny', price: 60, body: '#ffc928', dark: '#d18e00', accent: '#3a2a12' },
    { id: 'grape', name: 'Grape Soda', price: 90, body: '#9b5cff', dark: '#6a2fd1', accent: '#231a3a' },
    { id: 'night', name: 'Midnight', price: 140, body: '#2b3245', dark: '#151a26', accent: '#5ef2ff' },
    { id: 'gold', name: 'Golden', price: 220, body: '#ffd447', dark: '#c28b00', accent: '#fff6c2' },
    { id: 'rainbow', name: 'Rainbow', price: 350, body: '#ff5fa2', dark: '#c73a7a', accent: '#ffffff', rainbow: true },
  ];

  ZM.BOOST_SECONDS = 180;
  ZM.GOLD_MULT = 12; // golden patch cells pay ×12
  ZM.BOOST_MAX = 900;
  ZM.FRENZY_SECONDS = 9;
})(window.ZM);
