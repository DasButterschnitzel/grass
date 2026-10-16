const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
(async () => {
  const [url, out] = process.argv.slice(2);
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const shots = [
    { name: '1_mow', lv: 3, upg: { blade: 4, sharp: 3, engine: 4, fert: 3 }, mowT: 9, fingers: 1 },
    { name: '2_lavender', lv: 8, upg: { blade: 6, sharp: 6, engine: 6, fert: 8, fleet: 1, bots: 1 }, mowT: 7, fingers: 2 },
    { name: '3_neon', lv: 47, upg: { blade: 22, sharp: 22, engine: 22, fert: 46, fleet: 3, bots: 9 }, mowT: 5, fingers: 2 },
    { name: '4_moon', lv: 32, upg: { blade: 16, sharp: 16, engine: 16, fert: 30, fleet: 3, bots: 7 }, mowT: 5, fingers: 2 },
    { name: '5_sakura', lv: 12, upg: { blade: 9, sharp: 9, engine: 9, fert: 14, fleet: 2, bots: 3 }, mowT: 6, fingers: 2 },
    { name: '6_ocean', lv: 42, upg: { blade: 20, sharp: 20, engine: 20, fert: 40, fleet: 3, bots: 8 }, mowT: 5, fingers: 2 },
  ];
  for (const s of shots) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 780 }, deviceScaleFactor: 1080 / 390, isMobile: true, hasTouch: true });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => console.log('[pageerror]', e.message));
    await page.addInitScript((s) => localStorage.setItem('zenmower.save.v1', JSON.stringify({ level: s.lv, cash: 3.7 * Math.pow(1.31, s.lv) * 1000, gems: 23 + s.lv, tutorial: { move: true, fleet: true }, upg: s.upg })), s);
    await page.goto(url, { waitUntil: 'load' });
    await page.waitForFunction(() => window.ZM && ZM.ready && ZM.debug, null, { timeout: 30000 });
    await page.evaluate((s) => {
      ZM.debug.paused = true; const l = document.getElementById('loading'); if (l) l.remove();
      document.getElementById('banner').classList.add('hidden');
      const g = ZM.game; ZM.debug.step(100);
      let t = 0;
      while (t < s.mowT) {
        for (const m of g.mowers.slice(0, s.fingers)) {
          if (m.pointer === null) m.pointer = 50 + m.idx;
          if (!m._tt || t > m._tt) { const i = g.field.nearestUncut(m.x + Math.sin(m.angle) * 3, m.y - Math.cos(m.angle) * 3); if (i >= 0) { m.tx = (i % g.level.W) + 0.5; m.ty = ((i / g.level.W) | 0) + 0.5; m.hasTarget = true; } m._tt = t + 0.3; }
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
