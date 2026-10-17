# Zen Mower – relaxing ASMR grass cutting (Android)

A calm, endlessly satisfying lawn-mowing game for Android – inspired by “+1 Cut Grass ASMR”, rebuilt from scratch with bolder visuals, synthesized ASMR audio in perfect harmony, a separate zen mode with nature soundscapes, multi-touch fleets, unlimited procedural levels and AdMob monetization.

<p align="center">
  <img src="store/screenshots/1_mow.png" width="160">
  <img src="store/screenshots/2_lavender.png" width="160">
  <img src="store/screenshots/7_zen_temple.png" width="160">
  <img src="store/screenshots/8_zen_night.png" width="160">
</p>

## What's in the game

| | |
|---|---|
| **Grass** | Every blade is GPU-instanced (up to ~17 000 per field) with wind gusts, drifting cloud shadows, blades that bend away from the mower and real lawn stripes in the direction you mowed. Like the original, the lawn **grows back** continuously – you can watch every blade get taller again. |
| **ASMR audio** | 100 % synthesized at runtime (no audio files): granular crunch/snip/rustle grains whose density follows the actual cut rate, a soft blade swish, live-generated ambient pads, nature ambience per garden, convolution reverb, glue compressor + limiter. |
| **Harmony** | Every garden has one key and **every pitched sound uses only its pentatonic scale** – pads, the kalimba melody you "play" while mowing (quantised to the beat), bells, wind chimes, the singing bowl and even the tuned birds, crickets, owl and gulls. A pentatonic scale has no semitones and no tritone, so nothing can clash. Key changes fade out every note of the old key. Verified with `tools/qa/harmony.py` (tonal energy outside the key: 27 % → 0.4 %). |
| **Multi-touch** | Up to 4 mowers – each finger steers its own mower. Autopilot drives the ones you're not steering. |
| **Endless lawns** | As in the original you **buy the next lawn** – its price is always visible next to the progress bar at the top and on the first card of the upgrade bar. Each lawn pays ×6 per blade and has its own biome and shape: 14 shapes (heart, star, clover, ring island …) with ponds, stepping stones, flower beds and rocks; 10 biomes, then endless hue-shifted cycles. Thicker multi-layer grass on later lawns. |
| **Progression** | The original's four upgrades – **Blade** (cut size), **Engine** (speed), **Fertilizer** (×(1+level) coins per blade), **Sprinkler** (regrowth speed) – plus **Fleet** (multi-touch mowers) and **Autopilot**. Golden patches (×12 + bonus), hidden gems, lucky clovers → frenzy, combos, offline earnings, 8 mower skins bought with gems. Lawn prices were tuned with an automated bot: ~1 min for the first lawn, then a steady few minutes per lawn, forever. |
| **Zen mode** | A separate, endless garden just for relaxing – no coins, no goals. 7 scenes with their own soundscapes: Summer Meadow (breeze, birds, brook), Gentle Rain (rain, distant thunder, visible rain & splashes), Ocean Breeze (waves, gulls), Starry Night (crickets, owl, fireflies), Autumn Wind (gusts, rustling leaves, singing wind tones), Snowy Silence (wind chimes) and Temple Garden (singing bowls, brook, pond with stepping stones). Sound mixer (mowing / wind / water / nature / music), every finger is a mower, autopilot "watch" mode that mows perfect stripes, breathing guide (4-1-6) and a sleep timer that fades out and lets the screen turn off. |
| **Minimal view** | The eye button hides every number and button in the normal game. |
| **Monetization** | AdMob adaptive banner, interstitial only when you move to a new lawn (max every 3 min, never in the first 2 minutes or right after a rewarded ad), rewarded ads (×2 offline earnings, 3-min ×2 cash boost, +5 gems, **30 minutes without ads** in zen mode). Google UMP consent (GDPR/EEA) + “Privacy & ad choices” in settings. |
| **Polish** | English + German (auto by device language), haptics, adaptive resolution, save/resume mid-level, back-button handling, edge-to-edge/immersive with notch support. |

## Architecture

