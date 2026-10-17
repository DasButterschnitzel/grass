// Visual check of the regrowing lawn, the "next lawn" dialog and zen view.
// usage: node lawn.js <url> <outdir> [lawn] [locale]
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
(async () => {
  const [url, out, lawn = '1', locale = 'de-DE'] = process.argv.slice(2);
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const ctx = await browser.newContext({ viewport: { width: 400, height: 860 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push('[pageerror] ' + e.message + '\n' + e.stack));
  page.on('console', (m) => { if (m.type() === 'error') errs.push('[console] ' + m.text()); });
  await page.addInitScript((lv) => localStorage.setItem('zenmower.save.v1', JSON.stringify({ v: 2, level: +lv, cash: 1800 * Math.pow(8, lv - 1), gems: 12,
    tutorial: { move: true, fleet: true, lawn: false, regrow: true, zen: true },
    upg: { blade: 3 + 4 * (lv - 1), engine: 2 + 4 * (lv - 1), fert: 3 * lv, sprinkler: 2 + 3 * (lv - 1), fleet: Math.min(3, lv - 1), bots: Math.min(10, 2 * (lv - 1)) } })), lawn);
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => window.ZM && ZM.ready && ZM.debug, null, { timeout: 30000 });
  const mow = (secs, fingers) => page.evaluate(([secs, fingers]) => {
    const g = ZM.game; let t = 0;
    while (t < secs) {
      for (const m of g.mowers.slice(0, fingers)) {
        if (m.pointer === null) m.pointer = 50 + m.idx;
        if (!m._tt || t > m._tt) { const i = g.field.nearestTall(m.x + Math.sin(m.angle) * 3, m.y - Math.cos(m.angle) * 3, 0.9); if (i >= 0) { m.tx = (i % g.level.W) + 0.5; m.ty = ((i / g.level.W) | 0) + 0.5; m.hasTarget = true; } m._tt = t + 0.3; }
      }
      ZM.debug.step(1, 1 / 30); t += 1 / 30;
    }
    for (const m of g.mowers) { m.pointer = null; m.hasTarget = false; }
    ZM.debug.draw();
    return { cash: ZM.save.cash, coverage: g.field.coverage, mowers: g.mowers.length, patch: !!g.patch, gem: g.gemCell, regrow: g.stats.regrow };
  }, [secs, fingers]);
  await page.evaluate(() => { ZM.debug.paused = true; const l = document.getElementById('loading'); if (l) l.remove(); document.getElementById('banner').classList.add('hidden'); ZM.debug.step(90); });
  console.log('mow', JSON.stringify(await mow(8, 2)));
  await page.screenshot({ path: `${out}/N${lawn}_1_mowed.png` });
  // let it regrow for a few seconds without mowing
  console.log('regrow', JSON.stringify(await page.evaluate(() => { ZM.debug.step(150, 1 / 30); ZM.game.spawnGoldenPatch(); if (ZM.game.gemCell < 0) ZM.game.gemCell = ZM.game.spawnSpecial(3); ZM.debug.step(20, 1 / 30); ZM.debug.draw(); return { coverage: ZM.game.field.coverage, patch: !!ZM.game.patch, gem: ZM.game.gemCell }; })));
  await page.screenshot({ path: `${out}/N${lawn}_2_regrowing.png` });
  await page.evaluate(() => { ZM.save.cash = ZM.game.nextLawnCost * 1.2; ZM.debug.step(2); ZM.debug.draw(); });
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${out}/N${lawn}_3_ready.png` });
  await page.evaluate(() => document.getElementById('levelBox').click());
  await page.waitForTimeout(450);
  await page.screenshot({ path: `${out}/N${lawn}_4_nextlawn.png` });
  await page.evaluate(() => document.querySelector('#lawnBtns .btn').click());
  await page.evaluate(() => { ZM.debug.step(25, 1 / 30); ZM.debug.draw(); });
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${out}/N${lawn}_5_newlawn.png` });
  console.log('after buy', JSON.stringify(await page.evaluate(() => ({ level: ZM.save.level, cash: ZM.save.cash, N: ZM.game.level.N, biome: ZM.game.biome.name }))));
  await page.evaluate(() => { ZM.debug.step(60, 1 / 30); document.getElementById('btnZen').click(); });
  console.log('zen', JSON.stringify(await mow(5, 1)));
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${out}/N${lawn}_6_zen.png` });
  console.log(errs.join('\n') || 'no errors');
  await browser.close();
})();
