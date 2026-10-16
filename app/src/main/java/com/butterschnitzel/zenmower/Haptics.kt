package com.butterschnitzel.zenmower

import android.annotation.SuppressLint
import android.content.Context
import android.os.Build
import android.os.SystemClock
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.util.Log
import androidx.annotation.RequiresApi

/**
 * Short, game-style haptic feedback. Thread-safe and never throws: devices without a vibrator
 * (or with vibration restricted) simply get nothing.
 *
 * - API 29+: predefined effects (TICK / CLICK / HEAVY_CLICK), one-shot + waveform for heavy/success
 * - API 26-28: one-shot / waveform with amplitudes
 * - API 24-25: legacy duration / pattern vibration
 */
internal class Haptics(context: Context) {

    private enum class Kind(val durationMs: Long, val amplitude: Int) {
        TICK(8, 60),
        LIGHT(12, 100),
        MEDIUM(20, 170),
        HEAVY(35, 255),
        SUCCESS(0, 0),
    }

    private val vibrator: Vibrator? = try {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            context.getSystemService(VibratorManager::class.java)?.defaultVibrator
        } else {
            @Suppress("DEPRECATION")
            context.getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator
        }
    } catch (t: Throwable) {
        null
    }

    private val available: Boolean by lazy {
        try {
            vibrator?.hasVibrator() == true
        } catch (t: Throwable) {
            false
        }
    }

    private val amplitudeControl: Boolean by lazy {
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.O &&
            try {
                vibrator?.hasAmplitudeControl() == true
            } catch (t: Throwable) {
                false
            }
    }

    @Volatile
    private var lastTickAt = 0L

    fun perform(kindName: String) {
        val kind = when (kindName.lowercase()) {
            "tick" -> Kind.TICK
            "light" -> Kind.LIGHT
            "medium" -> Kind.MEDIUM
            "heavy" -> Kind.HEAVY
            "success" -> Kind.SUCCESS
            else -> return
        }
        val v = vibrator ?: return
        if (!available) return

        if (kind == Kind.TICK) {
            // Ticks can be fired every frame while mowing; don't flood the vibrator service.
            val now = SystemClock.uptimeMillis()
            if (now - lastTickAt < MIN_TICK_INTERVAL_MS) return
            lastTickAt = now
        }

        try {
            when {
                Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q -> vibrateApi29(v, kind)
                Build.VERSION.SDK_INT >= Build.VERSION_CODES.O -> vibrateApi26(v, kind)
                else -> vibrateLegacy(v, kind)
            }
        } catch (t: Throwable) {
            Log.w(TAG, "Vibration failed", t)
        }
    }

    @SuppressLint("MissingPermission") // VIBRATE is declared in the manifest.
    @RequiresApi(Build.VERSION_CODES.Q)
    private fun vibrateApi29(v: Vibrator, kind: Kind) {
        val effect = when (kind) {
            Kind.TICK -> VibrationEffect.createPredefined(VibrationEffect.EFFECT_TICK)
            Kind.LIGHT -> VibrationEffect.createPredefined(VibrationEffect.EFFECT_CLICK)
            Kind.MEDIUM -> VibrationEffect.createPredefined(VibrationEffect.EFFECT_HEAVY_CLICK)
            Kind.HEAVY -> oneShot(kind)
            Kind.SUCCESS -> successWaveform()
        }
        v.vibrate(effect)
    }

    @SuppressLint("MissingPermission")
    @RequiresApi(Build.VERSION_CODES.O)
    private fun vibrateApi26(v: Vibrator, kind: Kind) {
        v.vibrate(if (kind == Kind.SUCCESS) successWaveform() else oneShot(kind))
    }

    @SuppressLint("MissingPermission")
    @Suppress("DEPRECATION")
    private fun vibrateLegacy(v: Vibrator, kind: Kind) {
        if (kind == Kind.SUCCESS) {
            v.vibrate(SUCCESS_TIMINGS, -1)
        } else {
            v.vibrate(kind.durationMs)
        }
    }

    @RequiresApi(Build.VERSION_CODES.O)
    private fun oneShot(kind: Kind): VibrationEffect = VibrationEffect.createOneShot(
        kind.durationMs,
        if (amplitudeControl) kind.amplitude else VibrationEffect.DEFAULT_AMPLITUDE,
    )

    @RequiresApi(Build.VERSION_CODES.O)
    private fun successWaveform(): VibrationEffect = if (amplitudeControl) {
        VibrationEffect.createWaveform(SUCCESS_TIMINGS, SUCCESS_AMPLITUDES, -1)
    } else {
        VibrationEffect.createWaveform(SUCCESS_TIMINGS, -1)
    }

    private companion object {
        const val TAG = "ZenHaptics"
        const val MIN_TICK_INTERVAL_MS = 25L

        // off, buzz, off, buzz, off, buzz : a short rising "ta-da".
        val SUCCESS_TIMINGS = longArrayOf(0, 14, 60, 18, 60, 30)
        val SUCCESS_AMPLITUDES = intArrayOf(0, 90, 0, 160, 0, 255)
    }
}
