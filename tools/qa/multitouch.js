const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
(async () => {
  const [url, out] = process.argv.slice(2);
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const ctx = await browser.newContext({ viewport: { width: 400, height: 860 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  await page.addInitScript(() => localStorage.setItem('zenmower.save.v1', JSON.stringify({ level: 3, tutorial: { move: true, fleet: true }, upg: { fleet: 1, blade: 4, engine: 4, sharp: 4 } })));
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => window.ZM && ZM.ready && ZM.debug, null, { timeout: 30000 });
  const start = await page.evaluate(() => { ZM.debug.paused = true; const l = document.getElementById('loading'); if (l) l.remove(); ZM.debug.step(120); const g = ZM.game, c = g.cam; return g.mowers.map((m) => [c.offX + m.x * c.scale, c.offY + m.y * c.scale]); });
  console.log('mower screen pos', JSON.stringify(start));
  const cdp = await ctx.newCDPSession(page);
  const T = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
  const a = { x: start[0][0], y: start[0][1], id: 1 }, b = { x: start[1][0], y: start[1][1], id: 2 };
  await T('touchStart', [a, b]);
  for (let k = 1; k <= 40; k++) {
    const pa = { x: start[0][0] - k * 2.2, y: start[0][1] - k * 9, id: 1 };
    const pb = { x: start[1][0] + k * 1.5, y: start[1][1] - k * 4, id: 2 };
    await T('touchMove', [pa, pb]);
    await page.evaluate(() => ZM.debug.step(3));
  }
  const res = await page.evaluate(() => { const g = ZM.game; ZM.debug.draw(); return { touches: g.touches.size, mowers: g.mowers.map((m) => ({ ptr: m.pointer, x: +m.x.toFixed(1), y: +m.y.toFixed(1) })), progress: g.field.progress.toFixed(3) }; });
  console.log('during', JSON.stringify(res));
  await page.screenshot({ path: `${out}/MT_two_fingers.png` });
  await T('touchEnd', []);
  const after = await page.evaluate(() => ({ touches: ZM.game.touches.size, ptrs: ZM.game.mowers.map((m) => m.pointer) }));
  console.log('after', JSON.stringify(after));
  await browser.close();
})();
