const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
(async () => {
  const [url, out] = process.argv.slice(2);
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const up = (N) => ({ blade: Math.min(60, 5 * N + 3), engine: Math.min(60, 5 * N + 4), fert: 5 * N, sprinkler: Math.min(50, 4 * N + 3), fleet: Math.min(3, N - 1), bots: Math.min(10, (N - 1) * 2) });
  const shots = [
    { name: '1_mow', lv: 1, upg: { blade: 3, engine: 3, fert: 2, sprinkler: 2 }, mowT: 9, fingers: 1 },
    { name: '2_lavender', lv: 2, upg: up(2), mowT: 7, fingers: 2 },
    { name: '3_neon', lv: 10, upg: up(10), mowT: 5, fingers: 2 },
    { name: '4_moon', lv: 7, upg: up(7), mowT: 5, fingers: 2 },
    { name: '5_sakura', lv: 3, upg: up(3), mowT: 6, fingers: 2 },
    { name: '6_ocean', lv: 9, upg: up(9), mowT: 5, fingers: 2 },
  ];
  for (const s of shots) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 780 }, deviceScaleFactor: 1080 / 390, isMobile: true, hasTouch: true });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => console.log('[pageerror]', e.message));
    await page.addInitScript((s) => localStorage.setItem('zenmower.save.v1', JSON.stringify({ v: 2, level: s.lv, cash: 0, gems: 23 + s.lv * 3, tutorial: { move: true, fleet: true, lawn: true, regrow: true, zen: true }, upg: s.upg })), s);
    await page.goto(url, { waitUntil: 'load' });
    await page.waitForFunction(() => window.ZM && ZM.ready && ZM.debug, null, { timeout: 30000 });
    await page.evaluate((s) => {
      ZM.debug.paused = true; const l = document.getElementById('loading'); if (l) l.remove();
      document.getElementById('banner').classList.add('hidden');
      const g = ZM.game; ZM.save.cash = ZM.lawnCost(s.lv) * 0.55; ZM.debug.step(100);
      let t = 0;
      while (t < s.mowT) {
        for (const m of g.mowers.slice(0, s.fingers)) {
          if (m.pointer === null) m.pointer = 50 + m.idx;
          if (!m._tt || t > m._tt) { const i = g.field.nearestTall(m.x + Math.sin(m.angle) * 3, m.y - Math.cos(m.angle) * 3); if (i >= 0) { m.tx = (i % g.level.W) + 0.5; m.ty = ((i / g.level.W) | 0) + 0.5; m.hasTarget = true; } m._tt = t + 0.3; }
        }
        ZM.debug.step(1, 1 / 30); t += 1 / 30;
      }
      ZM.debug.step(2); ZM.debug.draw();
      document.getElementById('banner').classList.add('hidden');
      document.getElementById('progressFill').style.transition = 'none';
    }, s);
    await page.waitForTimeout(400);
    await page.evaluate(() => ZM.debug.draw());
    await page.screenshot({ path: `${out}/${s.name}.png` });
    console.log('ok', s.name);
    await ctx.close();
  }
  await browser.close();
})();
