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
      document.querySelector('#btnZen .act-ico').innerHTML = I().lotus;
      document.querySelector('#btnShop .act-ico').innerHTML = I().shop;
      document.querySelector('#btnView .act-ico').innerHTML = I().eye;
      document.querySelector('#nextPrice i').innerHTML = I().coin;
      $('tutHand').innerHTML = I().hand;
      document.querySelector('#btnZen .act-lbl').textContent = ZM.t('Zen');
      document.querySelector('#btnShop .act-lbl').textContent = ZM.t('Shop');
      const tap = (el, fn) => el.addEventListener('click', (e) => { e.stopPropagation(); if (ZM.audio) { ZM.audio.unlock(); ZM.audio.click(); } fn(); });
      tap($('btnSettings'), () => this.openSettings());
      tap($('btnShop'), () => this.openShop());
      tap($('btnZen'), () => { if (ZM.zen) ZM.zen.enter(); });
      tap($('btnView'), () => this.toggleMinimal());
      tap($('viewExit'), () => this.toggleMinimal());
      tap($('btnBoost'), () => this.boost());
      tap($('levelBox'), () => this.openNextLawn());
      $('viewExit').innerHTML = I().eye;

      const wrap = $('upgrades');
      // the next lawn is the first "card": what it costs and how close you are
      const lc = document.createElement('div');
      lc.className = 'card lawn';
      lc.innerHTML = `<div class="pv"></div><div class="nm"></div><div class="lv"></div><div class="fx"></div><div class="cost"><div class="fill"></div><i>${I().coin}</i><span></span></div>`;
      wrap.appendChild(lc);
      this.lawnCard = { el: lc, pv: lc.querySelector('.pv'), nm: lc.querySelector('.nm'), lv: lc.querySelector('.lv'), fx: lc.querySelector('.fx'), cost: lc.querySelector('.cost span'), fill: lc.querySelector('.cost .fill') };
      lc.addEventListener('click', (e) => { e.stopPropagation(); if (ZM.audio) { ZM.audio.unlock(); ZM.audio.click(); } this.openNextLawn(); });
      this.cards = {};
      for (const u of ZM.UPGRADES) {
        const c = document.createElement('div');
        c.className = 'card';
        c.innerHTML = `<span class="ico">${I()[u.id]}</span><div class="nm">${ZM.t(u.name)}</div><div class="lv"></div><div class="fx"></div><div class="cost"><i>${I().coin}</i><span></span></div>`;
        wrap.appendChild(c);
        this.cards[u.id] = { el: c, lv: c.querySelector('.lv'), fx: c.querySelector('.fx'), cost: c.querySelector('.cost span'), costBox: c.querySelector('.cost') };
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
        if (!silentFail) {
          card.classList.remove('shake'); void card.offsetWidth; card.classList.add('shake');
          if (ZM.audio) ZM.audio.error();
          this.toast(this.describe(id) + '<br>' + ZM.t('missing', { v: ZM.fmt(cost - s.cash) }), 3.5);
        }
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
      else if (lvl === 0 && id !== 'fleet') this.toast(this.describe(id), 3.5);
      if (ZM.onSaveNeeded) ZM.onSaveNeeded();
      return true;
    }

    describe(id) {
      const u = ZM.UPG[id], lvl = this.save.upg[id] || 0;
      const now = ZM.upgradeEffect(id, lvl), next = lvl >= u.max ? '' : ' → ' + ZM.upgradeEffect(id, lvl + 1);
      return `<b>${ZM.t(u.name)}</b>: ${ZM.t(u.desc)} (${now}${next})`;
    }

    // ------------------------------------------------------------ per-frame update
    update(dt) {
      const g = this.game, s = this.save, c = this.cache;
      // events from the simulation
      while (g.events.length) this.onEvent(g.events.shift());
      if (g.mode === 'zen') { // the game HUD is hidden in zen mode – only toasts matter
        if (this.toastT > 0) { this.toastT -= dt; if (this.toastT <= 0) $('toast').classList.add('hidden'); }
        return;
      }

      // smooth money counter
      const diff = s.cash - this.dispCash;
      this.dispCash = Math.abs(diff) < 0.5 || Math.abs(diff) / Math.max(1, s.cash) < 0.002 ? s.cash : this.dispCash + diff * Math.min(1, dt * 9);
      const cashStr = ZM.fmt(Math.max(0, this.dispCash));
      if (c.cash !== cashStr) { $('cashText').textContent = cashStr; c.cash = cashStr; }
      if (c.gems !== s.gems) { $('gemText').textContent = s.gems; c.gems = s.gems; }

      if (g.level) {
        const lvStr = ZM.t('Lawn') + ' ' + g.level.N;
        if (c.lv !== lvStr) { $('levelNum').textContent = lvStr; c.lv = lvStr; }
        if (c.biome !== g.biome.name) { $('biomeName').textContent = ZM.biomeName(g.biome); c.biome = g.biome.name; }
        const cost = g.nextLawnCost;
        const p = ZM.clamp(this.dispCash / cost, 0, 1);
        const pct = Math.floor(p * 200) / 2;
        const ready = s.cash >= cost;
        if (c.pct !== pct) {
          $('progressFill').style.width = pct + '%';
          this.lawnCard.fill.style.width = pct + '%';
          c.pct = pct;
        }
        // narrow phones: the bar only has room for the percentage
        this.barCheckT = (this.barCheckT || 0) - dt;
        if (this.barCheckT <= 0) { this.barCheckT = 1; this.barWide = $('progress').clientWidth > 128; }
        const label = ready ? ZM.t(this.barWide ? 'lawn_ready' : 'lawn_ready_short') : (this.barWide ? ZM.t('Next lawn') + ' · ' : '▶ ') + Math.floor(p * 100) + '%';
        if (c.lawnLbl !== label) { $('progressText').textContent = label; c.lawnLbl = label; }
        const price = ZM.fmt(cost);
        if (c.price !== price) { $('nextPriceText').textContent = price; this.lawnCard.cost.textContent = price; c.price = price; }
        if (c.lawnN !== g.level.N) {
          c.lawnN = g.level.N;
          const nb = ZM.biomeForLevel(g.level.N + 1), lc = this.lawnCard;
          lc.pv.style.background = `radial-gradient(circle at 35% 30%, ${ZM.css(nb.blades[0])}, ${ZM.css(nb.blades[3])} 55%, ${ZM.css(nb.root)} 100%)`;
          lc.pv.textContent = g.level.N + 1;
          lc.nm.textContent = ZM.t('Lawn') + ' ' + (g.level.N + 1);
          lc.lv.textContent = ZM.biomeName(nb);
        }
        if (c.ready !== ready) {
          $('levelBox').classList.toggle('ready', ready);
          this.lawnCard.el.classList.toggle('ready', ready);
          this.lawnCard.el.classList.toggle('poor', !ready);
          this.lawnCard.fx.textContent = ready ? ZM.t('Move there!') : ZM.t('lawn_mult', { m: ZM.LAWN_MULT });
          c.ready = ready;
          if (ready && !s.tutorial.lawn) { s.tutorial.lawn = true; this.toast(ZM.t('tip_next_lawn'), 4.5); }
        }
      }

      // chips
      const combo = g.combo;
      const showCombo = combo.level > 0;
      if (c.combo !== showCombo) { $('comboChip').classList.toggle('hidden', !showCombo); c.combo = showCombo; }
      if (showCombo) {
        const txt = ZM.t('COMBO') + ' ×' + (1 + 0.1 * Math.min(10, combo.level)).toFixed(1);
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
        cd.lv.textContent = 'Lv ' + lvl;
        cd.fx.textContent = max ? ZM.upgradeEffect(u.id, lvl) + ' · MAX' : ZM.upgradeEffect(u.id, lvl) + ' → ' + ZM.upgradeEffect(u.id, lvl + 1);
        cd.cost.textContent = max ? 'MAX' : ZM.fmt(cost);
        cd.costBox.querySelector('i').style.display = max ? 'none' : '';
      }

      // tutorial
      if (!s.tutorial.move && g.sessionCuts > 40) { s.tutorial.move = true; this.hideTutorial(); }
      if (!s.tutorial.regrow && g.sessionCuts > 600) { s.tutorial.regrow = true; this.toast(ZM.t('tip_regrow'), 4.5); }
      if (this.tutTimer > 0) { this.tutTimer -= dt; if (this.tutTimer <= 0) this.hideTutorial(); }
      if (this.toastT > 0) { this.toastT -= dt; if (this.toastT <= 0) $('toast').classList.add('hidden'); }
    }

    onEvent(ev) {
      const g = this.game;
      switch (ev.type) {
        case 'level': {
          if (ev.data.restore) break;
          const N = ev.data.N;
          this.banner(N > 1 ? ZM.t('NEW LAWN!') : ZM.t('Lawn') + ' 1', ZM.biomeName(ev.data.biome));
          break;
        }
        case 'newLawn': this.cache = {}; if (ZM.onLevelAdvance) setTimeout(() => ZM.onLevelAdvance(), 1600); break;
        case 'gem': break;
        case 'flyerArrived': { const el = $('gems'); el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump'); break; }
        case 'combo': { const el = $('comboChip'); el.classList.remove('pulse'); void el.offsetWidth; el.classList.add('pulse'); break; }
        case 'frenzy': this.toast(ZM.t('clover_toast'), 2.5); break;
      }
    }

    // ------------------------------------------------------------ layout
    playRect() {
      if (this.minimalView || document.body.classList.contains('zen')) {
        const cs0 = getComputedStyle(document.documentElement);
        const v = (k) => parseFloat(cs0.getPropertyValue(k)) || 0;
        return { x: v('--sal') + 6, y: v('--sat') + 10, w: window.innerWidth - v('--sal') - v('--sar') - 12, h: window.innerHeight - v('--sat') - v('--sab') - 20 };
      }
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

    // The original's progression: spend coins to move to a new, more valuable lawn.
    openNextLawn() {
      const g = this.game, s = this.save;
      const N = g.level.N, cost = g.nextLawnCost;
      const nb = ZM.biomeForLevel(N + 1);
      const sw = (c) => ZM.css(c);
      const preview = `background: radial-gradient(circle at 35% 30%, ${sw(nb.blades[0])}, ${sw(nb.blades[3])} 55%, ${sw(nb.root)} 100%);`;
      const card = this.openModal(`
        <div class="m-title">${ZM.t('Next lawn')}</div>
        <div class="lawn-prev" style="${preview}"><span>${N + 1}</span></div>
        <div class="m-sub"><b>${ZM.biomeName(nb)}</b><br>${ZM.t('lawn_info', { m: ZM.LAWN_MULT })}</div>
        <div class="reward small"><i>${I().coin}</i><span>${ZM.fmt(cost)}</span></div>
        <div id="lawnBtns"></div>`);
      const box = card.querySelector('#lawnBtns');
      const go = document.createElement('button');
      const afford = s.cash >= cost;
      go.className = 'btn' + (afford ? '' : ' disabled');
      go.textContent = afford ? ZM.t('Move there!') : ZM.t('missing', { v: ZM.fmt(cost - s.cash) });
      go.onclick = () => {
        if (!g.buyNextLawn()) return;
        this.closeModal();
        if (ZM.onSaveNeeded) ZM.onSaveNeeded();
      };
      const later = document.createElement('button');
      later.className = 'btn ghost'; later.textContent = ZM.t('Keep mowing');
      later.onclick = () => { if (ZM.audio) ZM.audio.click(); this.closeModal(); };
      box.append(go, later);
    }

    openOffline(amount, secs, subKey) {
      const card = this.openModal(`
        <div class="m-title">${ZM.t('Welcome back!')}</div>
        <div class="m-sub">${ZM.t(subKey || 'offline_sub', { t: ZM.fmtTime(secs) })}</div>
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

    // Minimal view: hide every number and button – just you, the lawn and the sounds.
    // (The separate Zen mode lives in zen.js.)
    toggleMinimal() {
      this.minimalView = !this.minimalView;
      this.game.minimalView = this.minimalView;
      document.body.classList.toggle('minimal', this.minimalView);
      this.hideTutorial();
      $('toast').classList.add('hidden');
      if (this.minimalView && !this.save.tutorial.zen) { this.save.tutorial.zen = true; this.toast(ZM.t('clean_toast'), 3.5); }
      if (ZM.onLayout) ZM.onLayout();
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
