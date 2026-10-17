// Screenshot several levels, partially mowed by a bot. usage: node gallery.js <url> <outdir> <levels comma>
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
(async () => {
  const [url, out, lvls] = process.argv.slice(2);
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  for (const lv of lvls.split(',').map(Number)) {
    const ctx = await browser.newContext({ viewport: { width: 400, height: 860 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => console.log('[pageerror]', lv, e.message));
    page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log('[console]', lv, m.text().slice(0, 300)); });
    await page.addInitScript((lv) => {
      localStorage.setItem('zenmower.save.v1', JSON.stringify({ level: lv, cash: 12345 * lv * lv, gems: 7, tutorial: { move: true, fleet: true },
        v: 2, upg: { blade: Math.min(60, 5 * lv), engine: Math.min(60, 5 * lv), fert: 5 * lv, sprinkler: Math.min(50, 4 * lv), fleet: Math.min(3, lv - 1), bots: Math.min(10, 2 * (lv - 1)) } }));
    }, lv);
    await page.goto(url, { waitUntil: 'load' });
    await page.waitForFunction(() => window.ZM && ZM.ready && ZM.debug, null, { timeout: 30000 });
    const info = await page.evaluate(() => {
      ZM.debug.paused = true; const l = document.getElementById('loading'); if (l) l.remove();
      const g = ZM.game; ZM.debug.step(120);
      const t0 = g.time; let t = 0;
      while (t < 7) {
        for (const m of g.mowers.slice(0, 2)) {
          if (m.pointer === null) m.pointer = 50 + m.idx;
          if (!m._tt || t > m._tt) { const i = g.field.nearestTall(m.x, m.y); if (i >= 0) { m.tx = (i % g.level.W) + 0.5; m.ty = ((i / g.level.W) | 0) + 0.5; m.hasTarget = true; } m._tt = t + 0.25; }
        }
        ZM.debug.step(1, 1 / 30); t += 1 / 30;
      }
      ZM.debug.step(1); ZM.debug.draw();
      return { N: g.level.N, shape: g.level.shape, biome: g.biome.name, W: g.level.W, maxL: g.level.maxL, mowers: g.mowers.length, coverage: g.field.coverage.toFixed(2) };
    });
    console.log(JSON.stringify(info));
    await page.screenshot({ path: `${out}/G${lv}.png` });
    await ctx.close();
  }
  await browser.close();
})();
