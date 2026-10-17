import java.util.Properties
import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
}

// ---------------------------------------------------------------------------------------------
// Helpers: optional, gitignored property files in the project root.
// ---------------------------------------------------------------------------------------------
fun loadRootProperties(fileName: String): Properties = Properties().apply {
    val f = rootProject.file(fileName)
    if (f.isFile) f.inputStream().use { load(it) }
}

fun String?.nonBlank(): String? = this?.trim()?.takeIf { it.isNotEmpty() }

fun escapeForBuildConfig(value: String): String =
    "\"" + value.replace("\\", "\\\\").replace("\"", "\\\"") + "\""

// ---------------------------------------------------------------------------------------------
// AdMob ids: Gradle property (-P / gradle.properties) > environment variable > admob.properties.
// Defaults are Google's official TEST ids so the project builds and runs out of the box.
// ---------------------------------------------------------------------------------------------
val admobProperties = loadRootProperties("admob.properties")

fun admobSetting(key: String, default: String): String =
    (findProperty(key) as String?).nonBlank()
        ?: System.getenv(key).nonBlank()
        ?: admobProperties.getProperty(key).nonBlank()
        ?: default

val testAdmobAppId = "ca-app-pub-3940256099942544~3347511713"
val testBannerId = "ca-app-pub-3940256099942544/9214589741"
val testInterstitialId = "ca-app-pub-3940256099942544/1033173712"
val testRewardedId = "ca-app-pub-3940256099942544/5224354917"

val admobAppId = admobSetting("ADMOB_APP_ID", testAdmobAppId)
val admobBannerId = admobSetting("ADMOB_BANNER_ID", testBannerId)
val admobInterstitialId = admobSetting("ADMOB_INTERSTITIAL_ID", testInterstitialId)
val admobRewardedId = admobSetting("ADMOB_REWARDED_ID", testRewardedId)
val admobTestDeviceIds = admobSetting("ADMOB_TEST_DEVICE_IDS", "")
val umpDebugGeography = admobSetting("UMP_DEBUG_GEOGRAPHY", "")

val usesTestAdIds = listOf(admobAppId, admobBannerId, admobInterstitialId, admobRewardedId)
    .any { it.startsWith("ca-app-pub-3940256099942544") }

// ---------------------------------------------------------------------------------------------
// Release signing: keystore.properties (storeFile, storePassword, keyAlias, keyPassword)
// or env vars ZEN_KEYSTORE_FILE / ZEN_KEYSTORE_PASSWORD / ZEN_KEY_ALIAS / ZEN_KEY_PASSWORD.
// Falls back to the debug keystore (with a warning) so CI always produces an installable APK.
// ---------------------------------------------------------------------------------------------
val keystoreProperties = loadRootProperties("keystore.properties")

fun signingSetting(propKey: String, envKey: String): String? =
    keystoreProperties.getProperty(propKey).nonBlank() ?: System.getenv(envKey).nonBlank()

val releaseStoreFile = signingSetting("storeFile", "ZEN_KEYSTORE_FILE")?.let { rootProject.file(it) }
val releaseStorePassword = signingSetting("storePassword", "ZEN_KEYSTORE_PASSWORD")
val releaseKeyAlias = signingSetting("keyAlias", "ZEN_KEY_ALIAS")
val releaseKeyPassword = signingSetting("keyPassword", "ZEN_KEY_PASSWORD")
val hasReleaseSigning = releaseStoreFile?.isFile == true &&
    releaseStorePassword != null && releaseKeyAlias != null && releaseKeyPassword != null

android {
    namespace = "com.butterschnitzel.zenmower"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.butterschnitzel.zenmower"
        minSdk = 24
        targetSdk = 36
        versionCode = 3
        versionName = "1.2.0"

        manifestPlaceholders["admobAppId"] = admobAppId

        buildConfigField("String", "ADMOB_BANNER_ID", escapeForBuildConfig(admobBannerId))
        buildConfigField("String", "ADMOB_INTERSTITIAL_ID", escapeForBuildConfig(admobInterstitialId))
        buildConfigField("String", "ADMOB_REWARDED_ID", escapeForBuildConfig(admobRewardedId))
        buildConfigField("String", "ADMOB_TEST_DEVICE_IDS", escapeForBuildConfig(admobTestDeviceIds))
        // UMP debug geography is only honoured in debug builds (see buildTypes.debug).
        buildConfigField("String", "UMP_DEBUG_GEOGRAPHY", "\"\"")
    }

    signingConfigs {
        if (hasReleaseSigning) {
            create("release") {
                storeFile = releaseStoreFile
                storePassword = releaseStorePassword
                keyAlias = releaseKeyAlias
                keyPassword = releaseKeyPassword
                enableV1Signing = true
                enableV2Signing = true
            }
        }
    }

    buildTypes {
        debug {
            buildConfigField("String", "UMP_DEBUG_GEOGRAPHY", escapeForBuildConfig(umpDebugGeography))
        }
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro",
            )
            signingConfig = if (hasReleaseSigning) {
                signingConfigs.getByName("release")
            } else {
                signingConfigs.getByName("debug")
            }
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    buildFeatures {
        buildConfig = true
    }

    bundle {
        language {
            // The game ships its own localisation inside the web bundle.
            enableSplit = false
        }
    }

    packaging {
        resources {
            excludes += setOf("/META-INF/{AL2.0,LGPL2.1}", "/META-INF/*.kotlin_module")
        }
    }

    lint {
        abortOnError = true
        checkReleaseBuilds = true
        warningsAsErrors = false
        // Version-freshness checks depend on the day the build runs (new releases appear
        // constantly) and would make CI non-reproducible; versions are pinned on purpose.
        disable += setOf(
            "GradleDependency",
            "NewerVersionAvailable",
            "AndroidGradlePluginVersion",
        )
    }
}

kotlin {
    compilerOptions {
        jvmTarget.set(JvmTarget.JVM_17)
    }
}

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.webkit)
    implementation(libs.play.services.ads)
    implementation(libs.user.messaging.platform)
}

// Loud warnings when producing a release build that is not store-ready.
val releaseWarnings = buildList {
    if (usesTestAdIds) {
        add("Zen Mower: release build uses Google's TEST AdMob ids. Set ADMOB_APP_ID, ADMOB_BANNER_ID, " +
            "ADMOB_INTERSTITIAL_ID and ADMOB_REWARDED_ID (Gradle property, env var or admob.properties).")
    }
    if (!hasReleaseSigning) {
        add("Zen Mower: no release keystore configured (keystore.properties or ZEN_KEYSTORE_* env vars); " +
            "release build is signed with the DEBUG key and cannot be uploaded to Google Play.")
    }
}
tasks.matching { it.name == "preReleaseBuild" }.configureEach {
    val messages = releaseWarnings
    doFirst { messages.forEach { logger.warn("WARNING: $it") } }
}
