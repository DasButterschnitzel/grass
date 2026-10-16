'use strict';
// DOM HUD: wallet, level progress, upgrades, dialogs, toasts, tutorial.
(function (ZM) {
  const $ = (id) => document.getElementById(id);
  const I = () => ZM.ICONS;

  class UI {
    constructor(game) {
      this.game = game;
      this.save = game.save;
      this.dispCash = this.save.cash;
      this.cache = {};
      this.modalOpen = null;
      this.toastT = 0;
      this.adsReady = ZM.Native.isRewardedReady();
      this.build();
      ZM.Native.on('ads', (rew) => { this.adsReady = rew; });
    }

    build() {
      $('btnSettings').innerHTML = I().gear;
      document.querySelector('#cash i').innerHTML = I().coin;
      document.querySelector('#gems i').innerHTML = I().gem;
      document.querySelector('#btnBoost .act-ico').innerHTML = I().play;
      document.querySelector('#btnZen .act-ico').innerHTML = I().leaf;
      document.querySelector('#btnShop .act-ico').innerHTML = I().shop;
      $('tutHand').innerHTML = I().hand;
      document.querySelector('#btnZen .act-lbl').textContent = ZM.t('Zen');
      document.querySelector('#btnShop .act-lbl').textContent = ZM.t('Shop');
      const tap = (el, fn) => el.addEventListener('click', (e) => { e.stopPropagation(); if (ZM.audio) { ZM.audio.unlock(); ZM.audio.click(); } fn(); });
      tap($('btnSettings'), () => this.openSettings());
      tap($('btnShop'), () => this.openShop());
      tap($('btnZen'), () => this.toggleZen());
      tap($('btnBoost'), () => this.boost());

      const wrap = $('upgrades');
      this.cards = {};
      for (const u of ZM.UPGRADES) {
        const c = document.createElement('div');
        c.className = 'card';
        c.innerHTML = `<span class="ico">${I()[u.id]}</span><div class="nm">${ZM.t(u.name)}</div><div class="lv"></div><div class="cost"><i>${I().coin}</i><span></span></div>`;
        wrap.appendChild(c);
        this.cards[u.id] = { el: c, lv: c.querySelector('.lv'), cost: c.querySelector('.cost span'), costBox: c.querySelector('.cost') };
        this.bindHold(c, u.id);
      }
      // keep upgrade bar from moving mowers
      wrap.addEventListener('pointerdown', (e) => e.stopPropagation());
    }

    bindHold(el, id) {
      let down = false, moved = false, sx = 0, sy = 0, timer = null, repeats = 0;
      const stop = () => { down = false; clearTimeout(timer); timer = null; };
      const repeat = () => {
        if (!down || moved) return;
        if (!this.buy(id, true)) { stop(); return; }
        repeats++;
        timer = setTimeout(repeat, Math.max(55, 140 - repeats * 8));
      };
      el.addEventListener('pointerdown', (e) => {
        down = true; moved = false; sx = e.clientX; sy = e.clientY; repeats = 0;
        if (ZM.audio) ZM.audio.unlock();
        timer = setTimeout(() => { timer = null; repeats = 1; if (this.buy(id, true)) timer = setTimeout(repeat, 160); }, 420);
      });
      el.addEventListener('pointermove', (e) => { if (down && Math.hypot(e.clientX - sx, e.clientY - sy) > 10) { moved = true; stop(); } });
      el.addEventListener('pointerup', () => {
        if (down && !moved && repeats === 0) { clearTimeout(timer); this.buy(id, false); }
        stop();
      });
      el.addEventListener('pointercancel', stop);
      el.addEventListener('pointerleave', stop);
    }

    buy(id, silentFail) {
      const s = this.save, u = ZM.UPG[id], lvl = s.upg[id] || 0;
      const card = this.cards[id].el;
      if (lvl >= u.max) return false;
      const cost = ZM.upgradeCost(id, lvl);
      if (s.cash < cost) {
        if (!silentFail) { card.classList.remove('shake'); void card.offsetWidth; card.classList.add('shake'); if (ZM.audio) ZM.audio.error(); }
        return false;
      }
      s.cash -= cost;
      s.upg[id] = lvl + 1;
      this.game.recalc();
      card.classList.remove('bought'); void card.offsetWidth; card.classList.add('bought');
      if (ZM.audio) ZM.audio.upgrade(lvl);
      ZM.Native.haptic('light');
      if (id === 'fleet') {
        if (!s.tutorial.fleet) { s.tutorial.fleet = true; this.showTutorial('two'); }
        this.toast(ZM.t('new_mower'));
      }
      if (id === 'bots' && lvl === 0) this.toast(ZM.t('autopilot_on'));
      if (ZM.onSaveNeeded) ZM.onSaveNeeded();
      return true;
    }

    // ------------------------------------------------------------ per-frame update
    update(dt) {
      const g = this.game, s = this.save, c = this.cache;
      // events from the simulation
      while (g.events.length) this.onEvent(g.events.shift());

      // smooth money counter
      const diff = s.cash - this.dispCash;
      this.dispCash = Math.abs(diff) < 0.5 || Math.abs(diff) / Math.max(1, s.cash) < 0.002 ? s.cash : this.dispCash + diff * Math.min(1, dt * 9);
      const cashStr = ZM.fmt(Math.max(0, this.dispCash));
      if (c.cash !== cashStr) { $('cashText').textContent = cashStr; c.cash = cashStr; }
      if (c.gems !== s.gems) { $('gemText').textContent = s.gems; c.gems = s.gems; }

      if (g.level) {
        const lvStr = g.zen ? ZM.t('Zen Mode') : ZM.t('Level') + ' ' + g.level.N;
        if (c.lv !== lvStr) { $('levelNum').textContent = lvStr; c.lv = lvStr; }
        if (c.biome !== g.biome.name) { $('biomeName').textContent = ZM.biomeName(g.biome); c.biome = g.biome.name; }
        const p = g.zen ? 1 : g.field.progress;
        const pct = Math.floor(p * 100);
        if (c.pct !== pct) {
          $('progressFill').style.width = (g.zen ? 100 : pct) + '%';
          $('progressText').textContent = g.zen ? '∞' : pct + '%';
          c.pct = pct;
        }
      }

      // chips
      const combo = g.combo;
      const showCombo = combo.level > 0;
      if (c.combo !== showCombo) { $('comboChip').classList.toggle('hidden', !showCombo); c.combo = showCombo; }
      if (showCombo) {
        const txt = ZM.t('COMBO') + ' ×' + (1 + 0.1 * Math.min(15, combo.level)).toFixed(1);
        if (c.comboTxt !== txt) { $('comboText').textContent = txt; c.comboTxt = txt; }
        $('comboBar').style.transform = `scaleX(${ZM.clamp(combo.timer / 0.9, 0, 1)})`;
      }
      const fr = g.frenzyT > 0;
      if (c.fr !== fr) { $('frenzyChip').classList.toggle('hidden', !fr); c.fr = fr; }
      if (fr) {
        const t = ZM.t('LUCKY FRENZY') + ' ' + Math.ceil(g.frenzyT) + 's';
        if (c.frT !== t) { $('frenzyText').textContent = t; c.frT = t; }
      }
      // boost button
      const bt = s.boostT > 0 ? '×2 ' + ZM.fmtTime(s.boostT) : ZM.t('×2 Cash');
      if (c.boost !== bt) { $('boostLbl').textContent = bt; c.boost = bt; }
      const canAd = this.adsReady && s.boostT < ZM.BOOST_MAX - ZM.BOOST_SECONDS;
      if (c.canAd !== canAd) { $('btnBoost').classList.toggle('ready', canAd && s.boostT <= 0); $('btnBoost').classList.toggle('disabled', !canAd && s.boostT <= 0); c.canAd = canAd; }
      if (c.zen !== g.zen) { $('btnZen').classList.toggle('active', g.zen); document.getElementById('hud').classList.toggle('zen', g.zen); c.zen = g.zen; }

      // upgrade cards (only touch the DOM when something changes)
      for (const u of ZM.UPGRADES) {
        const lvl = s.upg[u.id] || 0;
        const max = lvl >= u.max;
        const cost = max ? 0 : ZM.upgradeCost(u.id, lvl);
        const poor = !max && s.cash < cost;
        const key = lvl + '|' + poor + '|' + max;
        const cd = this.cards[u.id];
        if (cd.key === key) continue;
        cd.key = key;
        cd.el.classList.toggle('poor', poor);
        cd.el.classList.toggle('max', max);
        cd.lv.textContent = max ? 'Lv ' + lvl + ' · MAX' : 'Lv ' + lvl + ' · ' + ZM.upgradeEffect(u.id, lvl);
        cd.cost.textContent = max ? 'MAX' : ZM.fmt(cost);
        cd.costBox.querySelector('i').style.display = max ? 'none' : '';
      }

      // tutorial
      if (!s.tutorial.move && g.sessionCuts > 40) { s.tutorial.move = true; this.hideTutorial(); }
      if (this.tutTimer > 0) { this.tutTimer -= dt; if (this.tutTimer <= 0) this.hideTutorial(); }
      if (this.toastT > 0) { this.toastT -= dt; if (this.toastT <= 0) $('toast').classList.add('hidden'); }
    }

    onEvent(ev) {
      const g = this.game;
      switch (ev.type) {
        case 'level': {
          if (ev.data.restore) break;
          const N = ev.data.N;
          if (N > 1 && (N - 1) % ZM.LEVELS_PER_BIOME === 0) this.banner(ZM.t('NEW GARDEN!'), ZM.biomeName(ev.data.biome));
          else this.banner(ZM.t('LEVEL') + ' ' + N, ZM.biomeName(ev.data.biome));
          break;
        }
        case 'cleared': this.openCleared(ev.data); break;
        case 'gem': break;
        case 'flyerArrived': { const el = $('gems'); el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump'); break; }
        case 'combo': { const el = $('comboChip'); el.classList.remove('pulse'); void el.offsetWidth; el.classList.add('pulse'); break; }
        case 'frenzy': this.toast(ZM.t('clover_toast'), 2.5); break;
        case 'zen': if (ev.data) this.toast(ZM.t('zen_toast'), 3.5); break;
      }
      if (g && ev.type === 'cleared') this.cache = {};
    }

    // ------------------------------------------------------------ layout
    playRect() {
      const top = $('actions').getBoundingClientRect().bottom + 6;
      const cards = $('upgrades').getBoundingClientRect();
      const bottom = cards.top + 10;
      const cs = getComputedStyle(document.documentElement);
      const sal = parseFloat(cs.getPropertyValue('--sal')) || 0, sar = parseFloat(cs.getPropertyValue('--sar')) || 0;
      const w = window.innerWidth;
      return { x: sal + 4, y: top, w: w - sal - sar - 8, h: Math.max(100, bottom - top) };
    }

    targetPos(name) {
      const el = name === 'gem' ? document.querySelector('#gems i') : document.querySelector('#cash i');
      const r = el.getBoundingClientRect();
      return [r.left + r.width / 2, r.top + r.height / 2];
    }

    // ------------------------------------------------------------ feedback
    toast(html, sec) {
      const t = $('toast');
      t.innerHTML = html;
      t.classList.remove('hidden');
      t.style.animation = 'none'; void t.offsetWidth; t.style.animation = '';
      this.toastT = sec || 3.2;
    }

    banner(title, sub) {
      const b = $('banner');
      $('bannerTitle').textContent = title;
      $('bannerSub').textContent = sub || '';
      b.classList.remove('hidden');
      b.style.animation = 'none'; void b.offsetWidth; b.style.animation = '';
      clearTimeout(this.bannerTimer);
      this.bannerTimer = setTimeout(() => b.classList.add('hidden'), 2700);
    }

    showTutorial(kind) {
      const t = $('tutorial');
      t.classList.remove('hidden');
      t.classList.toggle('two', kind === 'two');
      $('tutText').textContent = ZM.t(kind === 'two' ? 'Two fingers = two mowers!' : 'Drag to mow');
      this.tutTimer = kind === 'two' ? 4.5 : 0;
    }
    hideTutorial() { $('tutorial').classList.add('hidden'); this.tutTimer = 0; }

    // ------------------------------------------------------------ modals
    openModal(html, opts) {
      const m = $('modal'), card = $('modalCard');
      card.innerHTML = html;
      m.classList.remove('hidden');
      this.modalOpen = opts || {};
      if (this.modalOpen.closable !== false) {
        const x = document.createElement('button');
        x.className = 'm-close'; x.innerHTML = I().close;
        x.onclick = () => { if (ZM.audio) ZM.audio.click(); this.closeModal(); };
        card.appendChild(x);
        m.onclick = (e) => { if (e.target === m) this.closeModal(); };
      } else m.onclick = null;
      return card;
    }
    closeModal() {
      const opts = this.modalOpen;
      $('modal').classList.add('hidden');
      $('modalCard').innerHTML = '';
      this.modalOpen = null;
      clearTimeout(this.autoTimer);
      if (opts && opts.onClose) opts.onClose();
    }
    onBack() {
      if (!this.modalOpen) return false;
      if (this.modalOpen.closable !== false) this.closeModal();
      return true;
    }

    rewardedButton(label, placement, onReward) {
      const b = document.createElement('button');
      b.className = 'btn gold' + (this.adsReady ? '' : ' disabled');
      b.innerHTML = `<i>${I().play}</i><span>${label}</span>`;
      b.onclick = () => {
        if (ZM.audio) ZM.audio.click();
        b.classList.add('disabled');
        clearTimeout(this.autoTimer);
        ZM.Native.showRewarded(placement, (ok) => {
          if (ok) onReward();
          else { b.classList.remove('disabled'); this.toast(ZM.t('no_ad')); }
        });
      };
      return b;
    }

    openCleared(d) {
      const g = this.game;
      const nextN = d.N + 1;
      const nextBiome = ZM.biomeForLevel(nextN);
      const newGarden = nextBiome.index !== g.biome.index;
      const card = this.openModal(`
        <div class="stars"><span>${I().star}</span><span>${I().star}</span><span>${I().star}</span></div>
        <div class="m-title">${ZM.t('Field Cleared!')}</div>
        <div class="m-sub">${ZM.t('Level')} ${d.N} · ${ZM.biomeName(g.biome)}</div>
        <div class="reward"><i>${I().coin}</i><span>+${ZM.fmt(d.reward)}</span></div>
        <div id="clrBtns"></div>
        ${newGarden ? `<div class="next-biome">${ZM.t('Next garden:')} <b>${ZM.biomeName(nextBiome)}</b></div>` : ''}`, { closable: false });
      const box = card.querySelector('#clrBtns');
      let done = false;
      const collect = (mult) => {
        if (done) return; done = true;
        clearTimeout(this.autoTimer);
        const amount = g.collectReward(mult);
        if (ZM.audio) ZM.audio.coins();
        this.closeModal();
        if (mult > 1) this.toast(ZM.t('bonus', { m: mult, v: ZM.fmt(amount) }), 2.2);
        if (ZM.onLevelAdvance) ZM.onLevelAdvance();
      };
      box.appendChild(this.rewardedButton(ZM.t('Collect ×3'), 'level_x3', () => collect(3)));
      const c = document.createElement('button');
      c.className = 'btn countdown';
      c.style.setProperty('--dur', '7s');
      c.textContent = ZM.t('Collect');
      c.onclick = () => { if (ZM.audio) ZM.audio.click(); collect(1); };
      box.appendChild(c);
      this.autoTimer = setTimeout(() => collect(1), 7000);
    }

    openOffline(amount, secs) {
      const card = this.openModal(`
        <div class="m-title">${ZM.t('Welcome back!')}</div>
        <div class="m-sub">${ZM.t('offline_sub', { t: ZM.fmtTime(secs) })}</div>
        <div class="reward"><i>${I().coin}</i><span>+${ZM.fmt(amount)}</span></div>
        <div id="offBtns"></div>`, { closable: false });
      const box = card.querySelector('#offBtns');
      let done = false;
      const collect = (mult) => {
        if (done) return; done = true;
        this.save.cash += amount * mult;
        this.save.stats.totalEarned += amount * mult;
        if (ZM.audio) ZM.audio.coins();
        this.closeModal();
      };
      box.appendChild(this.rewardedButton(ZM.t('Double it ×2'), 'offline_x2', () => collect(2)));
      const c = document.createElement('button');
      c.className = 'btn'; c.textContent = ZM.t('Collect');
      c.onclick = () => { if (ZM.audio) ZM.audio.click(); collect(1); };
      box.appendChild(c);
    }

    boost() {
      const s = this.save;
      if (s.boostT >= ZM.BOOST_MAX - ZM.BOOST_SECONDS) { this.toast(ZM.t('boost_max')); return; }
      if (!this.adsReady) { this.toast(ZM.t('no_ad')); return; }
      const card = this.openModal(`
        <div class="m-title">${ZM.t('Double Cash')}</div>
        <div class="m-sub">${ZM.t('boost_sub', { m: ZM.BOOST_SECONDS / 60 })}${s.boostT > 0 ? ' ' + ZM.t('Time stacks!') : ''}</div>
        <div class="reward"><i>${I().coin}</i><span>×2</span></div><div id="bBtns"></div>`);
      card.querySelector('#bBtns').appendChild(this.rewardedButton(ZM.t('Watch & Boost'), 'boost_x2', () => {
        s.boostT = Math.min(ZM.BOOST_MAX, s.boostT + ZM.BOOST_SECONDS);
        this.closeModal();
        this.toast(ZM.t('boost_on', { t: ZM.fmtTime(s.boostT) }));
        if (ZM.audio) ZM.audio.coins();
      }));
    }

    toggleZen() {
      const g = this.game;
      if (g.state === 'cleared' || g.state === 'sweep') return;
      if (g.zen) g.stopZen(); else g.startZen();
    }

    openSettings() {
      const s = this.save.settings;
      const card = this.openModal(`
        <div class="m-title">${ZM.t('Settings')}</div>
        <div class="set-row"><span>${ZM.t('Sound effects')}</span><input type="range" min="0" max="1" step="0.05" value="${s.sfx}" data-k="sfx"></div>
        <div class="set-row"><span>${ZM.t('Music')}</span><input type="range" min="0" max="1" step="0.05" value="${s.music}" data-k="music"></div>
        <div class="set-row"><span>${ZM.t('Nature ambience')}</span><input type="range" min="0" max="1" step="0.05" value="${s.amb}" data-k="amb"></div>
        <div class="set-row"><span>${ZM.t('Vibration')}</span><button class="toggle ${s.haptics ? 'on' : ''}" data-t="haptics"></button></div>
        <div class="set-row"><span>${ZM.t('Steering')}</span><div class="seg" data-s="control"><button data-v="follow">${ZM.t('Follow finger')}</button><button data-v="drag">${ZM.t('Drag')}</button></div></div>
        <div class="set-row"><span>${ZM.t('Graphics')}</span><div class="seg" data-s="quality"><button data-v="auto">${ZM.t('Auto')}</button><button data-v="high">${ZM.t('High')}</button><button data-v="low">${ZM.t('Saver')}</button></div></div>
        <div id="setBtns"></div>
        <div class="foot">Zen Mower ${ZM.Native.appVersion()}<br>Fonts: Lilita One & Varela Round (SIL Open Font License)</div>
        <button class="linkish" id="resetBtn">${ZM.t('Reset progress')}</button>`);
      card.querySelectorAll('input[type=range]').forEach((el) => {
        el.addEventListener('input', () => { s[el.dataset.k] = parseFloat(el.value); if (ZM.audio) ZM.audio.applyVolumes(); });
        el.addEventListener('change', () => ZM.onSaveNeeded && ZM.onSaveNeeded());
      });
      card.querySelectorAll('.toggle').forEach((el) => el.addEventListener('click', () => {
        s[el.dataset.t] = !s[el.dataset.t]; el.classList.toggle('on', s[el.dataset.t]);
        if (ZM.audio) ZM.audio.click();
        if (el.dataset.t === 'haptics' && s.haptics) ZM.Native.haptic('medium');
      }));
      card.querySelectorAll('.seg').forEach((seg) => {
        const k = seg.dataset.s;
        const sync = () => seg.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.v === s[k]));
        sync();
        seg.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => { s[k] = b.dataset.v; sync(); if (ZM.audio) ZM.audio.click(); if (k === 'quality' && ZM.onQuality) ZM.onQuality(); }));
      });
      const btns = card.querySelector('#setBtns');
      if (ZM.Native.isPrivacyOptionsRequired()) {
        const p = document.createElement('button'); p.className = 'btn ghost small'; p.textContent = ZM.t('Privacy & ad choices');
        p.onclick = () => ZM.Native.showPrivacyOptions(); btns.appendChild(p);
      }
      if (ZM.Native.isNative) {
        const r = document.createElement('button'); r.className = 'btn ghost small'; r.textContent = '★ ' + ZM.t('Rate Zen Mower');
        r.onclick = () => ZM.Native.openStoreListing(); btns.appendChild(r);
      }
      card.querySelector('#resetBtn').onclick = () => {
        const c2 = this.openModal(`<div class="m-title">${ZM.t('Reset?')}</div><div class="m-sub">${ZM.t('reset_sub')}</div><div id="rb"></div>`);
        const yes = document.createElement('button'); yes.className = 'btn ghost'; yes.textContent = ZM.t('Yes, start over');
        yes.onclick = () => { if (ZM.resetProgress) ZM.resetProgress(); };
        const no = document.createElement('button'); no.className = 'btn'; no.textContent = ZM.t('Keep my garden');
        no.onclick = () => this.closeModal();
        c2.querySelector('#rb').append(no, yes);
      };
    }

    openShop() {
      const s = this.save;
      const card = this.openModal(`<div class="m-title">${ZM.t('Mower Shop')}</div><div class="m-sub">${ZM.t('shop_sub')}</div><div class="skins"></div><div id="shopBtns"></div>`);
      const grid = card.querySelector('.skins');
      const render = () => {
        grid.innerHTML = '';
        for (const sk of ZM.SKINS) {
          const owned = s.skins.includes(sk.id), on = s.skin === sk.id;
          const d = document.createElement('div');
          d.className = 'skin' + (on ? ' on' : '');
          const cv = document.createElement('canvas'); cv.width = 144; cv.height = 144;
          ZM.drawMowerPreview(cv, sk);
          d.appendChild(cv);
          d.insertAdjacentHTML('beforeend', `<div class="nm">${ZM.t(sk.name)}</div><div class="pr">${on ? ZM.t('Equipped') : owned ? ZM.t('Use') : `<i>${I().gem}</i>${sk.price}`}</div>`);
          d.onclick = () => {
            if (on) return;
            if (owned) { s.skin = sk.id; if (ZM.audio) ZM.audio.click(); render(); return; }
            if (s.gems < sk.price) { if (ZM.audio) ZM.audio.error(); this.toast(ZM.t('need_gems', { n: sk.price - s.gems })); return; }
            s.gems -= sk.price; s.skins.push(sk.id); s.skin = sk.id;
            if (ZM.audio) ZM.audio.upgrade(3);
            ZM.Native.haptic('success');
            render();
            if (ZM.onSaveNeeded) ZM.onSaveNeeded();
          };
          grid.appendChild(d);
        }
      };
      render();
      const now = Date.now();
      const box = card.querySelector('#shopBtns');
      if (now >= (s.freeGemsAt || 0)) {
        box.appendChild(this.rewardedButton(ZM.t('Free gems +5'), 'free_gems', () => {
          s.gems += 5; s.freeGemsAt = Date.now() + 8 * 60 * 1000;
          if (ZM.audio) ZM.audio.gem();
          this.closeModal(); this.openShop();
          if (ZM.onSaveNeeded) ZM.onSaveNeeded();
        }));
      } else {
        const w = document.createElement('div'); w.className = 'foot';
        w.textContent = ZM.t('more_gems', { t: ZM.fmtTime((s.freeGemsAt - now) / 1000) });
        box.appendChild(w);
      }
    }
  }
  ZM.UI = UI;
})(window.ZM);
