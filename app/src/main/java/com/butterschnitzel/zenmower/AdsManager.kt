package com.butterschnitzel.zenmower

import android.app.Activity
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.util.Log
import android.view.Gravity
import android.view.ViewGroup
import android.widget.FrameLayout
import androidx.core.view.isVisible
import com.google.android.gms.ads.AdError
import com.google.android.gms.ads.AdListener
import com.google.android.gms.ads.AdRequest
import com.google.android.gms.ads.AdSize
import com.google.android.gms.ads.AdView
import com.google.android.gms.ads.FullScreenContentCallback
import com.google.android.gms.ads.LoadAdError
import com.google.android.gms.ads.MobileAds
import com.google.android.gms.ads.RequestConfiguration
import com.google.android.gms.ads.interstitial.InterstitialAd
import com.google.android.gms.ads.interstitial.InterstitialAdLoadCallback
import com.google.android.gms.ads.rewarded.RewardedAd
import com.google.android.gms.ads.rewarded.RewardedAdLoadCallback
import com.google.android.ump.ConsentDebugSettings
import com.google.android.ump.ConsentInformation
import com.google.android.ump.ConsentRequestParameters
import com.google.android.ump.UserMessagingPlatform
import java.util.Locale
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.concurrent.thread
import kotlin.math.min

/**
 * Consent (UMP) + Google Mobile Ads: anchored adaptive banner, interstitial and rewarded ads.
 *
 * Threading: all SDK work happens on the main thread. The `is*Ready()` / `show*()` /
 * `isPrivacyOptionsRequired()` entry points may be called from any thread (the JS bridge thread)
 * and only read volatile/atomic state or post to the main thread. Nothing in here may crash
 * the app: every SDK call is guarded and failures just mean "no ad".
 */
