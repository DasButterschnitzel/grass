const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const fs = require('fs');
(async () => {
  const [url, out, secs = '10', level = '1'] = process.argv.slice(2);
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
  const ctx = await browser.newContext({ viewport: { width: 400, height: 860 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  page.on('console', (m) => { if (m.type() === 'error') console.log('[err]', m.text()); });
  await page.addInitScript((lv) => localStorage.setItem('zenmower.save.v1', JSON.stringify({ level: +lv, tutorial: { move: true, fleet: true }, upg: { blade: 3, sharp: 3, engine: 3 } })), level);
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => window.ZM && ZM.ready && ZM.debug, null, { timeout: 30000 });
  const b64 = await page.evaluate(async (secs) => {
    ZM.debug.paused = true;
    const A = ZM.audio; A.unlock();
    await new Promise((r) => setTimeout(r, 300));
    const tap = A.ctx.createMediaStreamDestination();
    A.master.connect(tap);
    const rec = new MediaRecorder(tap.stream, { mimeType: 'audio/webm;codecs=opus', audioBitsPerSecond: 256000 });
    const chunks = [];
    rec.ondataavailable = (e) => chunks.push(e.data);
    rec.start();
    const g = ZM.game; const m = g.mowers[0];
    m.pointer = 99;
    let t = 0, phase = 0;
    const iv = setInterval(() => {
      // 0-2s idle (ambience/music), then mow lanes, last 1.5s idle again
      if (t > 2 && t < secs - 1.5) {
        if (!m._tt || t > m._tt) { const i = g.field.nearestUncut(m.x, m.y); if (i >= 0) { m.tx = (i % g.level.W) + 0.5; m.ty = ((i / g.level.W) | 0) + 0.5; m.hasTarget = true; } m._tt = t + 0.25; }
      } else m.hasTarget = false;
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
  }, +secs);
  fs.writeFileSync(out, Buffer.from(b64, 'base64'));
  console.log('wrote', out, fs.statSync(out).size);
  await browser.close();
})();
