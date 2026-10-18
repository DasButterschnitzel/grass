'use strict';
// DOM HUD: wallet, next lawn, round progress, upgrade grid, autopilot, dialogs, toasts.
(function (ZM) {
  const $ = (id) => document.getElementById(id);
  const I = () => ZM.ICONS;

  // A slider that works the same on every phone (pointer events, no browser range input:
  // inside a scrolling dialog those fight with the page and feel "broken").
  ZM.slider = function (value, onInput, onChange) {
    const el = document.createElement('div');
    el.className = 'slider';
    el.innerHTML = '<div class="track"><div class="fill"></div></div><div class="thumb"></div>';
    const fill = el.querySelector('.fill'), thumb = el.querySelector('.thumb');
    let v = ZM.clamp(value, 0, 1);
    const draw = () => { fill.style.width = v * 100 + '%'; thumb.style.left = `calc(12px + (100% - 24px) * ${v})`; };
    const at = (e) => { const r = el.getBoundingClientRect(); return ZM.clamp((e.clientX - r.left - 12) / Math.max(1, r.width - 24), 0, 1); };
    let drag = false;
    el.addEventListener('pointerdown', (e) => {
      e.stopPropagation(); e.preventDefault();
      drag = true; el.classList.add('drag');
      try { el.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      v = at(e); draw(); onInput(v);
    });
    el.addEventListener('pointermove', (e) => { if (!drag) return; v = at(e); draw(); onInput(v); });
    const end = () => { if (!drag) return; drag = false; el.classList.remove('drag'); if (onChange) onChange(v); };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener('lostpointercapture', end);
    draw();
    return el;
  };

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
      document.querySelector('#btnAuto .act-ico').innerHTML = I().bots;
      document.querySelector('#nextPrice i').innerHTML = I().coin;
      $('tutHand').innerHTML = I().hand;
      document.querySelector('#btnZen .act-lbl').textContent = ZM.t('Zen');
      const tap = (el, fn) => el.addEventListener('click', (e) => { e.stopPropagation(); if (ZM.audio) { ZM.audio.unlock(); ZM.audio.click(); } fn(); });
      tap($('btnSettings'), () => this.openSettings());
      tap($('btnShop'), () => this.openShop());
      tap($('btnZen'), () => { if (ZM.zen) ZM.zen.enter(); });
      tap($('btnView'), () => this.toggleMinimal());
      tap($('viewExit'), () => this.toggleMinimal());
      tap($('btnBoost'), () => this.boost());
      tap($('btnAuto'), () => this.openAuto());
      tap($('levelBox'), () => this.openNextLawn());
      $('viewExit').innerHTML = I().eye;

      const wrap = $('upgrades');
      // the next lawn is the first tile: what it costs and how close you are
      const lc = document.createElement('div');
      lc.className = 'card lawn';
      lc.innerHTML = `<div class="row"><div class="pv"></div><div class="tx"><div class="nm"></div><div class="lv"></div></div></div><div class="fx"></div><div class="cost"><div class="fill"></div><i>${I().coin}</i><span></span></div>`;
      wrap.appendChild(lc);
      this.lawnCard = { el: lc, pv: lc.querySelector('.pv'), nm: lc.querySelector('.nm'), lv: lc.querySelector('.lv'), fx: lc.querySelector('.fx'), cost: lc.querySelector('.cost span'), fill: lc.querySelector('.cost .fill') };
      lc.addEventListener('click', (e) => { e.stopPropagation(); if (ZM.audio) { ZM.audio.unlock(); ZM.audio.click(); } this.openNextLawn(); });
      // all other upgrades in one 3×2 grid – nothing hidden behind a scroll
      this.cards = {};
      for (const u of ZM.UPGRADES) {
        if (u.id === 'auto') continue; // lives on the autopilot button
        const c = document.createElement('div');
        c.className = 'card';
        c.innerHTML = `<div class="row"><span class="ico">${I()[u.id]}</span><div class="tx"><div class="nm">${ZM.t(u.name)}</div><div class="lv"></div></div></div><div class="fx"></div><div class="cost"><i>${I().coin}</i><span></span></div>`;
        wrap.appendChild(c);
        this.cards[u.id] = { el: c, lv: c.querySelector('.lv'), fx: c.querySelector('.fx'), cost: c.querySelector('.cost span'), costBox: c.querySelector('.cost') };
        this.bindHold(c, u.id);
      }
      this.lastToast = {};
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
      const card = this.cards[id] ? this.cards[id].el : null;
      if (lvl >= u.max) return false;
      const lock = ZM.upgradeLock(id, lvl, this.game.level.N);
      const cost = ZM.upgradeCost(id, lvl);
      if (lock || s.cash < cost) {
        if (!silentFail) {
          if (card) { card.classList.remove('shake'); void card.offsetWidth; card.classList.add('shake'); }
          if (ZM.audio) ZM.audio.error();
          // explain once, don't nag on every tap
          const now = performance.now();
          if (!this.lastToast[id] || now - this.lastToast[id] > 4000) {
            this.lastToast[id] = now;
            this.toast(this.describe(id) + '<br>' + (lock ? ZM.t('unlock_at', { n: lock }) : ZM.t('missing', { v: ZM.fmt(cost - s.cash) })), 2.6);
          }
        }
        return false;
      }
      s.cash -= cost;
      s.upg[id] = lvl + 1;
      this.game.recalc();
      if (card) { card.classList.remove('bought', 'hint'); void card.offsetWidth; card.classList.add('bought'); }
      if (ZM.audio) ZM.audio.upgrade();
      ZM.Native.haptic('light');
      s.tutorial.buy = true;
      if (id === 'fleet') {
        if (!s.tutorial.fleet) { s.tutorial.fleet = true; this.showTutorial('two'); }
        this.toast(ZM.t('new_mower'), 4);
      } else if (lvl === 0 && id !== 'auto') this.toast(this.describe(id), 3);
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

      // round progress ("mow everything once")
      const rp = g.roundProgress, rpct = Math.min(100, Math.floor(rp * 100));
      const rtxt = ZM.t('Round') + ' ' + (g.rounds + 1) + ' · ' + rpct + '%';
      if (c.rtxt !== rtxt) {
        $('roundTxt').textContent = rtxt; $('roundFill').style.width = rpct + '%'; c.rtxt = rtxt;
        $('roundPill').classList.toggle('near', rp >= 0.85);
      }
      // autopilot button: ready / running / charging
      const ar = g.autoReadyIn, aOn = g.autoT > 0;
      const aState = aOn ? 'on' : ar <= 0 ? 'ready' : 'wait';
      const aLbl = aOn ? Math.ceil(g.autoT) + 's' : ar <= 0 ? ZM.t('Auto') : ZM.fmtTime(ar);
      if (c.aLbl !== aLbl) { $('autoLbl').textContent = aLbl; c.aLbl = aLbl; }
      if (c.aState !== aState) {
        const b = $('btnAuto');
        b.classList.toggle('ready', aState === 'ready'); b.classList.toggle('on', aState === 'on');
        c.aState = aState;
      }
      const fr = g.frenzyT > 0;
      if (c.fr !== fr) { $('frenzyChip').classList.toggle('hidden', !fr); c.fr = fr; }
      if (fr) {
        const t = ZM.t('LUCKY FRENZY') + ' ' + Math.ceil(g.frenzyT) + 's';
        if (c.frT !== t) { $('frenzyText').textContent = t; c.frT = t; }
      }
      // boost button
      const bt = s.boostT > 0 ? '×2 ' + ZM.fmtTime(s.boostT) : '×2';
      if (c.boost !== bt) { $('boostLbl').textContent = bt; c.boost = bt; }
      const canAd = this.adsReady && s.boostT < ZM.BOOST_MAX - ZM.BOOST_SECONDS;
      if (c.canAd !== canAd) { $('btnBoost').classList.toggle('ready', canAd && s.boostT <= 0); $('btnBoost').classList.toggle('disabled', !canAd && s.boostT <= 0); c.canAd = canAd; }

      // upgrade tiles (only touch the DOM when something changes)
      for (const u of ZM.UPGRADES) {
        const cd = this.cards[u.id];
        if (!cd) continue;
        const lvl = s.upg[u.id] || 0;
        const max = lvl >= u.max;
        const lock = max ? 0 : ZM.upgradeLock(u.id, lvl, g.level.N);
        const cost = max ? 0 : ZM.upgradeCost(u.id, lvl);
        const poor = !max && !lock && s.cash < cost;
        const key = lvl + '|' + poor + '|' + max + '|' + lock + '|' + (lock ? '' : ZM.fmt(cost));
        if (cd.key === key) continue;
        cd.key = key;
        cd.el.classList.toggle('poor', poor);
        cd.el.classList.toggle('max', max);
        cd.el.classList.toggle('locked', !!lock);
        cd.lv.textContent = 'Lv ' + lvl;
        cd.fx.textContent = max ? ZM.upgradeEffect(u.id, lvl) + ' · MAX' : ZM.upgradeEffect(u.id, lvl) + ' → ' + ZM.upgradeEffect(u.id, lvl + 1);
        cd.cost.textContent = max ? 'MAX' : lock ? ZM.t('from_lawn', { n: lock }) : ZM.fmt(cost);
        cd.costBox.querySelector('i').style.display = max || lock ? 'none' : '';
      }
      this.coach(dt);

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
        case 'frenzy': this.toast(ZM.t('clover_toast'), 2.5); break;
        case 'round': {
          const el = $('roundPill'); el.classList.remove('pulse'); void el.offsetWidth; el.classList.add('pulse');
          if (ev.data.big) this.banner(ZM.t('LAWN COMPLETE!'), '+' + ZM.fmt(ev.data.bonus));
          if (!this.save.tutorial.round) { this.save.tutorial.round = true; this.toast(ZM.t('tip_round'), 5); }
          break;
        }
        case 'auto': if (!this.save.tutorial.autoUse) { this.save.tutorial.autoUse = true; this.toast(ZM.t('tip_auto_on', { s: ev.data }), 4); } break;
      }
    }

    // ------------------------------------------------------------ layout
    playRect() {
      if (this.minimalView || document.body.classList.contains('zen')) {
        const cs0 = getComputedStyle(document.documentElement);
        const v = (k) => parseFloat(cs0.getPropertyValue(k)) || 0;
        return { x: v('--sal') + 6, y: v('--sat') + 10, w: window.innerWidth - v('--sal') - v('--sar') - 12, h: window.innerHeight - v('--sat') - v('--sab') - 20 };
      }
      // the lawn starts below the round pill, so the pill never hides grass or a mower
      const pill = $('roundPill').getBoundingClientRect();
      const top = Math.max($('actions').getBoundingClientRect().bottom + 6, pill.height > 0 ? pill.bottom + 4 : 0);
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
      if (ZM.onModalClosed) ZM.onModalClosed();
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

    // First steps: point at the first affordable upgrade, introduce the autopilot.
    coach(dt) {
      const s = this.save, g = this.game;
      this.coachT = (this.coachT || 0) + dt;
      if (this.coachT < 1) return;
      this.coachT = 0;
      if (!s.tutorial.buy && g.sessionCuts > 120 && !this.modalOpen) {
        let best = null;
        for (const id of ['blade', 'engine', 'fert', 'sprinkler']) {
          const cost = ZM.upgradeCost(id, s.upg[id] || 0);
          if (s.cash >= cost && (!best || cost < best[1])) best = [id, cost];
        }
        this.hintId = best ? best[0] : null;
        for (const id of Object.keys(this.cards)) this.cards[id].el.classList.toggle('hint', this.hintId === id);
        if (best && !this.coachToast) { this.coachToast = true; this.toast(ZM.t('tip_buy'), 4); }
      } else if (s.tutorial.buy && this.hintId) {
        this.cards[this.hintId].el.classList.remove('hint'); this.hintId = null;
      }
      if (!s.tutorial.autoIntro && g.level.N >= 2 && g.autoReadyIn <= 0 && !this.modalOpen) {
        s.tutorial.autoIntro = true;
        this.toast(ZM.t('tip_auto'), 5);
      }
    }

    // The autopilot is a bonus: X seconds of mowing by itself, then it recharges.
    openAuto() {
      const g = this.game, s = this.save;
      const lvl = s.upg.auto || 0, u = ZM.UPG.auto, max = lvl >= u.max;
      const dur = g.stats.autoDur, ready = g.autoReadyIn <= 0, on = g.autoT > 0;
      const card = this.openModal(`
        <div class="m-title">${ZM.t('Autopilot')}</div>
        <div class="big-ico">${I().bots}</div>
        <div class="m-sub">${ZM.t('auto_sub', { s: dur, c: ZM.fmtTime(ZM.AUTO_COOLDOWN) })}</div>
        <div class="m-rows">
          <div class="m-row"><span>${ZM.t('Duration')}</span><b>${dur}s${max ? '' : ' → ' + ZM.upgradeEffect('auto', lvl + 1)}</b></div>
          <div class="m-row"><span>${ZM.t('Status')}</span><b>${on ? ZM.t('auto_running', { s: Math.ceil(g.autoT) }) : ready ? ZM.t('auto_ready') : ZM.t('auto_wait', { t: ZM.fmtTime(g.autoReadyIn) })}</b></div>
        </div>
        <div id="autoBtns"></div>`);
      const box = card.querySelector('#autoBtns');
      if (ready && !on) {
        const go = document.createElement('button'); go.className = 'btn'; go.textContent = ZM.t('Start autopilot');
        go.onclick = () => { this.closeModal(); g.activateAuto(); };
        box.appendChild(go);
      } else if (!on) {
        box.appendChild(this.rewardedButton(ZM.t('Recharge now'), 'auto_recharge', () => {
          s.autoReadyAt = 0; this.closeModal(); g.activateAuto(true);
          if (ZM.onSaveNeeded) ZM.onSaveNeeded();
        }));
      }
      if (!max) {
        const cost = ZM.upgradeCost('auto', lvl);
        const up = document.createElement('button');
        up.className = 'btn ghost' + (s.cash >= cost ? '' : ' disabled');
        up.innerHTML = `<span>${ZM.t('Longer')} +6s</span><i>${I().coin}</i><span>${ZM.fmt(cost)}</span>`;
        up.onclick = () => {
          if (s.cash < cost) return;
          s.cash -= cost; s.upg.auto = lvl + 1; g.recalc();
          if (ZM.audio) ZM.audio.upgrade();
          ZM.Native.haptic('light');
          if (ZM.onSaveNeeded) ZM.onSaveNeeded();
          this.openAuto();
        };
        box.appendChild(up);
      }
    }

    // Daily gift with a 7-day streak. Shown once per calendar day, after any other dialog.
    checkDaily() {
      const s = this.save, today = new Date().toDateString();
      if (s.daily.last === today || this.modalOpen) return false;
      const yesterday = new Date(Date.now() - 86400000).toDateString();
      s.daily.streak = s.daily.last === yesterday ? (s.daily.streak % 7) + 1 : 1;
      s.daily.last = today;
      this.openDaily(s.daily.streak);
      return true;
    }

    openDaily(day) {
      const s = this.save, g = this.game;
      const plan = [['c', 60], ['c', 90], ['g', 5], ['c', 120], ['a', 120], ['c', 180], ['g', 15]];
      const [kind, amt] = plan[day - 1];
      const coins = Math.max(50, (s.rate || 0) * amt, g.nextLawnCost * 0.04 * (amt / 60));
      const days = plan.map(([k], i) => `<div class="day ${i + 1 < day ? 'done' : i + 1 === day ? 'today' : ''}">${ZM.t('Day')} ${i + 1}<i>${I()[k === 'g' ? 'gem' : k === 'a' ? 'bots' : 'coin']}</i></div>`).join('');
      const what = kind === 'g' ? `<i>${I().gem}</i><span>+${amt}</span>` : `<i>${I().coin}</i><span>+${ZM.fmt(coins)}</span>`;
      const card = this.openModal(`
        <div class="m-title">${ZM.t('Daily gift')}</div>
        <div class="m-sub">${ZM.t('daily_sub', { d: day })}${kind === 'a' ? '<br>' + ZM.t('daily_auto') : ''}</div>
        <div class="days">${days}</div>
        <div class="reward small">${what}</div>
        <div id="dailyBtns"></div>`, { closable: false });
      const box = card.querySelector('#dailyBtns');
      let done = false;
      const take = (mult) => {
        if (done) return; done = true;
        if (kind === 'g') s.gems += amt * mult;
        else { s.cash += coins * mult; s.stats.totalEarned += coins * mult; }
        if (kind === 'a') s.autoReadyAt = 0;
        if (ZM.audio) { if (kind === 'g') ZM.audio.gem(); else ZM.audio.coins(); }
        ZM.Native.haptic('success');
        this.closeModal();
        if (ZM.onSaveNeeded) ZM.onSaveNeeded();
      };
      box.appendChild(this.rewardedButton(ZM.t('Double it ×2'), 'daily_x2', () => take(2)));
      const c = document.createElement('button');
      c.className = 'btn'; c.textContent = ZM.t('Collect');
      c.onclick = () => { if (ZM.audio) ZM.audio.click(); take(1); };
      box.appendChild(c);
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
        <div class="set-row" data-sl="master"><span>${ZM.t('Volume')}</span></div>
        <div class="set-row" data-sl="sfx"><span>${ZM.t('Sound effects')}</span></div>
        <div class="set-row" data-sl="music"><span>${ZM.t('Music')}</span></div>
        <div class="set-row" data-sl="amb"><span>${ZM.t('Nature ambience')}</span></div>
        <div class="set-row"><span>${ZM.t('Melody while mowing')}</span><div class="seg" data-s="melody"><button data-v="off">${ZM.t('Off')}</button><button data-v="soft">${ZM.t('Soft')}</button><button data-v="full">${ZM.t('Full')}</button></div></div>
        <div class="set-row"><span>${ZM.t('Vibration')}</span><div class="seg" data-s="vib" data-num="1"><button data-v="0">${ZM.t('Off')}</button><button data-v="1">${ZM.t('Soft')}</button><button data-v="2">${ZM.t('Strong')}</button></div></div>
        <div class="set-row"><span>${ZM.t('Steering')}</span><div class="seg" data-s="control"><button data-v="follow">${ZM.t('Follow finger')}</button><button data-v="drag">${ZM.t('Drag')}</button></div></div>
        <div class="set-row"><span>${ZM.t('Graphics')}</span><div class="seg" data-s="quality"><button data-v="auto">${ZM.t('Auto')}</button><button data-v="high">${ZM.t('High')}</button><button data-v="low">${ZM.t('Saver')}</button></div></div>
        <div id="setBtns"></div>
        <div class="foot">Zen Mower ${ZM.Native.appVersion()}<br>Fonts: Lilita One & Varela Round (SIL Open Font License)</div>
        <button class="linkish" id="resetBtn">${ZM.t('Reset progress')}</button>`);
      const save = () => ZM.onSaveNeeded && ZM.onSaveNeeded();
      card.querySelectorAll('[data-sl]').forEach((row) => {
        const k = row.dataset.sl;
        row.appendChild(ZM.slider(s[k] === undefined ? 1 : s[k], (v) => { s[k] = Math.round(v * 100) / 100; if (ZM.audio) ZM.audio.applyVolumes(); }, () => {
          save();
          // let you hear what you just set
          if (ZM.audio) { if (k === 'sfx' || k === 'master') ZM.audio.upgrade(); }
        }));
      });
      card.querySelectorAll('.seg').forEach((seg) => {
        const k = seg.dataset.s, num = !!seg.dataset.num;
        const sync = () => seg.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.v === String(s[k])));
        sync();
        seg.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
          s[k] = num ? parseInt(b.dataset.v, 10) : b.dataset.v; sync(); save();
          if (ZM.audio) ZM.audio.click();
          if (k === 'quality' && ZM.onQuality) ZM.onQuality();
          if (k === 'vib') ZM.Native.haptic('heavy');
        }));
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
            if (ZM.audio) ZM.audio.upgrade();
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
