'use strict';
// Upgrades, level scaling and rewards. All tuning numbers live here.
(function (ZM) {
  // The four upgrades of the original game (Blade, Engine, Fertilizer, Sprinkler), the Fleet
  // (extra mowers that follow yours in formation or take another finger) and the Autopilot,
  // a timed bonus whose duration you level up. Prices were tuned with tools/qa/sim.py.
  const E0 = window.__econ || {};
  ZM.UPGRADES = [
    { id: 'blade', name: 'Blade', desc: 'desc_blade', base: 15, growth: E0.gb || 2.3, max: 45 },
    { id: 'engine', name: 'Engine', desc: 'desc_engine', base: 12, growth: E0.ge || 2.3, max: 45 },
    { id: 'fert', name: 'Fertilizer', desc: 'desc_fert', base: 25, growth: E0.gf || 2.2, max: Infinity },
    { id: 'sprinkler', name: 'Sprinkler', desc: 'desc_sprinkler', base: 20, growth: E0.gs || 2.55, max: 40 },
    { id: 'fleet', name: 'Fleet', desc: 'desc_fleet', max: 3, unlock: [3, 6, 10] },
    { id: 'auto', name: 'Autopilot', desc: 'desc_auto', max: 10 },
  ];
  ZM.UPG = {};
  for (const u of ZM.UPGRADES) ZM.UPG[u.id] = u;

  // A fleet mower costs a good part of the lawn it unlocks on; a longer autopilot costs a
  // quarter of a lawn, so it grows about one level per lawn instead of being maxed at once.
  ZM.upgradeCost = (id, lvl) => {
    const u = ZM.UPG[id];
    if (id === 'fleet') return Math.ceil(0.6 * ZM.lawnCost(u.unlock[Math.min(lvl, u.unlock.length - 1)]));
    if (id === 'auto') return Math.ceil(0.25 * ZM.lawnCost(lvl + 1));
    return Math.ceil(u.base * Math.pow(u.growth, lvl));
  };
  // lawn number needed for the next level (0 = available)
  ZM.upgradeLock = (id, lvl, lawn) => {
    const u = ZM.UPG[id];
    return u.unlock && lvl < u.max && lawn < u.unlock[lvl] ? u.unlock[lvl] : 0;
  };

  // Effects (world unit = one grass cell, grass height in "layers").
  ZM.stats = function (upg) {
    const blade = upg.blade || 0, engine = upg.engine || 0, fert = upg.fert || 0;
    const sprinkler = upg.sprinkler || 0, fleet = upg.fleet || 0, auto = upg.auto || 0;
    return {
      radius: 2.0 + 0.09 * blade,
      speed: 11 + 0.3 * engine,
      regrow: 0.05 * (1 + 0.15 * sprinkler), // layers per second
      valueMult: 1 + fert,                     // like the original: +100% coins per level
      mowers: 1 + fleet,
      autoDur: 20 + 6 * auto,                  // seconds of autopilot per charge
    };
  };
  ZM.AUTO_COOLDOWN = 150; // seconds until the autopilot can be used again
  ZM.ROUND_BONUS = 0.5;   // a completed round pays +50% of what it earned

  // Zen garden: one calm, medium-size mower; the lawn grows back quickly so it never ends.
  ZM.zenStats = () => ({ radius: 3.0, speed: 9.5, regrow: 0.1, valueMult: 0, mowers: 1, autoDur: 0 });

  // Effect label for upgrade cards: "now → next".
  ZM.upgradeEffect = function (id, lvl) {
    const s = ZM.stats({ [id]: lvl });
    switch (id) {
      case 'blade': return Math.round(s.radius / 2 * 100) + '%';
      case 'engine': return Math.round(s.speed / 11 * 100) + '%';
      case 'fert': return '×' + ZM.fmt(s.valueMult);
      case 'sprinkler': return Math.round(s.regrow / 0.05 * 100) + '%';
      case 'fleet': return String(s.mowers);
      case 'auto': return s.autoDur + 's';
    }
    return '';
  };

  // Lawns (levels): the original's "Next lawn" progression, but endless. Price growth starts
  // steep (your mower is still growing fast) and eases towards the value growth.
  const E = window.__econ || {}; // test-only overrides for the balancing bot
  ZM.LAWN_MULT = E.vm || 6;   // each lawn pays ×6 per blade
  ZM.LAWN_BASE = E.c0 || 4600;
  // (tuned with the real game code: tools/qa/pace.js, ~1.5–2.5 min per lawn early, ~4 later)
  const CR = E.rinf || 0.98, CA = E.a !== undefined ? E.a : 0.85, CB = E.b !== undefined ? E.b : 2.2, CC = E.c || 3.3;
  ZM.lawnValue = (N) => Math.pow(ZM.LAWN_MULT, N - 1);
  // later lawns are much bigger, so the growing blade and the fleet always have room
  // (the width of a 1.6 tall lawn; the real lawn takes the shape of the screen, same area)
  ZM.levelWidth = (N) => Math.min(100, 34 + 4 * (N - 1));
  // A bigger lawn earns more per minute once you can keep up with it, so its price grows
  // with its area – relative to the smaller lawns (34 → 60) the curve was first tuned on.
  const AREA = E.area !== undefined ? E.area : 1.6;
  const tunedWidth = (N) => Math.min(60, 34 + 2 * (N - 1));
  ZM.lawnCost = (N) => { // price to leave lawn N
    let c = ZM.LAWN_BASE;
    for (let k = 1; k < N; k++) c *= ZM.LAWN_MULT * CR * (1 + CA / k + CB * Math.exp(-(k - 1) / CC));
    return c * Math.pow(ZM.levelWidth(N) / tunedWidth(N), AREA);
  };
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
