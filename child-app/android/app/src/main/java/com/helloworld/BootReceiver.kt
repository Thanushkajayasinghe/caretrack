package com.helloworld

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import android.util.Log
import androidx.core.content.ContextCompat

class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action == Intent.ACTION_BOOT_COMPLETED ||
            intent.action == "android.intent.action.QUICKBOOT_POWERON"
        ) {
            Log.i("CareTrackBootReceiver", "Boot completed detected, checking credentials...")
            val prefs = CareTrackLocationService.getPrefs(context)
            val token = prefs.getString("deviceToken", null)
            val fingerprint = prefs.getString("deviceFingerprint", null)

            if (!token.isNullOrEmpty() && !fingerprint.isNullOrEmpty()) {
                Log.i("CareTrackBootReceiver", "Starting CareTrackLocationService after reboot")
                val serviceIntent = Intent(context, CareTrackLocationService::class.java)
                ContextCompat.startForegroundService(context, serviceIntent)
            }
        }
    }
}
