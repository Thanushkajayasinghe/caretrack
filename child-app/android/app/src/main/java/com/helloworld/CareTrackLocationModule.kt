package com.helloworld

import android.Manifest
import android.app.ActivityManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.location.LocationManager
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.CallLog
import android.provider.Settings
import android.util.Log
import androidx.core.content.ContextCompat
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableMap
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.facebook.react.bridge.LifecycleEventListener
import android.media.MediaRecorder
import android.os.Handler
import android.os.Looper
import android.util.Base64
import java.io.File
import android.graphics.Bitmap

class CareTrackLocationModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext), LifecycleEventListener {

    companion object {
        const val NAME = "CareTrackLocationModule"
    }

    private val locationReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            try {
                if (intent?.action == LocationManager.PROVIDERS_CHANGED_ACTION) {
                    val statusMap = getServicesStatusMap()
                    reactApplicationContext
                        .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                        ?.emit("onServicesStatusChanged", statusMap)
                }
            } catch (e: Exception) {
                Log.w(NAME, "locationReceiver broadcast error: ${e.message}")
            }
        }
    }

    init {
        try {
            reactContext.addLifecycleEventListener(this)
            val filter = IntentFilter(LocationManager.PROVIDERS_CHANGED_ACTION)
            reactContext.registerReceiver(locationReceiver, filter)
        } catch (e: Exception) {
            Log.w(NAME, "Failed to register locationReceiver: ${e.message}")
        }
    }

    override fun onHostResume() {
        try {
            val statusMap = getServicesStatusMap()
            reactApplicationContext
                .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                ?.emit("onServicesStatusChanged", statusMap)
        } catch (e: Exception) {
            Log.w(NAME, "onHostResume status emit error: ${e.message}")
        }
    }

    override fun onHostPause() {}
    override fun onHostDestroy() {}

    override fun getName(): String = NAME

    @ReactMethod
    fun startBackgroundService(
        deviceToken: String,
        deviceFingerprint: String,
        serverHost: String,
        serverPort: Int,
        promise: Promise
    ) {
        try {
            val context = reactApplicationContext
            CareTrackLocationService.saveCredentials(
                context,
                deviceToken,
                deviceFingerprint,
                serverHost,
                serverPort
            )

            val intent = Intent(context, CareTrackLocationService::class.java).apply {
                action = CareTrackLocationService.ACTION_START
            }
            ContextCompat.startForegroundService(context, intent)
            Log.i(NAME, "startBackgroundService invoked successfully")
            promise.resolve(true)
        } catch (e: Exception) {
            Log.e(NAME, "Failed to start background service: ${e.message}", e)
            promise.reject("START_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun stopBackgroundService(promise: Promise) {
        try {
            val context = reactApplicationContext
            val intent = Intent(context, CareTrackLocationService::class.java).apply {
                action = CareTrackLocationService.ACTION_STOP
            }
            context.startService(intent)
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("STOP_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun isServiceRunning(promise: Promise) {
        val running = isServiceActuallyRunning(reactApplicationContext, CareTrackLocationService::class.java)
        promise.resolve(running)
    }

    private fun getServicesStatusMap(): WritableMap {
        val context = reactApplicationContext
        val locationManager = context.getSystemService(Context.LOCATION_SERVICE) as? LocationManager

        // Check master location toggle
        val isMasterLocationEnabled = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            locationManager?.isLocationEnabled == true
        } else {
            try {
                Settings.Secure.getInt(context.contentResolver, Settings.Secure.LOCATION_MODE, 0) != Settings.Secure.LOCATION_MODE_OFF
            } catch (e: Exception) {
                false
            }
        }

        val isGpsProviderOn = locationManager?.isProviderEnabled(LocationManager.GPS_PROVIDER) == true
        val isNetworkProviderOn = locationManager?.isProviderEnabled(LocationManager.NETWORK_PROVIDER) == true
        val isHardwareLocationOn = isMasterLocationEnabled && (isGpsProviderOn || isNetworkProviderOn)

        val hasFinePermission = ContextCompat.checkSelfPermission(
            context, Manifest.permission.ACCESS_FINE_LOCATION
        ) == PackageManager.PERMISSION_GRANTED
        val hasCoarsePermission = ContextCompat.checkSelfPermission(
            context, Manifest.permission.ACCESS_COARSE_LOCATION
        ) == PackageManager.PERMISSION_GRANTED
        val hasLocationPermission = hasFinePermission || hasCoarsePermission

        val hasBackgroundPermission = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            ContextCompat.checkSelfPermission(
                context, Manifest.permission.ACCESS_BACKGROUND_LOCATION
            ) == PackageManager.PERMISSION_GRANTED
        } else {
            true
        }

        val powerManager = context.getSystemService(Context.POWER_SERVICE) as? PowerManager
        val isBatteryOptIgnored = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            powerManager?.isIgnoringBatteryOptimizations(context.packageName) ?: false
        } else {
            true
        }

        val hasCallLogPermission = ContextCompat.checkSelfPermission(
            context, Manifest.permission.READ_CALL_LOG
        ) == PackageManager.PERMISSION_GRANTED

        val isRunning = isServiceActuallyRunning(context, CareTrackLocationService::class.java)
        val isLocationFullyOperational = isHardwareLocationOn && hasLocationPermission

        val m = Build.MANUFACTURER.lowercase()
        val isXiaomi = m.contains("xiaomi") || m.contains("redmi") || m.contains("poco")
        val isAutostartAllowed = if (isXiaomi) isXiaomiAutostartGranted(context) else false

        return Arguments.createMap().apply {
            putBoolean("locationEnabled", isLocationFullyOperational)
            putBoolean("masterLocationEnabled", isMasterLocationEnabled)
            putBoolean("gpsEnabled", isGpsProviderOn)
            putBoolean("hardwareLocationEnabled", isHardwareLocationOn)
            putBoolean("permissionGranted", hasLocationPermission)
            putBoolean("backgroundPermissionGranted", hasBackgroundPermission)
            putBoolean("callLogPermissionGranted", hasCallLogPermission)
            putBoolean("serviceRunning", isRunning)
            putBoolean("batteryOptimizationIgnored", isBatteryOptIgnored)
            putString("manufacturer", m)
            putBoolean("isOemWithKillSwitch", isOemWithAggressiveKillSwitch())
            putBoolean("autostartGranted", isAutostartAllowed)
        }
    }

    private fun isXiaomiAutostartGranted(context: Context): Boolean {
        return try {
            val appOps = context.getSystemService(Context.APP_OPS_SERVICE) as? android.app.AppOpsManager ?: return true
            val checkOpNoThrowMethod = android.app.AppOpsManager::class.java.getDeclaredMethod(
                "checkOpNoThrow",
                Int::class.javaPrimitiveType,
                Int::class.javaPrimitiveType,
                String::class.java
            )
            checkOpNoThrowMethod.isAccessible = true
            // 10008 is OP_AUTO_START on Xiaomi MIUI / HyperOS
            val mode = checkOpNoThrowMethod.invoke(
                appOps,
                10008,
                android.os.Process.myUid(),
                context.packageName
            ) as? Int
            mode == android.app.AppOpsManager.MODE_ALLOWED
        } catch (_e: Exception) {
            true
        }
    }

    private fun isOemWithAggressiveKillSwitch(): Boolean {
        val m = Build.MANUFACTURER.lowercase()
        return m.contains("xiaomi") || m.contains("redmi") || m.contains("poco") ||
               m.contains("samsung") || m.contains("huawei") || m.contains("honor") ||
               m.contains("oppo") || m.contains("realme") || m.contains("vivo") ||
               m.contains("oneplus") || m.contains("asus")
    }

    private fun isServiceActuallyRunning(context: Context, serviceClass: Class<*>): Boolean {
        if (CareTrackLocationService.isRunning) return true
        val manager = context.getSystemService(Context.ACTIVITY_SERVICE) as? ActivityManager ?: return false
        @Suppress("DEPRECATION")
        for (service in manager.getRunningServices(Int.MAX_VALUE)) {
            if (serviceClass.name == service.service.className) {
                return true
            }
        }
        return false
    }

    @ReactMethod
    fun checkServicesStatus(promise: Promise) {
        try {
            promise.resolve(getServicesStatusMap())
        } catch (e: Exception) {
            Log.e(NAME, "checkServicesStatus error: ${e.message}")
            val fallback = Arguments.createMap().apply {
                putBoolean("locationEnabled", false)
                putBoolean("masterLocationEnabled", false)
                putBoolean("gpsEnabled", false)
                putBoolean("hardwareLocationEnabled", false)
                putBoolean("permissionGranted", false)
                putBoolean("backgroundPermissionGranted", false)
                putBoolean("callLogPermissionGranted", false)
                putBoolean("serviceRunning", false)
                putBoolean("batteryOptimizationIgnored", false)
                putString("manufacturer", Build.MANUFACTURER.lowercase())
                putBoolean("isOemWithKillSwitch", false)
                putBoolean("autostartGranted", false)
            }
            promise.resolve(fallback)
        }
    }

    @ReactMethod
    fun openLocationSettings(promise: Promise) {
        try {
            val intent = Intent(Settings.ACTION_LOCATION_SOURCE_SETTINGS).apply {
                flags = Intent.FLAG_ACTIVITY_NEW_TASK
            }
            reactApplicationContext.startActivity(intent)
            promise.resolve(true)
        } catch (e: Exception) {
            Log.e(NAME, "openLocationSettings error: ${e.message}")
            promise.reject("SETTINGS_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun openBatteryOptimizationSettings(promise: Promise) {
        try {
            TamperGuardManager.unlockTemporarily(60 * 1000)
            val context = reactApplicationContext
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                val powerManager = context.getSystemService(Context.POWER_SERVICE) as? PowerManager
                val isIgnored = powerManager?.isIgnoringBatteryOptimizations(context.packageName) == true
                if (!isIgnored) {
                    try {
                        // Direct 1-tap system dialog prompt: "Let CareTrack always run in background?"
                        val directIntent = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS).apply {
                            data = Uri.parse("package:${context.packageName}")
                            flags = Intent.FLAG_ACTIVITY_NEW_TASK
                        }
                        context.startActivity(directIntent)
                        promise.resolve(true)
                        return
                    } catch (e: Exception) {
                        Log.w(NAME, "ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS fallback: ${e.message}")
                    }
                }
                val listIntent = Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS).apply {
                    flags = Intent.FLAG_ACTIVITY_NEW_TASK
                }
                context.startActivity(listIntent)
            }
            promise.resolve(true)
        } catch (e: Exception) {
            Log.e(NAME, "openBatteryOptimizationSettings error: ${e.message}")
            promise.reject("BATTERY_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun openAutostartSettings(promise: Promise) {
        TamperGuardManager.unlockTemporarily(60 * 1000)
        val context = reactApplicationContext
        val pkg = context.packageName
        val autostartIntents = listOf(
            // Xiaomi / Redmi / Poco (MIUI & HyperOS)
            Intent().setComponent(android.content.ComponentName("com.miui.securitycenter", "com.miui.permcenter.autostart.AutoStartManagementActivity")),
            Intent("miui.intent.action.OP_AUTO_START").addCategory(Intent.CATEGORY_DEFAULT),
            Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
                data = Uri.fromParts("package", pkg, null)
            },

            // Samsung
            Intent().setComponent(android.content.ComponentName("com.samsung.android.lool", "com.samsung.android.sm.ui.battery.BatteryActivity")),
            Intent().setComponent(android.content.ComponentName("com.samsung.android.sm", "com.samsung.android.sm.battery.ui.BatteryActivity")),
            Intent().setComponent(android.content.ComponentName("com.samsung.android.sm", "com.samsung.android.sm.ui.battery.AppSleepListActivity")),

            // Huawei / Honor
            Intent().setComponent(android.content.ComponentName("com.huawei.systemmanager", "com.huawei.systemmanager.startupmgr.ui.StartupNormalAppListActivity")),
            Intent().setComponent(android.content.ComponentName("com.huawei.systemmanager", "com.huawei.systemmanager.optimize.process.ProtectActivity")),
            Intent().setComponent(android.content.ComponentName("com.huawei.systemmanager", "com.huawei.systemmanager.appcontrol.activity.StartupAppControlActivity")),

            // Oppo / Realme
            Intent().setComponent(android.content.ComponentName("com.coloros.safecenter", "com.coloros.safecenter.permission.startup.StartupAppListActivity")),
            Intent().setComponent(android.content.ComponentName("com.oppo.safe", "com.oppo.safe.permission.startup.StartupAppListActivity")),
            Intent().setComponent(android.content.ComponentName("com.coloros.safecenter", "com.coloros.safecenter.startupapp.StartupAppListActivity")),

            // Vivo
            Intent().setComponent(android.content.ComponentName("com.iqoo.secure", "com.iqoo.secure.ui.phoneoptimize.AddWhiteListActivity")),
            Intent().setComponent(android.content.ComponentName("com.vivo.permissionmanager", "com.vivo.permissionmanager.activity.BgStartUpManagerActivity")),
            Intent().setComponent(android.content.ComponentName("com.iqoo.secure", "com.iqoo.secure.ui.phoneoptimize.BgStartUpManager")),

            // OnePlus
            Intent().setComponent(android.content.ComponentName("com.oneplus.security", "com.oneplus.security.chainlaunch.view.ChainLaunchAppListAct")),

            // Asus
            Intent().setComponent(android.content.ComponentName("com.asus.mobilemanager", "com.asus.mobilemanager.powersaver.PowerSaverSettings")),
            Intent().setComponent(android.content.ComponentName("com.asus.mobilemanager", "com.asus.mobilemanager.autostart.AutoStartActivity"))
        )

        for (intent in autostartIntents) {
            try {
                intent.flags = Intent.FLAG_ACTIVITY_NEW_TASK
                context.startActivity(intent)
                Log.i(NAME, "Successfully opened autostart settings with intent: $intent")
                promise.resolve(true)
                return
            } catch (_e: Exception) {}
        }

        // Fallback to application details settings
        try {
            val appDetailsIntent = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
                data = Uri.fromParts("package", pkg, null)
                flags = Intent.FLAG_ACTIVITY_NEW_TASK
            }
            context.startActivity(appDetailsIntent)
            promise.resolve(true)
        } catch (e: Exception) {
            Log.e(NAME, "Failed to open fallback app settings: ${e.message}")
            promise.reject("AUTOSTART_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun openAppSettings(promise: Promise) {
        try {
            val intent = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
                data = Uri.fromParts("package", reactApplicationContext.packageName, null)
                flags = Intent.FLAG_ACTIVITY_NEW_TASK
            }
            reactApplicationContext.startActivity(intent)
            promise.resolve(true)
        } catch (e: Exception) {
            Log.e(NAME, "openAppSettings error: ${e.message}")
            promise.reject("APP_SETTINGS_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun getTamperGuardStatus(promise: Promise) {
        try {
            val context = reactApplicationContext
            val map = Arguments.createMap().apply {
                putBoolean("isDeviceAdminActive", TamperGuardManager.isDeviceAdminActive(context))
                putBoolean("isAccessibilityEnabled", TamperGuardManager.isAccessibilityServiceEnabled(context))
                putBoolean("canDrawOverlays", TamperGuardManager.canDrawOverlays(context))
                putBoolean("hasMasterPin", TamperGuardManager.isPinConfigured(context))
                putBoolean("isMaintenanceActive", TamperGuardManager.isTemporarilyUnlocked())
            }
            promise.resolve(map)
        } catch (e: Exception) {
            promise.reject("TAMPER_STATUS_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun setMasterPin(pin: String, promise: Promise) {
        try {
            val success = TamperGuardManager.setMasterPin(reactApplicationContext, pin)
            if (success) {
                TamperGuardManager.unlockTemporarily(10 * 60 * 1000)
            }
            promise.resolve(success)
        } catch (e: Exception) {
            promise.reject("SET_PIN_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun verifyMasterPin(pin: String, promise: Promise) {
        try {
            val valid = TamperGuardManager.verifyMasterPin(reactApplicationContext, pin)
            promise.resolve(valid)
        } catch (e: Exception) {
            promise.reject("VERIFY_PIN_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun requestDeviceAdmin(promise: Promise) {
        try {
            TamperGuardManager.unlockTemporarily(10 * 60 * 1000)
            val activity = currentActivity
            val context = activity ?: reactApplicationContext
            val adminComponent = TamperGuardManager.getAdminComponent(reactApplicationContext)

            val intent = Intent(android.app.admin.DevicePolicyManager.ACTION_ADD_DEVICE_ADMIN).apply {
                putExtra(android.app.admin.DevicePolicyManager.EXTRA_DEVICE_ADMIN, adminComponent)
                putExtra(
                    android.app.admin.DevicePolicyManager.EXTRA_ADD_EXPLANATION,
                    "CareTrack Tamper Guard requires Device Admin privilege to protect background child safety services."
                )
                if (activity == null) {
                    flags = Intent.FLAG_ACTIVITY_NEW_TASK
                }
            }

            try {
                if (activity != null) {
                    activity.startActivity(intent)
                } else {
                    context.startActivity(intent)
                }
                promise.resolve(true)
            } catch (e1: Exception) {
                Log.w(NAME, "Direct ADD_DEVICE_ADMIN failed: ${e1.message}, trying system device admin list")
                try {
                    val fallbackIntent = Intent("android.settings.DEVICE_ADMIN_SETTINGS").apply {
                        flags = Intent.FLAG_ACTIVITY_NEW_TASK
                    }
                    context.startActivity(fallbackIntent)
                    promise.resolve(true)
                } catch (e2: Exception) {
                    val secIntent = Intent(Settings.ACTION_SECURITY_SETTINGS).apply {
                        flags = Intent.FLAG_ACTIVITY_NEW_TASK
                    }
                    context.startActivity(secIntent)
                    promise.resolve(true)
                }
            }
        } catch (e: Exception) {
            Log.e(NAME, "requestDeviceAdmin error: ${e.message}")
            promise.reject("DEVICE_ADMIN_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun openAccessibilitySettings(promise: Promise) {
        try {
            TamperGuardManager.unlockTemporarily(10 * 60 * 1000)
            val activity = currentActivity
            val context = activity ?: reactApplicationContext
            val intent = Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS).apply {
                if (activity == null) {
                    flags = Intent.FLAG_ACTIVITY_NEW_TASK
                }
            }
            if (activity != null) {
                activity.startActivity(intent)
            } else {
                context.startActivity(intent)
            }
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("ACCESSIBILITY_SETTINGS_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun requestOverlayPermission(promise: Promise) {
        try {
            TamperGuardManager.unlockTemporarily(10 * 60 * 1000)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                val activity = currentActivity
                val context = activity ?: reactApplicationContext
                val pkg = reactApplicationContext.packageName

                var launched = false

                // Tier 1: Specific ACTION_MANAGE_OVERLAY_PERMISSION with package URI
                try {
                    val intent = Intent(
                        Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                        Uri.parse("package:$pkg")
                    ).apply {
                        if (activity == null) {
                            flags = Intent.FLAG_ACTIVITY_NEW_TASK
                        }
                    }
                    if (activity != null) {
                        activity.startActivity(intent)
                    } else {
                        context.startActivity(intent)
                    }
                    launched = true
                } catch (e1: Exception) {
                    Log.w(NAME, "Specific ACTION_MANAGE_OVERLAY_PERMISSION failed: ${e1.message}")
                }

                // Tier 2: Xiaomi / HyperOS specific permission editor
                if (!launched) {
                    try {
                        val miuiIntent = Intent("miui.intent.action.APP_PERM_EDITOR").apply {
                            setClassName(
                                "com.miui.securitycenter",
                                "com.miui.permcenter.permissions.PermissionsEditorActivity"
                            )
                            putExtra("extra_pkgname", pkg)
                            if (activity == null) {
                                flags = Intent.FLAG_ACTIVITY_NEW_TASK
                            }
                        }
                        if (activity != null) {
                            activity.startActivity(miuiIntent)
                        } else {
                            context.startActivity(miuiIntent)
                        }
                        launched = true
                    } catch (eMiui: Exception) {
                        Log.w(NAME, "MIUI permission editor launch failed: ${eMiui.message}")
                    }
                }

                // Tier 3: Generic ACTION_MANAGE_OVERLAY_PERMISSION (system list)
                if (!launched) {
                    try {
                        val genericIntent = Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION).apply {
                            flags = Intent.FLAG_ACTIVITY_NEW_TASK
                        }
                        context.startActivity(genericIntent)
                        launched = true
                    } catch (e2: Exception) {
                        Log.w(NAME, "Generic ACTION_MANAGE_OVERLAY_PERMISSION failed: ${e2.message}")
                    }
                }

                // Tier 4: Application details settings
                if (!launched) {
                    val appDetails = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
                        data = Uri.fromParts("package", pkg, null)
                        flags = Intent.FLAG_ACTIVITY_NEW_TASK
                    }
                    context.startActivity(appDetails)
                }
            }
            promise.resolve(true)
        } catch (e: Exception) {
            Log.e(NAME, "requestOverlayPermission error: ${e.message}")
            promise.reject("OVERLAY_PERMISSION_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun unlockMaintenanceMode(pin: String, promise: Promise) {
        try {
            val context = reactApplicationContext
            val valid = TamperGuardManager.verifyMasterPin(context, pin)
            if (valid) {
                TamperGuardManager.unlockTemporarily(10 * 60 * 1000)
                promise.resolve(true)
            } else {
                promise.resolve(false)
            }
        } catch (e: Exception) {
            promise.reject("UNLOCK_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun lockNow(promise: Promise) {
        try {
            TamperGuardManager.lockNow()
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("LOCK_ERROR", e.message, e)
        }
    }

    private var activeMediaRecorder: MediaRecorder? = null
    private var recordingHandler: Handler? = null
    private var recordingRunnable: Runnable? = null

    @ReactMethod
    fun startLiveAudioStream(requestId: String, promise: Promise) {
        if (CareTrackLocationService.triggerLiveAudioStream(true, requestId)) {
            Log.i(NAME, "🔴 Live audio stream delegated to CareTrackLocationService")
            promise.resolve(true)
        } else {
            promise.reject("SERVICE_NOT_RUNNING", "CareTrackLocationService is not active")
        }
    }

    @ReactMethod
    fun stopLiveAudioStream(promise: Promise) {
        CareTrackLocationService.triggerLiveAudioStream(false, null)
        Log.i(NAME, "⏹️ Live audio stream stop requested")
        promise.resolve(true)
    }

    @ReactMethod
    fun captureScreenshot(requestId: String, promise: Promise) {
        if (CareTrackLocationService.triggerScreenshot(requestId)) {
            Log.i(NAME, "📸 Screenshot capture delegated to CareTrackLocationService")
            val map = Arguments.createMap().apply {
                putString("status", "HANDLED_BY_SERVICE")
                putString("requestId", requestId)
            }
            promise.resolve(map)
            return
        }

        val accService = CareTrackAccessibilityGuardService.instance
        if (accService == null) {
            promise.reject("ACCESSIBILITY_DISABLED", "Accessibility service is not active.")
            return
        }

        accService.captureScreen { bitmap, error ->
            if (bitmap != null) {
                try {
                    val stream = java.io.ByteArrayOutputStream()
                    bitmap.compress(Bitmap.CompressFormat.JPEG, 75, stream)
                    val bytes = stream.toByteArray()
                    bitmap.recycle()
                    val base64 = android.util.Base64.encodeToString(bytes, android.util.Base64.NO_WRAP)
                    val map = Arguments.createMap().apply {
                        putString("status", "SUCCESS")
                        putString("mediaBase64", base64)
                        putString("requestId", requestId)
                    }
                    promise.resolve(map)
                } catch (e: Exception) {
                    promise.reject("CAPTURE_FAILED", e.message)
                }
            } else {
                promise.reject("CAPTURE_FAILED", error ?: "Unknown capture error")
            }
        }
    }

    @ReactMethod
    fun recordAudioSnapshot(durationSeconds: Int, requestId: String, promise: Promise) {
        val context = reactApplicationContext

        // 1. If background service is active, delegate directly so only one recorder ever runs
        if (CareTrackLocationService.triggerAudioSnapshot(durationSeconds, requestId)) {
            Log.i(NAME, "🎙️ Audio snapshot delegated to CareTrackLocationService")
            val map = Arguments.createMap().apply {
                putString("status", "HANDLED_BY_SERVICE")
                putString("requestId", requestId)
            }
            promise.resolve(map)
            return
        }

        if (ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            promise.reject("PERMISSION_DENIED", "RECORD_AUDIO permission is not granted.")
            return
        }

        val duration = durationSeconds.coerceIn(5, 60)
        val cacheDir = context.cacheDir
        val audioFile = File(cacheDir, "snapshot_${requestId}.aac")

        try {
            stopActiveRecorder()

            val recorder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                MediaRecorder(context)
            } else {
                @Suppress("DEPRECATION")
                MediaRecorder()
            }

            recorder.setAudioSource(MediaRecorder.AudioSource.MIC)
            recorder.setOutputFormat(MediaRecorder.OutputFormat.AAC_ADTS)
            recorder.setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
            recorder.setAudioEncodingBitRate(64000)
            recorder.setAudioSamplingRate(44100)
            recorder.setOutputFile(audioFile.absolutePath)
            recorder.prepare()
            recorder.start()

            activeMediaRecorder = recorder
            CareTrackLocationService.updateAudioRecordingNotification(context, true)
            Log.i(NAME, "🎙️ Audio snapshot recording started for ${duration}s -> ${audioFile.absolutePath}")

            val handler = Handler(Looper.getMainLooper())
            recordingHandler = handler
            val runnable = Runnable {
                try {
                    stopActiveRecorder()
                    CareTrackLocationService.updateAudioRecordingNotification(context, false)
                    Log.i(NAME, "🎙️ Audio snapshot recording finished.")

                    if (audioFile.exists() && audioFile.length() > 0) {
                        val bytes = audioFile.readBytes()
                        val base64 = Base64.encodeToString(bytes, Base64.NO_WRAP)
                        val map = Arguments.createMap().apply {
                            putString("filePath", audioFile.absolutePath)
                            putString("mediaBase64", base64)
                            putInt("fileSizeBytes", bytes.size)
                            putInt("durationSeconds", duration)
                            putString("requestId", requestId)
                        }
                        try { audioFile.delete() } catch (_e: Exception) {}
                        promise.resolve(map)
                    } else {
                        promise.reject("RECORD_ERROR", "Recorded file is empty or missing")
                    }
                } catch (e: Exception) {
                    Log.e(NAME, "Error stopping recorder: ${e.message}", e)
                    promise.reject("RECORD_ERROR", e.message, e)
                }
            }
            recordingRunnable = runnable
            handler.postDelayed(runnable, (duration * 1000).toLong())

        } catch (e: Exception) {
            Log.e(NAME, "Failed to start audio recording: ${e.message}", e)
            CareTrackLocationService.updateAudioRecordingNotification(context, false)
            stopActiveRecorder()
            promise.reject("START_ERROR", e.message, e)
        }
    }

    private fun stopActiveRecorder() {
        try {
            recordingRunnable?.let { recordingHandler?.removeCallbacks(it) }
            recordingRunnable = null
            recordingHandler = null
            activeMediaRecorder?.let {
                try { it.stop() } catch (_e: Exception) {}
                try { it.release() } catch (_e: Exception) {}
            }
            activeMediaRecorder = null
        } catch (_e: Exception) {}
    }

    @ReactMethod
    fun getCallLogs(limit: Double, promise: Promise) {
        try {
            val context = reactApplicationContext
            if (ContextCompat.checkSelfPermission(context, Manifest.permission.READ_CALL_LOG) != PackageManager.PERMISSION_GRANTED) {
                promise.reject("PERMISSION_DENIED", "READ_CALL_LOG permission not granted")
                return
            }

            val projection = arrayOf(
                CallLog.Calls._ID,
                CallLog.Calls.NUMBER,
                CallLog.Calls.CACHED_NAME,
                CallLog.Calls.TYPE,
                CallLog.Calls.DATE,
                CallLog.Calls.DURATION
            )

            val sortLimit = if (limit > 0) limit.toInt() else 100
            val sortOrder = "${CallLog.Calls.DATE} DESC"
            val array = Arguments.createArray()

            context.contentResolver.query(
                CallLog.Calls.CONTENT_URI,
                projection,
                null,
                null,
                sortOrder
            )?.use { cursor ->
                val idIndex = cursor.getColumnIndex(CallLog.Calls._ID)
                val numberIndex = cursor.getColumnIndex(CallLog.Calls.NUMBER)
                val nameIndex = cursor.getColumnIndex(CallLog.Calls.CACHED_NAME)
                val typeIndex = cursor.getColumnIndex(CallLog.Calls.TYPE)
                val dateIndex = cursor.getColumnIndex(CallLog.Calls.DATE)
                val durationIndex = cursor.getColumnIndex(CallLog.Calls.DURATION)

                var count = 0
                while (cursor.moveToNext() && count < sortLimit) {
                    count++
                    val rawId = if (idIndex != -1) cursor.getString(idIndex) else null
                    val rawNumber = if (numberIndex != -1) cursor.getString(numberIndex) else null
                    val name = if (nameIndex != -1) cursor.getString(nameIndex) else null
                    val type = if (typeIndex != -1) cursor.getInt(typeIndex) else -1
                    val date = if (dateIndex != -1) cursor.getLong(dateIndex) else System.currentTimeMillis()
                    val duration = if (durationIndex != -1) cursor.getInt(durationIndex) else 0

                    val id = if (!rawId.isNullOrBlank()) rawId.trim() else "call_${date}_${count}"
                    val number = if (!rawNumber.isNullOrBlank()) rawNumber.trim() else "Unknown"

                    val callTypeStr = when (type) {
                        CallLog.Calls.INCOMING_TYPE -> "incoming"
                        CallLog.Calls.OUTGOING_TYPE -> "outgoing"
                        CallLog.Calls.MISSED_TYPE -> "missed"
                        5 -> "rejected"
                        6 -> "blocked"
                        4 -> "voicemail"
                        else -> "unknown"
                    }

                    val map = Arguments.createMap().apply {
                        putString("deviceCallId", id)
                        putString("phoneNumber", number)
                        if (name != null && name.isNotBlank()) putString("contactName", name.trim()) else putNull("contactName")
                        putString("callType", callTypeStr)
                        putInt("durationSeconds", duration)
                        putDouble("timestamp", date.toDouble())
                    }
                    array.pushMap(map)
                }
            }

            promise.resolve(array)
        } catch (e: Exception) {
            Log.e(NAME, "getCallLogs error: ${e.message}", e)
            promise.reject("GET_CALL_LOGS_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun syncCallLogs(promise: Promise) {
        try {
            val triggered = CareTrackLocationService.triggerCallLogSync()
            if (!triggered) {
                val context = reactApplicationContext
                val intent = Intent(context, CareTrackLocationService::class.java).apply {
                    action = "com.caretrack.child.SYNC_CALL_LOGS"
                }
                ContextCompat.startForegroundService(context, intent)
            }
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("SYNC_CALL_LOGS_ERROR", e.message, e)
        }
    }
}



