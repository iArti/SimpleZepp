package com.thewizrd.simplewear.zepp

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Color
import org.json.JSONObject

/**
 * Accent color for the watch's media screens, taken from the player app's icon:
 * the hue that covers the most saturated, bright area of the icon.
 */
object AccentColor {
    private const val SAMPLE = 48
    private const val HUE_BUCKETS = 24
    private const val MIN_SAT = 0.35f
    private const val MIN_VAL = 0.3f

    // Readable on the watch's black background
    private const val MIN_LUMINANCE = 0.42f

    /** Adds "accent" (0xRRGGBB, or absent for a grey icon) to MediaPlayerAppInfoPath JSON */
    fun addToAppInfo(json: ByteArray?): ByteArray? {
        if (json == null) return null
        return runCatching {
            val obj = JSONObject(String(json, Charsets.UTF_8))
            val icon = obj.optJSONArray("key_icon") ?: return json
            val bytes = ByteArray(icon.length()) { icon.getInt(it).toByte() }
            val bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.size) ?: return json
            fromBitmap(bitmap)?.let { obj.put("accent", it) }
            obj.toString().toByteArray(Charsets.UTF_8)
        }.getOrDefault(json)
    }

    fun fromBitmap(source: Bitmap): Int? {
        val bmp = Bitmap.createScaledBitmap(source, SAMPLE, SAMPLE, true)
        val weight = FloatArray(HUE_BUCKETS)
        val sumR = FloatArray(HUE_BUCKETS)
        val sumG = FloatArray(HUE_BUCKETS)
        val sumB = FloatArray(HUE_BUCKETS)
        val hsv = FloatArray(3)

        for (y in 0 until SAMPLE) for (x in 0 until SAMPLE) {
            val c = bmp.getPixel(x, y)
            if (Color.alpha(c) < 128) continue
            Color.colorToHSV(c, hsv)
            if (hsv[1] < MIN_SAT || hsv[2] < MIN_VAL) continue
            val b = ((hsv[0] / 360f) * HUE_BUCKETS).toInt().coerceIn(0, HUE_BUCKETS - 1)
            val w = hsv[1] * hsv[2]
            weight[b] += w
            sumR[b] += Color.red(c) * w
            sumG[b] += Color.green(c) * w
            sumB[b] += Color.blue(c) * w
        }

        val best = weight.indices.maxByOrNull { weight[it] } ?: return null
        // Too little color (a grey or mostly white icon): let the watch use its default
        if (weight[best] < SAMPLE * SAMPLE * 0.02f) return null

        var r = sumR[best] / weight[best]
        var g = sumG[best] / weight[best]
        var b = sumB[best] / weight[best]
        // Lighten dark accents towards white until they read well on black
        repeat(10) {
            val lum = (0.2126f * r + 0.7152f * g + 0.0722f * b) / 255f
            if (lum >= MIN_LUMINANCE) return@repeat
            r += (255 - r) * 0.15f
            g += (255 - g) * 0.15f
            b += (255 - b) * 0.15f
        }
        return (r.toInt().coerceIn(0, 255) shl 16) or (g.toInt().coerceIn(0, 255) shl 8) or b.toInt().coerceIn(0, 255)
    }
}
