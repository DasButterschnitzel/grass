// Deterministic play-through screenshots. usage: node play.js <url> <outdir> [level] [dpr]
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
(async () => {
  const [url, out, level = '1', dprS = '2'] = process.argv.slice(2);
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const ctx = await browser.newContext({ viewport: { width: 400, height: 860 }, deviceScaleFactor: +dprS, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const logs = [];
  page.on('console', (m) => { if (m.type() !== 'log') logs.push(`[${m.type()}] ${m.text().slice(0, 300)}`); });
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message} ${e.stack}`));
  await page.addInitScript((lv) => {
    if (+lv > 1) localStorage.setItem('zenmower.save.v1', JSON.stringify({ level: +lv, cash: 0, tutorial: { move: true, fleet: true }, upg: { blade: Math.min(25, lv), sharp: Math.min(25, lv), engine: Math.min(25, lv), fert: +lv, fleet: Math.min(3, Math.floor(lv / 8)), bots: Math.min(10, Math.floor(lv / 4)) } }));
  }, level);
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => window.ZM && ZM.ready && ZM.debug, null, { timeout: 30000 });
  await page.evaluate(() => { ZM.debug.paused = true; document.getElementById('loading') && document.getElementById('loading').remove(); });
  await page.evaluate(() => { ZM.debug.step(100); ZM.debug.draw(); });
  await page.screenshot({ path: `${out}/L${level}_a_start.png` });
  const info = await page.evaluate(() => { const g = ZM.game; return { gl2: ZM.renderer.glw.isGL2, N: g.level.N, shape: g.level.shape, W: g.level.W, H: g.level.H, cells: g.level.cellCount, total: g.field.total, blades: ZM.renderer.bladeCount, cam: g.cam, mowers: g.mowers.length }; });
  console.log(JSON.stringify(info));
  // drive mower 0 along lanes with a "finger"
  const res = await page.evaluate(() => {
    const g = ZM.game, c = g.cam, W = g.level.W, H = g.level.H;
    const s = (x, y) => [c.offX + x * c.scale, c.offY + y * c.scale];
    const m = g.mowers[0];
    let p = s(m.x, m.y);
    g.pointerDown(7, p[0], p[1]);
    const lanes = 9;
    for (let l = 0; l < lanes; l++) {
      const y = H * (0.12 + l * (0.76 / (lanes - 1)));
      const from = l % 2 ? 0.92 : 0.08, to = l % 2 ? 0.08 : 0.92;
      for (let k = 0; k <= 30; k++) {
        p = s(W * (from + (to - from) * k / 30), y);
        g.pointerMove(7, p[0], p[1]);
        ZM.debug.step(3);
      }
      if (l === 4) { ZM.debug.draw(); window.__mid = true; break; }
    }
    return { progress: g.field.progress, cash: ZM.save.cash, combo: g.combo.level, texts: g.texts.length, particles: g.particles.n };
  });
  console.log('mid', JSON.stringify(res));
  await page.screenshot({ path: `${out}/L${level}_b_mowing.png` });
  // zoomed crop around mower
  const crop = await page.evaluate(() => { const g = ZM.game, c = g.cam, m = g.mowers[0]; return { x: Math.max(0, c.offX + m.x * c.scale - 110), y: Math.max(0, c.offY + m.y * c.scale - 110) }; });
  await page.screenshot({ path: `${out}/L${level}_c_zoom.png`, clip: { x: crop.x, y: crop.y, width: 220, height: 220 } });
  // finish the field quickly via autopilot-like sweep
  const res2 = await page.evaluate(() => {
    const g = ZM.game, c = g.cam, W = g.level.W, H = g.level.H;
    const s = (x, y) => [c.offX + x * c.scale, c.offY + y * c.scale];
    let steps = 0;
    for (let pass = 0; pass < 6 && g.state === 'play'; pass++) {
      const lanes = Math.ceil(H / (g.stats.radius * 1.5));
      for (let l = 0; l <= lanes && g.state === 'play'; l++) {
        const y = H * (l / lanes);
        const from = l % 2 ? 0.98 : 0.02, to = l % 2 ? 0.02 : 0.98;
        for (let k = 0; k <= 24 && g.state === 'play'; k++) { const p = s(W * (from + (to - from) * k / 24), y); g.pointerMove(7, p[0], p[1]); ZM.debug.step(2); steps += 2; }
      }
    }
    ZM.debug.step(70);
    ZM.debug.draw();
    return { steps, simSeconds: steps / 60, progress: g.field.progress, state: g.state, cash: ZM.save.cash, reward: g.pendingReward };
  });
  console.log('end', JSON.stringify(res2));
  await page.screenshot({ path: `${out}/L${level}_d_cleared.png` });
  console.log(logs.slice(0, 30).join('\n'));
  await browser.close();
})();
