package com.helloworld

import kotlin.math.max
import kotlin.math.min
import kotlin.math.sqrt

/**
 * 1D Kalman Filter for Latitude and Longitude smoothing.
 * Filters out GPS jitter while preserving legitimate physical trajectory.
 *
 * Design rationale:
 *  - The primary guard against trail going off-road is the POSITION CLAMP:
 *    the smoothed output is never allowed to drift more than accuracy/2 metres
 *    from the raw GPS fix. This unconditionally prevents the filter's inertial
 *    projection from drawing the trail into a field when turning at speed.
 *
 *  - A MILD dynamic process noise adjustment (capped at 1.5× the base noise)
 *    gently increases Kalman gain when accuracy degrades, making the filter
 *    slightly more responsive to new GPS fixes. The cap is deliberately
 *    conservative: raising it too high in urban multipath conditions (tall
 *    buildings bouncing signals) would cause the trail to snap to individual
 *    bad GPS points — a different version of the same off-road problem.
 *    The position clamp is the main safety net; the noise scaling is secondary.
 */
class KalmanLocationFilter {
    private var lastTimestampMs: Long = 0L
    private var lat: Double = 0.0
    private var lng: Double = 0.0
    private var variance: Double = -1.0

    // Base process noise (m/s²) at good GPS accuracy (< 20m).
    private val baseProcessNoiseMps2: Double = 3.0

    // Maximum multiplier for dynamic process noise scaling.
    // Deliberately capped at 1.5× to avoid snapping to bad multipath fixes in
    // urban canyons. The position clamp is the primary off-road guard.
    private val maxProcessNoiseFactor: Double = 1.5

    // Metres per degree latitude (approximate)
    private val metersPerDegLat: Double = 111320.0

    @Synchronized
    fun reset() {
        variance = -1.0
        lastTimestampMs = 0L
    }

    @Synchronized
    fun setState(newLat: Double, newLng: Double, accuracyMeters: Float, timestampMs: Long) {
        lat = newLat
        lng = newLng
        val acc = max(accuracyMeters.toDouble(), 1.0)
        variance = acc * acc
        lastTimestampMs = timestampMs
    }

    @Synchronized
    fun filter(measuredLat: Double, measuredLng: Double, accuracyMeters: Float, timestampMs: Long): Pair<Double, Double> {
        val acc = max(accuracyMeters.toDouble(), 1.0)
        val measurementVariance = acc * acc

        if (variance >= 0.0 && lastTimestampMs > 0) {
            val dtSec = max(0.1, (timestampMs - lastTimestampMs) / 1000.0)
            lastTimestampMs = timestampMs

            // ── Mild dynamic process noise (capped at 1.5×) ───────────────────
            // Gently increases Kalman gain as accuracy degrades so the filter is
            // slightly more responsive to new GPS fixes. Deliberately NOT scaled
            // aggressively: in urban multipath, a high factor would cause the
            // trail to snap to individual bad GPS points. The position clamp
            // below is the primary guard against off-road trail drawing.
            //
            // At accuracy <= 20m → factor = 1.0 (no change)
            // At accuracy =  35m → factor = 1.25
            // At accuracy =  50m → factor = 1.5  (cap — no further increase)
            // At accuracy =  65m → factor = 1.5  (cap maintained)
            val accuracyFactor = min(maxProcessNoiseFactor, max(1.0, acc / 40.0))
            val effectiveProcessNoise = baseProcessNoiseMps2 * accuracyFactor

            val predictedVariance = variance + (effectiveProcessNoise * dtSec * dtSec)
            val kalmanGain = (predictedVariance / (predictedVariance + measurementVariance)).coerceIn(0.05, 0.95)

            lat += (measuredLat - lat) * kalmanGain
            lng += (measuredLng - lng) * kalmanGain
            variance = (1.0 - kalmanGain) * predictedVariance

            // ── Position clamp (primary off-road guard) ────────────────────────
            // If the smoothed position has drifted more than accuracy/2 metres
            // from the raw GPS fix, pull it back. This is the unconditional
            // safety net that prevents the filter from projecting the trail
            // straight through corners regardless of Kalman gain value.
            val maxDriftMeters = acc / 2.0
            val driftLat = (lat - measuredLat) * metersPerDegLat
            val metersPerDegLng = metersPerDegLat * Math.cos(Math.toRadians(measuredLat))
            val driftLng = (lng - measuredLng) * metersPerDegLng
            val driftMeters = sqrt(driftLat * driftLat + driftLng * driftLng)
            if (driftMeters > maxDriftMeters) {
                val pullFactor = maxDriftMeters / driftMeters
                lat = measuredLat + (lat - measuredLat) * pullFactor
                lng = measuredLng + (lng - measuredLng) * pullFactor
            }

            return Pair(lat, lng)
        }

        setState(measuredLat, measuredLng, accuracyMeters, timestampMs)
        return Pair(lat, lng)
    }
}
