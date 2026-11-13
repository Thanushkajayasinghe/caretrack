package com.helloworld

import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.content.Context
import android.content.SharedPreferences
import android.os.Build
import android.provider.Settings
import android.text.TextUtils
import android.util.Base64
import android.util.Log
import java.security.MessageDigest
import java.security.SecureRandom

object TamperGuardManager {
    private const val TAG = "TamperGuard"
    private const val PREFS_NAME = "caretrack_tamper_guard"
    private const val KEY_PIN_HASH = "master_pin_hash"
    private const val KEY_PIN_SALT = "master_pin_salt"

    // In-memory maintenance unlock window
    @Volatile
    private var unlockExpiresAt: Long = 0L

    private fun getPrefs(context: Context): SharedPreferences {
        return context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    }

    fun isPinConfigured(context: Context): Boolean {
        val prefs = getPrefs(context)
        return !prefs.getString(KEY_PIN_HASH, null).isNullOrEmpty()
    }

    fun setMasterPin(context: Context, pin: String): Boolean {
        if (pin.length < 4) return false
        try {
            val random = SecureRandom()
            val salt = ByteArray(16)
            random.nextBytes(salt)
            val saltStr = Base64.encodeToString(salt, Base64.NO_WRAP)

            val hash = hashPin(pin, saltStr)
            getPrefs(context).edit()
                .putString(KEY_PIN_SALT, saltStr)
                .putString(KEY_PIN_HASH, hash)
                .apply()
            Log.i(TAG, "Master PIN successfully set/updated")
            return true
        } catch (e: Exception) {
            Log.e(TAG, "Failed to set master PIN: ${e.message}", e)
            return false
        }
    }

    fun verifyMasterPin(context: Context, pin: String): Boolean {
        val prefs = getPrefs(context)
        val savedHash = prefs.getString(KEY_PIN_HASH, null) ?: return false
        val savedSalt = prefs.getString(KEY_PIN_SALT, null) ?: return false

        val testHash = hashPin(pin, savedSalt)
        return testHash == savedHash
    }

    private fun hashPin(pin: String, salt: String): String {
        val md = MessageDigest.getInstance("SHA-256")
        md.update(salt.toByteArray(Charsets.UTF_8))
        val digest = md.digest(pin.toByteArray(Charsets.UTF_8))
        return Base64.encodeToString(digest, Base64.NO_WRAP)
    }

    fun isTemporarilyUnlocked(): Boolean {
        val active = System.currentTimeMillis() < unlockExpiresAt
        return active
    }

    fun unlockTemporarily(durationMs: Long = 60 * 1000) {
        unlockExpiresAt = System.currentTimeMillis() + durationMs
        Log.i(TAG, "Tamper Guard temporarily unlocked for ${durationMs / 1000}s maintenance window")
    }

    fun lockNow() {
        unlockExpiresAt = 0L
        Log.i(TAG, "Tamper Guard locked")
    }

    fun getAdminComponent(context: Context): ComponentName {
        return ComponentName(context, CareTrackAdminReceiver::class.java)
    }

    fun isDeviceAdminActive(context: Context): Boolean {
        return try {
            val dpm = context.getSystemService(Context.DEVICE_POLICY_SERVICE) as? DevicePolicyManager
            dpm?.isAdminActive(getAdminComponent(context)) == true
        } catch (e: Exception) {
            false
        }
    }

    fun isAccessibilityServiceEnabled(context: Context): Boolean {
        return try {
            val expectedComponentName = ComponentName(context, CareTrackAccessibilityGuardService::class.java).flattenToString()
            val enabledServices = Settings.Secure.getString(
                context.contentResolver,
                Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES
            ) ?: return false

            val colonSplitter = TextUtils.SimpleStringSplitter(':')
            colonSplitter.setString(enabledServices)
            while (colonSplitter.hasNext()) {
                val componentName = colonSplitter.next()
                if (componentName.equals(expectedComponentName, ignoreCase = true) ||
                    componentName.contains("CareTrackAccessibilityGuardService")) {
                    return true
                }
            }
            false
        } catch (e: Exception) {
            false
        }
    }

    fun canDrawOverlays(context: Context): Boolean {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            Settings.canDrawOverlays(context)
        } else {
            true
        }
    }
}