```
app/src/main/java/…/zenmower/   Kotlin shell: WebView host, JS bridge, AdMob + UMP, haptics, immersive mode
app/src/main/assets/www/        The game: WebGL2 (GL1 fallback) renderer + WebAudio engine, plain JS, no build step
  js/levelgen.js                procedural fields (SDF shapes, distance-encoded terrain)
  js/shaders.js / render.js     grass blades, terrain, sprites, particles, text
  js/game.js                    simulation (mowers, multitouch, cutting, combos, autopilot, level flow)
  js/audio.js                   ASMR synthesis (grass, instruments, event sounds, master chain)
  js/music.js                   one key per garden: pentatonic harmony, pads, mowing melody
  js/soundscape.js              wind, rain, waves, brook, birds, crickets, owl, chimes, bowl
  js/zen.js                     zen mode (scenes, mixer, autopilot stripes, breathing, sleep timer)
  js/economy.js                 every balancing number lives here
  js/ui.js / css/style.css      HUD, dialogs, shop, settings
store/                          Play Store icon, feature graphic, screenshots, listing texts (EN/DE), data-safety answers
docs/privacy-policy.html        privacy policy to host (e.g. GitHub Pages)
dist/                           prebuilt release APK + AAB (signed with the upload key, Google TEST ad ids)
tools/qa/                       headless-browser QA: pacing bot, screenshots, multitouch & audio checks
```

The game runs fully offline from the APK's assets (served via `WebViewAssetLoader`); only ads use the network.

### Play it in a desktop browser (dev)

```bash
cd app/src/main/assets/www && python3 -m http.server 8765
# open http://localhost:8765 (use devtools device mode for touch). Ads are simulated.
```

## Build

Requirements: JDK 17+ and the Android SDK (platform 36). Toolchain: Gradle 8.14.3 (wrapper), AGP 8.13.2, Kotlin 2.3.21, play-services-ads 25.5.0, UMP 4.0.0, androidx.webkit 1.17.1; minSdk 24, target/compile SDK 36. Then:

```bash
./gradlew assembleRelease bundleRelease   # → app/build/outputs/{apk,bundle}/release/
```

### 1. Your AdMob IDs (required to earn money)

The project – including the prebuilt `dist/` files – uses **Google's official test IDs**, so it is safe to install and test but **earns nothing**. Before publishing, create an app + 3 ad units (Banner/adaptive, Interstitial, Rewarded) in [AdMob](https://admob.google.com) and copy `admob.properties.example` → `admob.properties`:

```properties
ADMOB_APP_ID=ca-app-pub-XXXXXXXXXXXXXXXX~YYYYYYYYYY
ADMOB_BANNER_ID=ca-app-pub-XXXXXXXXXXXXXXXX/1111111111
ADMOB_INTERSTITIAL_ID=ca-app-pub-XXXXXXXXXXXXXXXX/2222222222
ADMOB_REWARDED_ID=ca-app-pub-XXXXXXXXXXXXXXXX/3333333333
```

(or pass them as `-PADMOB_APP_ID=…` / environment variables). A release build with test IDs prints a warning.
Also in AdMob: **Privacy & messaging → GDPR message** (publish it, otherwise EEA users get no consent form), and add `app-ads.txt` to your developer website.

### 2. Signing

Copy `keystore.properties.example` → `keystore.properties` and point it at your upload keystore (never commit it):

```properties
storeFile=/absolute/path/zenmower-upload.jks
storePassword=…
keyAlias=zenmower
keyPassword=…
```

Without it, release builds fall back to the debug key (fine for testing, not for Play).

### 3. CI

`.github/workflows/android.yml` builds APK + AAB on every push. Add repository secrets `ZEN_KEYSTORE_BASE64`, `ZEN_KEYSTORE_PASSWORD`, `ZEN_KEY_ALIAS`, `ZEN_KEY_PASSWORD` (+ optional `ADMOB_*`) to get signed artifacts.

## Release checklist

1. Put your real AdMob IDs in `admob.properties`; publish the GDPR message in AdMob.
2. Change `applicationId` in `app/build.gradle.kts` if you want a different package name (it can never change after the first upload).
3. Host `docs/privacy-policy.html` (fill in your name + contact email) and add the URL in Play Console.
4. `./gradlew bundleRelease` → upload `app-release.aab` (Play App Signing).
5. Store listing: texts in `store/listing.md`, data-safety answers in `store/data-safety.md`, graphics in `store/`.
6. Bump `versionCode`/`versionName` for every update.

## Tuning

All balancing lives in `app/src/main/assets/www/js/economy.js` (upgrade costs/effects, lawn value and price curve, grass thickness) and the ad cadence in `js/main.js` (`ZM.onLevelAdvance`). `tools/qa/pace.js` replays the economy with a bot so you can see minutes-per-lawn before changing numbers.

## Credits

Fonts: [Lilita One](https://fonts.google.com/specimen/Lilita+One) and [Varela Round](https://fonts.google.com/specimen/Varela+Round) – SIL Open Font License (`assets/www/fonts/OFL-*.txt`). All graphics and sounds are generated procedurally by the game's code.
