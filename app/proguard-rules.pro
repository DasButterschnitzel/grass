# Zen Mower R8 / ProGuard rules.
# Library rules (Google Mobile Ads, UMP, AndroidX) are shipped as consumer rules by the libraries.

# The JavaScript bridge is invoked reflectively by WebView: keep the class and every
# @JavascriptInterface method with its original name and signature.
-keep class com.butterschnitzel.zenmower.GameBridge { *; }
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

# Keep line numbers for readable crash reports; hide the original source file name.
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile
