'use strict';
// Biomes: every lawn has its own look, soundscape and musical key.
(function (ZM) {
  // Music: a key (root of its major pentatonic scale) and a bass movement – see music.js.
  // Sound: the garden's nature soundscape – see soundscape.js.
  const B = [
    {
      id: 'meadow', name: 'Spring Meadow',
      bg: ['#1b4d2e', '#0d2b1b'], bgStyle: 0, rim: '#5b4330',
      cut: ['#b9e27c', '#9fd065'], under: '#2f6b2a', root: '#245a22',
      blades: ['#86d85a', '#6fca4b', '#5cb941', '#4ca73a', '#3f9434', '#33802d', '#2a6d27'],
      gold: '#ffd54a', water: '#45b6e0', stone: '#c9c2b4', bed: '#6b4a32',
      flowers: ['#ffffff', '#ffd93b', '#ff7eb6', '#b48cff'],
      ambience: 'meadow', fx: 'pollen', music: { root: 60, prog: 'warm' }, clouds: 1,
      sound: { wind: 0.3, gust: 0.4, air: 0.35, birds: 1 },
    },
    {
      id: 'lavender', name: 'Lavender Fields',
      bg: ['#2b1b52', '#150c2c'], bgStyle: 0, rim: '#4a3360',
      cut: ['#d8c6f6', '#c6b0ee'], under: '#3b2a75', root: '#2c1d5c',
      blades: ['#b293ee', '#a07fe6', '#8d6bdb', '#7b59cf', '#6a49c0', '#5a3baf', '#4b2f9b'],
      gold: '#ffd76a', water: '#7ec8f2', stone: '#d6cfe6', bed: '#4b3456',
      flowers: ['#ffffff', '#ffe27a', '#ff9ad5', '#9fe8ff'],
      ambience: 'meadow', fx: 'pollen', music: { root: 62, prog: 'dreamy' }, clouds: 1,
      sound: { wind: 0.3, birds: 0.8, chimes: 0.25 },
    },
    {
      id: 'sakura', name: 'Sakura Garden',
      bg: ['#4a1d3d', '#250b20'], bgStyle: 0, rim: '#5b3340',
      cut: ['#ffe3ee', '#fbd1e2'], under: '#a8406f', root: '#8e2f5c',
      blades: ['#ffb3d1', '#ffa0c5', '#f78bb6', '#ec77a7', '#de6498', '#cd5289', '#ba437b'],
      gold: '#ffe08a', water: '#8fd8f0', stone: '#efe2e6', bed: '#6e3c4a',
      flowers: ['#ffffff', '#fff2a8', '#ff6f9f', '#ffd1e6'],
      ambience: 'meadow', fx: 'petals', music: { root: 57, prog: 'warm' }, clouds: 1,
      sound: { wind: 0.25, birds: 0.7, chimes: 0.45, brook: 0.3 },
    },
    {
      id: 'autumn', name: 'Autumn Glow',
      bg: ['#4a2610', '#26120a'], bgStyle: 0, rim: '#5e3a22',
      cut: ['#ffe2b0', '#f6d097'], under: '#a2531c', root: '#8a4416',
      blades: ['#ffc15c', '#fbb04c', '#f29d3e', '#e78a33', '#d8772a', '#c76423', '#b2531d'],
      gold: '#fff07a', water: '#5fb7d6', stone: '#d9cbb8', bed: '#5a3a26',
      flowers: ['#fff3d6', '#ff6a3d', '#ffd23f', '#c94f7c'],
      ambience: 'meadow', fx: 'leaves', music: { root: 55, prog: 'calm' }, clouds: 1,
      sound: { wind: 0.5, gust: 0.8, air: 0.5, leaves: 0.8, birds: 0.3 },
    },
    {
      id: 'frost', name: 'Frosty Tundra',
      bg: ['#16365e', '#0a1b33'], bgStyle: 3, rim: '#5a7896',
      cut: ['#f4fbff', '#e3f1fa'], under: '#3f87b5', root: '#2f6f9c',
      blades: ['#c9f6ff', '#aaeaf9', '#8bdcf1', '#6ecbe7', '#56b8dc', '#43a4cf', '#3490c0'],
      gold: '#fff3a0', water: '#3d7fc1', stone: '#e8eef5', bed: '#53697f',
      flowers: ['#ffffff', '#bfe9ff', '#d7c9ff', '#a8fff0'],
      ambience: 'winter', fx: 'snow', music: { root: 64, prog: 'dreamy' }, clouds: 0.6,
      sound: { wind: 0.65, gust: 0.7, air: 0.7, aeolian: 0.6, chimes: 0.5 },
    },
    {
      id: 'desert', name: 'Golden Wheat',
      bg: ['#5a3d12', '#2d1d07'], bgStyle: 0, rim: '#7a5a30',
      cut: ['#fbefc9', '#f2e1b0'], under: '#b48a2a', root: '#9b7421',
      blades: ['#fae27e', '#f3d468', '#e8c556', '#dbb348', '#cba13d', '#b98e33', '#a57c2b'],
      gold: '#fff6b0', water: '#38b9c9', stone: '#e4d3b0', bed: '#7a5530',
      flowers: ['#ffffff', '#ff8a5c', '#ffd35c', '#9ad16b'],
      ambience: 'desert', fx: 'dust', music: { root: 58, prog: 'warm' }, clouds: 1,
      sound: { wind: 0.5, gust: 0.6, air: 0.6, birds: 0.25, chimes: 0.3 },
    },
    {
      id: 'moon', name: 'Moonlit Garden',
      bg: ['#0a1430', '#03060f'], bgStyle: 1, rim: '#22304f',
      cut: ['#2f6a70', '#285b62'], under: '#0f3f45', root: '#0b3036',
      blades: ['#6ff0d2', '#57debf', '#44c9ac', '#35b39a', '#299c87', '#1f8676', '#177166'],
      gold: '#ffe58a', water: '#2a5c9e', stone: '#7d8aa6', bed: '#1d2a3c',
      flowers: ['#ffffff', '#b8f7ff', '#ffe2a3', '#e3b8ff'],
      ambience: 'night', fx: 'fireflies', music: { root: 60, prog: 'minor' }, clouds: 0.35, glow: 0.35,
      sound: { wind: 0.2, crickets: 1, owl: 0.7 },
    },
    {
      id: 'candy', name: 'Candy Dream',
      bg: ['#3a1d55', '#1f0d31'], bgStyle: 0, rim: '#6a3d78',
      cut: ['#fff4fb', '#ffe4f3'], under: '#3fb08f', root: '#2f9a7b',
      blades: ['#a8f7dc', '#86eccb', '#ffb6dd', '#ff9ccf', '#a7c4ff', '#8ab0ff', '#ffd27a'],
      gold: '#fff38a', water: '#8ad8ff', stone: '#fff0f6', bed: '#7a4b78',
      flowers: ['#ffffff', '#ff6fb5', '#7ce8ff', '#ffe066'],
      ambience: 'meadow', fx: 'sparkle', music: { root: 65, prog: 'warm' }, clouds: 0.8,
      sound: { wind: 0.2, birds: 0.7, chimes: 0.4 },
    },
    {
      id: 'ocean', name: 'Ocean Isle',
      bg: ['#0e6d8f', '#063a52'], bgStyle: 2, rim: '#e8d6a6',
      cut: ['#dcfbf3', '#c7f1e7'], under: '#1a8f8c', root: '#127775',
      blades: ['#73f2df', '#5ae4d2', '#45d2c4', '#36bdb5', '#2aa7a5', '#209194', '#177c83'],
      gold: '#ffe680', water: '#2fa6d0', stone: '#efe4c8', bed: '#a1815a',
      flowers: ['#ffffff', '#ff7a8a', '#ffd166', '#c3a6ff'],
      ambience: 'ocean', fx: 'pollen', music: { root: 62, prog: 'calm' }, clouds: 0.9,
      sound: { wind: 0.35, waves: 1, gulls: 0.6 },
    },
    {
      id: 'neon', name: 'Neon Dreams',
      bg: ['#140a33', '#05020f'], bgStyle: 4, rim: '#3a2a7a',
      cut: ['#251b4a', '#1e1640'], under: '#130d2c', root: '#0f0a24',
      blades: ['#ff5fd9', '#d65cff', '#9a63ff', '#5f7dff', '#3ab5ff', '#2de0e6', '#38ffb5'],
      gold: '#fff27a', water: '#3a1f8a', stone: '#4a3d88', bed: '#1a1238',
      flowers: ['#ffffff', '#ff5fd9', '#38ffb5', '#ffe36e'],
      ambience: 'neon', fx: 'sparkle', music: { root: 55, prog: 'minor' }, clouds: 0, glow: 0.8,
      sound: { wind: 0.08, arp: true, melody: 0.6 },
    },
  ];

  const parse = (b) => {
    const o = Object.assign({}, b);
    for (const k of ['rim', 'under', 'root', 'gold', 'water', 'stone', 'bed']) o[k] = ZM.hex(b[k]);
    o.bg = b.bg.map(ZM.hex);
    o.cut = b.cut.map(ZM.hex);
    o.blades = b.blades.map(ZM.hex);
    o.flowers = b.flowers.map(ZM.hex);
    o.glow = b.glow || 0;
    return o;
  };
  const BASE = B.map(parse);
  ZM.BIOME_COUNT = BASE.length;
  ZM.LEVELS_PER_BIOME = 1; // every lawn has its own look

  // Endless: after the first full cycle biomes return with a hue twist and a roman numeral.
  const ROMAN = ['', '', ' II', ' III', ' IV', ' V', ' VI', ' VII', ' VIII', ' IX', ' X'];
  ZM.biomeForLevel = function (level) {
    const idx = Math.floor((level - 1) / ZM.LEVELS_PER_BIOME);
    const base = BASE[idx % BASE.length];
    const cycle = Math.floor(idx / BASE.length);
    if (cycle === 0) return Object.assign({ index: idx, cycle: 0 }, base);
    const shift = ((cycle * 47) % 120) - 60; // gentle, never garish
    const hs = (c) => ZM.hueShift(c, shift);
    const o = Object.assign({}, base, { index: idx, cycle });
    o.name = base.name + (ROMAN[cycle + 1] || ' ' + (cycle + 1));
    for (const k of ['rim', 'under', 'root', 'water']) o[k] = hs(base[k]);
    o.bg = base.bg.map(hs);
    o.cut = base.cut.map(hs);
    o.blades = base.blades.map(hs);
    o.music = Object.assign({}, base.music, { root: base.music.root + ((cycle * 5) % 7) - 3 });
    return o;
  };
  ZM.BIOMES = BASE;

  // ---------------------------------------------------------------- zen scenes
  // Each scene: a garden look, a slow key, and a richer soundscape (levels 0..1).
  const RAIN = parse({
    id: 'rain', name: 'Gentle Rain',
    bg: ['#1d302d', '#0a1413'], bgStyle: 0, rim: '#3b423d',
    cut: ['#8db69a', '#79a487'], under: '#2c5039', root: '#1f3e2b',
    blades: ['#64b07d', '#57a371', '#4a9665', '#3e8a5a', '#347c50', '#2b6f46', '#24623e'],
    gold: '#ffd54a', water: '#55869f', stone: '#a2aaa7', bed: '#3e3a33',
    flowers: ['#eef4ff', '#bcd7ff', '#ffd1e6', '#cbb8ff'],
    ambience: 'rain', fx: 'none', clouds: 1.9,
  });
  const byId = (id) => BASE.find((b) => b.id === id);
  const SCENES = [
    { id: 'meadow', name: 'Summer Meadow', biome: byId('meadow'), music: { root: 60, prog: 'still', bpm: 54 },
      sound: { wind: 0.35, gust: 0.4, air: 0.45, birds: 1, brook: 0.45 }, lawn: { pond: { x: 0.42, y: -0.85, a: 0.26, b: 0.2 }, flowers: 5 } },
    { id: 'rain', name: 'Gentle Rain', biome: RAIN, weather: 'rain', music: { root: 57, prog: 'calm', bpm: 50 },
      sound: { wind: 0.25, gust: 0.3, air: 0.3, rain: 0.9, thunder: 0.7, birds: 0.06, melody: 0.8 }, lawn: { flowers: 3 } },
    { id: 'ocean', name: 'Ocean Breeze', biome: byId('ocean'), music: { root: 62, prog: 'calm', bpm: 52 },
      sound: { wind: 0.45, gust: 0.5, air: 0.55, waves: 1, gulls: 0.45 }, lawn: { shape: 'fullOval', flowers: 4 } },
    { id: 'night', name: 'Starry Night', biome: byId('moon'), music: { root: 60, prog: 'night', bpm: 48 },
      sound: { wind: 0.2, crickets: 1, owl: 0.9, brook: 0.25, melody: 0.8 }, lawn: { pond: { x: -0.4, y: 0.9, a: 0.24, b: 0.2 }, flowers: 4 } },
    { id: 'autumn', name: 'Autumn Wind', biome: byId('autumn'), music: { root: 55, prog: 'calm', bpm: 52 },
      sound: { wind: 0.75, gust: 0.95, air: 0.75, aeolian: 0.8, leaves: 1, birds: 0.2 }, lawn: { flowers: 3 } },
    { id: 'snow', name: 'Snowy Silence', biome: byId('frost'), music: { root: 64, prog: 'still', bpm: 46 },
      sound: { wind: 0.55, gust: 0.6, air: 0.5, aeolian: 0.75, chimes: 0.7, melody: 0.85 }, lawn: { shape: 'fullOval', flowers: 2 } },
    { id: 'temple', name: 'Temple Garden', biome: byId('sakura'), music: { root: 57, prog: 'still', bpm: 48 },
      sound: { wind: 0.25, gust: 0.35, brook: 0.6, bowl: 1, chimes: 0.45, birds: 0.45 }, lawn: { pond: { x: 0, y: 0.15, a: 0.34, b: 0.26 }, stones: true, flowers: 4 } },
  ];
  ZM.ZEN_SCENES = SCENES.map((sc, i) => {
    const biome = Object.assign({}, sc.biome, { music: sc.music, sound: sc.sound, zen: true });
    const lawn = Object.assign({ W: 34, shape: 'full', maxL: 3, thick: 2.1, biome }, sc.lawn);
    return Object.assign({}, sc, { index: i, biome, lawn });
  });
  ZM.zenScene = (id) => ZM.ZEN_SCENES.find((s) => s.id === id) || ZM.ZEN_SCENES[0];
  // Localised display name ("Lavendelfelder II").
  ZM.biomeName = function (b) {
    const base = BASE.find((x) => x.id === b.id);
    const suffix = base ? b.name.slice(base.name.length) : '';
    return ZM.t(base ? base.name : b.name) + suffix;
  };
})(window.ZM);
