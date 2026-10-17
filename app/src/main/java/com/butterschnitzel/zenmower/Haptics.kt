package com.butterschnitzel.zenmower

import android.content.Context
import android.media.AudioAttributes
import android.os.Build
import android.os.SystemClock
import android.os.VibrationAttributes
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.util.Log
import androidx.annotation.RequiresApi

/**
 * Game haptics: a light tick while grass is being cut plus stronger pulses for events.
 * Thread-safe and never throws: devices without a vibrator simply get nothing.
 *
 * Everything uses explicit one-shot / waveform effects (the predefined CLICK/TICK effects are
 * barely noticeable or silent on many phones) and is tagged as media/game vibration, so it
 * follows the "media vibration" setting instead of the often disabled touch feedback.
 *
 * Phones without amplitude control usually have an eccentric-mass motor that needs ~20 ms
 * just to spin up, so they get longer pulses (`motorMs`) instead of the crisp short ones.
 *
 * `level`: 0 = off, 1 = soft, 2 = strong.
 */
internal class Haptics(context: Context) {

    private enum class Kind(val durationMs: Long, val amplitude: Int, val motorMs: Long) {
        TICK(12, 120, 22),
        LIGHT(20, 160, 30),
        MEDIUM(32, 210, 45),
        HEAVY(50, 255, 65),
        SUCCESS(0, 0, 0),
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

    fun perform(kindName: String, level: Int) {
        if (level <= 0) return
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
            // Ticks come in fast while mowing; keep them to a gentle purr.
            val now = SystemClock.uptimeMillis()
            if (now - lastTickAt < MIN_TICK_INTERVAL_MS) return
            lastTickAt = now
        }
        val strong = level >= 2

        try {
            when {
                Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU -> vibrateApi33(v, effect(kind, strong))
                Build.VERSION.SDK_INT >= Build.VERSION_CODES.O -> vibrateApi26(v, effect(kind, strong))
                else -> vibrateLegacy(v, kind, strong)
            }
        } catch (t: Throwable) {
            Log.w(TAG, "Vibration failed", t)
        }
    }

    @RequiresApi(Build.VERSION_CODES.TIRAMISU)
    private fun vibrateApi33(v: Vibrator, effect: VibrationEffect) {
        v.vibrate(effect, VibrationAttributes.createForUsage(VibrationAttributes.USAGE_MEDIA))
    }

    @RequiresApi(Build.VERSION_CODES.O)
    @Suppress("DEPRECATION")
    private fun vibrateApi26(v: Vibrator, effect: VibrationEffect) {
        v.vibrate(effect, GAME_AUDIO_ATTRIBUTES)
    }

    @Suppress("DEPRECATION")
    private fun vibrateLegacy(v: Vibrator, kind: Kind, strong: Boolean) {
        if (kind == Kind.SUCCESS) {
            v.vibrate(MOTOR_SUCCESS_TIMINGS, -1)
        } else {
            v.vibrate(if (strong) kind.motorMs else kind.motorMs * 3 / 4)
        }
    }

    @RequiresApi(Build.VERSION_CODES.O)
    private fun effect(kind: Kind, strong: Boolean): VibrationEffect {
        if (kind == Kind.SUCCESS) {
            return if (amplitudeControl) {
                val amps = if (strong) SUCCESS_AMPLITUDES else SUCCESS_AMPLITUDES.map { it * 3 / 5 }.toIntArray()
                VibrationEffect.createWaveform(SUCCESS_TIMINGS, amps, -1)
            } else {
                VibrationEffect.createWaveform(MOTOR_SUCCESS_TIMINGS, -1)
            }
        }
        // Without amplitude control "soft" can only mean "shorter".
        return if (amplitudeControl) {
            val amp = if (strong) kind.amplitude else kind.amplitude * 3 / 5
            VibrationEffect.createOneShot(kind.durationMs, amp.coerceIn(1, 255))
        } else {
            VibrationEffect.createOneShot(if (strong) kind.motorMs else kind.motorMs * 3 / 4, VibrationEffect.DEFAULT_AMPLITUDE)
        }
    }

    private companion object {
        const val TAG = "ZenHaptics"
        const val MIN_TICK_INTERVAL_MS = 60L

        // off, buzz, off, buzz, off, buzz : a short rising "ta-da".
        val SUCCESS_TIMINGS = longArrayOf(0, 18, 60, 22, 60, 40)
        val SUCCESS_AMPLITUDES = intArrayOf(0, 110, 0, 180, 0, 255)
        val MOTOR_SUCCESS_TIMINGS = longArrayOf(0, 28, 70, 32, 70, 55)

        val GAME_AUDIO_ATTRIBUTES: AudioAttributes = AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_GAME)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build()
    }
}
