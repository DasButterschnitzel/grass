package com.butterschnitzel.zenmower

import android.os.Build
import android.webkit.JavascriptInterface
import org.json.JSONObject

/**
 * JavaScript interface exposed to the game as `window.AndroidBridge`.
 *
 * Every method is invoked on WebView's private "JavaBridge" thread, never on the main thread.
 * State queries read thread-safe snapshots; anything touching views/activities is posted to the
 * main thread. String parameters are nullable because JS may pass `undefined`/`null`.
 */
class GameBridge internal constructor(activity: MainActivity) {

    @Volatile
    private var activity: MainActivity? = activity
    private val haptics = Haptics(activity.applicationContext)

    /** Called when the WebView is torn down; afterwards every call is a harmless no-op. */
    internal fun detach() {
        activity = null
    }

    private inline fun onMain(crossinline block: (MainActivity) -> Unit) {
        val host = activity ?: return
        host.runOnUiThread {
            val current = activity
            if (current != null && !current.isFinishing && !current.isDestroyed) block(current)
        }
    }

    // -- Haptics ---------------------------------------------------------------------------

    /** kind: "tick" | "light" | "medium" | "heavy" | "success". Unknown kinds are ignored. */
    @JavascriptInterface
    fun haptic(kind: String?) {
        if (activity == null || kind == null) return
        haptics.perform(kind)
    }

    // -- Ads -------------------------------------------------------------------------------

    @JavascriptInterface
    fun isInterstitialReady(): Boolean = activity?.adsManager?.isInterstitialReady() ?: false

    /** Returns true if an interstitial will be shown; JS then receives `onInterstitialClosed()`. */
    @JavascriptInterface
    fun showInterstitial(): Boolean = activity?.adsManager?.showInterstitial() ?: false

    @JavascriptInterface
    fun isRewardedReady(): Boolean = activity?.adsManager?.isRewardedReady() ?: false

    /** Returns true if a rewarded ad will be shown; JS then receives `onRewardResult(placement, earned)`. */
    @JavascriptInterface
    fun showRewarded(placement: String?): Boolean =
        activity?.adsManager?.showRewarded(placement.orEmpty().take(MAX_PLACEMENT_LENGTH)) ?: false

    // -- Privacy (UMP) ---------------------------------------------------------------------

    @JavascriptInterface
    fun isPrivacyOptionsRequired(): Boolean = activity?.adsManager?.isPrivacyOptionsRequired() ?: false

    @JavascriptInterface
    fun showPrivacyOptions() {
        activity?.adsManager?.showPrivacyOptions()
    }

    // -- App / platform info ---------------------------------------------------------------

    @JavascriptInterface
    fun getAppVersion(): String = BuildConfig.VERSION_NAME

    @JavascriptInterface
    fun getPlatformInfo(): String = JSONObject().apply {
        put("platform", "android")
        put("sdkInt", Build.VERSION.SDK_INT)
        put("release", Build.VERSION.RELEASE ?: "")
        put("manufacturer", Build.MANUFACTURER ?: "")
        put("model", Build.MODEL ?: "")
        put("debug", BuildConfig.DEBUG)
        put("appVersion", BuildConfig.VERSION_NAME)
        put("versionCode", BuildConfig.VERSION_CODE)
    }.toString()

    // -- Intents ---------------------------------------------------------------------------

    @JavascriptInterface
    fun openStoreListing() {
        onMain { it.openStoreListing() }
    }

    @JavascriptInterface
    fun share(text: String?) {
        val payload = text?.take(MAX_SHARE_LENGTH)?.takeIf { it.isNotBlank() } ?: return
        onMain { it.share(payload) }
    }

    // -- Layout ----------------------------------------------------------------------------

    /** Re-sends the current safe-area insets via `ZenNative.onInsets(top, right, bottom, left)`. */
    @JavascriptInterface
    fun requestInsets() {
        onMain { it.applyInsets(force = true) }
    }

    private companion object {
        const val MAX_PLACEMENT_LENGTH = 64
        const val MAX_SHARE_LENGTH = 4_000
    }
}
