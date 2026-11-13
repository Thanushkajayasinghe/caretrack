package com.helloworld

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import android.util.Log
import androidx.core.content.ContextCompat

class WatchdogReceiver : BroadcastReceiver() {

    companion object {
        private const val TAG = "CareTrackWatchdog"
        const val ACTION_WATCHDOG_CHECK = "com.helloworld.WATCHDOG_CHECK"
        const val WATCHDOG_INTERVAL_MS = 10 * 60 * 1000L // Check every 10 minutes

        fun scheduleNextWatchdog(context: Context, delayMs: Long = WATCHDOG_INTERVAL_MS) {
            try {
                val alarmManager = context.getSystemService(Context.ALARM_SERVICE) as? AlarmManager ?: return
                val intent = Intent(context, WatchdogReceiver::class.java).apply {
                    action = ACTION_WATCHDOG_CHECK
                }
                val flags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                    PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
                } else {
                    PendingIntent.FLAG_UPDATE_CURRENT
                }
                val pendingIntent = PendingIntent.getBroadcast(context, 1002, intent, flags)
                val triggerAtMs = System.currentTimeMillis() + delayMs
                val canExact = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                    alarmManager.canScheduleExactAlarms()
                } else {
                    true
                }

                if (canExact && Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                    try {
                        alarmManager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAtMs, pendingIntent)
                    } catch (se: SecurityException) {
                        Log.w(TAG, "Exact alarm permission missing or restricted, falling back to setAndAllowWhileIdle")
                        alarmManager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAtMs, pendingIntent)
                    }
                } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                    alarmManager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAtMs, pendingIntent)
                } else {
                    alarmManager.set(AlarmManager.RTC_WAKEUP, triggerAtMs, pendingIntent)
                }
                Log.d(TAG, "Watchdog scheduled in ${delayMs / 1000}s (canExact=$canExact)")
            } catch (e: Exception) {
                Log.w(TAG, "Failed to schedule watchdog: ${e.message}")
            }
        }

        fun cancelWatchdog(context: Context) {
            try {
                val alarmManager = context.getSystemService(Context.ALARM_SERVICE) as? AlarmManager ?: return
                val intent = Intent(context, WatchdogReceiver::class.java).apply {
                    action = ACTION_WATCHDOG_CHECK
                }
                val flags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                    PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
                } else {
                    PendingIntent.FLAG_UPDATE_CURRENT
                }
                val pendingIntent = PendingIntent.getBroadcast(context, 1002, intent, flags)
                alarmManager.cancel(pendingIntent)
                Log.d(TAG, "Watchdog cancelled")
            } catch (e: Exception) {
                Log.w(TAG, "Failed to cancel watchdog: ${e.message}")
            }
        }
    }

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action == ACTION_WATCHDOG_CHECK) {
            Log.d(TAG, "Watchdog check triggered. isRunning=${CareTrackLocationService.isRunning}")

            val prefs = CareTrackLocationService.getPrefs(context)
            val token = prefs.getString("deviceToken", null)
            val fingerprint = prefs.getString("deviceFingerprint", null)

            if (!token.isNullOrEmpty() && !fingerprint.isNullOrEmpty()) {
                if (!CareTrackLocationService.isRunning) {
                    Log.w(TAG, "⚠️ Silent death detected! Resurrecting CareTrackLocationService...")
                    val serviceIntent = Intent(context, CareTrackLocationService::class.java).apply {
                        action = CareTrackLocationService.ACTION_START
                    }
                    try {
                        ContextCompat.startForegroundService(context, serviceIntent)
                    } catch (e: Exception) {
                        Log.e(TAG, "Failed to resurrect service: ${e.message}")
                    }
                }
                // Schedule next watchdog iteration
                scheduleNextWatchdog(context)
            }
        }
    }
}
