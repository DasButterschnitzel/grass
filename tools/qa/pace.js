// Pacing bot for the lawn economy, running the real game code. A "finger" steers the lead
// mower towards tall grass (the fleet follows in formation), the autopilot is used whenever it
// is charged (optional), and the bot buys the cheapest available upgrade unless it is saving
// up for the next lawn. `skill` < 1 slows the whole simulation down to a human pace.
// usage: node pace.js <url> [lawns] [skill 0..1] [useAuto 0|1] [econ json]
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
(async () => {
  const [url, lawns = '12', skill = '0.75', useAuto = '1', econ = ''] = process.argv.slice(2);
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await (await browser.newContext({ viewport: { width: 400, height: 860 } })).newPage();
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  await page.addInitScript((econ) => { localStorage.removeItem('zenmower.save.v1'); if (econ) window.__econ = JSON.parse(econ); }, econ);
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => window.ZM && ZM.ready && ZM.debug, null, { timeout: 30000 });
  await page.evaluate(() => { ZM.debug.paused = true; ZM.audio = null; });
  let total = 0;
  for (let L = 0; L < +lawns; L++) {
    const r = await page.evaluate(([skill, useAuto]) => {
      const g = ZM.game, s = ZM.save, dt = 1 / 30;
      const ids = ZM.UPGRADES.map((u) => u.id);
      const N = g.level.N, rounds0 = g.rounds;
      let t = 0, lastBuy = 0, retarget = 0, autoUses = 0, autoTime = 0;
      const buys = [];
      g.paceNextAuto = g.paceNextAuto || 0; g.paceT = g.paceT || 0;
      while (t < 3600) {
        const lead = g.mowers[0];
        if (useAuto && g.paceT >= g.paceNextAuto && g.autoT <= 0) {
          // the cooldown runs on the wall clock in the game; the bot keeps its own sim clock
          s.autoReadyAt = 0;
          if (g.activateAuto()) { autoUses++; g.paceNextAuto = g.paceT + g.stats.autoDur + ZM.AUTO_COOLDOWN; }
        }
        if (g.autoT > 0) { lead.pointer = null; lead.hasTarget = false; autoTime += dt; }
        else {
          lead.pointer = 1;
          if (t >= retarget) { lead.hasTarget = g.botTarget(lead); retarget = t + 0.25; }
        }
        g.update(dt * skill); t += dt; g.paceT += dt;
        if (t - lastBuy > 1) {
          lastBuy = t;
          const lawnCost = g.nextLawnCost;
          for (;;) {
            let best = null, bc = Infinity;
            for (const id of ids) {
              const l = s.upg[id] || 0;
              if (l >= ZM.UPG[id].max || ZM.upgradeLock(id, l, g.level.N)) continue;
              const c = ZM.upgradeCost(id, l);
              if (c < bc) { bc = c; best = id; }
            }
            if (best && s.cash >= bc && (bc < 0.25 * lawnCost || s.cash - bc >= lawnCost)) { s.cash -= bc; s.upg[best]++; g.recalc(); buys.push(best); } else break;
          }
          if (s.cash >= lawnCost) break;
        }
      }
      g.mowers[0].pointer = null;
      const st = g.stats, rounds = g.rounds - rounds0;
      g.buyNextLawn();
      return { N, t: Math.round(t), buys: buys.length, rounds, autoUses, autoPct: Math.round((autoTime / t) * 100), upg: Object.assign({}, s.upg), radius: +st.radius.toFixed(1), W: g.level.W };
    }, [+skill, +useAuto]);
    total += r.t;
    console.log(`Lawn ${String(r.N).padStart(2)}: ${String(r.t).padStart(4)}s (total ${(total / 60).toFixed(1)} min) rounds=${r.rounds} auto=${r.autoUses}x/${r.autoPct}% buys=${r.buys} r=${r.radius} ${JSON.stringify(r.upg)}`);
  }
  await browser.close();
})();
