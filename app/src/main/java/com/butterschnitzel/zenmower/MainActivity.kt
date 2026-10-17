package com.butterschnitzel.zenmower

import android.annotation.SuppressLint
import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.graphics.Color
import android.media.AudioManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.util.Log
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.webkit.ConsoleMessage
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import android.window.OnBackInvokedCallback
import android.window.OnBackInvokedDispatcher
import androidx.annotation.RequiresApi
import androidx.core.graphics.Insets
import androidx.core.net.toUri
import androidx.core.view.ViewCompat
import androidx.core.view.isVisible
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.webkit.WebSettingsCompat
import androidx.webkit.WebViewAssetLoader
import androidx.webkit.WebViewFeature
import java.util.Locale

/**
 * Single-activity native shell around the HTML5 game in `assets/www/`.
 *
 * Native -> JS calls go to `window.ZenNative.*` (always guarded, so a missing handler is a no-op);
 * JS -> native calls go through [GameBridge], exposed as `window.AndroidBridge`.
 */
class MainActivity : Activity() {

    private val mainHandler = Handler(Looper.getMainLooper())

    private lateinit var root: LinearLayout
    private lateinit var bannerContainer: FrameLayout
    private var webView: WebView? = null
    private var gameBridge: GameBridge? = null
    private var assetLoader: WebViewAssetLoader? = null

    /** Ads layer; read from the JavaBridge thread, hence volatile. */
    @Volatile
    internal var adsManager: AdsManager? = null
        private set

    private var windowInsets: WindowInsetsCompat? = null
    private var lastSentInsets: String? = null
    private var pageLoaded = false
    private var backCallback: Any? = null
    private var backRequestToken = 0

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        volumeControlStream = AudioManager.STREAM_MUSIC
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        configureWindow()

        val wv = createWebView()
        if (wv == null) {
            showWebViewUnavailable()
            return
        }
        webView = wv

