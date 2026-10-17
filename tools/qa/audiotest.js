// Records the live audio mix while the game is played by a script.
// usage: node audiotest.js <url> <out.webm> [secs] [lawn] [scenario]
//   scenario "mow"   – two mowers mow non-stop (combos), golden patch, gem, next lawn
//   scenario "zen:<scene>" – zen mode with that scene, one finger mowing now and then
// Convert + analyse: ffmpeg -i out.webm out.wav && python3 harmony.py out.wav 0,2,4,7,9
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const fs = require('fs');
(async () => {
  const [url, out, secs = '30', lawn = '1', scenario = 'mow'] = process.argv.slice(2);
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
  const ctx = await browser.newContext({ viewport: { width: 400, height: 860 }, deviceScaleFactor: 1, locale: 'de-DE' });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log('[' + m.type() + ']', m.text()); });
  await page.addInitScript((lv) => localStorage.setItem('zenmower.save.v1', JSON.stringify({ v: 2, level: +lv, cash: 0, gems: 5,
    tutorial: { move: true, fleet: true, lawn: true, regrow: true, zen: true },
    upg: { blade: 8, engine: 6, fert: 3, sprinkler: 12, fleet: 1, bots: 0 } })), lawn);
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => window.ZM && ZM.ready && ZM.debug, null, { timeout: 30000 });
  const b64 = await page.evaluate(async ([secs, scenario]) => {
    ZM.debug.paused = true;
    const A = ZM.audio; A.unlock();
    await new Promise((r) => setTimeout(r, 400));
    if (scenario.startsWith('zen:') && ZM.zen) { ZM.zen.enter(scenario.slice(4)); await new Promise((r) => setTimeout(r, 300)); }
    const tap = A.ctx.createMediaStreamDestination();
    (A.out || A.master).connect(tap);
    const rec = new MediaRecorder(tap.stream, { mimeType: 'audio/webm;codecs=opus', audioBitsPerSecond: 256000 });
    const chunks = [];
    rec.ondataavailable = (e) => chunks.push(e.data);
    rec.start();
    const g = ZM.game;
    let t = 0;
    const done = {};
    const steer = (m, id) => {
      if (m.pointer === null) m.pointer = id;
      if (!m._tt || t > m._tt) {
        const i = g.field.nearestTall(m.x + Math.sin(m.angle) * 3, m.y - Math.cos(m.angle) * 3, 0.5);
        if (i >= 0) { m.tx = (i % g.level.W) + 0.5; m.ty = ((i / g.level.W) | 0) + 0.5; m.hasTarget = true; }
        m._tt = t + 0.3;
      }
    };
    const iv = setInterval(() => {
      const zen = scenario.startsWith('zen:');
      const mowing = zen ? (t > 3 && t < secs * 0.45) || (t > secs * 0.6 && t < secs - 3) : t > 2 && t < secs - 4;
      g.mowers.forEach((m, k) => { if (mowing && k < 2) steer(m, 50 + k); else { m.pointer = null; m.hasTarget = false; } });
      if (!zen) {
        if (t > 8 && !done.gold) { done.gold = 1; g.spawnGoldenPatch(); if (g.patch) { g.mowers[0].tx = g.patch.x; g.mowers[0].ty = g.patch.y; g.mowers[0]._tt = t + 1.5; } }
        if (t > 14 && !done.gem) { done.gem = 1; const i = g.field.cells[(g.field.cells.length / 3) | 0]; g.collectGem(i); }
        if (t > secs * 0.7 && !done.lawn) { done.lawn = 1; ZM.save.cash = g.nextLawnCost; g.buyNextLawn(); }
      }
      ZM.debug.step(1, 1 / 60); t += 1 / 60;
    }, 1000 / 60);
    await new Promise((r) => setTimeout(r, secs * 1000));
    clearInterval(iv);
    rec.stop();
    await new Promise((r) => (rec.onstop = r));
    const blob = new Blob(chunks, { type: 'audio/webm' });
    const buf = new Uint8Array(await blob.arrayBuffer());
    let s = ''; for (let i = 0; i < buf.length; i += 8192) s += String.fromCharCode.apply(null, buf.subarray(i, i + 8192));
    return btoa(s);
  }, [+secs, scenario]);
  fs.writeFileSync(out, Buffer.from(b64, 'base64'));
  console.log('wrote', out, fs.statSync(out).size);
  await browser.close();
})();
