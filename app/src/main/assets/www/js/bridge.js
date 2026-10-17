'use strict';
// JS <-> Android bridge. In a desktop browser (development) ads are simulated.
(function (ZM) {
  const A = window.AndroidBridge || null;
  const listeners = {};
  const on = (ev, fn) => ((listeners[ev] = listeners[ev] || []).push(fn));
  const fire = (ev, ...args) => (listeners[ev] || []).forEach((fn) => { try { fn(...args); } catch (e) { console.error(e); } });
  const pendingRewards = {};
  let interCb = null;

  const call = (name, ...args) => {
    if (!A || typeof A[name] !== 'function') return undefined;
    try { return A[name](...args); } catch (e) { console.warn('bridge', name, e); return undefined; }
  };

  ZM.Native = {
    isNative: !!A,
    on,
    haptic(kind) {
      if (!ZM.save || !ZM.save.settings.haptics) return;
      if (A) call('haptic', kind);
      else if (navigator.vibrate) { try { navigator.vibrate(kind === 'heavy' ? 30 : kind === 'success' ? [12, 40, 18] : 10); } catch (e) { /* ignore */ } }
    },
    isRewardedReady() { return A ? !!call('isRewardedReady') : true; },
    isInterstitialReady() { return A ? !!call('isInterstitialReady') : false; },
    showRewarded(placement, cb) {
      pendingRewards[placement] = cb;
      if (A) {
        const ok = call('showRewarded', placement);
        if (!ok) { delete pendingRewards[placement]; cb(false, 'not-ready'); }
        return;
      }
      // development fallback: a pretend ad
      const ov = document.createElement('div');
      ov.className = 'dev-ad';
      ov.innerHTML = '<div>Rewarded ad (dev preview)</div><small>reward in 1.5s</small>';
      document.body.appendChild(ov);
      ZM.Native._adShowing(true);
      setTimeout(() => { ov.remove(); ZM.Native._adShowing(false); window.ZenNative.onRewardResult(placement, true); }, 1500);
    },
    showInterstitial(cb) {
      if (!A) { if (cb) cb(); return false; }
      interCb = cb || null;
      const ok = call('showInterstitial');
      if (!ok) { interCb = null; if (cb) cb(); }
      return !!ok;
    },
    isPrivacyOptionsRequired() { return A ? !!call('isPrivacyOptionsRequired') : false; },
    showPrivacyOptions() { call('showPrivacyOptions'); },
    openStoreListing() { if (A) call('openStoreListing'); },
    share(text) { if (A) call('share', text); else if (navigator.share) navigator.share({ text }).catch(() => {}); },
    appVersion() { return (A && call('getAppVersion')) || 'web'; },
    requestInsets() { call('requestInsets'); },
    // hide the banner during rewarded ad-free time
    setBannerHidden(v) { call('setBannerHidden', !!v); },
    // the sleep timer lets the screen turn off again
    setKeepAwake(v) { call('setKeepAwake', !!v); },
    _adShowing(v) { fire('adShowing', v); },
  };

  // Callbacks invoked by the Android side via evaluateJavascript.
  window.ZenNative = {
    onPause() { fire('pause'); },
    onResume() { fire('resume'); },
    onBack() {
      let handled = false;
      (listeners.back || []).forEach((fn) => { if (fn()) handled = true; });
      return handled;
    },
    onInsets(top, right, bottom, left) {
      const r = document.documentElement.style;
      r.setProperty('--sat', (top || 0) + 'px');
      r.setProperty('--sar', (right || 0) + 'px');
      r.setProperty('--sab', (bottom || 0) + 'px');
      r.setProperty('--sal', (left || 0) + 'px');
      fire('insets');
    },
    onRewardResult(placement, earned) {
      const cb = pendingRewards[placement];
      delete pendingRewards[placement];
      if (cb) cb(!!earned);
    },
    onInterstitialClosed() { const cb = interCb; interCb = null; if (cb) cb(); },
    onAdShowing(v) { fire('adShowing', !!v); },
    onAdsAvailability(rewarded, inter) { fire('ads', !!rewarded, !!inter); },
  };
})(window.ZM);