class AdsManager(
    private val activity: Activity,
    private val bannerContainer: FrameLayout,
    private val callbacks: Callbacks,
) {

    /** All callbacks are delivered on the main thread. */
    interface Callbacks {
        fun onBannerVisibilityChanged(visible: Boolean)
        fun onFullscreenAdShowing(showing: Boolean)
        fun onInterstitialClosed()
        fun onRewardResult(placement: String, earned: Boolean)
        fun onAdsAvailabilityChanged(rewardedReady: Boolean, interstitialReady: Boolean)
    }

    private val handler = Handler(Looper.getMainLooper())
    private val consentInformation: ConsentInformation? = try {
        UserMessagingPlatform.getConsentInformation(activity)
    } catch (t: Throwable) {
        Log.e(TAG, "UMP unavailable", t)
        null
    }

    @Volatile
    private var destroyed = false
    private var sdkReady = false

    // Banner (main thread only)
    private var adView: AdView? = null
    private var bannerVisible = false
    private var bannerFailures = 0

    /** True while the player enjoys ad-free time earned with a rewarded ad. */
    private var bannerSuppressed = false

    // Interstitial
    @Volatile
    private var interstitialAd: InterstitialAd? = null
    private var interstitialLoading = false
    private var interstitialFailures = 0

    @Volatile
    private var lastInterstitialClosedAt = 0L

    // Rewarded
    @Volatile
    private var rewardedAd: RewardedAd? = null
    private var rewardedLoading = false
    private var rewardedFailures = 0

    /** True from the moment a show() is accepted until the ad is dismissed / fails to show. */
    private val fullscreenBusy = AtomicBoolean(false)

    @Volatile
    private var privacyOptionsRequired = false
    private var lastAvailability: Pair<Boolean, Boolean>? = null

    private val interstitialGapElapsedRunnable = Runnable { publishAvailability(force = false) }

    // -----------------------------------------------------------------------------------------
    // Startup: consent -> SDK init -> load ads
    // -----------------------------------------------------------------------------------------

    fun start() {
        val consent = consentInformation ?: return
        try {
            val params = ConsentRequestParameters.Builder().apply {
                buildConsentDebugSettings()?.let { setConsentDebugSettings(it) }
            }.build()
            consent.requestConsentInfoUpdate(
                activity,
                params,
                {
                    if (destroyed) return@requestConsentInfoUpdate
                    try {
                        UserMessagingPlatform.loadAndShowConsentFormIfRequired(activity) { formError ->
                            if (formError != null) {
                                Log.w(TAG, "Consent form error ${formError.errorCode}: ${formError.message}")
                            }
                            onConsentGathered()
                        }
                    } catch (t: Throwable) {
                        Log.e(TAG, "Consent form failed", t)
                        onConsentGathered()
                    }
                },
                { requestError ->
                    Log.w(TAG, "Consent info update failed ${requestError.errorCode}: ${requestError.message}")
                    onConsentGathered()
                },
            )
        } catch (t: Throwable) {
            Log.e(TAG, "Consent info update threw", t)
        }
        // Google's recommended pattern: if consent was already given in a previous session,
        // start the SDK immediately instead of waiting for the network round-trip.
        if (canRequestAds()) initializeMobileAdsSdk()
    }

    private fun onConsentGathered() {
        if (destroyed) return
        refreshPrivacyOptionsRequired()
        if (canRequestAds()) initializeMobileAdsSdk()
    }

    private fun canRequestAds(): Boolean = try {
        consentInformation?.canRequestAds() == true
    } catch (t: Throwable) {
        false
    }

    private fun testDeviceIds(): List<String> =
        BuildConfig.ADMOB_TEST_DEVICE_IDS.split(',').map { it.trim() }.filter { it.isNotEmpty() }

    private fun buildConsentDebugSettings(): ConsentDebugSettings? {
        // UMP_DEBUG_GEOGRAPHY is always empty in release builds (see app/build.gradle.kts).
        val geography = when (BuildConfig.UMP_DEBUG_GEOGRAPHY.trim().uppercase(Locale.ROOT)) {
            "EEA" -> ConsentDebugSettings.DebugGeography.DEBUG_GEOGRAPHY_EEA
            "REGULATED_US_STATE", "US" -> ConsentDebugSettings.DebugGeography.DEBUG_GEOGRAPHY_REGULATED_US_STATE
            "OTHER" -> ConsentDebugSettings.DebugGeography.DEBUG_GEOGRAPHY_OTHER
            else -> null
        }
        val testIds = testDeviceIds()
        if (geography == null && testIds.isEmpty()) return null
        return ConsentDebugSettings.Builder(activity).apply {
            if (geography != null) setDebugGeography(geography)
            testIds.forEach { addTestDeviceHashedId(it) }
        }.build()
    }

    private fun initializeMobileAdsSdk() {
        if (destroyed || sdkReady) return
        if (sdkInitComplete) {
            onSdkReady()
            return
        }
        if (!sdkInitStarted.compareAndSet(false, true)) {
            // A previous activity instance is still initialising the SDK; check back shortly.
            handler.postDelayed({ initializeMobileAdsSdk() }, INIT_POLL_MS)
            return
        }
        try {
            val testIds = testDeviceIds()
            if (testIds.isNotEmpty()) {
                MobileAds.setRequestConfiguration(
                    RequestConfiguration.Builder().setTestDeviceIds(testIds).build(),
                )
            }
        } catch (t: Throwable) {
            Log.w(TAG, "setRequestConfiguration failed", t)
        }
        val appContext = activity.applicationContext
        thread(name = "ZenAdsInit", isDaemon = true) {
            try {
                MobileAds.initialize(appContext) {
                    sdkInitComplete = true
                    handler.post { onSdkReady() }
                }
            } catch (t: Throwable) {
                Log.e(TAG, "MobileAds.initialize failed", t)
                sdkInitStarted.set(false)
            }
        }
    }

    private fun onSdkReady() {
        if (destroyed || sdkReady) return
        sdkReady = true
        loadBanner()
        loadInterstitial()
        loadRewarded()
    }

    // -----------------------------------------------------------------------------------------
    // Banner
    // -----------------------------------------------------------------------------------------

    private fun loadBanner() {
        if (destroyed || !sdkReady || bannerSuppressed) return
        val view = adView ?: createAdView() ?: return
        try {
            view.loadAd(AdRequest.Builder().build())
        } catch (t: Throwable) {
            Log.e(TAG, "Banner loadAd failed", t)
        }
    }

    private fun createAdView(): AdView? = try {
        AdView(activity).also { view ->
            view.adUnitId = BuildConfig.ADMOB_BANNER_ID
            view.setAdSize(bannerAdSize())
            view.adListener = object : AdListener() {
                override fun onAdLoaded() {
                    if (destroyed) return
                    bannerFailures = 0
                    setBannerVisible(true)
                }

                override fun onAdFailedToLoad(error: LoadAdError) {
                    if (destroyed) return
                    Log.w(TAG, "Banner failed to load: ${error.code} ${error.message}")
                    // Once a banner is showing, the SDK's own refresh cycle keeps it alive and
                    // keeps the previous creative on failure. Before that we retry ourselves.
                    if (!bannerVisible) scheduleRetry(bannerFailures++) { loadBanner() }
                }
            }
            bannerContainer.addView(
                view,
                FrameLayout.LayoutParams(
                    ViewGroup.LayoutParams.WRAP_CONTENT,
                    ViewGroup.LayoutParams.WRAP_CONTENT,
                    Gravity.CENTER,
                ),
            )
            adView = view
        }
    } catch (t: Throwable) {
        Log.e(TAG, "Could not create banner", t)
        null
    }

    // getCurrentOrientationAnchoredAdaptiveBannerAdSize is deprecated in GMA 25.x in favour of
    // the taller "large" anchored banner; the standard anchored size suits a game better.
    @Suppress("DEPRECATION")
    private fun bannerAdSize(): AdSize {
        val metrics = activity.resources.displayMetrics
        val widthPx = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            activity.windowManager.currentWindowMetrics.bounds.width()
        } else {
            metrics.widthPixels
        }
        val widthDp = (widthPx / metrics.density).toInt().coerceAtLeast(1)
        return AdSize.getCurrentOrientationAnchoredAdaptiveBannerAdSize(activity, widthDp)
    }

    private fun setBannerVisible(visible: Boolean) {
        if (bannerVisible == visible) return
        bannerVisible = visible
        applyBannerVisibility()
    }

    /**
     * Hides (and pauses) the banner during rewarded ad-free time. Main thread only. While
     * suppressed the banner neither shows nor refreshes; it comes back when the time is over.
     */
    fun setBannerSuppressed(suppressed: Boolean) {
        if (destroyed || bannerSuppressed == suppressed) return
        bannerSuppressed = suppressed
        try {
            if (suppressed) adView?.pause() else adView?.resume()
        } catch (t: Throwable) {
            Log.w(TAG, "AdView pause/resume failed", t)
        }
        applyBannerVisibility()
        if (!suppressed && !bannerVisible) loadBanner()
    }

    private fun applyBannerVisibility() {
        val show = bannerVisible && !bannerSuppressed
        if (bannerContainer.isVisible == show) return
        bannerContainer.isVisible = show
        callbacks.onBannerVisibilityChanged(show)
    }

    // -----------------------------------------------------------------------------------------
    // Interstitial
    // -----------------------------------------------------------------------------------------

    fun isInterstitialReady(): Boolean =
        !destroyed && !fullscreenBusy.get() && interstitialAd != null && interstitialGapElapsed()

    private fun interstitialGapElapsed(): Boolean = interstitialGapRemaining() <= 0L

    private fun interstitialGapRemaining(): Long {
        val last = lastInterstitialClosedAt
        if (last == 0L) return 0L
        return MIN_INTERSTITIAL_GAP_MS - (SystemClock.elapsedRealtime() - last)
    }

    /** Any thread. Returns true if the ad will be presented (JS then gets onInterstitialClosed). */
    fun showInterstitial(): Boolean {
        if (destroyed || interstitialAd == null || !interstitialGapElapsed()) return false
        if (!fullscreenBusy.compareAndSet(false, true)) return false
        handler.post { presentInterstitial() }
        return true
    }

    private fun loadInterstitial() {
        if (destroyed || !sdkReady || interstitialLoading || interstitialAd != null) return
        interstitialLoading = true
        try {
            InterstitialAd.load(
                activity,
                BuildConfig.ADMOB_INTERSTITIAL_ID,
                AdRequest.Builder().build(),
                object : InterstitialAdLoadCallback() {
                    override fun onAdLoaded(ad: InterstitialAd) {
                        interstitialLoading = false
                        if (destroyed) return
                        interstitialFailures = 0
                        interstitialAd = ad
                        scheduleExpiry { if (interstitialAd === ad) discardInterstitial() }
                        publishAvailability(force = false)
                    }

                    override fun onAdFailedToLoad(error: LoadAdError) {
                        interstitialLoading = false
                        if (destroyed) return
                        Log.w(TAG, "Interstitial failed to load: ${error.code} ${error.message}")
                        scheduleRetry(interstitialFailures++) { loadInterstitial() }
                    }
                },
            )
        } catch (t: Throwable) {
            interstitialLoading = false
            Log.e(TAG, "Interstitial load threw", t)
            scheduleRetry(interstitialFailures++) { loadInterstitial() }
        }
    }

    private fun discardInterstitial() {
        interstitialAd = null
        publishAvailability(force = false)
        loadInterstitial()
    }

    private fun presentInterstitial() {
        val ad = interstitialAd
        if (destroyed || ad == null || activity.isFinishing || activity.isDestroyed) {
            fullscreenBusy.set(false)
            callbacks.onInterstitialClosed()
            return
        }
        interstitialAd = null
        var finished = false
        fun finish(shown: Boolean) {
            if (finished) return
            finished = true
            if (shown) lastInterstitialClosedAt = SystemClock.elapsedRealtime()
            fullscreenBusy.set(false)
            callbacks.onFullscreenAdShowing(false)
            callbacks.onInterstitialClosed()
            if (!destroyed) {
                loadInterstitial()
                publishAvailability(force = false)
            }
        }
        ad.fullScreenContentCallback = object : FullScreenContentCallback() {
            override fun onAdDismissedFullScreenContent() = finish(shown = true)

            override fun onAdFailedToShowFullScreenContent(error: AdError) {
                Log.w(TAG, "Interstitial failed to show: ${error.code} ${error.message}")
                finish(shown = false)
            }
        }
        callbacks.onFullscreenAdShowing(true)
        publishAvailability(force = false)
        try {
            ad.show(activity)
        } catch (t: Throwable) {
            Log.e(TAG, "Interstitial show threw", t)
            finish(shown = false)
        }
    }

    // -----------------------------------------------------------------------------------------
    // Rewarded
    // -----------------------------------------------------------------------------------------

    fun isRewardedReady(): Boolean = !destroyed && !fullscreenBusy.get() && rewardedAd != null

    /** Any thread. Returns true if the ad will be presented (JS then gets onRewardResult). */
    fun showRewarded(placement: String): Boolean {
        if (destroyed || rewardedAd == null) return false
        if (!fullscreenBusy.compareAndSet(false, true)) return false
        handler.post { presentRewarded(placement) }
        return true
    }

    private fun loadRewarded() {
        if (destroyed || !sdkReady || rewardedLoading || rewardedAd != null) return
        rewardedLoading = true
        try {
            RewardedAd.load(
                activity,
                BuildConfig.ADMOB_REWARDED_ID,
                AdRequest.Builder().build(),
                object : RewardedAdLoadCallback() {
                    override fun onAdLoaded(ad: RewardedAd) {
                        rewardedLoading = false
                        if (destroyed) return
                        rewardedFailures = 0
                        rewardedAd = ad
                        scheduleExpiry { if (rewardedAd === ad) discardRewarded() }
                        publishAvailability(force = false)
                    }

                    override fun onAdFailedToLoad(error: LoadAdError) {
                        rewardedLoading = false
                        if (destroyed) return
                        Log.w(TAG, "Rewarded failed to load: ${error.code} ${error.message}")
                        scheduleRetry(rewardedFailures++) { loadRewarded() }
                    }
                },
            )
        } catch (t: Throwable) {
            rewardedLoading = false
            Log.e(TAG, "Rewarded load threw", t)
            scheduleRetry(rewardedFailures++) { loadRewarded() }
        }
    }

    private fun discardRewarded() {
        rewardedAd = null
        publishAvailability(force = false)
        loadRewarded()
    }

    private fun presentRewarded(placement: String) {
        val ad = rewardedAd
        if (destroyed || ad == null || activity.isFinishing || activity.isDestroyed) {
            fullscreenBusy.set(false)
            callbacks.onRewardResult(placement, false)
            return
        }
        rewardedAd = null
        var earned = false
        var finished = false
        fun report() {
            fullscreenBusy.set(false)
            callbacks.onFullscreenAdShowing(false)
            callbacks.onRewardResult(placement, earned)
            if (!destroyed) {
                loadRewarded()
                publishAvailability(force = false)
            }
        }
        fun finish() {
            if (finished) return
            finished = true
            // Some adapters deliver onUserEarnedReward just after dismissal; give it a moment.
            if (earned) report() else handler.postDelayed({ report() }, LATE_REWARD_GRACE_MS)
        }
        ad.fullScreenContentCallback = object : FullScreenContentCallback() {
            override fun onAdDismissedFullScreenContent() = finish()

            override fun onAdFailedToShowFullScreenContent(error: AdError) {
                Log.w(TAG, "Rewarded failed to show: ${error.code} ${error.message}")
                finish()
            }
        }
        callbacks.onFullscreenAdShowing(true)
        publishAvailability(force = false)
        try {
            ad.show(activity) { earned = true }
        } catch (t: Throwable) {
            Log.e(TAG, "Rewarded show threw", t)
            finish()
        }
    }

    // -----------------------------------------------------------------------------------------
    // Availability, privacy options, scheduling
    // -----------------------------------------------------------------------------------------

    /** Main thread. Sends `onAdsAvailability(rewardedReady, interstitialReady)` when it changed. */
    fun publishAvailability(force: Boolean) {
        if (destroyed) return
        handler.removeCallbacks(interstitialGapElapsedRunnable)
        val remaining = interstitialGapRemaining()
        if (interstitialAd != null && remaining > 0L) {
            handler.postDelayed(interstitialGapElapsedRunnable, remaining + 50L)
        }
        val state = isRewardedReady() to isInterstitialReady()
        if (!force && state == lastAvailability) return
        lastAvailability = state
        callbacks.onAdsAvailabilityChanged(state.first, state.second)
    }

    fun isPrivacyOptionsRequired(): Boolean = privacyOptionsRequired

    private fun refreshPrivacyOptionsRequired() {
        privacyOptionsRequired = try {
            consentInformation?.privacyOptionsRequirementStatus ==
                ConsentInformation.PrivacyOptionsRequirementStatus.REQUIRED
        } catch (t: Throwable) {
            false
        }
    }

    /** Any thread. Shows the UMP privacy options form (no-op when not available). */
    fun showPrivacyOptions() {
        handler.post {
            if (destroyed || activity.isFinishing) return@post
            try {
                UserMessagingPlatform.showPrivacyOptionsForm(activity) { formError ->
                    if (formError != null) {
                        Log.w(TAG, "Privacy options form error ${formError.errorCode}: ${formError.message}")
                    }
                    onConsentGathered()
                }
            } catch (t: Throwable) {
                Log.e(TAG, "Privacy options form failed", t)
            }
        }
    }

    private fun scheduleRetry(failures: Int, action: () -> Unit) {
        val delay = RETRY_DELAYS_MS[min(failures, RETRY_DELAYS_MS.lastIndex)]
        handler.postDelayed({ if (!destroyed) action() }, delay)
    }

    private fun scheduleExpiry(action: () -> Unit) {
        handler.postDelayed({ if (!destroyed) action() }, AD_EXPIRY_MS)
    }

    // -----------------------------------------------------------------------------------------
    // Lifecycle (main thread)
    // -----------------------------------------------------------------------------------------

    fun pause() {
        try {
            adView?.pause()
        } catch (t: Throwable) {
            Log.w(TAG, "AdView.pause failed", t)
        }
    }

    fun resume() {
        if (bannerSuppressed) return
        try {
            adView?.resume()
        } catch (t: Throwable) {
            Log.w(TAG, "AdView.resume failed", t)
        }
    }

    fun destroy() {
        destroyed = true
        handler.removeCallbacksAndMessages(null)
        adView?.let { view ->
            try {
                bannerContainer.removeView(view)
                view.destroy()
            } catch (t: Throwable) {
                Log.w(TAG, "AdView.destroy failed", t)
            }
        }
        adView = null
        interstitialAd?.fullScreenContentCallback = null
        interstitialAd = null
        rewardedAd?.fullScreenContentCallback = null
        rewardedAd = null
    }

    private companion object {
        const val TAG = "ZenAds"
        const val MIN_INTERSTITIAL_GAP_MS = 45_000L
        const val LATE_REWARD_GRACE_MS = 300L
        const val INIT_POLL_MS = 250L

        /** Loaded full-screen ads expire after one hour; refresh them a little earlier. */
        const val AD_EXPIRY_MS = 55L * 60L * 1000L
        val RETRY_DELAYS_MS = longArrayOf(5_000L, 15_000L, 60_000L)

        /** Process-wide so a recreated activity never initialises the SDK twice. */
        val sdkInitStarted = AtomicBoolean(false)

        @Volatile
        var sdkInitComplete = false
    }
}
