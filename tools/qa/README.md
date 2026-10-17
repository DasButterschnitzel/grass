# QA scripts (headless Chromium + Playwright)

Serve the game first: `cd app/src/main/assets/www && python3 -m http.server 8765`
Run with `PLAYWRIGHT=/path/to/node_modules/playwright node tools/qa/<script>.js http://localhost:8765/index.html <outdir> …`
(WebGL in headless Chromium: the scripts launch with `--use-angle=swiftshader`.)

| Script | Purpose |
| --- | --- |
| `pace.js <url> [lawns] [skill] [econ-json]` | Bot plays N lawns (autopilot steering, buys cheapest upgrade or saves for the next lawn) and prints seconds per lawn – used to tune `economy.js`. `econ-json` overrides the lawn price curve, e.g. `'{"a":1,"b":2,"c":4,"c0":6000}'`. |
| `lawn.js <url> <out> [lawn] [locale]` | Regrowth, golden patch, "next lawn" dialog, lawn change and zen view screenshots. |
| `gallery.js <url> <out> 2,6,9` | Screenshots of several lawns/biomes. |
| `multitouch.js <url> <out>` | Two simultaneous CDP touch points → verifies each finger steers its own mower. |
| `storeshots.js <url> <out>` | Regenerates the 1080×2160 Play Store screenshots. |
| `audiotest.js <url> out.webm [secs] [level]` + `analyze.py in.wav spec.png` | Records the live audio mix while mowing and reports loudness / spectral balance. |

All scripts drive the game through the `ZM.debug` hooks (`paused`, `step(n, dt)`, `draw()`) so results don't depend on the software renderer's frame rate.