        bannerContainer = FrameLayout(this).apply {
            setBackgroundColor(BACKGROUND_COLOR)
            visibility = View.GONE
        }
        root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(BACKGROUND_COLOR)
            addView(wv, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
            addView(
                bannerContainer,
                LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT),
            )
        }
        setContentView(root)

        ViewCompat.setOnApplyWindowInsetsListener(root) { _, insets ->
            windowInsets = insets
            applyInsets(force = false)
            WindowInsetsCompat.CONSUMED
        }

        registerBackHandler()
        applyImmersiveMode()

        wv.loadUrl(START_URL)
        adsManager = AdsManager(this, bannerContainer, adsCallbacks).also { it.start() }
    }

    // ---------------------------------------------------------------------------------------
    // Window / immersive mode / insets
    // ---------------------------------------------------------------------------------------

    private fun configureWindow() {
        WindowCompat.setDecorFitsSystemWindows(window, false)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            window.attributes = window.attributes.apply {
                layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
            }
        }
        WindowCompat.getInsetsController(window, window.decorView).apply {
            isAppearanceLightStatusBars = false
            isAppearanceLightNavigationBars = false
        }
    }

    private fun applyImmersiveMode() {
        WindowCompat.getInsetsController(window, window.decorView).apply {
            systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            hide(WindowInsetsCompat.Type.systemBars())
        }
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) applyImmersiveMode()
    }

    /**
     * Safe insets = display cutout + any *visible* system bars. When the banner is visible it
     * sits at the bottom and absorbs the bottom inset as padding; otherwise the bottom inset is
     * passed to JS. Values are sent in CSS px (physical px / density).
     */
    internal fun applyInsets(force: Boolean) {
        if (webView == null) return
        val safe = windowInsets?.getInsets(
            WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout(),
        ) ?: Insets.NONE

        val bannerVisible = bannerContainer.isVisible
        val bannerBottom = if (bannerVisible) safe.bottom else 0
        if (bannerContainer.paddingLeft != safe.left || bannerContainer.paddingRight != safe.right ||
            bannerContainer.paddingBottom != bannerBottom || bannerContainer.paddingTop != 0
        ) {
            bannerContainer.setPadding(safe.left, 0, safe.right, bannerBottom)
        }

        val density = resources.displayMetrics.density
        val top = toCssPx(safe.top, density)
        val right = toCssPx(safe.right, density)
        val bottom = if (bannerVisible) 0.0 else toCssPx(safe.bottom, density)
        val left = toCssPx(safe.left, density)
        val key = "$top,$right,$bottom,$left"
        if (!force && key == lastSentInsets) return
        lastSentInsets = key
        callJs("onInsets", top, right, bottom, left)
    }

    private fun toCssPx(px: Int, density: Float): Double =
        if (density > 0f) Math.round(px / density * 100.0) / 100.0 else px.toDouble()

    // ---------------------------------------------------------------------------------------
    // WebView
    // ---------------------------------------------------------------------------------------

    @SuppressLint("SetJavaScriptEnabled", "JavascriptInterface")
    private fun createWebView(): WebView? {
        val wv = try {
            WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)
            WebView(this)
        } catch (t: Throwable) {
            // Missing / updating WebView provider (MissingWebViewPackageException etc.).
            Log.e(TAG, "WebView is unavailable", t)
            return null
        }

        assetLoader = WebViewAssetLoader.Builder()
            .setDomain(ASSET_HOST)
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()

        wv.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            mediaPlaybackRequiresUserGesture = false
            allowFileAccess = false
            allowContentAccess = false
            setSupportZoom(false)
            builtInZoomControls = false
            displayZoomControls = false
            textZoom = 100
            setSupportMultipleWindows(false)
            javaScriptCanOpenWindowsAutomatically = false
            setGeolocationEnabled(false)
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
        }
        // The app theme is dark; never let WebView auto-darken the game's own colours.
        if (WebViewFeature.isFeatureSupported(WebViewFeature.ALGORITHMIC_DARKENING)) {
            WebSettingsCompat.setAlgorithmicDarkeningAllowed(wv.settings, false)
        }

        wv.setBackgroundColor(BACKGROUND_COLOR)
        wv.overScrollMode = View.OVER_SCROLL_NEVER
        wv.isVerticalScrollBarEnabled = false
        wv.isHorizontalScrollBarEnabled = false
        wv.isLongClickable = false
        wv.isHapticFeedbackEnabled = false
        wv.setOnLongClickListener { true }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            wv.importantForAutofill = View.IMPORTANT_FOR_AUTOFILL_NO_EXCLUDE_DESCENDANTS
        }

        wv.webViewClient = GameWebViewClient()
        wv.webChromeClient = GameChromeClient()

        val bridge = GameBridge(this)
        gameBridge = bridge
        wv.addJavascriptInterface(bridge, BRIDGE_NAME)
        return wv
    }

    // MissingOnRenderProcessGone is a false positive: the androidx.webkit detector flags the Kotlin
    // supertype constructor call, but onRenderProcessGone is implemented below.
    @SuppressLint("MissingOnRenderProcessGone")
    private inner class GameWebViewClient : WebViewClient() {

        override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
            assetLoader?.shouldInterceptRequest(request.url)

        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
            val uri = request.url
            if (uri.scheme.equals("https", ignoreCase = true) && uri.host.equals(ASSET_HOST, ignoreCase = true)) {
                return false
            }
            openExternally(uri)
            return true
        }

        override fun onPageStarted(view: WebView, url: String?, favicon: android.graphics.Bitmap?) {
            pageLoaded = false
        }

        override fun onPageFinished(view: WebView, url: String?) {
            if (view !== webView) return
            pageLoaded = true
            applyInsets(force = true)
            adsManager?.publishAvailability(force = true)
        }

        // Only ever invoked on API 26+, where RenderProcessGoneDetail exists.
        @RequiresApi(Build.VERSION_CODES.O)
        override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
            Log.e(TAG, "WebView render process gone (didCrash=${detail.didCrash()})")
            if (view !== webView) {
                destroyWebView(view)
                return true
            }
            destroyWebView(view)
            webView = null
            val now = SystemClock.elapsedRealtime()
            val crashLoop = now - lastRenderCrashAt < RENDER_CRASH_LOOP_WINDOW_MS
            lastRenderCrashAt = now
            if (!isFinishing && !isDestroyed) {
                if (crashLoop) finish() else recreate()
            }
            return true
        }
    }

    private class GameChromeClient : WebChromeClient() {
        override fun onConsoleMessage(consoleMessage: ConsoleMessage): Boolean {
            if (BuildConfig.DEBUG) {
                val priority = when (consoleMessage.messageLevel()) {
                    ConsoleMessage.MessageLevel.ERROR -> Log.ERROR
                    ConsoleMessage.MessageLevel.WARNING -> Log.WARN
                    ConsoleMessage.MessageLevel.DEBUG -> Log.DEBUG
                    else -> Log.INFO
                }
                Log.println(
                    priority,
                    WEB_TAG,
                    "${consoleMessage.message()} [${consoleMessage.sourceId()}:${consoleMessage.lineNumber()}]",
                )
            }
            // Returning true suppresses WebView's own console logging (keeps release logcat clean).
            return true
        }
    }

    private fun destroyWebView(view: WebView) {
        try {
            view.removeJavascriptInterface(BRIDGE_NAME)
            view.stopLoading()
            (view.parent as? ViewGroup)?.removeView(view)
            view.destroy()
        } catch (t: Throwable) {
            Log.w(TAG, "Error while destroying WebView", t)
        }
    }

    // ---------------------------------------------------------------------------------------
    // Native -> JS
    // ---------------------------------------------------------------------------------------

    /**
     * Calls `ZenNative.<function>(args)` if (and only if) the game has defined it.
     * Safe to call from any thread.
     */
    internal fun callJs(function: String, vararg args: Any?) {
        val argList = args.joinToString(",") { jsLiteral(it) }
        val script = "(function(){try{if(typeof ZenNative!=='undefined'&&ZenNative&&" +
            "typeof ZenNative.$function==='function'){ZenNative.$function($argList);}}" +
            "catch(e){console.error('ZenNative.$function failed',e);}})();"
        runOnMain { webView?.evaluateJavascript(script, null) }
    }

    private fun runOnMain(block: () -> Unit) {
        if (Looper.myLooper() == Looper.getMainLooper()) {
            block()
        } else {
            mainHandler.post { if (!isDestroyed) block() }
        }
    }

    private val adsCallbacks = object : AdsManager.Callbacks {
        override fun onBannerVisibilityChanged(visible: Boolean) = applyInsets(force = true)
        override fun onFullscreenAdShowing(showing: Boolean) = callJs("onAdShowing", showing)
        override fun onInterstitialClosed() = callJs("onInterstitialClosed")
        override fun onRewardResult(placement: String, earned: Boolean) = callJs("onRewardResult", placement, earned)
        override fun onAdsAvailabilityChanged(rewardedReady: Boolean, interstitialReady: Boolean) =
            callJs("onAdsAvailability", rewardedReady, interstitialReady)
    }

    // ---------------------------------------------------------------------------------------
    // Back navigation (predictive back on API 33+, onBackPressed below)
    // ---------------------------------------------------------------------------------------

    private fun registerBackHandler() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            backCallback = BackApi33.register(this) { handleBack() }
        }
    }

    // Fallback for API 24-32 only. On API 33+ the OnBackInvokedCallback registered above handles
    // back (android:enableOnBackInvokedCallback="true"), so this is never relied upon there.
    @SuppressLint("GestureBackNavigation")
    @Deprecated("Only reached below API 33; newer versions use OnBackInvokedCallback.")
    override fun onBackPressed() {
        handleBack()
    }

    /** Lets the game close an open dialog first; otherwise sends the app to the background. */
    private fun handleBack() {
        val wv = webView
        if (wv == null || !pageLoaded) {
            moveTaskToBack(true)
            return
        }
        val token = ++backRequestToken
        val timeout = Runnable {
            if (backRequestToken == token) {
                backRequestToken++
                moveTaskToBack(true)
            }
        }
        mainHandler.postDelayed(timeout, BACK_TIMEOUT_MS)
        wv.evaluateJavascript(BACK_SCRIPT) { result ->
            mainHandler.removeCallbacks(timeout)
            if (backRequestToken != token) return@evaluateJavascript
            if (result != "\"1\"" && result != "1") moveTaskToBack(true)
        }
    }

    @RequiresApi(Build.VERSION_CODES.TIRAMISU)
    private object BackApi33 {
        fun register(activity: Activity, onBack: () -> Unit): Any {
            val callback = OnBackInvokedCallback { onBack() }
            activity.onBackInvokedDispatcher.registerOnBackInvokedCallback(
                OnBackInvokedDispatcher.PRIORITY_DEFAULT,
                callback,
            )
            return callback
        }

        fun unregister(activity: Activity, callback: Any) {
            activity.onBackInvokedDispatcher.unregisterOnBackInvokedCallback(callback as OnBackInvokedCallback)
        }
    }

    // ---------------------------------------------------------------------------------------
    // Lifecycle
    // ---------------------------------------------------------------------------------------

    override fun onResume() {
        super.onResume()
        applyImmersiveMode()
        webView?.onResume()
        callJs("onResume")
        adsManager?.resume()
    }

    override fun onPause() {
        callJs("onPause")
        webView?.onPause()
        adsManager?.pause()
        super.onPause()
    }

    override fun onDestroy() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            backCallback?.let { BackApi33.unregister(this, it) }
        }
        backCallback = null
        mainHandler.removeCallbacksAndMessages(null)
        adsManager?.destroy()
        adsManager = null
        gameBridge?.detach()
        gameBridge = null
        webView?.let { destroyWebView(it) }
        webView = null
        super.onDestroy()
    }

    // ---------------------------------------------------------------------------------------
    // Helpers used by GameBridge (main thread)
    // ---------------------------------------------------------------------------------------

    internal fun setKeepScreenOn(on: Boolean) {
        if (on) {
            window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        } else {
            window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        }
    }

    internal fun openExternally(uri: Uri) {
        val scheme = uri.scheme?.lowercase(Locale.ROOT)
        if (scheme !in EXTERNAL_SCHEMES) {
            Log.w(TAG, "Blocked navigation to unsupported scheme: $scheme")
            return
        }
        try {
            startActivity(Intent(Intent.ACTION_VIEW, uri))
        } catch (e: ActivityNotFoundException) {
            Log.w(TAG, "No activity to open $uri", e)
        }
    }

    internal fun openStoreListing() {
        val market = Intent(Intent.ACTION_VIEW, "market://details?id=$packageName".toUri())
            .setPackage(PLAY_STORE_PACKAGE)
        try {
            startActivity(market)
        } catch (e: ActivityNotFoundException) {
            openExternally("https://play.google.com/store/apps/details?id=$packageName".toUri())
        }
    }

    internal fun share(text: String) {
        val send = Intent(Intent.ACTION_SEND)
            .setType("text/plain")
            .putExtra(Intent.EXTRA_TEXT, text)
        try {
            startActivity(Intent.createChooser(send, getString(R.string.share_title)))
        } catch (e: ActivityNotFoundException) {
            Log.w(TAG, "No share target available", e)
        }
    }

    private fun showWebViewUnavailable() {
        val pad = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, 32f, resources.displayMetrics).toInt()
        val message = TextView(this).apply {
            setText(R.string.webview_unavailable)
            setTextColor(Color.WHITE)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 18f)
            gravity = Gravity.CENTER
            setPadding(pad, pad, pad, pad)
            setOnClickListener {
                val intent = Intent(Intent.ACTION_VIEW, "market://details?id=$WEBVIEW_PACKAGE".toUri())
                try {
                    startActivity(intent)
                } catch (e: ActivityNotFoundException) {
                    openExternally("https://play.google.com/store/apps/details?id=$WEBVIEW_PACKAGE".toUri())
                }
            }
        }
        setContentView(
            FrameLayout(this).apply {
                setBackgroundColor(BACKGROUND_COLOR)
                addView(
                    message,
                    FrameLayout.LayoutParams(
                        ViewGroup.LayoutParams.MATCH_PARENT,
                        ViewGroup.LayoutParams.WRAP_CONTENT,
                        Gravity.CENTER,
                    ),
                )
            },
        )
    }

    companion object {
        private const val TAG = "ZenMower"
        private const val WEB_TAG = "ZenMowerWeb"
        private const val BRIDGE_NAME = "AndroidBridge"
        private const val ASSET_HOST = WebViewAssetLoader.DEFAULT_DOMAIN // appassets.androidplatform.net
        private const val START_URL = "https://$ASSET_HOST/assets/www/index.html"
        private const val PLAY_STORE_PACKAGE = "com.android.vending"
        private const val WEBVIEW_PACKAGE = "com.google.android.webview"
        private const val BACK_TIMEOUT_MS = 1_000L
        private const val RENDER_CRASH_LOOP_WINDOW_MS = 10_000L
        private val EXTERNAL_SCHEMES = setOf("http", "https", "mailto", "market")
        internal const val BACKGROUND_COLOR = 0xFF0E2A1B.toInt()

        private const val BACK_SCRIPT =
            "(function(){try{return (typeof ZenNative!=='undefined'&&ZenNative&&" +
                "typeof ZenNative.onBack==='function'&&ZenNative.onBack())?'1':'0';}catch(e){return '0';}})()"

        /** Process-wide: used to detect a WebView renderer crash loop across activity recreation. */
        private var lastRenderCrashAt = 0L

        /** Converts a Kotlin value into a JavaScript literal. Strings are fully escaped. */
        internal fun jsLiteral(value: Any?): String = when (value) {
            null -> "null"
            is Boolean -> value.toString()
            is Int, is Long, is Short, is Byte -> value.toString()
            is Float -> if (value.isFinite()) value.toString() else "0"
            is Double -> if (value.isFinite()) value.toString() else "0"
            else -> jsString(value.toString())
        }

        internal fun jsString(value: String): String {
            val sb = StringBuilder(value.length + 2).append('\'')
            for (ch in value) {
                when {
                    ch == '\'' -> sb.append("\\'")
                    ch == '\\' -> sb.append("\\\\")
                    ch == '\n' -> sb.append("\\n")
                    ch == '\r' -> sb.append("\\r")
                    ch.code < 0x20 || ch.code > 0x7E || ch == '<' || ch == '>' ->
                        sb.append(String.format(Locale.ROOT, "\\u%04x", ch.code))
                    else -> sb.append(ch)
                }
            }
            return sb.append('\'').toString()
        }
    }
}
