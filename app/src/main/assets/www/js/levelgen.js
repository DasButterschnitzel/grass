'use strict';
// Procedural, endless level generation. Every level number always yields the same garden.
(function (ZM) {
  const hyp = Math.hypot, abs = Math.abs, max = Math.max, min = Math.min, sqrt = Math.sqrt;
  const smin = (a, b, k) => {
    const h = ZM.clamp(0.5 + (0.5 * (b - a)) / k, 0, 1);
    return b + (a - b) * h - k * h * (1 - h);
  };
  const sdCircle = (x, y, r) => hyp(x, y) - r;
  const sdBox = (x, y, bx, by, r) => {
    const qx = abs(x) - bx + r, qy = abs(y) - by + r;
    return hyp(max(qx, 0), max(qy, 0)) + min(max(qx, qy), 0) - r;
  };
  const sdEllipse = (x, y, a, b) => {
    const k0 = hyp(x / a, y / b), k1 = hyp(x / (a * a), y / (b * b));
    return k1 === 0 ? -min(a, b) : (k0 * (k0 - 1)) / k1;
  };
  // Inigo Quilez' heart, y up, spans roughly x∈[-.6,.6], y∈[-.1,1].
  const sdHeart = (x, y) => {
    x = abs(x);
    if (y + x > 1) return hyp(x - 0.25, y - 0.75) - sqrt(2) / 4;
    const a = x * x + (y - 1) * (y - 1);
    const m = 0.5 * max(x + y, 0);
    const b = (x - m) * (x - m) + (y - m) * (y - m);
    return sqrt(min(a, b)) * Math.sign(x - y);
  };
  const sdStar5 = (x, y, r, rf) => {
    const k1x = 0.809016994375, k1y = -0.587785252292, k2x = -k1x, k2y = k1y;
    x = abs(x);
    let d = 2 * max(k1x * x + k1y * y, 0); x -= d * k1x; y -= d * k1y;
    d = 2 * max(k2x * x + k2y * y, 0); x -= d * k2x; y -= d * k2y;
    x = abs(x); y -= r;
    const bax = rf * -k1y - 0, bay = rf * k1x - 1;
    const h = ZM.clamp((x * bax + y * bay) / (bax * bax + bay * bay), 0, r);
    return hyp(x - bax * h, y - bay * h) * Math.sign(y * bax - x * bay);
  };
  const sdHexagon = (x, y, r) => {
    const kx = -0.866025404, ky = 0.5, kz = 0.577350269;
    x = abs(x); y = abs(y);
    const d = 2 * min(kx * x + ky * y, 0); x -= d * kx; y -= d * ky;
    x -= ZM.clamp(x, -kz * r, kz * r); y -= r;
    return hyp(x, y) * Math.sign(y);
  };
  const sdRhombus = (x, y, bx, by) => {
    x = abs(x); y = abs(y);
    const ndot = (ax, ay, cx, cy) => ax * cx - ay * cy;
    const h = ZM.clamp(ndot(bx - 2 * x, by - 2 * y, bx, by) / (bx * bx + by * by), -1, 1);
    const dx = x - 0.5 * bx * (1 - h), dy = y - 0.5 * by * (1 + h);
    return hyp(dx, dy) * Math.sign(x * by + y * bx - bx * by);
  };

  // Shape catalog in normalized space: x ∈ [-1,1] across, y ∈ [-A,A] down (A = aspect).
  const SHAPES = {
    meadow: () => (x, y) => sdBox(x, y, 0.95, 1.52, 0.2),
    oval: () => (x, y) => sdEllipse(x, y, 0.98, 1.52),
    heart: () => (x, y) => sdHeart(x / 1.55, 0.52 - y / 2.0) * 1.55,
    pill: () => (x, y) => sdBox(x, y, 0.93, 1.52, 0.9),
    hex: () => (x, y) => sdHexagon(x / 0.98, y / 1.42, 1.0) * 0.98,
    diamond: () => (x, y) => sdRhombus(x, y, 1.0, 1.58) - 0.04,
    cross: () => (x, y) => smin(sdBox(x, y + 0.15, 0.96, 0.6, 0.25), sdBox(x, y, 0.55, 1.55, 0.25), 0.15),
    clover: () => (x, y) => {
      let d = sdCircle(x, y, 0.6);
      for (const [cx, cy] of [[-0.45, -0.75], [0.45, -0.75], [-0.45, 0.75], [0.45, 0.75]]) d = smin(d, sdCircle(x - cx, y - cy, 0.56), 0.25);
      return d;
    },
    peanut: () => (x, y) => smin(sdCircle(x, y + 0.75, 0.88), sdCircle(x, y - 0.78, 0.88), 0.45),
    ring: () => (x, y) => sdEllipse(x, y, 0.98, 1.52),
    star: () => (x, y) => smin(sdStar5(x / 1.02, (-y + 0.12) / 1.45, 1.0, 0.55) * 1.02, sdCircle(x, y / 1.3, 0.52), 0.25),
    wave: () => (x, y) => sdBox(x - 0.07 * Math.sin(y * 3.2), y, 0.86, 1.52, 0.2),
    steps: () => (x, y) => min(min(sdBox(x + 0.25, y + 1.0, 0.72, 0.5, 0.18), sdBox(x - 0.22, y, 0.75, 0.62, 0.18)), sdBox(x + 0.2, y - 1.0, 0.78, 0.52, 0.18)),
    blob: (rnd) => {
      const n = ZM.makeNoise(Math.floor(rnd() * 1e9));
      const ph = rnd() * 10;
      return (x, y) => {
        const a = Math.atan2(y / 1.5, x);
        const r = 0.84 + 0.14 * (n.fbm(Math.cos(a) * 1.3 + ph, Math.sin(a) * 1.3 + ph, 3) - 0.5) * 2;
        return (hyp(x, y / 1.5) - r) * 1.0;
      };
    },
  };
  const ORDER = ['meadow', 'oval', 'heart', 'clover', 'pill', 'wave', 'hex', 'peanut', 'diamond', 'cross', 'ring', 'blob', 'star', 'steps'];

  ZM.generateLevel = function (N) {
    const rnd = ZM.rng(0x9E3779B1 ^ (N * 2654435761));
    const W = ZM.levelWidth(N);
    const H = Math.round(W * 1.6);
    const A = H / W; // aspect in normalized units
    const S = 4; // terrain texels per cell
    const TW = W * S, TH = H * S;
    const shapeName = N <= ORDER.length ? ORDER[N - 1] : ORDER[Math.floor(rnd() * ORDER.length)];
    const land = SHAPES[shapeName](rnd);

    // Obstacles: ponds, stepping stones, rocks and flower beds – more as levels go on.
    const ponds = [], rocks = [], beds = [], stones = [];
    if (shapeName === 'ring') ponds.push({ x: 0, y: 0, a: 0.38, b: 0.62 });
    if (N >= 4 && shapeName !== 'ring' && rnd() < 0.55) {
      ponds.push({ x: rnd.range(-0.45, 0.45), y: rnd.range(-0.9, 0.9), a: rnd.range(0.18, 0.3), b: rnd.range(0.16, 0.26) });
    }
    if (N >= 6 && rnd() < 0.5) {
      const vertical = rnd() < 0.6;
      const ph = rnd() * 6, amp = rnd.range(0.15, 0.35), cnt = vertical ? 15 : 9;
      const y0 = rnd.range(-0.5, 0.5) * A;
      for (let i = 0; i < cnt; i++) {
        const t = (i / (cnt - 1)) * 2 - 1;
        const r = rnd.range(0.065, 0.085);
        if (vertical) stones.push({ x: Math.sin(t * 2.4 + ph) * amp, y: t * A * 0.97, r });
        else stones.push({ x: t * 0.97, y: y0 + Math.sin(t * 2.2 + ph) * amp, r });
      }
    }
    if (N >= 3) {
      const nr = Math.min(4, 1 + Math.floor(rnd() * (1 + N / 8)));
      for (let i = 0; i < nr; i++) rocks.push({ x: rnd.range(-0.8, 0.8), y: rnd.range(-1.35, 1.35), r: rnd.range(0.05, 0.1) });
    }
    if (N >= 8 && rnd() < 0.45) {
      beds.push({ x: rnd.range(-0.4, 0.4), y: rnd.range(-1.1, 1.1), w: rnd.range(0.22, 0.34), h: rnd.range(0.09, 0.13) });
    }

    const sdWater = (x, y) => {
      let d = 9;
      for (const p of ponds) d = min(d, sdEllipse(x - p.x, y - p.y, p.a, p.b));
      return d;
    };
    const sdStone = (x, y) => {
      let d = 9;
      for (const r of rocks) d = min(d, sdCircle(x - r.x, y - r.y, r.r));
      for (const s of stones) d = min(d, sdCircle(x - s.x, y - s.y, s.r));
      return d;
    };
    const sdBed = (x, y) => {
      let d = 9;
      for (const b of beds) d = min(d, sdBox(x - b.x, y - b.y, b.w, b.h, 0.06));
      return d;
    };

    // Terrain texture, distance-encoded so the shader can draw soft rims, shadows and
    // lit stones: value = 0.5 - distance_in_cells / k. R land, G water, B stone, A flower bed.
    const terrain = new Uint8Array(TW * TH * 4);
    const cellsPerUnit = W / 2;
    const margin = (2.6 * 2) / W; // keep ~2.6 cells of empty border around the field
    const landD = (x, y) => max(land(x, y), sdBox(x, y, 1 - margin, A - margin, 0.04));
    const enc = (d, k) => Math.round(ZM.clamp(0.5 - (d * cellsPerUnit) / k, 0, 1) * 255);
    for (let ty = 0; ty < TH; ty++) {
      const y = ((ty + 0.5) / TH * 2 - 1) * A;
      for (let tx = 0; tx < TW; tx++) {
        const x = (tx + 0.5) / TW * 2 - 1;
        const o = (ty * TW + tx) * 4;
        terrain[o] = enc(landD(x, y), 4);
        terrain[o + 1] = enc(sdWater(x, y), 4);
        terrain[o + 2] = enc(sdStone(x, y), 3);
        terrain[o + 3] = enc(sdBed(x, y), 4);
      }
    }

    // Grass cells.
    const n = W * H;
    const grass = new Uint8Array(n);
    const layers = new Uint8Array(n);
    const type = new Uint8Array(n);
    const maxL = ZM.levelMaxLayers(N);
    const target = ZM.levelThickness(N);
    const noise = ZM.makeNoise(Math.floor(rnd() * 1e9));
    const nscale = rnd.range(0.07, 0.11);
    const cells = [];
    for (let cy = 0; cy < H; cy++) {
      const y = ((cy + 0.5) / H * 2 - 1) * A;
      for (let cx = 0; cx < W; cx++) {
        const x = (cx + 0.5) / W * 2 - 1;
        const i = cy * W + cx;
        const dl = landD(x, y);
        const inside = dl < -0.6 / W && sdWater(x, y) > 0.35 / W && sdStone(x, y) > 0.2 / W && sdBed(x, y) > 0.2 / W;
        if (!inside) continue;
        grass[i] = 1;
        cells.push(i);
      }
    }
    // Thickness from smooth noise, scaled so the average approaches the level's target.
    const raw = new Float32Array(n);
    let sum = 0;
    for (const i of cells) {
      const cx = i % W, cy = (i / W) | 0;
      raw[i] = noise.fbm(cx * nscale, cy * nscale, 3);
      sum += raw[i];
    }
    const mean = sum / Math.max(1, cells.length);
    const extra = Math.max(0, target - 1);
    let total = 0;
    for (const i of cells) {
      const v = (raw[i] - mean) * 3.2 + 0.5; // ~0..1 with blobs
      const L = 1 + Math.round(ZM.clamp(extra * (0.35 + v * 1.3) * (maxL > 1 ? 1 : 0), 0, maxL - 1));
      layers[i] = L;
      total += L;
    }

    // Static flower clusters (they bloom again when the grass grows back). Golden patches,
    // gems and lucky clovers are spawned dynamically while you mow.
    const pick = () => cells[Math.floor(rnd() * cells.length)];
    const blob = (i, r, t, prob) => {
      const cx = i % W, cy = (i / W) | 0, R = Math.ceil(r);
      for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
        const x = cx + dx, y = cy + dy;
        if (x < 0 || y < 0 || x >= W || y >= H) continue;
        const j = y * W + x;
        if (!grass[j] || type[j]) continue;
        if (dx * dx + dy * dy <= r * r && rnd() < prob) type[j] = t;
      }
    };
    const flowerClusters = 2 + Math.floor(rnd() * 3);
    for (let f = 0; f < flowerClusters; f++) blob(pick(), rnd.range(1.5, 3), 2, 0.28);

    return {
      N, W, H, A, S, TW, TH, terrain, grass, layers, type, total, maxL,
      shape: shapeName, biome: ZM.biomeForLevel(N), value: ZM.lawnValue(N),
      cellCount: cells.length, seed: Math.floor(rnd() * 1e9),
    };
  };
})(window.ZM);
