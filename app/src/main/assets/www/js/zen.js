'use strict';
// Zen mode: a separate, endless garden just for relaxing – no coins, no goals, no numbers.
// Pick a scene (meadow, rain, ocean, night, autumn wind, snow, temple garden), mix its
// sounds, let the mowers draw stripes by themselves, breathe along or set a sleep timer.
(function (ZM) {
  const $ = (id) => document.getElementById(id);
  const I = () => ZM.ICONS;
  const BREATH = [4, 1, 6]; // inhale, hold, exhale (seconds)
  const MIX_KEYS = ['grass', 'wind', 'water', 'life', 'music'];

  class Zen {
    constructor(game, ui) {
      this.game = game;
      this.ui = ui;
      this.save = game.save;
      this.on = false;
      this.sheet = null;
      this.timerEnd = 0;
      this.sleeping = false;
      this.breathT = 0;
      this.dockT = 0;
      this.titleT = 0;
      this.build();
    }

    build() {
      $('zenBack').innerHTML = I().back;
      document.querySelector('#sleepShade .sl-t').textContent = ZM.t('Good night');
      document.querySelector('#sleepShade .sl-s').textContent = ZM.t('tap_wake');
      const dock = $('zenDock');
      const items = [['scene', 'scene', 'Scene'], ['mix', 'sliders', 'Sounds'], ['auto', 'stripes', 'Autopilot'], ['breathe', 'breathe', 'Breathe'], ['timer', 'moon', 'Timer']];
      this.dockBtns = {};
      for (const [k, ico, lbl] of items) {
        const b = document.createElement('button');
        b.className = 'zd'; b.dataset.k = k;
        b.innerHTML = `<span class="zi">${I()[ico]}</span><span class="zl">${ZM.t(lbl)}</span>`;
        dock.appendChild(b);
        this.dockBtns[k] = b;
      }
      const tap = (el, fn) => el.addEventListener('click', (e) => { e.stopPropagation(); if (ZM.audio) { ZM.audio.unlock(); ZM.audio.click(); } this.wakeDock(); fn(); });
      tap($('zenBack'), () => this.exit());
      tap(this.dockBtns.scene, () => this.toggleSheet('scene'));
      tap(this.dockBtns.mix, () => this.toggleSheet('mix'));
      tap(this.dockBtns.timer, () => this.toggleSheet('timer'));
      tap(this.dockBtns.auto, () => this.setAuto(!this.save.zen.auto, true));
      tap(this.dockBtns.breathe, () => this.setBreathe(!this.save.zen.breathe));
      for (const id of ['zenDock', 'zenSheet', 'zenTop']) $(id).addEventListener('pointerdown', (e) => { e.stopPropagation(); this.wakeDock(); });
      // touching the lower part of the screen brings the dock back
      $('gl').addEventListener('pointerdown', (e) => { if (this.on && e.clientY > window.innerHeight - 170) this.wakeDock(); });
      $('sleepShade').addEventListener('pointerdown', (e) => { e.stopPropagation(); this.wake(); });
    }

    // ------------------------------------------------------------ enter / leave
    enter(sceneId) {
      if (this.on) return;
      if (ZM.onSaveNeeded) { this.game.saveFieldSnapshot(); ZM.onSaveNeeded(); }
      this.on = true;
      this.enteredAt = Date.now();
      if (this.ui.minimalView) this.ui.toggleMinimal();
      this.ui.closeModal && this.ui.modalOpen && this.ui.closeModal();
      this.fade(() => {
        document.body.classList.add('zen');
        if (ZM.onLayout) ZM.onLayout(); // full-screen play area before the garden is sized
        this.game.zenAuto = !!this.save.zen.auto;
        this.applyScene(sceneId || this.save.zen.scene, true);
        this.applyMix();
        this.setAuto(!!this.save.zen.auto, false);
        this.setBreathe(!!this.save.zen.breathe);
        this.wakeDock();
        if (ZM.onLayout) ZM.onLayout();
        if (ZM.audio) ZM.audio.zenChime();
        if (!this.save.tutorial.zenMode) { this.save.tutorial.zenMode = true; this.toast(ZM.t('zen_intro'), 6); }
      });
    }

    exit() {
      if (!this.on) return;
      this.closeSheet();
      this.setTimer(0);
      if (this.sleeping) this.wake();
      this.fade(() => {
        this.on = false;
        document.body.classList.remove('zen', 'breathe');
        this.game.zenAuto = false;
        this.game.startLevel(this.save.level, true);
        if (ZM.onLayout) ZM.onLayout();
        const secs = (Date.now() - this.enteredAt) / 1000;
        this.save.stats.zenTime = (this.save.stats.zenTime || 0) + secs;
        if (ZM.onZenExit) ZM.onZenExit(secs);
      });
    }

    fade(fn) {
      const f = $('fader');
      f.classList.add('on');
      setTimeout(() => { try { fn(); } finally { setTimeout(() => f.classList.remove('on'), 60); } }, 260);
    }

    applyScene(id, first) {
      const sc = ZM.zenScene(id);
      this.scene = sc;
      this.save.zen.scene = sc.id;
      this.game.startZen(sc);
      this.applyMix();
      $('zenName').textContent = ZM.t(sc.name);
      $('zenSub').textContent = ZM.t('zen_sub_' + sc.id);
      $('zenTitle').classList.remove('gone');
      this.titleT = 4.5;
      if (!first && ZM.audio) ZM.audio.zenChime();
      if (this.sheet === 'scene' || this.sheet === 'mix') this.openSheet(this.sheet);
      if (ZM.onSaveNeeded) ZM.onSaveNeeded();
    }

    // sliders are 0..1 with 0.75 = the scene's own balance
    applyMix() {
      if (!ZM.audio) return;
      const m = this.save.zen.mix, o = {};
      for (const k of MIX_KEYS) o[k] = (m[k] === undefined ? 0.75 : m[k]) / 0.75;
      ZM.audio.setMix(o);
    }

    setAuto(on, announce) {
      this.save.zen.auto = on;
      this.game.setZenAuto(on);
      this.dockBtns.auto.classList.toggle('on', on);
      this.dockBtns.auto.querySelector('.zl').textContent = ZM.t(on ? 'Watching' : 'Autopilot');
      if (announce) this.toast(ZM.t(on ? 'zen_auto_on' : 'zen_auto_off'), 3);
      if (ZM.onSaveNeeded) ZM.onSaveNeeded();
    }

    setBreathe(on) {
      this.save.zen.breathe = on;
      document.body.classList.toggle('breathe', on && this.on);
      this.dockBtns.breathe.classList.toggle('on', on);
      this.breathT = 0;
      this.breathPhase = -1;
      if (ZM.onSaveNeeded) ZM.onSaveNeeded();
    }

    setTimer(min) {
      this.timerEnd = min > 0 ? Date.now() + min * 60000 : 0;
      this.timerMin = min;
      this.fading = false;
      if (ZM.audio && !this.sleeping) ZM.audio.fadeTo(1, 1.5);
      this.dockBtns.timer.classList.toggle('on', min > 0);
      this.updateTimerLabel(true);
    }

    updateTimerLabel(force) {
      const lbl = this.dockBtns.timer.querySelector('.zl');
      const txt = this.timerEnd ? Math.max(1, Math.ceil((this.timerEnd - Date.now()) / 60000)) + ' min' : ZM.t('Timer');
      if (force || lbl.textContent !== txt) lbl.textContent = txt;
    }

    // ------------------------------------------------------------ sheets
    toggleSheet(name) { if (this.sheet === name) this.closeSheet(); else this.openSheet(name); }
    closeSheet() {
      this.sheet = null;
      $('zenSheet').classList.add('hidden');
      $('zenSheet').innerHTML = '';
      for (const k of ['scene', 'mix', 'timer']) this.dockBtns[k].classList.remove('sel');
    }

    openSheet(name) {
      const el = $('zenSheet');
      this.sheet = name;
      for (const k of ['scene', 'mix', 'timer']) this.dockBtns[k].classList.toggle('sel', k === name);
      el.classList.remove('hidden');
      el.style.animation = 'none'; void el.offsetWidth; el.style.animation = '';
      if (name === 'scene') this.sceneSheet(el);
      else if (name === 'mix') this.mixSheet(el);
      else this.timerSheet(el);
    }

    sceneSheet(el) {
      el.innerHTML = `<div class="zs-title">${ZM.t('Scene')}</div><div class="scene-list"></div>`;
      const list = el.querySelector('.scene-list');
      for (const sc of ZM.ZEN_SCENES) {
        const b = sc.biome, c = (x) => ZM.css(x);
        const d = document.createElement('button');
        d.className = 'scene' + (this.scene && this.scene.id === sc.id ? ' on' : '');
        d.innerHTML = `<div class="pv" style="background: radial-gradient(circle at 35% 30%, ${c(b.blades[0])}, ${c(b.blades[3])} 52%, ${c(b.bg[0])} 100%);">${this.sceneGlyph(sc)}</div><div class="nm">${ZM.t(sc.name)}</div>`;
        d.onclick = (e) => { e.stopPropagation(); if (ZM.audio) ZM.audio.click(); if (this.scene.id !== sc.id) this.fade(() => this.applyScene(sc.id)); };
        list.appendChild(d);
      }
      const on = list.querySelector('.on');
      if (on) on.scrollIntoView({ inline: 'center', block: 'nearest' });
    }

    sceneGlyph(sc) {
      const ico = { meadow: 'fly', rain: 'drop', ocean: 'wave', night: 'moon', autumn: 'leaf', snow: 'flake', temple: 'lotus' }[sc.id];
      return ico ? `<i>${I()[ico]}</i>` : '';
    }

    mixSheet(el) {
      const S = this.scene.sound, m = this.save.zen.mix;
      const has = {
        grass: true, wind: S.wind > 0, music: true,
        water: (S.rain || 0) + (S.waves || 0) + (S.brook || 0) > 0,
        life: (S.birds || 0) + (S.crickets || 0) + (S.owl || 0) + (S.gulls || 0) + (S.leaves || 0) + (S.chimes || 0) > 0,
      };
      const waterName = S.rain ? 'Rain' : S.waves ? 'Sea' : 'Brook';
      const names = { grass: 'Mowing', wind: 'Wind', water: waterName, life: 'Nature', music: 'Music' };
      let html = `<div class="zs-title">${ZM.t('Sounds')}</div>`;
      for (const k of MIX_KEYS) {
        if (!has[k]) continue;
        const v = m[k] === undefined ? 0.75 : m[k];
        html += `<div class="mix-row"><span>${ZM.t(names[k])}</span><input type="range" min="0" max="1" step="0.01" value="${v}" data-k="${k}"></div>`;
      }
      html += '<div id="zsExtra"></div>';
      el.innerHTML = html;
      el.querySelectorAll('input[type=range]').forEach((r) => {
        r.addEventListener('input', () => { m[r.dataset.k] = parseFloat(r.value); this.applyMix(); });
        r.addEventListener('change', () => ZM.onSaveNeeded && ZM.onSaveNeeded());
      });
      this.adFreeButton(el.querySelector('#zsExtra'));
    }

    // Rewarded ad → 30 minutes without the banner (the most "zen" reward there is).
    adFreeButton(box) {
      if (!ZM.Native.isNative || !ZM.adFree) return;
      if (ZM.adFree.active()) {
        box.innerHTML = `<div class="zs-note">${ZM.t('adfree_left', { t: ZM.fmtTime(ZM.adFree.left()) })}</div>`;
        return;
      }
      const b = this.ui.rewardedButton(ZM.t('adfree_btn', { m: 30 }), 'adfree_30', () => {
        ZM.adFree.grant(30 * 60);
        this.toast(ZM.t('adfree_on'), 3);
        if (this.sheet === 'mix') this.openSheet('mix');
      });
      b.classList.add('small');
      box.appendChild(b);
    }

    timerSheet(el) {
      el.innerHTML = `<div class="zs-title">${ZM.t('Sleep timer')}</div><div class="zs-sub">${ZM.t('timer_sub')}</div><div class="seg wide"></div>`;
      const seg = el.querySelector('.seg');
      for (const min of [0, 15, 30, 60, 90]) {
        const b = document.createElement('button');
        b.textContent = min ? min + ' min' : ZM.t('Off');
        b.classList.toggle('on', (this.timerEnd ? this.timerMin : 0) === min);
        b.onclick = (e) => { e.stopPropagation(); if (ZM.audio) ZM.audio.click(); this.setTimer(min); this.openSheet('timer'); };
        seg.appendChild(b);
      }
    }

    toast(html, sec) { this.ui.toast(html, sec); }

    wakeDock() { this.dockT = 6; $('zenDock').classList.remove('dim'); $('zenTop').classList.remove('dim'); }

    // ------------------------------------------------------------ per frame
    update(dt) {
      if (!this.on) return;
      if (this.titleT > 0) { this.titleT -= dt; if (this.titleT <= 0) $('zenTitle').classList.add('gone'); }
      if (this.dockT > 0 && !this.sheet) {
        this.dockT -= dt;
        if (this.dockT <= 0) { $('zenDock').classList.add('dim'); $('zenTop').classList.add('dim'); }
      }
      if (this.save.zen.breathe) this.updateBreath(dt);
      if (this.timerEnd) {
        const left = (this.timerEnd - Date.now()) / 1000;
        this.updateTimerLabel(false);
        if (left < 30 && !this.fading) { this.fading = true; if (ZM.audio) ZM.audio.fadeTo(0, Math.max(1, left)); }
        if (left <= 0) this.sleep();
      }
    }

    updateBreath(dt) {
      const cyc = BREATH[0] + BREATH[1] + BREATH[2];
      this.breathT += dt;
      if (this.breathPhase < 0 || this.breathT >= cyc) {
        this.breathT = this.breathPhase < 0 ? 0 : this.breathT - cyc;
        const ring = document.querySelector('#breath .ring');
        ring.classList.remove('cycle'); void ring.offsetWidth; ring.classList.add('cycle');
        if (ZM.audio) ZM.audio.breathCycle(BREATH[0], BREATH[1], BREATH[2]);
        this.breathPhase = 0;
      }
      const ph = this.breathT < BREATH[0] ? 0 : this.breathT < BREATH[0] + BREATH[1] ? 1 : 2;
      if (ph !== this.breathPhase || !this.breathTxt) {
        this.breathPhase = ph;
        this.breathTxt = ZM.t(['Breathe in', 'Hold', 'Breathe out'][ph]);
        $('breathTxt').textContent = this.breathTxt;
      }
    }

    // sleep timer finished: silence, dark screen, let the phone go to sleep
    sleep() {
      this.timerEnd = 0;
      this.sleeping = true;
      this.closeSheet();
      this.updateTimerLabel(true);
      this.dockBtns.timer.classList.remove('on');
      const sh = $('sleepShade');
      sh.classList.remove('hidden');
      requestAnimationFrame(() => sh.classList.add('on'));
      if (ZM.audio) ZM.audio.sleep(true);
      ZM.Native.setKeepAwake(false);
    }

    wake() {
      if (!this.sleeping) return;
      this.sleeping = false;
      const sh = $('sleepShade');
      sh.classList.remove('on');
      setTimeout(() => sh.classList.add('hidden'), 400);
      if (ZM.audio) { ZM.audio.sleep(false); ZM.audio.fadeTo(1, 2); }
      ZM.Native.setKeepAwake(true);
      this.wakeDock();
    }

    onBack() {
      if (!this.on) return false;
      if (this.sleeping) { this.wake(); return true; }
      if (this.sheet) { this.closeSheet(); return true; }
      this.exit();
      return true;
    }
  }
  ZM.Zen = Zen;
})(window.ZM);
