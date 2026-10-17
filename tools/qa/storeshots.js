const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
(async () => {
  const [url, out] = process.argv.slice(2);
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  // upgrade levels a player typically has on lawn N (see pace.js)
  const up = (N) => ({ blade: Math.min(45, Math.round(3.1 * N)), engine: Math.min(45, Math.round(3.1 * N)), fert: Math.round(3.2 * N), sprinkler: Math.min(40, Math.round(2.7 * N)),
    fleet: N >= 10 ? 3 : N >= 6 ? 2 : N >= 3 ? 1 : 0, auto: Math.min(10, N - 1) });
  const shots = [
    { name: '1_mow', lv: 1, upg: { blade: 3, engine: 3, fert: 2, sprinkler: 2 }, mowT: 9, fingers: 1 },
    { name: '2_lavender', lv: 2, upg: up(2), mowT: 7, fingers: 1 },
    { name: '3_neon', lv: 10, upg: up(10), mowT: 3.5, fingers: 1 },          // fleet in formation
    { name: '4_moon', lv: 7, upg: up(7), mowT: 5, fingers: 1, auto: 4 },     // autopilot running
    { name: '5_sakura', lv: 3, upg: up(3), mowT: 8, fingers: 1, round: true }, // LAWN COMPLETE!
    { name: '6_ocean', lv: 9, upg: up(9), mowT: 5, fingers: 2 },            // two fingers, two mowers
    { name: '7_zen_temple', lv: 3, upg: up(3), zen: 'temple', mowT: 16 },
    { name: '8_zen_night', lv: 3, upg: up(3), zen: 'night', mowT: 14, breathe: true },
  ];
  for (const s of shots) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 780 }, deviceScaleFactor: 1080 / 390, isMobile: true, hasTouch: true });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => console.log('[pageerror]', e.message));
    await page.addInitScript((s) => localStorage.setItem('zenmower.save.v1', JSON.stringify({ v: 3, level: s.lv, cash: 0, gems: 23 + s.lv * 3,
      daily: { last: new Date().toDateString(), streak: 1 },
      tutorial: { move: true, fleet: true, lawn: true, regrow: true, zen: true, zenMode: true, buy: true, round: true, autoIntro: true, autoUse: true }, upg: s.upg })), s);
    await page.goto(url, { waitUntil: 'load' });
    await page.waitForFunction(() => window.ZM && ZM.ready && ZM.debug, null, { timeout: 30000 });
    if (s.zen) {
      // zen mode: autopilot mows stripes, optional breathing ring
      await page.evaluate((s) => {
        ZM.debug.paused = true; const l = document.getElementById('loading'); if (l) l.remove();
        ZM.save.zen.auto = true; ZM.save.zen.breathe = !!s.breathe; ZM.save.tutorial.zenMode = true;
        ZM.zen.enter(s.zen);
      }, s);
      await page.waitForTimeout(700);
      await page.evaluate((s) => {
        ZM.debug.step(Math.round(s.mowT * 30), 1 / 30);
        ZM.zen.titleT = 5; document.getElementById('zenTitle').classList.remove('gone'); ZM.zen.wakeDock();
        if (s.breathe) {
          const ring = document.querySelector('#breath .ring');
          ring.classList.remove('cycle'); ring.style.transform = 'scale(0.92)';
          document.getElementById('breathTxt').textContent = ZM.t('Breathe in');
        }
        ZM.debug.draw();
      }, s);
      await page.waitForTimeout(500);
      await page.evaluate(() => ZM.debug.draw());
      await page.screenshot({ path: `${out}/${s.name}.png` });
      console.log('ok', s.name);
      await ctx.close();
      continue;
    }
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
      if (s.auto) { // lift the fingers and let the autopilot drive for a few seconds
        for (const m of g.mowers) { m.pointer = null; m.hasTarget = false; }
        g.activateAuto(true); ZM.debug.step(Math.round(s.auto * 30), 1 / 30);
      }
      if (s.round) { g.roundStart = g.time - 60; g.completeRound(); ZM.debug.step(14, 1 / 30); }
      ZM.debug.step(2); ZM.debug.draw();
      if (!s.round) document.getElementById('banner').classList.add('hidden');
      document.getElementById('toast').classList.add('hidden');
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
