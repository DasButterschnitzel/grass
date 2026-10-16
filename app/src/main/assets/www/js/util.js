'use strict';
// Shared helpers: math, seeded randomness, noise, colors, number formatting.
window.ZM = window.ZM || {};

(function (ZM) {
  ZM.clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  ZM.lerp = (a, b, t) => a + (b - a) * t;
  ZM.smoothstep = (a, b, x) => {
    const t = ZM.clamp((x - a) / (b - a), 0, 1);
    return t * t * (3 - 2 * t);
  };
  ZM.easeOutBack = (t) => {
    const c1 = 1.70158, c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  };
  ZM.easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
  ZM.TAU = Math.PI * 2;

  // Deterministic PRNG (mulberry32) – levels are reproducible from their number.
  ZM.rng = function (seed) {
    let a = seed >>> 0;
    const f = function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    f.range = (a, b) => a + (b - a) * f();
    f.int = (a, b) => Math.floor(a + (b - a + 1) * f());
    f.pick = (arr) => arr[Math.floor(f() * arr.length)];
    f.chance = (p) => f() < p;
    return f;
  };
  ZM.rand = (a, b) => a + (b - a) * Math.random();

  // Smooth 2D value noise + fbm (used by level generation).
  ZM.makeNoise = function (seed) {
    const r = ZM.rng(seed);
    const perm = new Uint8Array(512);
    const vals = new Float32Array(256);
    for (let i = 0; i < 256; i++) { perm[i] = i; vals[i] = r(); }
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(r() * (i + 1));
      const t = perm[i]; perm[i] = perm[j]; perm[j] = t;
    }
    for (let i = 0; i < 256; i++) perm[i + 256] = perm[i];
    const v = (x, y) => vals[perm[(x & 255) + perm[y & 255]]];
    const noise = (x, y) => {
      const xi = Math.floor(x), yi = Math.floor(y);
      const xf = x - xi, yf = y - yi;
      const u = xf * xf * (3 - 2 * xf), w = yf * yf * (3 - 2 * yf);
      const a = v(xi, yi), b = v(xi + 1, yi), c = v(xi, yi + 1), d = v(xi + 1, yi + 1);
      return a + (b - a) * u + (c - a) * w + (a - b - c + d) * u * w;
    };
    noise.fbm = (x, y, oct = 4) => {
      let s = 0, amp = 0.5, f = 1, n = 0;
      for (let i = 0; i < oct; i++) { s += noise(x * f, y * f) * amp; n += amp; amp *= 0.5; f *= 2.03; }
      return s / n;
    };
    return noise;
  };

  // Colors are kept as [r,g,b] floats 0..1.
  ZM.hex = function (h) {
    h = h.replace('#', '');
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    const n = parseInt(h, 16);
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  };
  ZM.mixc = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  ZM.mulc = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
  ZM.css = (c, a = 1) => `rgba(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)},${a})`;
  // Hue rotation in RGB space – used to create endless biome variations.
  ZM.hueShift = function (c, deg) {
    const a = (deg * Math.PI) / 180, cos = Math.cos(a), sin = Math.sin(a);
    const k = 1 / 3, sq = Math.sqrt(k);
    const m00 = cos + (1 - cos) * k, m01 = k * (1 - cos) - sq * sin, m02 = k * (1 - cos) + sq * sin;
    const m10 = k * (1 - cos) + sq * sin, m11 = cos + k * (1 - cos), m12 = k * (1 - cos) - sq * sin;
    const m20 = k * (1 - cos) - sq * sin, m21 = k * (1 - cos) + sq * sin, m22 = cos + k * (1 - cos);
    return [
      ZM.clamp(c[0] * m00 + c[1] * m01 + c[2] * m02, 0, 1),
      ZM.clamp(c[0] * m10 + c[1] * m11 + c[2] * m12, 0, 1),
      ZM.clamp(c[0] * m20 + c[1] * m21 + c[2] * m22, 0, 1),
    ];
  };

  // Idle-game number formatting: 999, 1.23K, 45.6M ... then aa, ab, ac ...
  const SUFFIX = ['', 'K', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx', 'Sp', 'Oc', 'No', 'Dc'];
  ZM.fmt = function (n) {
    if (!isFinite(n)) return '∞';
    if (n < 0) return '-' + ZM.fmt(-n);
    if (n < 1000) return n < 10 && n % 1 !== 0 ? n.toFixed(1).replace(/\.0$/, '') : String(Math.floor(n));
    let e = Math.floor(Math.log10(n) / 3);
    let suffix;
    if (e < SUFFIX.length) suffix = SUFFIX[e];
    else {
      const k = e - SUFFIX.length;
      suffix = String.fromCharCode(97 + Math.floor(k / 26) % 26) + String.fromCharCode(97 + (k % 26));
    }
    let v = n / Math.pow(1000, e);
    if (v >= 999.95) { v /= 1000; e++; if (e < SUFFIX.length) suffix = SUFFIX[e]; }
    const s = v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2);
    return s.replace(/\.?0+$/, '') + suffix;
  };
  ZM.fmtTime = function (sec) {
    sec = Math.max(0, Math.ceil(sec));
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    if (h > 0) return `${h}h ${m}m`;
    return `${m}:${String(s).padStart(2, '0')}`;
  };

  ZM.now = () => performance.now() / 1000;
})(window.ZM);
