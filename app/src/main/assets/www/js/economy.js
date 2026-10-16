'use strict';
// Upgrades, level scaling and rewards. All tuning numbers live here.
(function (ZM) {
  ZM.UPGRADES = [
    { id: 'blade', name: 'Blade', desc: 'Wider cutting circle', base: 50, growth: 2.15, max: 25 },
    { id: 'sharp', name: 'Sharpness', desc: 'Slice thick grass faster', base: 60, growth: 2.2, max: 25 },
    { id: 'engine', name: 'Engine', desc: 'Faster mower', base: 60, growth: 2.2, max: 25 },
    { id: 'fert', name: 'Fertilizer', desc: 'Every blade is worth more', base: 80, growth: 1.5, max: Infinity },
    { id: 'fleet', name: 'Fleet', desc: '+1 mower – steer each with a finger', base: 4000, growth: 25, max: 3 },
    { id: 'bots', name: 'Autopilot', desc: 'Free mowers drive themselves', base: 2500, growth: 2.7, max: 10 },
  ];
  ZM.UPG = {};
  for (const u of ZM.UPGRADES) ZM.UPG[u.id] = u;

  ZM.upgradeCost = (id, lvl) => {
    const u = ZM.UPG[id];
    return Math.ceil(u.base * Math.pow(u.growth, lvl));
  };

  // Effects (world unit = one grass cell).
  ZM.stats = function (upg) {
    const blade = upg.blade || 0, sharp = upg.sharp || 0, engine = upg.engine || 0;
    const fert = upg.fert || 0, fleet = upg.fleet || 0, bots = upg.bots || 0;
    return {
      radius: 2.6 + 0.16 * blade,
      speed: 14 + 0.6 * engine,
      interval: 0.34 / (1 + 0.06 * sharp),
      valueMult: Math.pow(1.08, fert),
      mowers: 1 + fleet,
      botFrac: bots === 0 ? 0 : Math.min(0.85, 0.35 + 0.05 * bots),
    };
  };

  // Human readable effect text for upgrade cards ("now → next").
  ZM.upgradeEffect = function (id, lvl) {
    const s = ZM.stats({ [id]: lvl });
    switch (id) {
      case 'blade': return (s.radius / 2.6 * 100).toFixed(0) + '%';
      case 'sharp': return (0.34 / s.interval).toFixed(1) + '×';
      case 'engine': return (s.speed / 14 * 100).toFixed(0) + '%';
      case 'fert': return '×' + ZM.fmt(Math.round(s.valueMult * 100) / 100);
      case 'fleet': return s.mowers + ' ' + ZM.t(s.mowers > 1 ? 'mowers' : 'mower');
      case 'bots': return lvl === 0 ? ZM.t('off') : Math.round(s.botFrac * 100) + '% ' + ZM.t('speed');
    }
    return '';
  };

  // Level scaling.
  ZM.levelWidth = (N) => Math.min(60, 35 + N);
  ZM.levelValue = (N) => Math.pow(1.12, N - 1);
  ZM.MAX_LAYERS = 12;
  ZM.levelMaxLayers = (N) => Math.min(ZM.MAX_LAYERS, 1 + Math.floor((N + 1) / 2.2));
  ZM.levelThickness = (N) => 1 + Math.min(9, 0.15 * (N - 1)); // target average layers
  ZM.levelRewardFrac = 0.3; // completion bonus = 30% of what the field paid

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
  ZM.BOOST_MAX = 900;
  ZM.FRENZY_SECONDS = 9;
})(window.ZM);
