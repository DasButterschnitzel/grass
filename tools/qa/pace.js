// Pacing bot for the lawn economy: all mowers drive like a good player (autopilot logic at
// full speed); buys the cheapest upgrade unless it is saving up for the next lawn.
// usage: node pace.js <url> [lawns] [skill 0..1]
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
(async () => {
  const [url, lawns = '12', skill = '0.75', econ = ''] = process.argv.slice(2);
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await (await browser.newContext({ viewport: { width: 400, height: 860 } })).newPage();
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  await page.addInitScript((econ) => { localStorage.removeItem('zenmower.save.v1'); if (econ) window.__econ = JSON.parse(econ); }, econ);
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => window.ZM && ZM.ready && ZM.debug, null, { timeout: 30000 });
  await page.evaluate(() => { ZM.debug.paused = true; ZM.audio = null; });
  let total = 0;
  for (let L = 0; L < +lawns; L++) {
    const r = await page.evaluate((skill) => {
      const g = ZM.game, s = ZM.save, dt = 1 / 30;
      g.autoAll = true;
      const spd = g.stats;
      let t = 0, buys = [], lastBuy = 0;
      const ids = ZM.UPGRADES.map((u) => u.id);
      const N = g.level.N;
      while (t < 3600) {
        // a human is slower and less precise than the autopilot: scale time
        g.update(dt * skill); t += dt;
        if (t - lastBuy > 1) {
          lastBuy = t;
          const lawnCost = g.nextLawnCost;
          for (;;) {
            let best = null, bc = Infinity;
            for (const id of ids) { const l = s.upg[id] || 0; if (l >= ZM.UPG[id].max) continue; const c = ZM.upgradeCost(id, l); if (c < bc) { bc = c; best = id; } }
            if (best && s.cash >= bc && (bc < 0.25 * lawnCost || s.cash - bc >= lawnCost)) { s.cash -= bc; s.upg[best]++; g.recalc(); buys.push(best); } else break;
          }
          if (s.cash >= lawnCost) break;
        }
      }
      const st = g.stats, cov = g.field.coverage;
      g.buyNextLawn();
      return { N, t: Math.round(t), buys: buys.length, upg: Object.assign({}, s.upg), regrow: +st.regrow.toFixed(2), radius: +st.radius.toFixed(1), cov: +cov.toFixed(2) };
    }, +skill);
    total += r.t;
    console.log(`Lawn ${r.N}: ${r.t}s (total ${(total / 60).toFixed(1)} min) buys=${r.buys} r=${r.radius} regrow=${r.regrow} cov=${r.cov} ${JSON.stringify(r.upg)}`);
  }
  await browser.close();
})();
