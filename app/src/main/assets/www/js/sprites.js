'use strict';
// All sprites are painted procedurally into one atlas at startup – crisp at any DPI,
// zero image assets to ship.
(function (ZM) {
  function shelfPacker(size) {
    let x = 2, y = 2, rowH = 0;
    return (w, h) => {
      if (x + w + 2 > size) { x = 2; y += rowH + 2; rowH = 0; }
      const r = { x, y, w, h };
      x += w + 2; rowH = Math.max(rowH, h);
      return r;
    };
  }

  function rr(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function drawMower(ctx, s, skin) {
    const c = s / 2;
    const body = skin.body, dark = skin.dark, acc = skin.accent;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    // handle (behind, pointing backwards = down)
    ctx.strokeStyle = '#2c2f38';
    ctx.lineWidth = s * 0.05;
    ctx.beginPath();
    ctx.moveTo(c - s * 0.16, c + s * 0.2); ctx.lineTo(c - s * 0.14, c + s * 0.44);
    ctx.moveTo(c + s * 0.16, c + s * 0.2); ctx.lineTo(c + s * 0.14, c + s * 0.44);
    ctx.stroke();
    ctx.lineWidth = s * 0.065;
    ctx.strokeStyle = '#1e2027';
    ctx.beginPath(); ctx.moveTo(c - s * 0.2, c + s * 0.445); ctx.lineTo(c + s * 0.2, c + s * 0.445); ctx.stroke();
    ctx.strokeStyle = '#4a4f5c';
    ctx.lineWidth = s * 0.03;
    ctx.beginPath(); ctx.moveTo(c - s * 0.18, c + s * 0.44); ctx.lineTo(c + s * 0.18, c + s * 0.44); ctx.stroke();
    // wheels
    ctx.fillStyle = '#1b1c22';
    for (const [wx, wy] of [[-0.3, -0.2], [0.3, -0.2], [-0.3, 0.17], [0.3, 0.17]]) {
      rr(ctx, c + wx * s - s * 0.06, c + wy * s - s * 0.085, s * 0.12, s * 0.17, s * 0.04);
      ctx.fill();
    }
    // body
    const bw = s * 0.56, bh = s * 0.6, bx = c - bw / 2, by = c - bh / 2 - s * 0.02;
    ctx.shadowColor = 'rgba(0,0,0,0.35)'; ctx.shadowBlur = s * 0.03; ctx.shadowOffsetY = s * 0.015;
    rr(ctx, bx, by, bw, bh, s * 0.16);
    const g = ctx.createLinearGradient(bx, by, bx + bw, by + bh);
    g.addColorStop(0, ZM.css(ZM.mixc(ZM.hex(body), [1, 1, 1], 0.35)));
    g.addColorStop(0.45, body);
    g.addColorStop(1, dark);
    ctx.fillStyle = g; ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.lineWidth = s * 0.028; ctx.strokeStyle = ZM.css(ZM.mulc(ZM.hex(dark), 0.6)); ctx.stroke();
    // front bumper
    rr(ctx, bx + bw * 0.12, by - s * 0.02, bw * 0.76, s * 0.07, s * 0.035);
    ctx.fillStyle = '#2a2d36'; ctx.fill();
    // glossy highlight
    rr(ctx, bx + bw * 0.12, by + bh * 0.08, bw * 0.3, bh * 0.5, s * 0.08);
    ctx.fillStyle = 'rgba(255,255,255,0.22)'; ctx.fill();
    // engine cap
    const ec = ctx.createRadialGradient(c - s * 0.05, c - s * 0.07, s * 0.02, c, c - s * 0.02, s * 0.17);
    ec.addColorStop(0, ZM.css(ZM.mixc(ZM.hex(acc), [1, 1, 1], 0.45)));
    ec.addColorStop(1, acc);
    ctx.beginPath(); ctx.arc(c, c - s * 0.02, s * 0.15, 0, ZM.TAU); ctx.fillStyle = ec; ctx.fill();
    ctx.lineWidth = s * 0.02; ctx.strokeStyle = 'rgba(0,0,0,0.45)'; ctx.stroke();
    ctx.beginPath(); ctx.arc(c, c - s * 0.02, s * 0.055, 0, ZM.TAU);
    ctx.fillStyle = ZM.css(ZM.hex(body)); ctx.fill();
    ctx.beginPath(); ctx.arc(c - s * 0.015, c - s * 0.035, s * 0.02, 0, ZM.TAU);
    ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.fill();
  }

  function drawDisc(ctx, s) {
    const c = s / 2;
    const g = ctx.createRadialGradient(c, c, s * 0.05, c, c, s * 0.5);
    g.addColorStop(0, 'rgba(255,255,255,0.05)');
    g.addColorStop(0.75, 'rgba(255,255,255,0.12)');
    g.addColorStop(0.93, 'rgba(255,255,255,0.28)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(c, c, s * 0.5, 0, ZM.TAU); ctx.fill();
    // motion-blurred blade arcs
    for (let k = 0; k < 2; k++) {
      const a0 = k * Math.PI;
      for (let i = 0; i < 14; i++) {
        ctx.strokeStyle = `rgba(255,255,255,${0.32 * (1 - i / 14)})`;
        ctx.lineWidth = s * 0.05;
        ctx.beginPath(); ctx.arc(c, c, s * 0.4, a0 - i * 0.09 - 0.09, a0 - i * 0.09); ctx.stroke();
      }
    }
  }

  function radial(ctx, s, stops) {
    const c = s / 2;
    const g = ctx.createRadialGradient(c, c, 0, c, c, c);
    for (const [o, col] of stops) g.addColorStop(o, col);
    ctx.fillStyle = g; ctx.fillRect(0, 0, s, s);
  }

  function drawRing(ctx, s) {
    const c = s / 2;
    ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.lineWidth = s * 0.05;
    ctx.beginPath(); ctx.arc(c, c, s * 0.46, 0, ZM.TAU); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.95)'; ctx.lineWidth = s * 0.018;
    ctx.beginPath(); ctx.arc(c, c, s * 0.46, 0, ZM.TAU); ctx.stroke();
  }

  function drawCoin(ctx, s) {
    const c = s / 2;
    ctx.beginPath(); ctx.arc(c, c, s * 0.44, 0, ZM.TAU);
    const g = ctx.createLinearGradient(0, 0, s, s);
    g.addColorStop(0, '#fff3a6'); g.addColorStop(0.5, '#ffcc33'); g.addColorStop(1, '#d98a00');
    ctx.fillStyle = g; ctx.fill();
    ctx.lineWidth = s * 0.06; ctx.strokeStyle = '#b86e00'; ctx.stroke();
    ctx.beginPath(); ctx.arc(c, c, s * 0.3, 0, ZM.TAU); ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = s * 0.04; ctx.stroke();
    star(ctx, c, c, s * 0.16, s * 0.07, 5, '#fff8d0');
  }

  function star(ctx, x, y, R, r, n, fill) {
    ctx.beginPath();
    for (let i = 0; i < n * 2; i++) {
      const a = (i * Math.PI) / n - Math.PI / 2;
      const rad = i % 2 === 0 ? R : r;
      ctx.lineTo(x + Math.cos(a) * rad, y + Math.sin(a) * rad);
    }
    ctx.closePath(); ctx.fillStyle = fill; ctx.fill();
  }

  function drawGem(ctx, s) {
    const c = s / 2;
    const top = s * 0.16, mid = s * 0.38, bot = s * 0.88, w = s * 0.4;
    const P = (x, y) => [c + x, y];
    const facets = [
      [[P(-w, mid), P(-w * 0.5, top), P(-w * 0.15, mid)], '#a6fff4'],
      [[P(-w * 0.15, mid), P(-w * 0.5, top), P(w * 0.5, top), P(w * 0.15, mid)], '#e8fffb'],
      [[P(w * 0.15, mid), P(w * 0.5, top), P(w, mid)], '#7deee6'],
      [[P(-w, mid), P(-w * 0.15, mid), P(0, bot)], '#34c7d9'],
      [[P(-w * 0.15, mid), P(w * 0.15, mid), P(0, bot)], '#5fe3ea'],
      [[P(w * 0.15, mid), P(w, mid), P(0, bot)], '#1b9fc2'],
    ];
    for (const [pts, col] of facets) {
      ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath();
      ctx.fillStyle = col; ctx.fill();
    }
    ctx.beginPath();
    [P(-w, mid), P(-w * 0.5, top), P(w * 0.5, top), P(w, mid), P(0, bot)].forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath(); ctx.lineWidth = s * 0.035; ctx.strokeStyle = '#0d6f8f'; ctx.stroke();
  }

  function drawClover(ctx, s) {
    const c = s / 2;
    ctx.strokeStyle = '#2f8f2f'; ctx.lineWidth = s * 0.06; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(c, c); ctx.quadraticCurveTo(c + s * 0.12, c + s * 0.25, c + s * 0.05, c + s * 0.45); ctx.stroke();
    for (let i = 0; i < 4; i++) {
      ctx.save(); ctx.translate(c, c); ctx.rotate((i * Math.PI) / 2 + Math.PI / 4);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.bezierCurveTo(-s * 0.26, -s * 0.12, -s * 0.18, -s * 0.38, 0, -s * 0.24);
      ctx.bezierCurveTo(s * 0.18, -s * 0.38, s * 0.26, -s * 0.12, 0, 0);
      const g = ctx.createLinearGradient(0, 0, 0, -s * 0.36);
      g.addColorStop(0, '#2fae3a'); g.addColorStop(1, '#7ee36b');
      ctx.fillStyle = g; ctx.fill();
      ctx.lineWidth = s * 0.02; ctx.strokeStyle = '#1d7a28'; ctx.stroke();
      ctx.restore();
    }
  }

  function drawPetals(ctx, s) {
    const c = s / 2;
    for (let i = 0; i < 5; i++) {
      ctx.save(); ctx.translate(c, c); ctx.rotate((i * ZM.TAU) / 5);
      ctx.beginPath(); ctx.ellipse(0, -s * 0.22, s * 0.15, s * 0.23, 0, 0, ZM.TAU);
      const g = ctx.createLinearGradient(0, 0, 0, -s * 0.45);
      g.addColorStop(0, 'rgba(255,255,255,0.75)'); g.addColorStop(1, '#ffffff');
      ctx.fillStyle = g; ctx.fill();
      ctx.restore();
    }
  }

  function drawCenter(ctx, s) {
    const c = s / 2;
    const g = ctx.createRadialGradient(c - s * 0.04, c - s * 0.04, 0, c, c, s * 0.14);
    g.addColorStop(0, '#fff5a8'); g.addColorStop(1, '#f2a922');
    ctx.beginPath(); ctx.arc(c, c, s * 0.13, 0, ZM.TAU); ctx.fillStyle = g; ctx.fill();
  }

  function drawPetal(ctx, s) {
    const c = s / 2;
    ctx.beginPath(); ctx.ellipse(c, c, s * 0.28, s * 0.45, 0, 0, ZM.TAU);
    ctx.fillStyle = '#fff'; ctx.fill();
  }

  function drawClip(ctx, w, h) {
    ctx.beginPath();
    ctx.moveTo(w * 0.5, 0);
    ctx.quadraticCurveTo(w * 0.95, h * 0.5, w * 0.6, h);
    ctx.lineTo(w * 0.4, h);
    ctx.quadraticCurveTo(w * 0.05, h * 0.5, w * 0.5, 0);
    ctx.fillStyle = '#fff'; ctx.fill();
  }

  function drawLeaf(ctx, s) {
    const c = s / 2;
    ctx.beginPath();
    ctx.moveTo(c, s * 0.06);
    ctx.bezierCurveTo(s * 0.95, s * 0.3, s * 0.8, s * 0.8, c, s * 0.94);
    ctx.bezierCurveTo(s * 0.2, s * 0.8, s * 0.05, s * 0.3, c, s * 0.06);
    ctx.fillStyle = '#fff'; ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = s * 0.04;
    ctx.beginPath(); ctx.moveTo(c, s * 0.1); ctx.lineTo(c, s * 0.9); ctx.stroke();
  }

  function drawSpark(ctx, s) {
    const c = s / 2;
    radial(ctx, s, [[0, 'rgba(255,255,255,0.9)'], [0.25, 'rgba(255,255,255,0.25)'], [1, 'rgba(255,255,255,0)']]);
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.moveTo(c, 0); ctx.quadraticCurveTo(c, c, s, c); ctx.quadraticCurveTo(c, c, c, s); ctx.quadraticCurveTo(c, c, 0, c); ctx.quadraticCurveTo(c, c, c, 0);
    ctx.fill();
  }

  function drawButterfly(ctx, s) {
    const c = s / 2;
    const wing = (sx) => {
      ctx.beginPath();
      ctx.moveTo(c, c);
      ctx.bezierCurveTo(c + sx * s * 0.15, c - s * 0.45, c + sx * s * 0.5, c - s * 0.35, c + sx * s * 0.42, c - s * 0.05);
      ctx.bezierCurveTo(c + sx * s * 0.48, c + s * 0.25, c + sx * s * 0.2, c + s * 0.38, c, c + s * 0.08);
      ctx.fillStyle = '#fff'; ctx.fill();
      ctx.lineWidth = s * 0.025; ctx.strokeStyle = 'rgba(40,20,40,0.55)'; ctx.stroke();
      ctx.beginPath(); ctx.arc(c + sx * s * 0.26, c - s * 0.12, s * 0.06, 0, ZM.TAU); ctx.fillStyle = 'rgba(40,20,40,0.35)'; ctx.fill();
    };
    wing(-1); wing(1);
    ctx.fillStyle = '#2a1a2a';
    ctx.beginPath(); ctx.ellipse(c, c, s * 0.035, s * 0.18, 0, 0, ZM.TAU); ctx.fill();
  }

  function drawArrow(ctx, s) {
    ctx.beginPath();
    ctx.moveTo(s * 0.5, s * 0.1); ctx.lineTo(s * 0.9, s * 0.6); ctx.lineTo(s * 0.62, s * 0.6); ctx.lineTo(s * 0.62, s * 0.9);
    ctx.lineTo(s * 0.38, s * 0.9); ctx.lineTo(s * 0.38, s * 0.6); ctx.lineTo(s * 0.1, s * 0.6); ctx.closePath();
    ctx.fillStyle = '#fff'; ctx.fill();
  }

  ZM.drawMowerPreview = function (canvas, skin) {
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawMower(ctx, canvas.width, skin);
  };

  ZM.buildAtlas = function () {
    const size = 1024;
    const cv = document.createElement('canvas');
    cv.width = size; cv.height = size;
    const ctx = cv.getContext('2d');
    const pack = shelfPacker(size);
    const sprites = {};
    const add = (name, w, h, fn) => {
      const r = pack(w, h);
      ctx.save(); ctx.translate(r.x, r.y);
      ctx.beginPath(); ctx.rect(0, 0, w, h); ctx.clip();
      fn(ctx, w, h);
      ctx.restore();
      // half-texel inset avoids bleeding from neighbours when filtering
      sprites[name] = [(r.x + 0.5) / size, (r.y + 0.5) / size, (r.x + w - 0.5) / size, (r.y + h - 0.5) / size];
    };
    ZM.SKINS.forEach((skin) => add('mower_' + skin.id, 160, 160, (c, w) => drawMower(c, w, skin)));
    add('disc', 160, 160, (c, w) => drawDisc(c, w));
    add('ring', 256, 256, (c, w) => drawRing(c, w));
    add('shadow', 96, 96, (c, w) => radial(c, w, [[0, 'rgba(0,0,0,0.55)'], [0.55, 'rgba(0,0,0,0.25)'], [1, 'rgba(0,0,0,0)']]));
    add('glow', 128, 128, (c, w) => radial(c, w, [[0, 'rgba(255,255,255,1)'], [0.3, 'rgba(255,255,255,0.45)'], [1, 'rgba(255,255,255,0)']]));
    add('dot', 48, 48, (c, w) => radial(c, w, [[0, 'rgba(255,255,255,1)'], [0.45, 'rgba(255,255,255,0.8)'], [1, 'rgba(255,255,255,0)']]));
    add('coin', 96, 96, (c, w) => drawCoin(c, w));
    add('gem', 96, 96, (c, w) => drawGem(c, w));
    add('clover', 96, 96, (c, w) => drawClover(c, w));
    add('petals', 96, 96, (c, w) => drawPetals(c, w));
    add('fcenter', 96, 96, (c, w) => drawCenter(c, w));
    add('petal', 32, 32, (c, w) => drawPetal(c, w));
    add('clip', 16, 40, (c, w, h) => drawClip(c, w, h));
    add('leaf', 48, 48, (c, w) => drawLeaf(c, w));
    add('spark', 64, 64, (c, w) => drawSpark(c, w));
    add('butterfly', 96, 96, (c, w) => drawButterfly(c, w));
    add('confetti', 16, 24, (c, w, h) => { rr(c, 0, 0, w, h, 4); c.fillStyle = '#fff'; c.fill(); });
    add('arrow', 64, 64, (c, w) => drawArrow(c, w));
    add('white', 8, 8, (c, w, h) => { c.fillStyle = '#fff'; c.fillRect(0, 0, w, h); });
    add('drop', 8, 64, (c, w, h) => {
      const g = c.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.75, 'rgba(255,255,255,0.7)'); g.addColorStop(1, 'rgba(255,255,255,1)');
      c.fillStyle = g; rr(c, 1, 0, w - 2, h, 3); c.fill();
    });
    return { canvas: cv, sprites };
  };

  // Glyph atlas for floating numbers ("+1.25K", "COMBO x3" ...).
  ZM.buildFont = function (fontFamily) {
    const chars = ' 0123456789.,+-$×xX!%:/?ABCDEFGHIJKLMNOPQRSTUVWYZabcdefghijklmnopqrstuvwyzÄÖÜäöüß';
    const px = 64, stroke = 9;
    const cv = document.createElement('canvas');
    cv.width = 1024; cv.height = 1024;
    const ctx = cv.getContext('2d');
    ctx.font = `${px}px ${fontFamily}`;
    ctx.textBaseline = 'alphabetic';
    ctx.lineJoin = 'round';
    const glyphs = {};
    let x = 4, y = 4;
    const cellH = px + stroke * 2 + 8;
    for (const ch of chars) {
      const w = Math.ceil(ctx.measureText(ch).width) + stroke * 2 + 4;
      if (x + w > cv.width - 4) { x = 4; y += cellH; }
      const bx = x + stroke + 2, by = y + px * 0.92 + stroke;
      ctx.strokeStyle = 'rgba(20,24,30,0.92)';
      ctx.lineWidth = stroke * 2;
      ctx.strokeText(ch, bx, by);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(ch, bx, by);
      glyphs[ch] = {
        uv: [(x + 0.5) / cv.width, (y + 0.5) / cv.height, (x + w - 0.5) / cv.width, (y + cellH - 0.5) / cv.height],
        w: w / px, adv: (ctx.measureText(ch).width + stroke * 0.6) / px, h: cellH / px,
      };
      x += w + 2;
    }
    return { canvas: cv, glyphs };
  };
})(window.ZM);
