package com.helloworld

import android.app.admin.DeviceAdminReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
import android.widget.Toast

class CareTrackAdminReceiver : DeviceAdminReceiver() {

    companion object {
        private const val TAG = "CareTrackAdminReceiver"
    }

    override fun onEnabled(context: Context, intent: Intent) {
        super.onEnabled(context, intent)
        Log.i(TAG, "CareTrack Device Administrator enabled")
        Toast.makeText(context, "CareTrack Tamper Guard (Device Admin) activated", Toast.LENGTH_SHORT).show()
    }

    override fun onDisableRequested(context: Context, intent: Intent): CharSequence? {
        Log.w(TAG, "Device Admin deactivation requested!")

        if (!TamperGuardManager.isTemporarilyUnlocked()) {
            val unlockIntent = Intent(context, TamperUnlockActivity::class.java).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
                putExtra("REASON", "DEACTIVATE_ADMIN")
            }
            context.startActivity(unlockIntent)
        }

        return "CareTrack Tamper Guard is active. Deactivating protection requires the Parent Master PIN and will immediately alert parents."
    }

    override fun onDisabled(context: Context, intent: Intent) {
        super.onDisabled(context, intent)
        Log.w(TAG, "CareTrack Device Administrator disabled")
    }
}
