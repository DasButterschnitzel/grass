// Bot plays N levels (greedy nearest-grass steering + greedy cheapest upgrade) and reports pacing.
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
(async () => {
  const [url, levels = '30', fingers = '2'] = process.argv.slice(2);
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const ctx = await browser.newContext({ viewport: { width: 400, height: 860 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => window.ZM && ZM.ready && ZM.debug, null, { timeout: 30000 });
  await page.evaluate(() => { ZM.debug.paused = true; ZM.audio = null; });
  for (let L = 0; L < +levels; L++) {
    const r = await page.evaluate((fingers) => {
      const g = ZM.game, s = ZM.save, dt = 1 / 30;
      let t = 0, buys = [], lastBuy = 0;
      const ids = ZM.UPGRADES.map((u) => u.id);
      const N = g.level.N;
      while (g.state !== 'cleared' && t < 900) {
        // steer up to `fingers` mowers like a human would
        const nf = Math.min(fingers, g.mowers.length);
        for (let k = 0; k < nf; k++) {
          const m = g.mowers[k];
          if (m.pointer === null) { m.pointer = 100 + k; }
          if (!m._tt || t > m._tt) {
            const i = g.field.nearestUncut(m.x + Math.sin(m.angle) * 2, m.y - Math.cos(m.angle) * 2);
            if (i >= 0) { m.tx = (i % g.level.W) + 0.5; m.ty = ((i / g.level.W) | 0) + 0.5; m.hasTarget = true; }
            m._tt = t + 0.25;
          }
        }
        g.update(dt); t += dt;
        if (t - lastBuy > 1) {
          lastBuy = t;
          for (;;) {
            let best = null, bc = Infinity;
            for (const id of ids) { const l = s.upg[id] || 0; if (l >= ZM.UPG[id].max) continue; const c = ZM.upgradeCost(id, l); if (c < bc) { bc = c; best = id; } }
            if (best && s.cash >= bc) { s.cash -= bc; s.upg[best]++; g.recalc(); buys.push(best); } else break;
          }
        }
      }
      for (const m of g.mowers) { m.pointer = null; m._tt = 0; }
      const reward = g.pendingReward;
      g.collectReward(1);
      return { N, t: Math.round(t), buys: buys.length, reward, cash: s.cash, upg: Object.assign({}, s.upg), W: g.level.W, shape: g.level.shape };
    }, +fingers);
    console.log(`L${r.N} ${r.shape} t=${r.t}s buys=${r.buys} reward=${ZM_fmt(r.reward)} upg=${JSON.stringify(r.upg)}`);
  }
  await browser.close();
  function ZM_fmt(n) { return n > 1e6 ? (n / 1e6).toFixed(2) + 'M' : n > 1e3 ? (n / 1e3).toFixed(1) + 'K' : Math.round(n); }
})();
