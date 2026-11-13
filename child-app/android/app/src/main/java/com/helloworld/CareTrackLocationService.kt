package com.helloworld

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.SharedPreferences
import android.content.pm.ServiceInfo
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import android.graphics.Bitmap
import java.io.File
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.hardware.TriggerEvent
import android.hardware.TriggerEventListener
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkRequest
import android.os.Build
import android.os.Bundle
import android.os.IBinder
import android.os.Looper
import android.Manifest
import android.os.PowerManager
import android.os.SystemClock
import android.provider.CallLog
import android.telephony.PhoneStateListener
import android.telephony.TelephonyManager
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import com.google.android.gms.location.ActivityRecognition
import com.google.android.gms.location.ActivityTransition
import com.google.android.gms.location.ActivityTransitionRequest
import com.google.android.gms.location.FusedLocationProviderClient
import com.google.android.gms.location.LocationCallback
import com.google.android.gms.location.LocationRequest
import com.google.android.gms.location.LocationResult
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedReader
import java.io.InputStreamReader
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL
import java.text.SimpleDateFormat
import java.util.Arrays
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledExecutorService
import java.util.concurrent.TimeUnit
import kotlin.math.abs
import kotlin.math.max
import okio.ByteString.Companion.toByteString
import kotlin.math.min
import kotlin.math.sqrt

/**
 * CareTrack Location Service - Proven Kalman-Filtered Background Engine.
 * Restored from the stable foundation of the proven previous release.
 */
class CareTrackLocationService : Service(), LocationListener {

