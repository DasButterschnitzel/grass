# QA scripts (headless Chromium + Playwright)

Serve the game first: `cd app/src/main/assets/www && python3 -m http.server 8765`
Run with `PLAYWRIGHT=/path/to/node_modules/playwright node tools/qa/<script>.js http://localhost:8765/index.html <outdir> …`
(WebGL in headless Chromium: the scripts launch with `--use-angle=swiftshader`.)

| Script | Purpose |
| --- | --- |
| `pace.js <url> [lawns] [skill] [useAuto] [econ-json]` | Bot plays N lawns with the real game code: a "finger" steers the lead mower (the fleet follows in formation), the autopilot is used whenever it is charged, it buys the cheapest available upgrade or saves for the next lawn. Prints seconds per lawn, rounds and autopilot share – the reference for tuning `economy.js`. `econ-json` overrides the lawn price curve, e.g. `'{"a":0.85,"b":2.2,"c":3.3,"c0":5300}'`. |
| `sim.py [lawns] [boost] [json]` / `sim.py design <lawns>` | Fast numpy model of the same economy (for exploring parameters before confirming them with `pace.js`). |
| `lawn.js <url> <out> [lawn] [locale]` | Regrowth, golden patch, "next lawn" dialog, lawn change and zen view screenshots. |
| `gallery.js <url> <out> 2,6,9` | Screenshots of several lawns/biomes. |
| `multitouch.js <url> <out>` | Two simultaneous CDP touch points → verifies each finger steers its own mower. |
| `storeshots.js <url> <out>` | Regenerates the 1080×2160 Play Store screenshots. |
| `audiotest.js <url> out.webm [secs] [lawn] [mow\|pure\|zen:<scene>]` + `analyze.py in.wav spec.png` | Records the live audio mix while mowing (`mow`: golden patch, gem, autopilot, next lawn; `pure`: just mowing) or in a zen scene and reports loudness / spectral balance. `UPG` / `SETTINGS` env vars (JSON) override upgrades and settings, e.g. `SETTINGS='{"melody":"full"}'`. |
| `noisecheck.py in.wav [t0] [t1]` | Comfort of the noisy layers (grass, wind, rain …): loudness swings, spectral balance and sharpness (acum), flutter/rattle beyond steady noise, clicks per second and audible loops. Record isolated layers with `SETTINGS='{"music":0,"amb":0}'` (grass) or `'{"sfx":0,"music":0}'` (nature). |
| `klongel.py in.wav [t0] [t1]` | Pitched attacks per second (plucks, bells, chimes) – the "is it tinkling all the time?" check. Pads, beating, noise and steady tones are ignored. |
| `harmony.py in.wav [0,2,4,7,9]` | Finds the stable tones in a recording and reports energy outside the key, semitone/tritone intervals, roughness and tuning – the "is anything dissonant?" check. |

All scripts drive the game through the `ZM.debug` hooks (`paused`, `step(n, dt)`, `draw()`) so results don't depend on the software renderer's frame rate.
