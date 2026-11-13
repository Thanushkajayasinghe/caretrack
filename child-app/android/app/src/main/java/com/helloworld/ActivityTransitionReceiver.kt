package com.helloworld

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
import com.google.android.gms.location.ActivityTransition
import com.google.android.gms.location.ActivityTransitionResult
import com.google.android.gms.location.DetectedActivity

/**
 * Receives Activity Transition API events from Google Play Services.
 * Broadcasts the detected activity type to CareTrackLocationService.
 */
class ActivityTransitionReceiver : BroadcastReceiver() {

    companion object {
        private const val TAG = "ActivityTransitionRcvr"
        const val ACTION_ACTIVITY_TRANSITION = "com.helloworld.ACTIVITY_TRANSITION"
        const val EXTRA_ACTIVITY_TYPE = "activityType"
        const val EXTRA_TRANSITION_TYPE = "transitionType"

        fun activityTypeToString(type: Int): String {
            return when (type) {
                DetectedActivity.STILL -> "still"
                DetectedActivity.WALKING -> "walking"
                DetectedActivity.RUNNING -> "running"
                DetectedActivity.ON_FOOT -> "walking"
                DetectedActivity.ON_BICYCLE -> "on_bicycle"
                DetectedActivity.IN_VEHICLE -> "in_vehicle"
                DetectedActivity.TILTING -> "unknown"
                DetectedActivity.UNKNOWN -> "unknown"
                else -> "unknown"
            }
        }
    }

    override fun onReceive(context: Context, intent: Intent) {
        try {
            if (!ActivityTransitionResult.hasResult(intent)) return

            val result = ActivityTransitionResult.extractResult(intent) ?: return

            for (event in result.transitionEvents) {
                val activityStr = activityTypeToString(event.activityType)
                val transitionStr = if (event.transitionType == ActivityTransition.ACTIVITY_TRANSITION_ENTER) "ENTER" else "EXIT"

                Log.i(TAG, "Activity transition: $activityStr ($transitionStr)")

                // Drop meaningless signals before they reach the state machine.
                // "unknown" and "tilting" provide no actionable information and can
                // confuse the activity classifier if forwarded.
                if (activityStr == "unknown") {
                    Log.d(TAG, "Dropping unknown activity signal")
                    continue
                }

                // Only forward ENTER transitions (user started doing this activity)
                if (event.transitionType == ActivityTransition.ACTIVITY_TRANSITION_ENTER) {
                    val serviceIntent = Intent(ACTION_ACTIVITY_TRANSITION).apply {
                        putExtra(EXTRA_ACTIVITY_TYPE, activityStr)
                        putExtra(EXTRA_TRANSITION_TYPE, event.transitionType)
                        setPackage(context.packageName)
                    }
                    context.sendBroadcast(serviceIntent)
                }
            }
        } catch (e: Exception) {
            Log.e(TAG, "ActivityTransitionReceiver crashed: ${e.message}")
        }
    }
}