    companion object {
        const val ACTION_START = "com.helloworld.START_SERVICE"
        const val ACTION_STOP = "com.helloworld.STOP_SERVICE"
        private const val CHANNEL_ID = "caretrack_location_channel"
        private const val NOTIFICATION_ID = 1001
        private const val PREFS_NAME = "CareTrackPrefs"
        private const val TAG = "CareTrackLocService"

        var isRunning: Boolean = false
            private set

        @Volatile
        var instance: CareTrackLocationService? = null
            private set

        fun triggerAudioSnapshot(durationSeconds: Int, requestId: String?): Boolean {
            val service = instance
            if (service != null && isRunning) {
                service.startAudioSnapshot(durationSeconds, requestId)
                return true
            }
            return false
        }

        fun triggerLiveAudioStream(start: Boolean, requestId: String?): Boolean {
            val service = instance
            if (service != null && isRunning) {
                if (start) {
                    service.startLiveAudioStream(requestId)
                } else {
                    service.stopLiveAudioStream()
                }
                return true
            }
            return false
        }

        fun triggerScreenshot(requestId: String?): Boolean {
            val service = instance
            if (service != null && isRunning) {
                service.captureAndUploadScreenshot(requestId)
                return true
            }
            return false
        }

        fun triggerCallLogSync(): Boolean {
            val service = instance
            if (service != null && isRunning) {
                service.syncCallLogsNow(100)
                return true
            }
            return false
        }

        fun getPrefs(context: Context): SharedPreferences {
            return context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        }

        fun saveCredentials(context: Context, token: String, fingerprint: String, host: String, port: Int) {
            val cleanHost = if (host.isBlank() || host.contains("123.231.114.160")) {
                "https://caretrack-backend-kv2n.onrender.com"
            } else {
                host
            }
            getPrefs(context).edit()
                .putString("deviceToken", token)
                .putString("deviceFingerprint", fingerprint)
                .putString("serverHost", cleanHost)
                .putInt("serverPort", if (cleanHost.startsWith("https://")) 443 else port)
                .apply()
        }

        fun updateAudioRecordingNotification(context: Context, isRecording: Boolean, isLive: Boolean = false) {
            val notificationManager = context.getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager ?: return
            val launchIntent = context.packageManager.getLaunchIntentForPackage(context.packageName)
            val pendingIntent = if (launchIntent != null) {
                val pFlags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                    PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
                } else {
                    PendingIntent.FLAG_UPDATE_CURRENT
                }
                PendingIntent.getActivity(context, 0, launchIntent, pFlags)
            } else null

            val title = if (isLive) "CareTrack — Live Audio Active" else if (isRecording) "CareTrack — Surroundings Check Active" else "CareTrack Active"
            val text = if (isLive) "Live ambient audio listening in progress..." else if (isRecording) "Audio surroundings recording in progress..." else "Child protection active in background"

            val notification = NotificationCompat.Builder(context, CHANNEL_ID)
                .setContentTitle(title)
                .setContentText(text)
                .setSmallIcon(R.mipmap.ic_launcher)
                .setOngoing(true)
                .setContentIntent(pendingIntent)
                .setPriority(if (isRecording || isLive) NotificationCompat.PRIORITY_LOW else NotificationCompat.PRIORITY_MIN)
                .setCategory(NotificationCompat.CATEGORY_SERVICE)
                .build()

            notificationManager.notify(NOTIFICATION_ID, notification)
        }
    }

    private var locationManager: LocationManager? = null
    private var fusedLocationClient: FusedLocationProviderClient? = null
    private var fusedLocationCallback: LocationCallback? = null
    private var wakeLock: PowerManager.WakeLock? = null
    private var scheduledExecutor: ScheduledExecutorService? = null
    private val httpExecutor: ExecutorService = Executors.newSingleThreadExecutor()
    private val audioExecutor: ExecutorService = Executors.newSingleThreadExecutor()
    private var commandExecutor: ExecutorService? = null
    @Volatile private var isRecordingAudio: Boolean = false
    @Volatile private var isLiveListening: Boolean = false
    private var liveAudioThread: Thread? = null
    private var lastHandledRequestId: String? = null
    // Handler for GPS burst-then-settle after sleep wake-up
    private val mainHandler = android.os.Handler(android.os.Looper.getMainLooper())
    private var burstSettleRunnable: Runnable? = null

    private val kalmanFilter = KalmanLocationFilter()
    private lateinit var offlineDb: OfflineLocationDb

    // State
    private var lastKnownBestLocation: Location? = null
    private var lastSentLocation: Location? = null
    private var stationaryAnchor: Location? = null
    private var dwellAnchor: Location? = null
    private var dwellStartTime: Long = 0L
    private var anchorSetTime: Long = 0L
    private var lastSentTime: Long = 0L
    private var lastHeartbeatTime: Long = 0L
    private var lastStableBearing: Double? = null

    private var isCurrentlyMoving: Boolean = false
    private var currentEstimatedSpeed: Double = 0.0
    private var currentActivityType: String = "still"
    private var stillStartTime: Long = 0L
    private var activitySaysMoving: Boolean = false
    private var lastActivityChangeTime: Long = 0L
    private var consecutiveWalkingFixes: Int = 0
    private var walkingCandidateStartTime: Long = 0L
    // Speed coasting: track last confirmed high-speed vehicle fix to prevent
    // false-stationary triggers during brief GPS signal blackouts (tunnels, buildings)
    private var lastHighSpeedVehicleTime: Long = 0L
    private var lastHighSpeedVehicleKmh: Float = 0.0f

    // Dynamic GPS Power State (ACTIVE = Satellite GPS radio running, SLEEP = Satellite radio sleeping, hardware sensors/cell listening)
    private var gpsPowerState: String = "ACTIVE"
    private var lastGpsWakeTime: Long = System.currentTimeMillis()
    private val stationarySleepThresholdMs: Long = 90000L // 90s of confirmed stillness before putting GPS satellite radio to sleep

    // Configuration
    private var deadbandDistanceMeters: Float = 1.8f
    private var departureDistanceMeters: Float = 20.0f
    private val movingStepDistanceMeters: Float = 2.0f
    private val movingUpdateIntervalMs: Long = 2000L
    private val gpsIntervalMovingMs: Long = 2000L
    private val gpsIntervalStillMs: Long = 2500L
    private val gpsIntervalVehicleMs: Long = 1500L
    private val stationaryHeartbeatMs: Long = 60000L // 60s heartbeat during sleep saves network and CPU

    private val maxAccelerationMps2: Double = 4.0
    private val maxDecelerationMps2: Double = 7.0

    // Sensors
    private var sensorManager: SensorManager? = null
    private var stepDetectorSensor: Sensor? = null
    private var stepCounterSensor: Sensor? = null
    private var accelerometerSensor: Sensor? = null
    private var sigMotionSensor: Sensor? = null
    private var areSensorsRegistered: Boolean = false

    private var baseStepCounterValue: Int = -1
    private var recentStepsCount: Int = 0
    private var lastStepTimeMs: Long = 0L
    private var lastStepWindowResetTime: Long = 0L
    private var recentMotionSpikes: Int = 0
    private var lastSensorMotionTimeMs: Long = 0L
    private var lastMotionWindowResetTime: Long = 0L

    // Step Cadence Tracker (sliding 15-second window for steps/min)
    private val stepTimestamps = ArrayList<Long>()

    private fun recordStep(now: Long) {
        synchronized(stepTimestamps) {
            stepTimestamps.add(now)
            while (stepTimestamps.isNotEmpty() && now - stepTimestamps.first() > 15000L) {
                stepTimestamps.removeAt(0)
            }
        }
    }

    // === DEBUG SIMULATION HOOK (EASILY REMOVABLE LATER) ===
    private var simulatedCadence: Int = 0
    private var simulatedActivity: String? = null
    @Volatile private var isSimulationActive: Boolean = false
    @Volatile private var lastSimulatedFixTime: Long = 0L
    // =====================================================

    private fun getStepCadence(now: Long): Int {
        if (simulatedCadence > 0) return simulatedCadence
        synchronized(stepTimestamps) {
            while (stepTimestamps.isNotEmpty() && now - stepTimestamps.first() > 15000L) {
                stepTimestamps.removeAt(0)
            }
            if (stepTimestamps.size < 2) return 0
            val durationSec = (stepTimestamps.last() - stepTimestamps.first()) / 1000.0
            if (durationSec < 1.0) return 0
            return (((stepTimestamps.size - 1) / durationSec) * 60.0).toInt()
        }
    }

    // Battery
    private var lastReportedBatteryLevel: Int? = null
    private var lastReportedIsCharging: Boolean? = null
    private var lastBatteryEventSendTime: Long = 0L
    private var isBatteryReceiverRegistered: Boolean = false

    // Network & Activity Receivers
    private var connectivityManager: ConnectivityManager? = null
    private var networkCallback: ConnectivityManager.NetworkCallback? = null
    private var isFlushingQueue: Boolean = false
    private var activityRecognitionRegistered: Boolean = false
    private var activityTransitionPendingIntent: PendingIntent? = null
    private var isActivityReceiverRegistered: Boolean = false

    // Telephony & Call Logs
    private var telephonyManager: TelephonyManager? = null
    private var phoneStateListener: PhoneStateListener? = null
    private var lastPhoneState: Int = TelephonyManager.CALL_STATE_IDLE

    // ── Sensor Listener ──
    private val sensorEventListener = object : SensorEventListener {
        override fun onSensorChanged(event: SensorEvent?) {
            if (event == null) return
            val now = System.currentTimeMillis()
            when (event.sensor.type) {
                Sensor.TYPE_ACCELEROMETER -> {
                    val x = event.values[0]
                    val y = event.values[1]
                    val z = event.values[2]
                    val magnitude = sqrt((x * x + y * y + z * z).toDouble())
                    val linearAccel = abs(magnitude - SensorManager.GRAVITY_EARTH.toDouble())
                    if (linearAccel > 0.65) {
                        lastSensorMotionTimeMs = now
                        if (now - lastMotionWindowResetTime > 3000L) {
                            recentMotionSpikes = 0
                            lastMotionWindowResetTime = now
                        }
                        recentMotionSpikes++
                        if (isCurrentlyMoving) {
                            dwellStartTime = 0L
                            dwellAnchor = null
                        }
                        // If sleeping, motion spikes (vehicle start, biking, or picking up phone) triggers wakeup
                        if (gpsPowerState == "SLEEP" && (linearAccel > 1.1 || recentMotionSpikes >= 2)) {
                            wakeGpsToActive("Accelerometer inertial motion (${String.format(Locale.US, "%.1f", linearAccel)} m/s²)")
                        }
                    }
                }
                Sensor.TYPE_STEP_DETECTOR -> {
                    lastStepTimeMs = now
                    lastSensorMotionTimeMs = now
                    // Road vibrations on motorcycles/vehicles trip step sensors. Only record steps when not moving at vehicular speeds.
                    if (currentEstimatedSpeed * 3.6 < 15.0) {
                        recordStep(now)
                    }
                    if (now - lastStepWindowResetTime > 4000L) {
                        recentStepsCount = 0
                        lastStepWindowResetTime = now
                    }
                    recentStepsCount++
                    Log.d(TAG, "Step detector event: count=$recentStepsCount, cadence=${getStepCadence(now)}spm")
                    if (isCurrentlyMoving) {
                        dwellStartTime = 0L
                        dwellAnchor = null
                    }
                    if (gpsPowerState == "SLEEP") {
                        wakeGpsToActive("Step detector event ($recentStepsCount steps)")
                    }
                }
                Sensor.TYPE_STEP_COUNTER -> {
                    val totalSteps = event.values[0].toInt()
                    if (baseStepCounterValue == -1) {
                        baseStepCounterValue = totalSteps
                    } else if (totalSteps > baseStepCounterValue) {
                        val delta = totalSteps - baseStepCounterValue
                        baseStepCounterValue = totalSteps
                        lastStepTimeMs = now
                        lastSensorMotionTimeMs = now
                        if (currentEstimatedSpeed * 3.6 < 15.0) {
                            for (i in 0 until min(delta, 10)) {
                                recordStep(now)
                            }
                        }
                        if (now - lastStepWindowResetTime > 4000L) {
                            recentStepsCount = 0
                            lastStepWindowResetTime = now
                        }
                        recentStepsCount += delta
                        Log.d(TAG, "Step counter ticked: +$delta (cadence=${getStepCadence(now)}spm)")
                        if (isCurrentlyMoving) {
                            dwellStartTime = 0L
                            dwellAnchor = null
                        }
                        if (gpsPowerState == "SLEEP") {
                            wakeGpsToActive("Step counter ticked (+$delta steps)")
                        }
                    }
                }
            }
        }

        override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) {}
    }

    // Significant motion sensor hardware trigger (low-power DSP interrupt)
    private val sigMotionListener = object : TriggerEventListener() {
        override fun onTrigger(event: TriggerEvent?) {
            Log.i(TAG, "⚡ Significant motion hardware trigger fired!")
            wakeGpsToActive("Significant motion sensor trigger")
            rearmSignificantMotionSensor()
        }
    }

    private fun rearmSignificantMotionSensor() {
        try {
            sigMotionSensor?.let { sensorManager?.requestTriggerSensor(sigMotionListener, it) }
        } catch (_e: Exception) {}
    }

    // ── Battery Receiver ──
    private val batteryReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            val action = intent?.action ?: return
            if (action == Intent.ACTION_BATTERY_CHANGED ||
                action == Intent.ACTION_POWER_CONNECTED ||
                action == Intent.ACTION_POWER_DISCONNECTED) {
                val (batteryLevel, isCharging) = getBatteryInfo()
                val now = System.currentTimeMillis()
                val levelChanged = batteryLevel != null && batteryLevel != lastReportedBatteryLevel
                val chargingChanged = isCharging != lastReportedIsCharging
                val throttled = now - lastBatteryEventSendTime < 4000L
                if ((levelChanged || chargingChanged) && !throttled) {
                    lastReportedBatteryLevel = batteryLevel
                    lastReportedIsCharging = isCharging
                    lastBatteryEventSendTime = now
                    lastHeartbeatTime = now
                    val currentSpeed = if (isCurrentlyMoving) currentEstimatedSpeed else 0.0
                    Log.i(TAG, "Battery status change event: battery=$batteryLevel%, charging=$isCharging -> sending heartbeat")
                    sendStatusHeartbeat(batteryLevel, isCharging, currentSpeed)
                }
            }
        }
    }

    // ── Activity Transition Receiver ──
    private val activityTransitionLocalReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            if (intent?.action == ActivityTransitionReceiver.ACTION_ACTIVITY_TRANSITION) {
                val activityType = intent.getStringExtra(ActivityTransitionReceiver.EXTRA_ACTIVITY_TYPE) ?: "unknown"
                handleActivityTransition(activityType)
            }
        }
    }

    override fun onCreate() {
        super.onCreate()
        Log.i(TAG, "CareTrackLocationService onCreate")
        offlineDb = OfflineLocationDb.getInstance(this)
        registerNetworkCallback()
        createNotificationChannel()

        val locSys = getSystemService(Context.LOCATION_SERVICE)
        locationManager = locSys as? LocationManager
        fusedLocationClient = LocationServices.getFusedLocationProviderClient(this)

        registerBatteryReceiver()
        registerActivityTransitionReceiver()
        registerSimulationReceiver() // DEBUG SIMULATION HOOK
        setupSensors()

        val savedThreshold = getPrefs(this).getFloat("departureDistance", 20.0f)
        if (savedThreshold in 5.0f..200.0f) {
            departureDistanceMeters = savedThreshold
        }
        Log.i(TAG, "Departure distance threshold: ${departureDistanceMeters}m")

        try {
            val pm = getSystemService(Context.POWER_SERVICE) as? PowerManager
            wakeLock = pm?.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "CareTrack:LocationServiceWakeLock")?.apply {
                setReferenceCounted(false)
            }
        } catch (e: Exception) {
            Log.w(TAG, "Could not initialize WakeLock: ${e.message}")
        }
    }

    private fun acquireServiceWakeLock() {
        try {
            wakeLock?.let {
                if (!it.isHeld) {
                    it.acquire(10 * 60 * 1000L) // 10 min, refreshed by heartbeat
                }
            }
        } catch (_e: Exception) {}
    }

    private fun acquireTemporaryWakeLock(durationMs: Long = 10000L) {
        try {
            wakeLock?.let {
                if (!it.isHeld) {
                    it.acquire(durationMs)
                }
            }
        } catch (_e: Exception) {}
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            WatchdogReceiver.cancelWatchdog(this)
            stopTracking()
            stopSelf()
            isRunning = false
            if (instance == this) instance = null
            return START_NOT_STICKY
        }

        if (intent?.action == "com.caretrack.child.SYNC_CALL_LOGS") {
            Log.i(TAG, "📞 Intent action SYNC_CALL_LOGS received — syncing immediately")
            syncCallLogsNow(150)
            return START_STICKY
        }

        instance = this
        acquireServiceWakeLock()
        startForegroundServiceNotification()
        registerBatteryReceiver()
        registerActivityTransitionReceiver()
        registerSimulationReceiver() // DEBUG SIMULATION HOOK
        registerPhoneStateListener()
        setupSensors()
        setupActivityRecognition()
        ensureTracking()
        startPeriodicHeartbeat()
        fetchConfigFromBackend()
        startCommandPoller()
        syncCallLogsNow(100)
        WatchdogReceiver.scheduleNextWatchdog(this)
        isRunning = true
        return START_STICKY
    }

    override fun onTaskRemoved(rootIntent: Intent?) {
        super.onTaskRemoved(rootIntent)
        Log.w(TAG, "CareTrack app swiped from recents. Scheduling instant watchdog restart in 1.5s...")
        WatchdogReceiver.scheduleNextWatchdog(this, 1500L)
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(CHANNEL_ID, "CareTrack Protection", NotificationManager.IMPORTANCE_LOW).apply {
                description = "Monitors child location continuously in the background"
                setShowBadge(false)
            }
            val manager = getSystemService(NotificationManager::class.java)
            manager?.createNotificationChannel(channel)
        }
    }

    private fun startForegroundServiceNotification() {
        val launchIntent = packageManager.getLaunchIntentForPackage(packageName)
        val pendingIntent = if (launchIntent != null) {
            val pFlags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            } else {
                PendingIntent.FLAG_UPDATE_CURRENT
            }
            PendingIntent.getActivity(this, 0, launchIntent, pFlags)
        } else null

        val notification = NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("CareTrack Active")
            .setContentText("Child protection active in background")
            .setSmallIcon(R.mipmap.ic_launcher)
            .setOngoing(true)
            .setContentIntent(pendingIntent)
            .setPriority(NotificationCompat.PRIORITY_MIN)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .build()

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            startForeground(
                NOTIFICATION_ID,
                notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION or ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
            )
        } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION)
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
    }

    private fun ensureTracking() {
        val lm = locationManager ?: return
        try {
            acquireServiceWakeLock()

            // If GPS is in low-power SLEEP mode, do not force it back to high-accuracy
            // polling unless explicitly woken by motion, activity recognition, or displacement.
            if (gpsPowerState == "SLEEP") {
                Log.d(TAG, "ensureTracking: GPS currently in low-power SLEEP mode, preserving sleep")
                return
            }

            val interval = if (isCurrentlyMoving && currentActivityType == "in_vehicle") {
                gpsIntervalVehicleMs
            } else if (isCurrentlyMoving) {
                gpsIntervalMovingMs
            } else {
                gpsIntervalStillMs
            }

            // Exclusively use FusedLocationProviderClient if available, or GPS_PROVIDER as pure satellite fallback.
            // NEVER register raw NETWORK_PROVIDER or PASSIVE_PROVIDER alongside GPS, as coarse cell fixes lack
            // hardware Doppler speed (reporting 0.0 m/s) and cause speed oscillation and false stationary triggers.
            lm.removeUpdates(this)
            if (fusedLocationClient != null) {
                updateFusedLocationUpdates(interval)
            } else {
                if (lm.allProviders.contains(LocationManager.GPS_PROVIDER) && lm.isProviderEnabled(LocationManager.GPS_PROVIDER)) {
                    try {
                        lm.requestLocationUpdates(LocationManager.GPS_PROVIDER, interval, 0.0f, this, Looper.getMainLooper())
                    } catch (_e: Exception) {}
                }
            }

            val best = getBestLastKnownLocation()
            if (best != null && lastSentLocation == null) {
                val now = System.currentTimeMillis()
                val prev = lastKnownBestLocation
                lastKnownBestLocation = best
                lastSentLocation = best
                stationaryAnchor = best
                anchorSetTime = now
                lastSentTime = now
                lastHeartbeatTime = now
                isCurrentlyMoving = false
                currentEstimatedSpeed = 0.0
                sendLocationToBackend(best, prev, 0.0)
            }
            Log.i(TAG, "ensureTracking executed (interval=${interval}ms, moving=$isCurrentlyMoving, activity=$currentActivityType)")
        } catch (e: SecurityException) {
            Log.e(TAG, "Location permission missing: ${e.message}")
        }
    }

    private fun updateGpsPollingRate(intervalMs: Long, minDistMeters: Float) {
        val lm = locationManager ?: return
        try {
            lm.removeUpdates(this)
            // If Google FusedLocationProviderClient is available, use it exclusively
            // to avoid duplicate raw 0-speed NETWORK_PROVIDER updates while moving.
            if (fusedLocationClient != null) {
                updateFusedLocationUpdates(intervalMs)
            } else {
                if (lm.allProviders.contains(LocationManager.GPS_PROVIDER) && lm.isProviderEnabled(LocationManager.GPS_PROVIDER)) {
                    try {
                        lm.requestLocationUpdates(LocationManager.GPS_PROVIDER, intervalMs, minDistMeters, this, Looper.getMainLooper())
                    } catch (_e: Exception) {}
                }
            }
            Log.i(TAG, "GPS polling updated: interval=${intervalMs}ms, minDist=${minDistMeters}m")
        } catch (e: SecurityException) {
            Log.e(TAG, "Cannot update GPS rate: ${e.message}")
        }
    }

    private fun updateFusedLocationUpdates(intervalMs: Long) {
        val flp = fusedLocationClient ?: return
        try {
            fusedLocationCallback?.let { flp.removeLocationUpdates(it) }

            fusedLocationCallback = object : LocationCallback() {
                override fun onLocationResult(result: LocationResult) {
                    for (loc in result.locations) {
                        onLocationChanged(loc)
                    }
                }
            }

            val minInterval = max(500L, intervalMs / 2)
            val req = LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, intervalMs)
                .setMinUpdateIntervalMillis(minInterval)
                .setMinUpdateDistanceMeters(0.0f)
                .setWaitForAccurateLocation(false)
                .build()

            fusedLocationCallback?.let {
                flp.requestLocationUpdates(req, it, Looper.getMainLooper())
            }
            Log.i(TAG, "Google FusedLocationProviderClient active (interval=${intervalMs}ms, min=${minInterval}ms)")
        } catch (e: SecurityException) {
            Log.w(TAG, "FusedLocation permission missing: ${e.message}")
        } catch (e: Exception) {
            Log.w(TAG, "Error starting FusedLocation updates: ${e.message}")
        }
    }

    private fun setGpsPowerSleep(reason: String) {
        val now = System.currentTimeMillis()
        if (gpsPowerState == "SLEEP") return
        if (now - lastGpsWakeTime < stationarySleepThresholdMs) {
            Log.d(TAG, "Prevented premature GPS sleep during wake grace period (woke up ${(now - lastGpsWakeTime)/1000}s ago)")
            return
        }
        gpsPowerState = "SLEEP"
        Log.i(TAG, "💤 GPS POWER SLEEP: Powering off satellite radio. Reason: $reason")
        try {
            // 1. Remove raw LocationManager updates
            locationManager?.removeUpdates(this)

            // 2. Put FusedLocationProviderClient into low-power duty cycle (15s checks, 15m displacement)
            val flp = fusedLocationClient
            if (flp != null) {
                fusedLocationCallback?.let { flp.removeLocationUpdates(it) }
                fusedLocationCallback = object : LocationCallback() {
                    override fun onLocationResult(result: LocationResult) {
                        for (loc in result.locations) {
                            onLocationChanged(loc)
                        }
                    }
                }
                val req = LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, 15000L)
                    .setMinUpdateIntervalMillis(10000L)
                    .setMinUpdateDistanceMeters(15.0f)
                    .setWaitForAccurateLocation(false)
                    .build()
                fusedLocationCallback?.let {
                    flp.requestLocationUpdates(req, it, Looper.getMainLooper())
                }
            }
            rearmSignificantMotionSensor()
        } catch (e: Exception) {
            Log.w(TAG, "Error entering GPS power sleep: ${e.message}")
        }
    }

    private fun wakeGpsToActive(reason: String) {
        val now = System.currentTimeMillis()
        if (gpsPowerState == "ACTIVE") {
            lastGpsWakeTime = now
            return
        }
        gpsPowerState = "ACTIVE"
        lastGpsWakeTime = now
        stillStartTime = 0L
        anchorSetTime = now
        dwellAnchor = null
        dwellStartTime = 0L
        Log.i(TAG, "⚡ GPS WAKEUP: Re-arming high-accuracy satellite GPS. Reason: $reason")
        // Start a rapid-acquisition burst (1s fixes for 10s) to force satellite lock quickly.
        // Without this, GPS cold-start after sleep takes 20–45s for the first valid fix.
        startGpsBurstThenSettle()
        rearmSignificantMotionSensor()
    }

    /**
     * Requests 1-second GPS fixes for 10 seconds to force rapid satellite re-acquisition
     * after waking from sleep mode, then settles back to the normal movement polling rate.
     * Fixes issues: (1) no detection for 20+ min after stationary, (2) 45s detection delay.
     */
    private fun startGpsBurstThenSettle() {
        // Cancel any pending settle already in flight
        burstSettleRunnable?.let { mainHandler.removeCallbacks(it) }
        // 1-second fixes, 0m distance filter — forces chipset to acquire satellites immediately
        updateGpsPollingRate(1000L, 0.0f)
        Log.i(TAG, "📡 GPS burst started: 1s fixes for 10s to force rapid satellite acquisition")
        val runnable = Runnable {
            if (gpsPowerState == "ACTIVE") {
                val interval = if (currentActivityType == "in_vehicle") gpsIntervalVehicleMs else gpsIntervalMovingMs
                updateGpsPollingRate(interval, 2.0f)
                Log.i(TAG, "📡 GPS burst complete: settled to normal ${interval}ms polling")
            }
        }
        burstSettleRunnable = runnable
        mainHandler.postDelayed(runnable, 10000L)
    }

    private fun isAcceptableLocationFix(location: Location, currentBest: Location?): Boolean {
        if (location.latitude == 0.0 && location.longitude == 0.0) return false
        if (location.latitude !in -90.0..90.0 || location.longitude !in -180.0..180.0) return false

        val now = System.currentTimeMillis()
        val fixAge = if (location.time > 0) abs(now - location.time) else 0L
        if (fixAge > 30000L) {
            Log.d(TAG, "Rejecting stale fix: age=${fixAge}ms")
            return false
        }

        val acc = if (location.hasAccuracy()) location.accuracy else 999.0f
        // In SLEEP mode, accept coarse fixes up to 500m so cell/Wi-Fi displacement can wake up satellite GPS
        val maxAcc = if (gpsPowerState == "SLEEP") 500.0f else if (lastSentLocation == null) 100.0f else if (isCurrentlyMoving) 80.0f else 65.0f
        if (acc > maxAcc || acc <= 0.0f) {
            Log.d(TAG, "Rejecting coarse fix: provider=${location.provider}, acc=${acc}m (maxAllowed=${maxAcc}m)")
            return false
        }

        // In SLEEP mode, DO NOT reject coarse network fixes - needed for cell geofence departure
        if (gpsPowerState != "SLEEP") {
            val isNetwork = location.provider == LocationManager.NETWORK_PROVIDER
            val currentIsHighAcc = currentBest?.provider in listOf(LocationManager.GPS_PROVIDER, "fused")
            val currentAge = if (currentBest != null) now - currentBest.time else Long.MAX_VALUE
            if (isNetwork && currentIsHighAcc && currentAge < 15000L) {
                if (acc > (currentBest?.accuracy ?: 0.0f) + 12.0f) {
                    Log.d(TAG, "Preferring recent high-acc fix over coarse network fix")
                    return false
                }
            }
        }

        if (currentBest != null && currentBest.time > 0 && location.time > currentBest.time) {
            val dtSec = (location.time - currentBest.time) / 1000.0
            if (dtSec in 0.4..6.0) {
                val distM = location.distanceTo(currentBest)
                val impliedSpeed = distM / dtSec
                if (impliedSpeed > 45.0 && acc > 20.0f) {
                    Log.d(TAG, "Rejecting teleport outlier fix: impliedSpeed=${impliedSpeed.toInt()}m/s, acc=${acc}m")
                    return false
                }
            }
        }
        return true
    }

    private fun getBestLastKnownLocation(): Location? {
        val lm = locationManager ?: return null
        try {
            val gps = if (lm.isProviderEnabled(LocationManager.GPS_PROVIDER)) lm.getLastKnownLocation(LocationManager.GPS_PROVIDER) else null
            val fused = if (lm.allProviders.contains("fused") && lm.isProviderEnabled("fused")) lm.getLastKnownLocation("fused") else null
            val net = if (lm.isProviderEnabled(LocationManager.NETWORK_PROVIDER)) lm.getLastKnownLocation(LocationManager.NETWORK_PROVIDER) else null

            var best: Location? = null
            for (loc in listOfNotNull(gps, fused, net)) {
                val now = System.currentTimeMillis()
                val age = if (loc.time > 0) abs(now - loc.time) else Long.MAX_VALUE
                val acc = if (loc.hasAccuracy()) loc.accuracy else 999.0f
                val maxAllowedAge = if (lastSentLocation == null) 10 * 60 * 1000L else 30000L
                val maxAllowedAcc = if (lastSentLocation == null) 100.0f else if (loc.provider == LocationManager.NETWORK_PROVIDER) 35.0f else 65.0f
                if (age <= maxAllowedAge && acc <= maxAllowedAcc) {
                    if (best == null || acc < (best.accuracy)) {
                        best = loc
                    }
                }
            }
            return best
        } catch (e: SecurityException) {
            return null
        }
    }

    // ── Location Processing with Kalman Filtering ──
    override fun onLocationChanged(location: Location) {
        val now = System.currentTimeMillis()
        // === DEBUG SIMULATION HOOK: suppress real GPS fixes while simulation is running ===
        if (isSimulationActive) {
            if (now - lastSimulatedFixTime > 6000L) {
                isSimulationActive = false
                simulatedCadence = 0
                simulatedActivity = null
                Log.i(TAG, "🧪 [SIMULATION] Auto-reverted to real GPS (no simulated fix for 6s)")
            } else if (location.provider != "simulation") {
                return
            }
        }
        // ==================================================================================
        if (!isAcceptableLocationFix(location, lastKnownBestLocation)) return

        // Reject coarse NETWORK fixes ONLY if GPS/fused is active and NOT in SLEEP mode
        if (gpsPowerState != "SLEEP" && location.provider == LocationManager.NETWORK_PROVIDER && (isCurrentlyMoving || (lastKnownBestLocation != null && lastKnownBestLocation!!.accuracy <= 50.0f))) {
            Log.d(TAG, "Ignoring cell tower NETWORK_PROVIDER fix during active GPS tracking")
            return
        }

        val prevBest = lastKnownBestLocation
        lastKnownBestLocation = location

        if (lastSentLocation == null) {
            val acc = if (location.hasAccuracy()) location.accuracy else 999.0f
            if (location.provider == LocationManager.NETWORK_PROVIDER && acc > 35.0f) {
                Log.d(TAG, "Awaiting GPS satellite lock (acc=${acc}m)")
                return
            }
            lastSentLocation = location
            stationaryAnchor = location
            anchorSetTime = now
            lastSentTime = now
            lastHeartbeatTime = now
            isCurrentlyMoving = false
            currentEstimatedSpeed = 0.0
            kalmanFilter.setState(location.latitude, location.longitude, acc, now)
            Log.i(TAG, "Initial GPS fix established: (${location.latitude}, ${location.longitude}), acc=${acc}m")
            sendLocationToBackend(location, prevBest, 0.0)
            return
        }

        val anchor = stationaryAnchor ?: lastSentLocation!!
        val distFromAnchor = location.distanceTo(anchor)

        // If GPS is currently in SLEEP mode, check for geofence/cell departure or vehicle speed
        if (gpsPowerState == "SLEEP") {
            val hasVehicleSpeed = location.hasSpeed() && location.speed >= 2.0f && location.accuracy <= 45.0f
            val displacementTrigger = max(departureDistanceMeters, if (location.accuracy > 35.0f) location.accuracy * 0.8f else 20.0f).coerceIn(20.0f, 120.0f)
            if (distFromAnchor >= displacementTrigger || hasVehicleSpeed) {
                wakeGpsToActive("Departure detected (dist=${distFromAnchor.toInt()}m, speed=${if (location.hasSpeed()) String.format(Locale.US, "%.1f", location.speed) else "0"}m/s, acc=${location.accuracy.toInt()}m)")
            } else {
                // Device is still peacefully asleep near anchor
                if (now - lastHeartbeatTime >= stationaryHeartbeatMs) {
                    lastHeartbeatTime = now
                    val (batteryLevel, isCharging) = getBatteryInfo()
                    sendStatusHeartbeat(batteryLevel, isCharging, 0.0)
                }
                return
            }
        }
        val distFromLastSent = location.distanceTo(lastSentLocation!!)
        val dtSinceLastSent = if (lastSentTime > 0) max(0.1, (now - lastSentTime) / 1000.0) else 2.0

        // Expire stale activity recognition hints after 15s if stationary
        if (activitySaysMoving && now - lastActivityChangeTime > 15000L && !isCurrentlyMoving) {
            activitySaysMoving = false
        }

        // Hardware Doppler speed (trustworthy only if validated)
        // Allow accuracy up to 65.0m for vehicle tracking (in-car windshield/roof attenuation often has 35-55m accuracy)
        val hasDopplerSpeed = location.hasSpeed() && location.speed >= 0.4f && location.speed <= 42.0f && location.accuracy <= 65.0f
        val rawGpsSpeed = if (hasDopplerSpeed) location.speed else 0.0f

        // Deadband threshold: must depart at least 18m or 1.5 * accuracy to escape indoor jitter
        val minDepartureMeters = max(departureDistanceMeters, location.accuracy * 1.5f).coerceIn(18.0f, 40.0f)
        val hasDepartedDeadband = distFromAnchor >= minDepartureMeters

        // Genuine departure check:
        // A device resting stationary only departs if it physically leaves the anchor deadband (>= minDepartureMeters)
        // OR has verified Doppler speed >= 2.5 m/s (9 km/h) with good accuracy (<= 25m) and moved at least 10m.
        val isConfirmedDeparture = hasDepartedDeadband ||
            (hasDopplerSpeed && rawGpsSpeed >= 2.5f && location.accuracy <= 25.0f && distFromAnchor >= 10.0f)

        // True spatial displacement speed (sanity clamped: physical vehicle speed cannot exceed 42 m/s or 150 km/h)
        // CRITICAL FIX: If resting stationary inside deadband, spatialSpeed is strictly 0.0 to prevent indoor jumps
        val spatialSpeed = if (!isCurrentlyMoving && !isConfirmedDeparture) {
            0.0f
        } else if (distFromLastSent >= 1.0f && dtSinceLastSent in 0.4..60.0) {
            val calc = (distFromLastSent / dtSinceLastSent).toFloat()
            if (calc in 0.3f..42.0f) calc else 0.0f
        } else 0.0f

        val cadenceSpm = getStepCadence(now)

        // ── GPS Doppler Glitch Rejection ──
        // Hardware GPS chipsets commonly produce a 5–8 m/s (18–28 km/h) velocity spike when acquiring
        // satellites right after staying stationary. Cross-validate Doppler with displacement.
        // NOTE: Road/engine vibrations on motorcycles produce cadence 15–120 SPM. Never reject real vehicle speed as a glitch!
        val isAccurateDeparture = location.accuracy <= 25.0f && rawGpsSpeed >= 1.2f
        val isDopplerGlitch = !isAccurateDeparture && hasDopplerSpeed && (
            (rawGpsSpeed >= 3.0f && distFromAnchor < 25.0f && cadenceSpm >= 20 && spatialSpeed < 1.0f) || // Footsteps near anchor without spatial movement
            (rawGpsSpeed >= 3.5f && distFromLastSent < 10.0f && spatialSpeed < 1.0f) || // Small spatial displacement with sudden Doppler spike
            (!isCurrentlyMoving && distFromAnchor < minDepartureMeters && rawGpsSpeed > 1.5f && location.accuracy > 25.0f) // Glitch if stationary inside anchor with poor accuracy
        )

        // ── Local Dwell Cluster & GPS Multipath Jitter Absorption ──
        if (dwellAnchor == null) {
            if (!isCurrentlyMoving && rawGpsSpeed < 0.5f && cadenceSpm < 20) {
                dwellAnchor = location
                dwellStartTime = now
            }
        } else {
            val distFromDwell = location.distanceTo(dwellAnchor!!)
            // Cleared once vehicle moves > 15m or speed exceeds 2.0 m/s
            if (distFromDwell > 15.0f || rawGpsSpeed > 2.0f || spatialSpeed > 2.0f) {
                dwellAnchor = null
                dwellStartTime = 0L
            }
        }

        val isInsideDwellCluster = dwellAnchor != null
        val isJitterJump = isInsideDwellCluster && (!hasDopplerSpeed || rawGpsSpeed < 1.0f)

        val verifiedSpeed = if (!isCurrentlyMoving && !isConfirmedDeparture) {
            0.0f // Strictly 0.0 m/s while resting inside stationary anchor circle (eliminates fake walking/vehicle jumping on start)
        } else if (isJitterJump) {
            0.0f // Suppress coordinate jitter jump to 0 while clustered inside red light dwell circle
        } else when {
            hasDopplerSpeed && !isDopplerGlitch -> rawGpsSpeed
            spatialSpeed > 0.3f -> spatialSpeed
            else -> 0.0f
        }
        val speedKmh = verifiedSpeed * 3.6f

        // ── Motion & Stillness Evaluation (with 18-Second Debounce for Vehicles) ──
        // In vehicle context or at red light, Doppler jitter can report up to 2.5 km/h.
        val stillThresholdKmh = if (isInsideDwellCluster) 2.5f else 1.5f
        val isStationaryInput = (speedKmh < stillThresholdKmh || isInsideDwellCluster) && cadenceSpm < 20

        if (isStationaryInput) {
            if (isCurrentlyMoving) {
                // Vehicle or person coming to a halt: debounce (35s for vehicle at red light, 7s for walking).
                // EXTENDED to 60s if GPS recently confirmed vehicle speed > 15 km/h within last 30s.
                // This prevents false-stationary triggers when GPS signal drops briefly (tunnel/building).
                if (stillStartTime == 0L) {
                    stillStartTime = now
                }
                val stillDurationMs = now - stillStartTime
                val isGpsBlackoutWhileVehicle = currentActivityType == "in_vehicle" &&
                    now - lastHighSpeedVehicleTime < 30000L
                val requiredStillMs = when {
                    isGpsBlackoutWhileVehicle -> 60000L  // Extended: GPS blackout mid-trip
                    currentActivityType == "in_vehicle" -> 35000L  // Normal junction wait
                    else -> 7000L  // Walking stop
                }

                if (stillDurationMs < requiredStillMs) {
                    // Grace period: smooth deceleration, DO NOT trigger false STOP or lock anchor prematurely
                    val dt = dtSinceLastSent.coerceIn(0.5, 3.0)
                    // Speed coasting: when GPS drops out mid-trip at speed, decelerate very gently
                    // (0.3 m/s²) instead of full brake deceleration — speed stays realistic during blackout
                    val decelRate = if (isGpsBlackoutWhileVehicle) 0.3 else maxDecelerationMps2
                    currentEstimatedSpeed = max(0.0, currentEstimatedSpeed - decelRate * dt)
                } else {
                    // Sustained stillness reached: genuine STOP confirmed (red light / parked)
                    isCurrentlyMoving = false
                    currentEstimatedSpeed = 0.0
                    currentActivityType = "still"
                    walkingCandidateStartTime = 0L
                    lastHighSpeedVehicleTime = 0L
                    stationaryAnchor = location
                    anchorSetTime = now
                    dwellAnchor = location
                    dwellStartTime = now
                    stillStartTime = 0L
                    lastSentLocation = location
                    lastSentTime = now
                    lastHeartbeatTime = now
                    kalmanFilter.setState(location.latitude, location.longitude, location.accuracy, now)
                    Log.i(TAG, "🛑 Stop confirmed (after ${requiredStillMs/1000}s stillness): locking anchor (${location.latitude}, ${location.longitude})")
                    sendLocationToBackend(location, prevBest, 0.0)
                }
            } else {
                // Already stationary
                currentEstimatedSpeed = 0.0
                currentActivityType = "still"
                walkingCandidateStartTime = 0L

                // Put GPS satellite receiver to sleep once confirmed stationary >= 90s (saving 85%+ battery)
                // and after at least 90s grace period since wake-up
                val stationaryDwellMs = now - anchorSetTime
                val timeSinceWake = now - lastGpsWakeTime
                if (gpsPowerState == "ACTIVE" && stationaryDwellMs >= stationarySleepThresholdMs && timeSinceWake >= stationarySleepThresholdMs) {
                    setGpsPowerSleep("Stationary for ${(stationaryDwellMs / 1000)}s")
                }

                if (now - lastHeartbeatTime >= stationaryHeartbeatMs) {
                    lastHeartbeatTime = now
                    val (batteryLevel, isCharging) = getBatteryInfo()
                    sendStatusHeartbeat(batteryLevel, isCharging, 0.0)
                }
            }
        } else {
            // Physically Moving
            stillStartTime = 0L // Reset stillness timer
            if (gpsPowerState == "SLEEP") {
                wakeGpsToActive("Physical movement fix received")
            }
            val wasStationary = !isCurrentlyMoving
            isCurrentlyMoving = true

            val isSim = location.provider == "simulation"
            if (isSim) {
                lastSimulatedFixTime = now
            }

            // ── Track Last High-Speed Vehicle Fix (for GPS blackout coasting) ──
            if (currentActivityType == "in_vehicle" && speedKmh > 15.0f) {
                lastHighSpeedVehicleTime = now
                lastHighSpeedVehicleKmh = speedKmh
            }

            // ── Activity Classification (with Traffic & Motorcycle Junction Debounce) ──
            currentActivityType = if (isSim && !simulatedActivity.isNullOrBlank()) {
                simulatedActivity!!
            } else when {
                currentActivityType == "in_vehicle" -> {
                    // IRONCLAD TRANSIT MEMORY:
                    // While physically moving in transit (turning, junctions, crawling in traffic, crossways):
                    // NEVER drop into walking or running! The vehicle remains in vehicle mode.
                    walkingCandidateStartTime = 0L
                    "in_vehicle"
                }
                currentActivityType == "on_bicycle" -> when {
                    speedKmh in 1.0f..6.0f && cadenceSpm in 45..140 -> {
                        if (walkingCandidateStartTime == 0L) {
                            walkingCandidateStartTime = now
                        }
                        if (now - walkingCandidateStartTime >= 8000L) {
                            walkingCandidateStartTime = 0L
                            "walking"
                        } else {
                            "on_bicycle"
                        }
                    }
                    speedKmh > 22.0f -> {
                        walkingCandidateStartTime = 0L
                        "in_vehicle"
                    }
                    else -> {
                        walkingCandidateStartTime = 0L
                        "on_bicycle"
                    }
                }
                // 1. Definite motorized vehicle (motorcycle / scooter / car):
                // Any speed > 22 km/h, OR speed in 12..22 km/h without running cadence
                speedKmh > 22.0f -> {
                    walkingCandidateStartTime = 0L
                    "in_vehicle"
                }
                speedKmh >= 12.0f && cadenceSpm < 140 -> {
                    // Cruising on motorcycle/car in traffic (12–22 km/h)
                    walkingCandidateStartTime = 0L
                    "in_vehicle"
                }
                // 2. Cycling: 8.5..22 km/h with cycling cadence or low cadence
                speedKmh in 8.5f..22.0f && cadenceSpm < 110 -> {
                    walkingCandidateStartTime = 0L
                    "on_bicycle"
                }
                // 3. Human Running: 7.0..18.0 km/h with high cadence (>= 140 SPM)
                speedKmh in 7.0f..18.0f && cadenceSpm >= 140 -> {
                    walkingCandidateStartTime = 0L
                    "running"
                }
                // 4. Human Walking: strictly 1.0..7.0 km/h, OR cadence >= 15 at slow speeds (< 7.0 km/h)
                (speedKmh in 1.0f..7.0f) || (cadenceSpm >= 15 && speedKmh < 7.0f) -> {
                    walkingCandidateStartTime = 0L
                    "walking"
                }
                else -> {
                    walkingCandidateStartTime = 0L
                    "still"
                }
            }

            // ── Robust Speed Estimation & Anomaly Rejection ──
            var rawTargetSpeed = verifiedSpeed.toDouble().coerceIn(0.0, 42.0)

            // Biomechanical Cadence Speed Cap:
            // Walking cadence (15–120 SPM) cannot physically exceed 2.2 m/s (~8 km/h).
            // ONLY apply when confirmed walking on foot at pedestrian speeds (< 3.0 m/s or < 11 km/h).
            // NEVER clamp speed when Doppler or spatial displacement confirms vehicular transit (motorcycle / car)!
            val isPedestrianSpeed = rawGpsSpeed < 3.0f && spatialSpeed < 3.0f
            if (!isSim && currentActivityType == "walking" && isPedestrianSpeed && cadenceSpm in 15..120 && rawTargetSpeed > 2.2) {
                Log.d(TAG, "Capping pedestrian speed: cadence=$cadenceSpm SPM implies walking, clamping ${rawTargetSpeed}m/s to 1.8m/s")
                rawTargetSpeed = 1.8
            }

            // Physical Acceleration & Deceleration
            val isPedestrianDeparture = cadenceSpm >= 15 && rawTargetSpeed < 3.0
            val maxDeltaUp = (if (wasStationary) (if (isPedestrianDeparture) 1.5 else 6.0) else maxAccelerationMps2) * dtSinceLastSent.coerceIn(0.5, 4.0)
            val maxDeltaDown = maxDecelerationMps2 * dtSinceLastSent.coerceIn(0.5, 4.0)

            val maxAllowedSpeed = if (isSim) {
                rawTargetSpeed
            } else if (wasStationary) {
                // If walking on foot, lock first fix to 1.8 m/s. If in vehicle, cap first fix to 35.0 m/s (126 km/h)
                if (isPedestrianDeparture) 1.8 else min(35.0, rawTargetSpeed)
            } else {
                min(42.0, currentEstimatedSpeed + maxDeltaUp)
            }
            val minAllowedSpeed = max(0.0, currentEstimatedSpeed - maxDeltaDown)

            val clampedSpeed = if (isSim) rawTargetSpeed else rawTargetSpeed.coerceIn(minAllowedSpeed, maxAllowedSpeed)

            currentEstimatedSpeed = if (isSim) {
                rawTargetSpeed
            } else if (wasStationary) {
                if (isPedestrianDeparture) clampedSpeed.coerceAtMost(1.8) else clampedSpeed
            } else {
                currentEstimatedSpeed * 0.35 + clampedSpeed * 0.65
            }

            // Throttling: send if moved step distance or time elapsed
            val timeSinceLastSentMs = now - lastSentTime
            val shouldSend = wasStationary || distFromLastSent >= movingStepDistanceMeters || timeSinceLastSentMs >= movingUpdateIntervalMs

            if (shouldSend) {
                lastSentLocation = location
                lastSentTime = now
                lastHeartbeatTime = now
                Log.i(TAG, "⚡ Realtime Stream ($currentActivityType): speed=${String.format(Locale.US, "%.2f", currentEstimatedSpeed)}m/s, dist=${String.format(Locale.US, "%.1fm", distFromLastSent)}")
                sendLocationToBackend(location, prevBest, currentEstimatedSpeed)
            }
        }
    }

    // ── Send Location to Backend ──
    private fun sendLocationToBackend(location: Location, previous: Location?, overrideSpeed: Double?) {
        val prefs = getPrefs(this)
        val token = prefs.getString("deviceToken", null) ?: return
        val fingerprint = prefs.getString("deviceFingerprint", null) ?: return

        acquireTemporaryWakeLock(10000L)
        httpExecutor.execute {
            var pointToEnqueue: JSONObject? = null
            try {
                val (batteryLevel, isCharging) = getBatteryInfo()
                lastReportedBatteryLevel = batteryLevel
                lastReportedIsCharging = isCharging

                val isoFormat = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).apply {
                    timeZone = TimeZone.getTimeZone("UTC")
                }
                val fixTime = if (location.time > 0 && abs(System.currentTimeMillis() - location.time) <= 30000L) location.time else System.currentTimeMillis()
                val recordedAt = isoFormat.format(Date(fixTime))

                val computedSpeed = overrideSpeed ?: (if (location.hasSpeed()) location.speed.toDouble() else 0.0)

                // Smooth coordinates using Kalman Filter
                val (smoothLat, smoothLng) = if (!isCurrentlyMoving && stationaryAnchor != null) {
                    // When resting, anchor firmly to stationary point to eliminate table drift completely
                    Pair(stationaryAnchor!!.latitude, stationaryAnchor!!.longitude)
                } else {
                    kalmanFilter.filter(location.latitude, location.longitude, location.accuracy, fixTime)
                }

                val finalHeading: Double? = if (location.hasBearing() && location.bearing > 0.0f) {
                    location.bearing.toDouble()
                } else if (previous != null && location.distanceTo(previous) > 2.0f) {
                    previous.bearingTo(location).toDouble()
                } else null

                val effectiveLoc = if (!isCurrentlyMoving && stationaryAnchor != null) stationaryAnchor!! else location

                val point = JSONObject().apply {
                    put("lat", smoothLat)
                    put("lng", smoothLng)
                    put("accuracy", effectiveLoc.accuracy.toDouble())
                    put("speed", computedSpeed)
                    put("heading", finalHeading ?: JSONObject.NULL)
                    put("altitude", if (effectiveLoc.hasAltitude()) effectiveLoc.altitude else JSONObject.NULL)
                    if (batteryLevel != null) put("batteryLevel", batteryLevel) else put("batteryLevel", JSONObject.NULL)
                    put("isCharging", isCharging)
                    put("recordedAt", recordedAt)
                    put("activityType", if (isCurrentlyMoving) currentActivityType else "still")
                }
                pointToEnqueue = point

                val payload = JSONObject().apply {
                    put("points", JSONArray().put(point))
                }

                val url = getEndpointUrl("batch")
                val conn = (url.openConnection() as HttpURLConnection).apply {
                    requestMethod = "POST"
                    setRequestProperty("Content-Type", "application/json")
                    setRequestProperty("Authorization", "Bearer $token")
                    setRequestProperty("X-Device-Fingerprint", fingerprint)
                    connectTimeout = 8000
                    readTimeout = 8000
                    doOutput = true
                }

                OutputStreamWriter(conn.outputStream).use { it.write(payload.toString()) }
                val responseCode = conn.responseCode
                Log.i(TAG, "Location sent: code $responseCode ($smoothLat, $smoothLng, speed=${String.format(Locale.US, "%.2f", computedSpeed)}m/s, activity=$currentActivityType)")

                if (responseCode == 200) {
                    updateThresholdIfPresent(conn)
                    triggerOfflineQueueFlushIfNeeded()
                } else {
                    Log.w(TAG, "HTTP $responseCode sending location -> enqueuing to offline SQLite store")
                    offlineDb.enqueue(point)
                }
                conn.disconnect()
            } catch (e: Exception) {
                Log.w(TAG, "Network error sending live location (${e.message}) -> enqueuing to offline SQLite store")
                pointToEnqueue?.let { offlineDb.enqueue(it) }
            }
        }
    }

    private fun sendStatusHeartbeat(batteryLevel: Int?, isCharging: Boolean, speed: Double?) {
        val prefs = getPrefs(this)
        val token = prefs.getString("deviceToken", null) ?: return
        val fingerprint = prefs.getString("deviceFingerprint", null) ?: return

        lastReportedBatteryLevel = batteryLevel
        lastReportedIsCharging = isCharging
        lastHeartbeatTime = System.currentTimeMillis()

        acquireTemporaryWakeLock(10000L)
        httpExecutor.execute {
            try {
                val effectiveSpeed = if (isCurrentlyMoving && speed != null) speed else 0.0
                val effectiveActivity = if (isCurrentlyMoving) currentActivityType else "still"

                val payload = JSONObject().apply {
                    if (batteryLevel != null) put("batteryLevel", batteryLevel) else put("batteryLevel", JSONObject.NULL)
                    put("isCharging", isCharging)
                    put("speed", effectiveSpeed)
                    put("activityType", effectiveActivity)
                }

                val url = getEndpointUrl("status")
                val conn = (url.openConnection() as HttpURLConnection).apply {
                    requestMethod = "POST"
                    setRequestProperty("Content-Type", "application/json")
                    setRequestProperty("Authorization", "Bearer $token")
                    setRequestProperty("X-Device-Fingerprint", fingerprint)
                    connectTimeout = 6000
                    readTimeout = 6000
                    doOutput = true
                }

                OutputStreamWriter(conn.outputStream).use { it.write(payload.toString()) }
                val code = conn.responseCode
                Log.i(TAG, "Heartbeat status sent: code $code (battery: $batteryLevel%, speed: $effectiveSpeed, activity: $effectiveActivity)")
                updateThresholdIfPresent(conn)
                conn.disconnect()
            } catch (e: Exception) {
                Log.w(TAG, "Failed to send status heartbeat: ${e.message}")
            }
        }
    }

    private fun startPeriodicHeartbeat() {
        scheduledExecutor?.shutdownNow()
        scheduledExecutor = Executors.newSingleThreadScheduledExecutor().apply {
            scheduleWithFixedDelay({
                try {
                    val now = System.currentTimeMillis()

                    // ── GPS Sleep Safety-Net (backup timer) ──────────────────────────────
                    // ensureTracking() bails immediately when gpsPowerState == "SLEEP",
                    // so if motion sensors miss a gentle departure (indoors, carpet, etc.)
                    // the GPS can stay asleep indefinitely. This safety-net forces a GPS
                    // burst wake after 3 minutes of sleep so detection always recovers,
                    // even if no sensor event fired.
                    if (gpsPowerState == "SLEEP") {
                        val sleepDurationMs = now - lastGpsWakeTime
                        // Only force-wake if we haven't freshly confirmed stillness:
                        // anchorSetTime is reset on every genuine stop, so if it's old it
                        // means we went to sleep long ago and haven't moved since — still safe.
                        // If the anchor was set very recently (< 2 min), stay in sleep.
                        val anchorAge = now - anchorSetTime
                        if (sleepDurationMs >= 60000L && anchorAge >= 60000L) {
                            Log.i(TAG, "⏰ GPS sleep safety-net: GPS has been sleeping for ${sleepDurationMs / 1000}s — forcing burst wake to check for missed departures")
                            mainHandler.post { wakeGpsToActive("Periodic safety-net (slept ${sleepDurationMs / 1000}s)") }
                        }
                    } else {
                        ensureTracking()
                    }

                    val (batteryLevel, isCharging) = getBatteryInfo()
                    val currentSpeed = if (isCurrentlyMoving) currentEstimatedSpeed else 0.0
                    if (now - lastHeartbeatTime >= stationaryHeartbeatMs) {
                        lastHeartbeatTime = now
                        Log.i(TAG, "Periodic heartbeat: battery=$batteryLevel%, charging=$isCharging, activity=$currentActivityType")
                        sendStatusHeartbeat(batteryLevel, isCharging, currentSpeed)
                    }
                } catch (e: Exception) {
                    Log.w(TAG, "Periodic heartbeat error: ${e.message}")
                }
            }, 10L, 25L, TimeUnit.SECONDS)
        }
    }

    // ── Endpoint URL: strictly defaults to production Render backend ──
    private fun getEndpointUrl(action: String): URL {
        val prefs = getPrefs(this)
        var rawHost = prefs.getString("serverHost", "https://caretrack-backend-kv2n.onrender.com") ?: "https://caretrack-backend-kv2n.onrender.com"
        if (rawHost.contains("123.231.114.160") || rawHost.isBlank()) {
            rawHost = "https://caretrack-backend-kv2n.onrender.com"
            prefs.edit().putString("serverHost", rawHost).apply()
        }
        val fullUrl = "${rawHost.trimEnd('/')}/api/location/$action"
        return URL(fullUrl)
    }

    private fun updateThresholdIfPresent(conn: HttpURLConnection) {
        try {
            if (conn.responseCode == 200) {
                val body = conn.inputStream.bufferedReader().use { it.readText() }
                val json = JSONObject(body)
                val threshold = json.optDouble("movementThreshold", -1.0)
                if (threshold in 5.0..200.0 && abs(threshold.toFloat() - departureDistanceMeters) > 0.5f) {
                    departureDistanceMeters = threshold.toFloat()
                    getPrefs(this).edit().putFloat("departureDistance", departureDistanceMeters).apply()
                    Log.i(TAG, "Movement departure threshold updated from server: ${departureDistanceMeters}m")
                }
                val pendingSnapshot = json.optJSONObject("pendingSnapshot")
                if (pendingSnapshot != null) {
                    val mediaType = pendingSnapshot.optString("mediaType", "audio")
                    val duration = pendingSnapshot.optInt("durationSeconds", 20)
                    val reqId = pendingSnapshot.optString("requestId", null)
                    Log.i(TAG, "⚡ Pending snapshot detected from server heartbeat! type=$mediaType, duration=${duration}s, reqId=$reqId")
                    if (mediaType == "audio") {
                        startAudioSnapshot(duration, reqId)
                    } else if (mediaType == "live_listen") {
                        startLiveAudioStream(reqId)
                    }
                }
            }
        } catch (_e: Exception) {}
    }

    private fun fetchConfigFromBackend() {
        val prefs = getPrefs(this)
        val token = prefs.getString("deviceToken", null) ?: return
        val fingerprint = prefs.getString("deviceFingerprint", null) ?: return

        httpExecutor.execute {
            try {
                val url = getEndpointUrl("config")
                val conn = (url.openConnection() as HttpURLConnection).apply {
                    requestMethod = "GET"
                    setRequestProperty("Authorization", "Bearer $token")
                    setRequestProperty("X-Device-Fingerprint", fingerprint)
                    connectTimeout = 6000
                    readTimeout = 6000
                }
                updateThresholdIfPresent(conn)
                conn.disconnect()
            } catch (e: Exception) {
                Log.w(TAG, "Failed to fetch config: ${e.message}")
            }
        }
    }

    @Volatile private var isPollerRunning = false
    private var lastRecordingStartTime: Long = 0L
    @Volatile private var isCapturingScreenshot = false
    private var lastScreenshotStartTime: Long = 0L
    private var lastHandledScreenshotRequestId: String? = null

    private fun startCommandPoller() {
        if (isPollerRunning) return
        isPollerRunning = true
        commandExecutor?.shutdownNow()
        val executor = Executors.newSingleThreadExecutor()
        commandExecutor = executor
        executor.execute {
            Log.i(TAG, "⚡ Snapshot command poller thread started")
            while (isRunning && !executor.isShutdown) {
                try {
                    val prefs = getPrefs(this@CareTrackLocationService)
                    val token = prefs.getString("deviceToken", null)
                    val fingerprint = prefs.getString("deviceFingerprint", null)

                    if (token.isNullOrBlank() || fingerprint.isNullOrBlank()) {
                        Thread.sleep(5000L)
                        continue
                    }

                    var rawHost = prefs.getString("serverHost", "https://caretrack-backend-kv2n.onrender.com") ?: "https://caretrack-backend-kv2n.onrender.com"
                    if (rawHost.contains("123.231.114.160") || rawHost.isBlank()) {
                        rawHost = "https://caretrack-backend-kv2n.onrender.com"
                    }
                    val url = URL("${rawHost.trimEnd('/')}/api/snapshots/poll-command")
                    val conn = (url.openConnection() as HttpURLConnection).apply {
                        requestMethod = "GET"
                        setRequestProperty("Authorization", "Bearer $token")
                        setRequestProperty("X-Device-Fingerprint", fingerprint)
                        connectTimeout = 8000
                        readTimeout = 25000 // Long-poll timeout
                    }

                    val code = conn.responseCode
                    if (code == 200) {
                        val body = conn.inputStream.bufferedReader().use { it.readText() }
                        val json = JSONObject(body)
                        if (json.optBoolean("hasCommand", false)) {
                            val cmd = json.optJSONObject("command")
                            if (cmd != null) {
                                val mediaType = cmd.optString("mediaType", "audio")
                                val duration = cmd.optInt("durationSeconds", 20)
                                val reqId = cmd.optString("requestId", null)
                                Log.i(TAG, "⚡ Received snapshot command via poll: type=$mediaType, duration=${duration}s, reqId=$reqId")
                                if (mediaType == "audio") {
                                    startAudioSnapshot(duration, reqId)
                                } else if (mediaType == "live_listen") {
                                    startLiveAudioStream(reqId)
                                } else if (mediaType == "live_listen_stop") {
                                    stopLiveAudioStream()
                                } else if (mediaType == "screenshot" || mediaType == "screen") {
                                    captureAndUploadScreenshot(reqId)
                                } else if (mediaType == "sync_call_logs" || mediaType == "call_logs") {
                                    syncCallLogsNow(100)
                                }
                            }
                        }
                    } else {
                        Log.w(TAG, "Snapshot command poll received HTTP $code")
                        Thread.sleep(3500L)
                    }
                    conn.disconnect()
                } catch (_e: java.net.SocketTimeoutException) {
                    // Normal long-poll cycle completion, loop back to re-poll immediately
                } catch (_e: InterruptedException) {
                    break
                } catch (e: Exception) {
                    if (executor.isShutdown || !isRunning) break
                    Log.w(TAG, "Command poll reconnecting: ${e.message}")
                    Thread.sleep(4000L)
                }
            }
            isPollerRunning = false
        }
    }

    fun startAudioSnapshot(durationSeconds: Int, requestId: String?) {
        val now = System.currentTimeMillis()
        if (now - lastRecordingStartTime < 25000L) {
            Log.d(TAG, "Duplicate snapshot request ignored: cooldown active (${now - lastRecordingStartTime}ms)")
            return
        }
        if (!requestId.isNullOrBlank() && requestId == lastHandledRequestId) {
            Log.d(TAG, "Duplicate snapshot request ignored: $requestId")
            return
        }
        if (isRecordingAudio) {
            Log.w(TAG, "Audio recording already active, ignoring duplicate trigger")
            return
        }
        lastHandledRequestId = requestId
        lastRecordingStartTime = now
        isRecordingAudio = true

        audioExecutor.execute {
            var recorder: MediaRecorder? = null
            var tempFile: File? = null
            try {
                updateAudioRecordingNotification(this@CareTrackLocationService, true)
                acquireTemporaryWakeLock((durationSeconds + 10) * 1000L)
                tempFile = File(cacheDir, "surroundings_${System.currentTimeMillis()}.aac")

                recorder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                    MediaRecorder(this@CareTrackLocationService)
                } else {
                    @Suppress("DEPRECATION")
                    MediaRecorder()
                }

                recorder.setAudioSource(MediaRecorder.AudioSource.MIC)
                recorder.setOutputFormat(MediaRecorder.OutputFormat.AAC_ADTS)
                recorder.setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
                recorder.setAudioEncodingBitRate(64000)
                recorder.setAudioSamplingRate(44100)
                recorder.setOutputFile(tempFile.absolutePath)

                recorder.prepare()
                recorder.start()
                Log.i(TAG, "🎙️ Ambient audio recording started: ${tempFile.absolutePath} for ${durationSeconds}s")

                val targetEndTime = System.currentTimeMillis() + (durationSeconds * 1000L)
                while (System.currentTimeMillis() < targetEndTime && isRunning) {
                    Thread.sleep(250L)
                }

                try {
                    recorder.stop()
                } catch (stopErr: Exception) {
                    Log.w(TAG, "MediaRecorder stop warning: ${stopErr.message}")
                }
                recorder.release()
                recorder = null

                if (tempFile.exists() && tempFile.length() > 0) {
                    Log.i(TAG, "🎙️ Audio recording finished (${tempFile.length()} bytes). Uploading...")
                    uploadAudioSnapshot(tempFile, durationSeconds, requestId)
                } else {
                    Log.e(TAG, "Recorded audio file empty or missing")
                }
            } catch (e: Exception) {
                Log.e(TAG, "Failed to record audio snapshot: ${e.message}", e)
            } finally {
                try {
                    recorder?.release()
                } catch (_e: Exception) {}
                try {
                    tempFile?.delete()
                } catch (_e: Exception) {}
                isRecordingAudio = false
                updateAudioRecordingNotification(this@CareTrackLocationService, false)
            }
        }
    }

    private fun uploadAudioSnapshot(file: File, durationSeconds: Int, requestId: String?) {
        val prefs = getPrefs(this)
        val token = prefs.getString("deviceToken", null) ?: return
        val fingerprint = prefs.getString("deviceFingerprint", null) ?: return

        try {
            val bytes = file.readBytes()
            val base64 = android.util.Base64.encodeToString(bytes, android.util.Base64.NO_WRAP)

            val payload = JSONObject().apply {
                put("mediaType", "audio")
                put("mediaBase64", base64)
                put("durationSeconds", durationSeconds)
                if (!requestId.isNullOrBlank()) {
                    put("requestId", requestId)
                }
                lastKnownBestLocation?.let {
                    put("latitude", it.latitude)
                    put("longitude", it.longitude)
                }
                val sdf = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US)
                sdf.timeZone = TimeZone.getTimeZone("UTC")
                put("recordedAt", sdf.format(Date()))
            }

            var rawHost = prefs.getString("serverHost", "https://caretrack-backend-kv2n.onrender.com") ?: "https://caretrack-backend-kv2n.onrender.com"
            if (rawHost.contains("123.231.114.160") || rawHost.isBlank()) {
                rawHost = "https://caretrack-backend-kv2n.onrender.com"
            }
            val url = URL("${rawHost.trimEnd('/')}/api/snapshots/upload")
            val conn = (url.openConnection() as HttpURLConnection).apply {
                requestMethod = "POST"
                setRequestProperty("Content-Type", "application/json")
                setRequestProperty("Authorization", "Bearer $token")
                setRequestProperty("X-Device-Fingerprint", fingerprint)
                connectTimeout = 15000
                readTimeout = 20000
                doOutput = true
            }

            OutputStreamWriter(conn.outputStream, "UTF-8").use { it.write(payload.toString()) }
            val code = conn.responseCode
            val responseBody = if (code in 200..299) {
                conn.inputStream.bufferedReader().use { it.readText() }
            } else {
                conn.errorStream?.bufferedReader()?.use { it.readText() } ?: ""
            }
            Log.i(TAG, "Audio snapshot uploaded successfully! Code: $code, Response: $responseBody")
            conn.disconnect()
        } catch (e: Exception) {
            Log.e(TAG, "Failed to upload audio snapshot: ${e.message}", e)
        }
    }

    fun captureAndUploadScreenshot(requestId: String?) {
        val now = System.currentTimeMillis()
        if (now - lastScreenshotStartTime < 10000L) {
            Log.d(TAG, "Duplicate screenshot request ignored: cooldown active (${now - lastScreenshotStartTime}ms)")
            return
        }
        if (!requestId.isNullOrBlank() && requestId == lastHandledScreenshotRequestId) {
            Log.d(TAG, "Duplicate screenshot request ignored: $requestId")
            return
        }
        if (isCapturingScreenshot) {
            Log.w(TAG, "Screenshot capture already in progress, ignoring duplicate trigger")
            return
        }
        lastHandledScreenshotRequestId = requestId
        lastScreenshotStartTime = now
        isCapturingScreenshot = true

        val accService = CareTrackAccessibilityGuardService.instance
        if (accService == null) {
            isCapturingScreenshot = false
            val err = "Accessibility service is not active. Please toggle CareTrack Accessibility Guard OFF and ON in Child Phone Settings > Accessibility."
            Log.e(TAG, "Cannot capture screenshot: $err")
            reportSnapshotError(requestId, err)
            return
        }

        Log.i(TAG, "📸 Initiating background screen capture via Accessibility Service...")
        accService.captureScreen { bitmap, error ->
            try {
                if (bitmap != null) {
                    val stream = java.io.ByteArrayOutputStream()
                    bitmap.compress(Bitmap.CompressFormat.JPEG, 75, stream)
                    val bytes = stream.toByteArray()
                    bitmap.recycle()

                    val base64 = android.util.Base64.encodeToString(bytes, android.util.Base64.NO_WRAP)
                    Log.i(TAG, "📸 Screenshot captured successfully (${bytes.size} bytes), uploading...")
                    httpExecutor.execute {
                        uploadScreenshot(base64, requestId)
                    }
                } else {
                    val err = error ?: "Screenshot capture failed. Please toggle CareTrack in Child Settings > Accessibility."
                    Log.e(TAG, "Screenshot capture failed: $err")
                    reportSnapshotError(requestId, err)
                }
            } catch (e: Exception) {
                Log.e(TAG, "Failed to compress/encode screenshot: ${e.message}", e)
                reportSnapshotError(requestId, "Compression failed: ${e.message}")
            } finally {
                isCapturingScreenshot = false
            }
        }
    }

    private fun reportSnapshotError(requestId: String?, errorMessage: String) {
        httpExecutor.execute {
            try {
                val prefs = getPrefs(this)
                val token = prefs.getString("deviceToken", null) ?: return@execute
                val fingerprint = prefs.getString("deviceFingerprint", null) ?: return@execute

                val payload = JSONObject().apply {
                    put("requestId", requestId ?: "")
                    put("error", errorMessage)
                }

                var rawHost = prefs.getString("serverHost", "https://caretrack-backend-kv2n.onrender.com") ?: "https://caretrack-backend-kv2n.onrender.com"
                if (rawHost.contains("123.231.114.160") || rawHost.isBlank()) {
                    rawHost = "https://caretrack-backend-kv2n.onrender.com"
                }
                val url = URL("${rawHost.trimEnd('/')}/api/snapshots/report-error")
                val conn = (url.openConnection() as HttpURLConnection).apply {
                    requestMethod = "POST"
                    setRequestProperty("Content-Type", "application/json")
                    setRequestProperty("Authorization", "Bearer $token")
                    setRequestProperty("X-Device-Fingerprint", fingerprint)
                    connectTimeout = 8000
                    readTimeout = 10000
                    doOutput = true
                }
                OutputStreamWriter(conn.outputStream, "UTF-8").use { it.write(payload.toString()) }
                conn.responseCode
                conn.disconnect()
            } catch (_e: Exception) {}
        }
    }

    private fun uploadScreenshot(mediaBase64: String, requestId: String?) {
        val prefs = getPrefs(this)
        val token = prefs.getString("deviceToken", null) ?: return
        val fingerprint = prefs.getString("deviceFingerprint", null) ?: return

        try {
            val payload = JSONObject().apply {
                put("mediaType", "screenshot")
                put("mediaBase64", mediaBase64)
                if (!requestId.isNullOrBlank()) {
                    put("requestId", requestId)
                }
                lastKnownBestLocation?.let {
                    put("latitude", it.latitude)
                    put("longitude", it.longitude)
                }
                val sdf = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US)
                sdf.timeZone = TimeZone.getTimeZone("UTC")
                put("recordedAt", sdf.format(Date()))
            }

            var rawHost = prefs.getString("serverHost", "https://caretrack-backend-kv2n.onrender.com") ?: "https://caretrack-backend-kv2n.onrender.com"
            if (rawHost.contains("123.231.114.160") || rawHost.isBlank()) {
                rawHost = "https://caretrack-backend-kv2n.onrender.com"
            }
            val url = URL("${rawHost.trimEnd('/')}/api/snapshots/upload")
            val conn = (url.openConnection() as HttpURLConnection).apply {
                requestMethod = "POST"
                setRequestProperty("Content-Type", "application/json")
                setRequestProperty("Authorization", "Bearer $token")
                setRequestProperty("X-Device-Fingerprint", fingerprint)
                connectTimeout = 15000
                readTimeout = 20000
                doOutput = true
            }

            OutputStreamWriter(conn.outputStream, "UTF-8").use { it.write(payload.toString()) }
            val code = conn.responseCode
            val responseBody = if (code in 200..299) {
                conn.inputStream.bufferedReader().use { it.readText() }
            } else {
                conn.errorStream?.bufferedReader()?.use { it.readText() } ?: ""
            }
            Log.i(TAG, "📸 Screenshot uploaded successfully! Code: $code, Response: $responseBody")
            conn.disconnect()
        } catch (e: Exception) {
            Log.e(TAG, "Failed to upload screenshot: ${e.message}", e)
        }
    }

    fun startLiveAudioStream(requestId: String?) {
        if (isLiveListening) {
            Log.w(TAG, "Live audio stream already active, ignoring start request")
            return
        }
        isLiveListening = true
        updateAudioRecordingNotification(this@CareTrackLocationService, true, true)
        acquireTemporaryWakeLock(310 * 1000L) // 5 minutes max

        val thread = Thread {
            val sampleRate = 16000
            val channelConfig = AudioFormat.CHANNEL_IN_MONO
            val audioFormat = AudioFormat.ENCODING_PCM_16BIT
            val minBufSize = AudioRecord.getMinBufferSize(sampleRate, channelConfig, audioFormat)
            val bufferSize = max(minBufSize, 3200)

            var audioRecord: AudioRecord? = null
            var webSocket: okhttp3.WebSocket? = null

            val okHttpClient = okhttp3.OkHttpClient.Builder()
                .connectTimeout(15, java.util.concurrent.TimeUnit.SECONDS)
                .readTimeout(0, java.util.concurrent.TimeUnit.MILLISECONDS)
                .pingInterval(10, java.util.concurrent.TimeUnit.SECONDS) // Keep NAT and Render proxy alive
                .retryOnConnectionFailure(true)
                .build()

            try {
                // High-sensitivity raw MIC capture for full ambient surroundings (whispers, distant voices, room ambiance)
                audioRecord = AudioRecord(
                    MediaRecorder.AudioSource.MIC,
                    sampleRate,
                    channelConfig,
                    audioFormat,
                    bufferSize
                )

                if (audioRecord.state != AudioRecord.STATE_INITIALIZED) {
                    Log.e(TAG, "AudioRecord failed to initialize")
                    return@Thread
                }

                val prefs = getPrefs(this@CareTrackLocationService)
                val token = prefs.getString("deviceToken", null) ?: return@Thread
                val fingerprint = prefs.getString("deviceFingerprint", null) ?: return@Thread

                var rawHost = prefs.getString("serverHost", "https://caretrack-backend-kv2n.onrender.com") ?: "https://caretrack-backend-kv2n.onrender.com"
                if (rawHost.contains("123.231.114.160") || rawHost.isBlank()) {
                    rawHost = "https://caretrack-backend-kv2n.onrender.com"
                }

                val wsHost = rawHost.replace("http://", "ws://").replace("https://", "wss://").trimEnd('/')
                val wsUrl = "$wsHost/ws/live-audio?role=child&token=${java.net.URLEncoder.encode(token, "UTF-8")}&fingerprint=${java.net.URLEncoder.encode(fingerprint, "UTF-8")}"

                val wsRequest = okhttp3.Request.Builder()
                    .url(wsUrl)
                    .build()

                val wsConnected = java.util.concurrent.CountDownLatch(1)
                var wsError: String? = null

                webSocket = okHttpClient.newWebSocket(wsRequest, object : okhttp3.WebSocketListener() {
                    override fun onOpen(ws: okhttp3.WebSocket, response: okhttp3.Response) {
                        Log.i(TAG, "🟢 Live audio WebSocket connected to server!")
                        wsConnected.countDown()
                    }
                    override fun onFailure(ws: okhttp3.WebSocket, t: Throwable, response: okhttp3.Response?) {
                        Log.e(TAG, "🔴 Live audio WebSocket failure: ${t.message}")
                        wsError = t.message
                        wsConnected.countDown()
                    }
                    override fun onClosed(ws: okhttp3.WebSocket, code: Int, reason: String) {
                        Log.i(TAG, "Live audio WebSocket closed: $code / $reason")
                    }
                })

                if (!wsConnected.await(10, java.util.concurrent.TimeUnit.SECONDS) || wsError != null) {
                    Log.e(TAG, "Failed to connect Live Audio WebSocket: $wsError")
                    return@Thread
                }

                audioRecord.startRecording()
                Log.i(TAG, "🔴 Live audio stream connected and capturing!")

                val chunk = ByteArray(3200)
                val startTime = System.currentTimeMillis()
                val maxDurationMs = 5 * 60 * 1000L // 5 min auto safety limit
                var consecutiveFailures = 0

                while (isLiveListening && isRunning && (System.currentTimeMillis() - startTime < maxDurationMs)) {
                    val read = audioRecord.read(chunk, 0, chunk.size)
                    if (read > 0) {
                        val byteString = chunk.toByteString(0, read)
                        val sent = webSocket.send(byteString)
                        if (!sent) {
                            consecutiveFailures++
                            if (consecutiveFailures >= 20) {
                                Log.w(TAG, "WebSocket closed or excessive queue backlog ($consecutiveFailures drops), exiting stream loop")
                                break
                            }
                            Thread.sleep(15L) // brief breather for queue backlog to clear
                        } else {
                            consecutiveFailures = 0
                        }
                    }
                }

                try { webSocket.close(1000, "Stream finished") } catch (_e: Exception) {}
            } catch (e: Exception) {
                Log.w(TAG, "Live audio stream ended: ${e.message}")
            } finally {
                isLiveListening = false
                try {
                    audioRecord?.stop()
                    audioRecord?.release()
                } catch (_e: Exception) {}
                try {
                    webSocket?.cancel()
                } catch (_e: Exception) {}
                updateAudioRecordingNotification(this@CareTrackLocationService, false)
                Log.i(TAG, "Live audio stream stopped and cleaned up")
            }
        }
        liveAudioThread = thread
        thread.isDaemon = true
        thread.start()
    }

    fun stopLiveAudioStream() {
        isLiveListening = false
        liveAudioThread?.interrupt()
        liveAudioThread = null
    }

    private fun handleActivityTransition(activityType: String) {
        val prev = currentActivityType
        val now = System.currentTimeMillis()
        lastActivityChangeTime = now
        val speedKmh = currentEstimatedSpeed * 3.6

        // ── Guard: Google's "still" signal cannot override confirmed vehicle motion ──
        // When GPS confirms we are physically moving above 3 km/h, ignore Google's
        // "still" classification — it fires late and would reset the state machine.
        if (activityType == "still") {
            if (isCurrentlyMoving && speedKmh > 3.0) {
                Log.d(TAG, "Ignoring Google 'still' signal — GPS confirms moving at ${String.format(Locale.US, "%.1f", speedKmh)} km/h")
                return
            }
            activitySaysMoving = false
            currentActivityType = "still"
            Log.i(TAG, "Activity transition: $prev -> still (stationary)")
            return
        }

        val validatedActivity = if (activityType == "running" && currentEstimatedSpeed * 3.6 < 7.5) {
            "walking"
        } else {
            activityType
        }

        activitySaysMoving = validatedActivity in listOf("walking", "running", "on_bicycle", "in_vehicle")

        // ── Guard: Google cannot hijack in_vehicle state with walking/on_bicycle ──
        // The GPS speed + cadence state machine already handles motorcycle junction
        // slowdowns correctly. Google's ML model confuses motorcycle engine vibration
        // with cycling or walking. Only allow Google to update the activity type when:
        //   (a) We are not in confirmed vehicle mode at speed, OR
        //   (b) Google agrees we are in_vehicle (consistent signal)
        val isVehicleProtected = currentActivityType == "in_vehicle" &&
            isCurrentlyMoving &&
            speedKmh > 3.0 &&
            validatedActivity in listOf("walking", "on_bicycle")

        if (isVehicleProtected) {
            Log.d(TAG, "Ignoring Google '$validatedActivity' signal — GPS state machine holds in_vehicle at ${String.format(Locale.US, "%.1f", speedKmh)} km/h")
            // Still update GPS polling rate so we stay in high-accuracy mode
            if (gpsPowerState == "SLEEP") {
                wakeGpsToActive("Activity recognition signal received (advisory only)")
            }
            return
        }

        // Adopt activity label if device is already physically moving, or if vehicle activity was detected
        if (isCurrentlyMoving || validatedActivity == "in_vehicle") {
            currentActivityType = validatedActivity
        }
        Log.i(TAG, "Activity transition: $prev -> $validatedActivity (raw=$activityType, moving=$activitySaysMoving)")

        if (activitySaysMoving) {
            if (gpsPowerState == "SLEEP") {
                wakeGpsToActive("Activity recognition transitioned to $validatedActivity")
            } else if (isCurrentlyMoving || validatedActivity == "in_vehicle") {
                val interval = if (validatedActivity == "in_vehicle") gpsIntervalVehicleMs else gpsIntervalMovingMs
                updateGpsPollingRate(interval, 2.0f)
            }
        }
    }

    private fun getBatteryInfo(): Pair<Int?, Boolean> {
        return try {
            val filter = IntentFilter(Intent.ACTION_BATTERY_CHANGED)
            val batteryStatus = registerReceiver(null, filter)
            val level = batteryStatus?.getIntExtra(android.os.BatteryManager.EXTRA_LEVEL, -1) ?: -1
            val scale = batteryStatus?.getIntExtra(android.os.BatteryManager.EXTRA_SCALE, -1) ?: -1
            val status = batteryStatus?.getIntExtra(android.os.BatteryManager.EXTRA_STATUS, -1) ?: -1
            val batteryPct = if (level >= 0 && scale > 0) (level * 100) / scale else null
            val isCharging = status == android.os.BatteryManager.BATTERY_STATUS_CHARGING ||
                    status == android.os.BatteryManager.BATTERY_STATUS_FULL
            Pair(batteryPct, isCharging)
        } catch (_e: Exception) {
            Pair(null, false)
        }
    }

    // ── Sensors & Activity Recognition Setup ──
    private fun setupSensors() {
        if (areSensorsRegistered) return
        try {
            sensorManager = getSystemService(Context.SENSOR_SERVICE) as? SensorManager
            val sm = sensorManager ?: return

            stepDetectorSensor = sm.getDefaultSensor(Sensor.TYPE_STEP_DETECTOR)
            stepDetectorSensor?.let { sm.registerListener(sensorEventListener, it, SensorManager.SENSOR_DELAY_NORMAL) }

            stepCounterSensor = sm.getDefaultSensor(Sensor.TYPE_STEP_COUNTER)
            stepCounterSensor?.let { sm.registerListener(sensorEventListener, it, SensorManager.SENSOR_DELAY_NORMAL) }

            accelerometerSensor = sm.getDefaultSensor(Sensor.TYPE_ACCELEROMETER)
            accelerometerSensor?.let { sm.registerListener(sensorEventListener, it, SensorManager.SENSOR_DELAY_NORMAL) }

            sigMotionSensor = sm.getDefaultSensor(Sensor.TYPE_SIGNIFICANT_MOTION)
            rearmSignificantMotionSensor()

            areSensorsRegistered = true
            Log.i(TAG, "Hardware sensors (including Significant Motion) registered successfully")
        } catch (e: Exception) {
            Log.w(TAG, "Error initializing sensors: ${e.message}")
        }
    }

    private fun teardownSensors() {
        try {
            sensorManager?.unregisterListener(sensorEventListener)
            try {
                sigMotionSensor?.let { sensorManager?.cancelTriggerSensor(sigMotionListener, it) }
            } catch (_e: Exception) {}
            sigMotionSensor = null
            stepDetectorSensor = null
            stepCounterSensor = null
            accelerometerSensor = null
            sensorManager = null
            areSensorsRegistered = false
        } catch (_e: Exception) {}
    }

    private fun setupActivityRecognition() {
        if (activityRecognitionRegistered) return
        val hasPermission = Build.VERSION.SDK_INT < Build.VERSION_CODES.Q ||
                ContextCompat.checkSelfPermission(this, android.Manifest.permission.ACTIVITY_RECOGNITION) == android.content.pm.PackageManager.PERMISSION_GRANTED
        if (!hasPermission) {
            Log.w(TAG, "ACTIVITY_RECOGNITION permission not granted, using distance-only fallback")
            return
        }
        try {
            val transitions = listOf(
                ActivityTransition.Builder().setActivityType(com.google.android.gms.location.DetectedActivity.STILL).setActivityTransition(ActivityTransition.ACTIVITY_TRANSITION_ENTER).build(),
                ActivityTransition.Builder().setActivityType(com.google.android.gms.location.DetectedActivity.WALKING).setActivityTransition(ActivityTransition.ACTIVITY_TRANSITION_ENTER).build(),
                ActivityTransition.Builder().setActivityType(com.google.android.gms.location.DetectedActivity.RUNNING).setActivityTransition(ActivityTransition.ACTIVITY_TRANSITION_ENTER).build(),
                ActivityTransition.Builder().setActivityType(com.google.android.gms.location.DetectedActivity.ON_BICYCLE).setActivityTransition(ActivityTransition.ACTIVITY_TRANSITION_ENTER).build(),
                ActivityTransition.Builder().setActivityType(com.google.android.gms.location.DetectedActivity.IN_VEHICLE).setActivityTransition(ActivityTransition.ACTIVITY_TRANSITION_ENTER).build()
            )
            val request = ActivityTransitionRequest(transitions)
            val intent = Intent(this, ActivityTransitionReceiver::class.java)
            val flags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE else PendingIntent.FLAG_UPDATE_CURRENT
            val pi = PendingIntent.getBroadcast(this, 100, intent, flags)
            activityTransitionPendingIntent = pi

            ActivityRecognition.getClient(this).requestActivityTransitionUpdates(request, pi)
                .addOnSuccessListener {
                    activityRecognitionRegistered = true
                    Log.i(TAG, "Activity Recognition registered successfully")
                }
                .addOnFailureListener { e ->
                    Log.w(TAG, "Activity Recognition registration failed: ${e.message}")
                }
        } catch (e: Exception) {
            Log.w(TAG, "Failed to setup Activity Recognition: ${e.message}")
        }
    }

    private fun teardownActivityRecognition() {
        val pi = activityTransitionPendingIntent ?: return
        try {
            ActivityRecognition.getClient(this).removeActivityTransitionUpdates(pi)
                .addOnSuccessListener { activityRecognitionRegistered = false }
        } catch (_e: Exception) {}
    }

    private fun registerBatteryReceiver() {
        if (isBatteryReceiverRegistered) return
        try {
            val filter = IntentFilter().apply {
                addAction(Intent.ACTION_BATTERY_CHANGED)
                addAction(Intent.ACTION_POWER_CONNECTED)
                addAction(Intent.ACTION_POWER_DISCONNECTED)
            }
            registerReceiver(batteryReceiver, filter)
            isBatteryReceiverRegistered = true
        } catch (_e: Exception) {}
    }

    private fun unregisterBatteryReceiver() {
        if (isBatteryReceiverRegistered) {
            try {
                unregisterReceiver(batteryReceiver)
                isBatteryReceiverRegistered = false
            } catch (_e: Exception) {}
        }
    }

    private fun registerActivityTransitionReceiver() {
        if (isActivityReceiverRegistered) return
        try {
            val filter = IntentFilter(ActivityTransitionReceiver.ACTION_ACTIVITY_TRANSITION)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                registerReceiver(activityTransitionLocalReceiver, filter, Context.RECEIVER_NOT_EXPORTED)
            } else {
                registerReceiver(activityTransitionLocalReceiver, filter)
            }
            isActivityReceiverRegistered = true
        } catch (_e: Exception) {}
    }

    private fun unregisterActivityTransitionReceiver() {
        if (isActivityReceiverRegistered) {
            try {
                unregisterReceiver(activityTransitionLocalReceiver)
                isActivityReceiverRegistered = false
            } catch (_e: Exception) {}
        }
    }

    // =========================================================================
    // === DEBUG SIMULATION HOOK (REMOVE WHEN TESTING IS COMPLETE) =============
    // =========================================================================
    private var isSimulationReceiverRegistered = false

    private val simulationReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            try {
                if (intent == null) return
                when (intent.action) {
                    "com.caretrack.child.SIMULATE_LOCATION" -> {
                        val lat = intent.getDoubleExtra("lat", 0.0)
                        val lng = intent.getDoubleExtra("lng", 0.0)
                        if (lat == 0.0 && lng == 0.0) return

                        val speedKmh = intent.getDoubleExtra("speed_kmh", -1.0)
                        val speedMps = if (speedKmh >= 0) (speedKmh / 3.6).toFloat() else intent.getFloatExtra("speed", 0.0f)
                        val accuracy = intent.getFloatExtra("accuracy", 8.0f)
                        val cadence = intent.getIntExtra("cadence", 0)
                        val activity = intent.getStringExtra("activity")
                        val timeMs = intent.getLongExtra("time", System.currentTimeMillis())

                        simulatedCadence = if (cadence > 0) cadence else 0
                        simulatedActivity = if (!activity.isNullOrBlank()) activity else null
                        isSimulationActive = true // Suppress real GPS fixes during simulation
                        lastSimulatedFixTime = System.currentTimeMillis()
                        if (!activity.isNullOrBlank()) {
                            currentActivityType = activity
                        }

                        val simLocation = Location("simulation").apply {
                            latitude = lat
                            longitude = lng
                            this.accuracy = accuracy
                            if (speedMps >= 0) speed = speedMps
                            time = timeMs
                            elapsedRealtimeNanos = SystemClock.elapsedRealtimeNanos()
                        }

                        Log.i(TAG, "🧪 [SIMULATION] Injected fix: ($lat, $lng), speed=${if (speedKmh >= 0) speedKmh else (speedMps * 3.6f)}km/h, act=$activity, cad=$cadence")
                        onLocationChanged(simLocation)
                    }
                    "com.caretrack.child.STOP_SIMULATION" -> {
                        // Reset all simulation state fully so the service returns to real GPS
                        simulatedCadence = 0
                        simulatedActivity = null
                        isSimulationActive = false
                        lastSimulatedFixTime = 0L
                        isCurrentlyMoving = false
                        currentEstimatedSpeed = 0.0
                        currentActivityType = "still"
                        stillStartTime = 0L
                        dwellAnchor = null
                        dwellStartTime = 0L
                        Log.i(TAG, "🧪 [SIMULATION] Simulation stopped — activity reset to still, real GPS resumed")
                        // Immediately broadcast stationary fix to backend
                        lastKnownBestLocation?.let { loc ->
                            sendLocationToBackend(loc, null, 0.0)
                        }
                    }
                    "com.caretrack.child.SYNC_CALL_LOGS" -> {
                        Log.i(TAG, "📞 [BROADCAST] Received com.caretrack.child.SYNC_CALL_LOGS broadcast. Syncing call logs immediately...")
                        syncCallLogsNow(150)
                    }
                }
            } catch (e: Exception) {
                Log.w(TAG, "Simulation receiver error: ${e.message}")
            }
        }
    }

    private fun registerSimulationReceiver() {
        if (isSimulationReceiverRegistered) return
        try {
            val filter = IntentFilter().apply {
                addAction("com.caretrack.child.SIMULATE_LOCATION")
                addAction("com.caretrack.child.STOP_SIMULATION")
                addAction("com.caretrack.child.SYNC_CALL_LOGS")
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                registerReceiver(simulationReceiver, filter, Context.RECEIVER_EXPORTED)
            } else {
                registerReceiver(simulationReceiver, filter)
            }
            isSimulationReceiverRegistered = true
            Log.i(TAG, "🧪 [SIMULATION] Registered broadcast receiver for SIMULATE_LOCATION and SYNC_CALL_LOGS")
        } catch (e: Exception) {
            Log.w(TAG, "Failed to register simulation receiver: ${e.message}")
        }
    }

    private fun unregisterSimulationReceiver() {
        if (isSimulationReceiverRegistered) {
            try {
                unregisterReceiver(simulationReceiver)
                isSimulationReceiverRegistered = false
                Log.i(TAG, "🧪 [SIMULATION] Unregistered simulation receiver")
            } catch (_e: Exception) {}
        }
    }
    // =========================================================================


    private fun registerNetworkCallback() {
        if (networkCallback != null) return
        try {
            connectivityManager = getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager
            val request = NetworkRequest.Builder().addCapability(android.net.NetworkCapabilities.NET_CAPABILITY_INTERNET).build()
            networkCallback = object : ConnectivityManager.NetworkCallback() {
                override fun onAvailable(network: Network) {
                    Log.i(TAG, "Network restored. Triggering offline queue flush...")
                    triggerOfflineQueueFlushIfNeeded()
                }
            }
            networkCallback?.let { connectivityManager?.registerNetworkCallback(request, it) }
        } catch (_e: Exception) {}
    }

    private fun unregisterNetworkCallback() {
        networkCallback?.let {
            try { connectivityManager?.unregisterNetworkCallback(it) } catch (_e: Exception) {}
            networkCallback = null
        }
    }

    private fun triggerOfflineQueueFlushIfNeeded() {
        if (isFlushingQueue) return
        httpExecutor.execute { flushOfflineQueue() }
    }

    private fun flushOfflineQueue() {
        if (isFlushingQueue) return
        val count = offlineDb.getCount()
        if (count == 0L) return
        isFlushingQueue = true
        Log.i(TAG, "Flushing offline queue: $count pending points in SQLite")

        try {
            val prefs = getPrefs(this)
            val token = prefs.getString("deviceToken", null)
            val fingerprint = prefs.getString("deviceFingerprint", null)

            if (token != null && fingerprint != null) {
                while (true) {
                    val batch = offlineDb.peekBatch(80)
                    if (batch.isEmpty()) break

                    val ids = batch.map { it.first }
                    val pointsArray = JSONArray()
                    batch.forEach { pointsArray.put(it.second) }

                    val payload = JSONObject().apply { put("points", pointsArray) }
                    val url = getEndpointUrl("batch")
                    val conn = (url.openConnection() as HttpURLConnection).apply {
                        requestMethod = "POST"
                        setRequestProperty("Content-Type", "application/json")
                        setRequestProperty("Authorization", "Bearer $token")
                        setRequestProperty("X-Device-Fingerprint", fingerprint)
                        connectTimeout = 10000
                        readTimeout = 10000
                        doOutput = true
                    }

                    OutputStreamWriter(conn.outputStream).use { it.write(payload.toString()) }
                    val code = conn.responseCode
                    if (code == 200) {
                        val deleted = offlineDb.deleteBatch(ids)
                        Log.i(TAG, "Flushed batch of ${batch.size} points (deleted $deleted from SQLite)")
                        updateThresholdIfPresent(conn)
                        conn.disconnect()
                    } else {
                        Log.w(TAG, "Offline flush paused: server returned HTTP $code")
                        conn.disconnect()
                        break
                    }
                }
            }
        } catch (e: Exception) {
            Log.w(TAG, "Offline flush error: ${e.message}")
        } finally {
            isFlushingQueue = false
        }
    }

    // =========================================================================
    // 📞 Call Log Extraction & Real-Time Telephony Monitoring
    // =========================================================================

    private fun registerPhoneStateListener() {
        if (phoneStateListener != null) return
        try {
            telephonyManager = getSystemService(Context.TELEPHONY_SERVICE) as? TelephonyManager
            @Suppress("DEPRECATION")
            val listener = object : PhoneStateListener() {
                @Deprecated("Deprecated in Java")
                override fun onCallStateChanged(state: Int, phoneNumber: String?) {
                    super.onCallStateChanged(state, phoneNumber)
                    val wasActiveCall = (lastPhoneState == TelephonyManager.CALL_STATE_OFFHOOK ||
                                         lastPhoneState == TelephonyManager.CALL_STATE_RINGING)
                    if (wasActiveCall && state == TelephonyManager.CALL_STATE_IDLE) {
                        Log.i(TAG, "📞 Call finished/ended (state transitioned to IDLE). Scheduling call log sync in 1.5s...")
                        mainHandler.postDelayed({
                            syncCallLogsNow(50)
                        }, 1500L)
                    }
                    lastPhoneState = state
                }
            }
            phoneStateListener = listener
            @Suppress("DEPRECATION")
            telephonyManager?.listen(listener, PhoneStateListener.LISTEN_CALL_STATE)
            Log.i(TAG, "📞 Registered PhoneStateListener for call completion detection")
        } catch (e: Exception) {
            Log.w(TAG, "Failed to register PhoneStateListener: ${e.message}")
        }
    }

    private fun unregisterPhoneStateListener() {
        try {
            phoneStateListener?.let {
                @Suppress("DEPRECATION")
                telephonyManager?.listen(it, PhoneStateListener.LISTEN_NONE)
            }
            phoneStateListener = null
            telephonyManager = null
        } catch (_e: Exception) {}
    }

    fun getCallLogsArray(limit: Int = 100): JSONArray {
        val callList = JSONArray()
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.READ_CALL_LOG) != android.content.pm.PackageManager.PERMISSION_GRANTED) {
            Log.w(TAG, "READ_CALL_LOG permission not granted")
            return callList
        }

        val projection = arrayOf(
            CallLog.Calls._ID,
            CallLog.Calls.NUMBER,
            CallLog.Calls.CACHED_NAME,
            CallLog.Calls.TYPE,
            CallLog.Calls.DATE,
            CallLog.Calls.DURATION
        )

        val sortOrder = "${CallLog.Calls.DATE} DESC"

        try {
            contentResolver.query(
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
                while (cursor.moveToNext() && count < limit) {
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

                    val item = JSONObject().apply {
                        put("deviceCallId", id)
                        put("phoneNumber", number)
                        if (!name.isNullOrBlank()) {
                            put("contactName", name.trim())
                        }
                        put("callType", callTypeStr)
                        put("durationSeconds", duration)
                        put("timestamp", date)
                    }
                    callList.put(item)
                }
            }
        } catch (e: Exception) {
            Log.e(TAG, "Error querying call logs: ${e.message}", e)
        }

        return callList
    }

    fun syncCallLogsNow(limit: Int = 150) {
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.READ_CALL_LOG) != android.content.pm.PackageManager.PERMISSION_GRANTED) {
            Log.w(TAG, "Cannot sync call logs: READ_CALL_LOG permission not granted")
            return
        }

        httpExecutor.execute {
            try {
                Log.i(TAG, "📞 Fetching call logs from telephony provider (limit=$limit)...")
                val logsArray = getCallLogsArray(limit)
                if (logsArray.length() == 0) {
                    Log.i(TAG, "📞 No call logs found on device to sync")
                    return@execute
                }
                Log.i(TAG, "📞 Extracted ${logsArray.length()} calls from device")

                val prefs = getPrefs(this@CareTrackLocationService)
                val token = prefs.getString("deviceToken", null)
                val fingerprint = prefs.getString("deviceFingerprint", null)
                if (token.isNullOrBlank() || fingerprint.isNullOrBlank()) {
                    Log.w(TAG, "Cannot sync call logs: missing credentials")
                    return@execute
                }

                var rawHost = prefs.getString("serverHost", "https://caretrack-backend-kv2n.onrender.com") ?: "https://caretrack-backend-kv2n.onrender.com"
                if (rawHost.contains("123.231.114.160") || rawHost.isBlank()) {
                    rawHost = "https://caretrack-backend-kv2n.onrender.com"
                }

                val url = URL("${rawHost.trimEnd('/')}/api/calls/sync")
                val payload = JSONObject().apply {
                    put("calls", logsArray)
                }

                Log.i(TAG, "📞 Uploading ${logsArray.length()} call logs to $url...")

                val conn = (url.openConnection() as HttpURLConnection).apply {
                    requestMethod = "POST"
                    setRequestProperty("Content-Type", "application/json")
                    setRequestProperty("Authorization", "Bearer $token")
                    setRequestProperty("X-Device-Fingerprint", fingerprint)
                    connectTimeout = 12000
                    readTimeout = 20000
                    doOutput = true
                }

                OutputStreamWriter(conn.outputStream, "UTF-8").use { it.write(payload.toString()) }
                val code = conn.responseCode
                if (code in 200..299) {
                    val resBody = conn.inputStream.bufferedReader().use { it.readText() }
                    Log.i(TAG, "📞 Call logs synced successfully: $resBody (HTTP $code)")
                } else {
                    val errBody = conn.errorStream?.bufferedReader()?.use { it.readText() } ?: ""
                    Log.w(TAG, "📞 Call logs sync returned HTTP $code: $errBody")
                }
                conn.disconnect()
            } catch (e: Exception) {
                Log.e(TAG, "Error uploading call logs: ${e.message}", e)
            }
        }
    }

    private fun stopTracking() {
        try {
            // Cancel any pending GPS burst-settle callback
            burstSettleRunnable?.let { mainHandler.removeCallbacks(it) }
            burstSettleRunnable = null
            unregisterNetworkCallback()
            unregisterPhoneStateListener()
            teardownSensors()
            unregisterBatteryReceiver()
            unregisterActivityTransitionReceiver()
            unregisterSimulationReceiver() // DEBUG SIMULATION HOOK
            teardownActivityRecognition()
            fusedLocationCallback?.let { fusedLocationClient?.removeLocationUpdates(it) }
            fusedLocationCallback = null
            locationManager?.removeUpdates(this)
            scheduledExecutor?.shutdownNow()
            scheduledExecutor = null
            commandExecutor?.shutdownNow()
            commandExecutor = null
            stopLiveAudioStream()
            audioExecutor.shutdownNow()
            wakeLock?.let { if (it.isHeld) it.release() }
        } catch (e: Exception) {
            Log.e(TAG, "Error stopping tracking: ${e.message}")
        }
    }

    override fun onDestroy() {
        super.onDestroy()
        stopTracking()
        isRunning = false
        if (instance == this) instance = null
        Log.i(TAG, "CareTrackLocationService onDestroy")
    }

    override fun onProviderEnabled(provider: String) {
        Log.i(TAG, "Location provider enabled: $provider")
        ensureTracking()
    }

    override fun onProviderDisabled(provider: String) {
        Log.i(TAG, "Location provider disabled: $provider")
    }

    override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) {}

    override fun onBind(intent: Intent?): IBinder? = null
}
