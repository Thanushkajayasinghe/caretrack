package com.helloworld

import android.accessibilityservice.AccessibilityService
import android.content.Intent
import android.graphics.Bitmap
import android.os.Build
import android.os.SystemClock
import android.util.Log
import android.view.Display
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import java.util.concurrent.Executors

class CareTrackAccessibilityGuardService : AccessibilityService() {

    companion object {
        private const val TAG = "AccessibilityGuard"
        private const val TARGET_PACKAGE = "com.caretrack.child"
        private const val ALT_PACKAGE = "com.helloworld"
        private const val APP_LABEL = "caretrack"
        private const val COOLDOWN_MS = 800L
        // Reduced from 30s to 5s: only spans immediate sub-page transitions (e.g. App Info -> Storage)
        private const val CONTEXT_TTL_MS = 5_000L

        @Volatile
        var instance: CareTrackAccessibilityGuardService? = null
            private set
    }

    private var lastTriggerTime: Long = 0L
    private var pinOverlay: TamperPinOverlay? = null

    // Stateful context: last time we confirmed the user is viewing CareTrack's App Info / Storage page
    private var careTrackContextTimestamp: Long = 0L

    override fun onServiceConnected() {
        super.onServiceConnected()
        instance = this
        pinOverlay = TamperPinOverlay(this)
        Log.i(TAG, "CareTrack Accessibility Guard Service connected with native overlay engine")
    }

    override fun onDestroy() {
        super.onDestroy()
        if (instance == this) {
            instance = null
        }
        pinOverlay?.dismiss()
        pinOverlay = null
    }

    /**
     * Captures the full screen using Android's native AccessibilityService.takeScreenshot API (Android 11+).
     * Runs completely in the background without prompting the child.
     */
    fun captureScreen(callback: (Bitmap?, String?) -> Unit) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            val executor = Executors.newSingleThreadExecutor()
            try {
                takeScreenshot(
                    Display.DEFAULT_DISPLAY,
                    executor,
                    object : TakeScreenshotCallback {
                        override fun onSuccess(screenshotResult: ScreenshotResult) {
                            try {
                                val hardwareBuffer = screenshotResult.hardwareBuffer
                                val colorSpace = screenshotResult.colorSpace
                                val hwBitmap = Bitmap.wrapHardwareBuffer(hardwareBuffer, colorSpace)
                                hardwareBuffer.close()

                                if (hwBitmap == null) {
                                    callback(null, "Failed to wrap hardware buffer into Bitmap")
                                    return
                                }

                                // Hardware bitmaps cannot be directly compressed with compress() on some Android versions.
                                // Copy into a standard software ARGB_8888 bitmap.
                                val softwareBitmap = hwBitmap.copy(Bitmap.Config.ARGB_8888, false)
                                hwBitmap.recycle()

                                callback(softwareBitmap, null)
                            } catch (e: Exception) {
                                Log.e(TAG, "Error unwrapping screenshot buffer: ${e.message}", e)
                                callback(null, e.message)
                            }
                        }

                        override fun onFailure(errorCode: Int) {
                            val msg = when (errorCode) {
                                ERROR_TAKE_SCREENSHOT_INTERNAL_ERROR -> "Internal screenshot engine error"
                                ERROR_TAKE_SCREENSHOT_NO_ACCESSIBILITY_ACCESS -> "Accessibility service lacks screenshot permission"
                                ERROR_TAKE_SCREENSHOT_INTERVAL_TIME_SHORT -> "Screenshot requested too quickly (interval too short)"
                                ERROR_TAKE_SCREENSHOT_INVALID_DISPLAY -> "Invalid display ID"
                                else -> "Screenshot capture failed with code $errorCode"
                            }
                            Log.e(TAG, "Screenshot onFailure: $msg")
                            callback(null, msg)
                        }
                    }
                )
            } catch (e: Exception) {
                Log.e(TAG, "Exception calling takeScreenshot: ${e.message}", e)
                callback(null, e.message)
            }
        } else {
            callback(null, "Android 11+ (API 30+) required for background accessibility screenshot capture")
        }
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        if (event == null) return

        // If maintenance window is currently active, allow parent full access
        if (TamperGuardManager.isTemporarilyUnlocked()) {
            careTrackContextTimestamp = 0L
            return
        }

        // If Master PIN has not been configured yet, do not block
        if (!TamperGuardManager.isPinConfigured(this)) {
            return
        }

        // If PIN overlay is currently active and presented to user, do not retrigger
        if (pinOverlay?.isShowing == true) {
            return
        }

        val pkgName = event.packageName?.toString()?.lowercase() ?: ""

        // If user leaves a monitored app, immediately clear context and ignore
        if (!isMonitoredPackage(pkgName)) {
            careTrackContextTimestamp = 0L
            return
        }

        // Inspect window content for CareTrack tampering
        val rootNode = rootInActiveWindow ?: event.source ?: return

        // Update stateful context: check if we are currently on CareTrack App Info page
        updateCareTrackContext(rootNode, event, pkgName)

        if (isTamperingAttempt(rootNode, event, pkgName)) {
            val now = SystemClock.uptimeMillis()
            if (now - lastTriggerTime > COOLDOWN_MS) {
                lastTriggerTime = now
                Log.w(TAG, "Tamper attempt detected in $pkgName! Presenting Master PIN challenge overlay.")

                if (pinOverlay == null) {
                    pinOverlay = TamperPinOverlay(this)
                }
                pinOverlay?.show()
            }
        }
    }

    /**
     * Checks if a package is a legitimate system package installer / uninstaller.
     * Replaces overly broad substring checks like `contains("installer")`.
     */
    private fun isPackageInstallerPackage(pkgName: String): Boolean {
        if (pkgName.isBlank()) return false
        return pkgName == "com.android.packageinstaller" ||
            pkgName == "com.google.android.packageinstaller" ||
            pkgName == "com.android.vending" ||
            pkgName.endsWith(".packageinstaller") ||
            pkgName.contains(".packageinstaller.")
    }

    /**
     * Checks if a package is system settings or a known OEM device manager/security app.
     */
    private fun isSettingsOrSecurityPackage(pkgName: String): Boolean {
        if (pkgName.isBlank()) return false
        return pkgName == "com.android.settings" ||
            pkgName.endsWith(".settings") ||
            pkgName == "com.miui.securitycenter" ||
            pkgName == "com.coloros.safecenter" ||
            pkgName == "com.oppo.safecenter" ||
            pkgName == "com.samsung.android.sm" ||
            pkgName == "com.samsung.android.lool" ||
            pkgName == "com.huawei.systemmanager" ||
            pkgName == "com.vivo.safecenter" ||
            pkgName == "com.transsion.phonemaster"
    }

    /**
     * Checks if the package belongs to settings or system package uninstaller.
     * Prevents monitoring unintended packages.
     */
    private fun isMonitoredPackage(pkgName: String): Boolean {
        return isSettingsOrSecurityPackage(pkgName) || isPackageInstallerPackage(pkgName)
    }

    /**
     * Confirms that text contains an explicit CareTrack identifier.
     * Strictly avoids matching generic standalone words like "child".
     */
    private fun hasCareTrackReference(text: String): Boolean {
        if (text.isBlank()) return false
        val lower = text.lowercase()
        return lower.contains("caretrack") ||
            lower.contains("care track") ||
            lower.contains(TARGET_PACKAGE) ||
            lower.contains(ALT_PACKAGE)
    }

    /**
     * Updates careTrackContextTimestamp when we detect the current window shows CareTrack's
     * App Info, Storage, or Cache page.
     * If the user navigates to another app in Settings or to the app list, context is immediately invalidated.
     */
    private fun updateCareTrackContext(root: AccessibilityNodeInfo, event: AccessibilityEvent, pkgName: String) {
        if (event.eventType != AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED &&
            event.eventType != AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED) return

        val texts = mutableListOf<String>()
        collectTexts(root, texts, maxCount = 300)
        for (cs in event.text) {
            if (!cs.isNullOrBlank()) texts.add(cs.toString())
        }
        val allText = texts.joinToString(" ").lowercase()

        val hasCareTrackRef = hasCareTrackReference(allText)

        if (hasCareTrackRef) {
            careTrackContextTimestamp = SystemClock.uptimeMillis()
            Log.d(TAG, "CareTrack App Info context confirmed (pkg=$pkgName)")
        } else if (event.eventType == AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) {
            // When navigating to another screen in Settings that doesn't reference CareTrack
            // (e.g. user went back to all apps list or opened another app's App Info),
            // immediately clear the context so other apps aren't blocked.
            val isOtherAppOrNavigation = allText.contains("app info") ||
                allText.contains("storage") ||
                allText.contains("all apps") ||
                allText.contains("see all") ||
                allText.contains("installed apps") ||
                allText.contains("applications") ||
                allText.contains("default apps") ||
                allText.contains("settings")
            if (isOtherAppOrNavigation && careTrackContextTimestamp != 0L) {
                Log.d(TAG, "Navigated away from CareTrack inside Settings (pkg=$pkgName); clearing context immediately")
                careTrackContextTimestamp = 0L
            }
        }
    }

    /** Returns true if the current context is within the CareTrack App Info TTL window */
    private fun isInCareTrackContext(): Boolean {
        if (careTrackContextTimestamp == 0L) return false
        return SystemClock.uptimeMillis() - careTrackContextTimestamp <= CONTEXT_TTL_MS
    }

    private fun isTamperingAttempt(root: AccessibilityNodeInfo, event: AccessibilityEvent, pkgName: String): Boolean {
        val eventType = event.eventType
        val className = event.className?.toString()?.lowercase() ?: ""

        // Case 1: Direct user click on a destructive action button (TYPE_VIEW_CLICKED)
        if (eventType == AccessibilityEvent.TYPE_VIEW_CLICKED) {
            val clickedTexts = mutableListOf<String>()
            for (cs in event.text) {
                if (!cs.isNullOrBlank()) clickedTexts.add(cs.toString())
            }
            event.contentDescription?.toString()?.let {
                if (it.isNotBlank()) clickedTexts.add(it)
            }
            event.source?.text?.toString()?.let {
                if (it.isNotBlank()) clickedTexts.add(it)
            }
            event.source?.contentDescription?.toString()?.let {
                if (it.isNotBlank()) clickedTexts.add(it)
            }

            val clickedStr = clickedTexts.joinToString(" ").lowercase().trim()

            // 1A. Destructive buttons in App Info (Uninstall, Clear data, Force stop, Deactivate)
            // Requires CareTrack context OR direct on-screen CareTrack reference
            if (isDestructiveActionKeyword(clickedStr)) {
                if (isInCareTrackContext() || isContextCareTrack(root, event)) {
                    Log.w(TAG, "Destructive button click detected: '$clickedStr' for CareTrack (contextHit=${isInCareTrackContext()})")
                    return true
                }
            }

            // 1B. Uninstaller confirmation clicks (e.g. clicking 'OK' in Package Installer)
            // Must belong to a legitimate package installer AND target CareTrack
            if (isPackageInstallerPackage(pkgName)) {
                val isConfirmClick = clickedStr == "ok" ||
                    clickedStr.contains("uninstall") ||
                    clickedStr.contains("delete") ||
                    clickedStr.contains("yes") ||
                    clickedStr.contains("confirm")
                if (isConfirmClick && (isInCareTrackContext() || isContextCareTrack(root, event))) {
                    Log.w(TAG, "Package installer confirmation click detected: '$clickedStr' for CareTrack")
                    return true
                }
            }

            // 1C. OK/Confirm click on a cache/data clear confirmation dialog while in CareTrack context
            if (isInCareTrackContext()) {
                val isOkConfirm = clickedStr == "ok" ||
                    clickedStr == "yes" ||
                    clickedStr == "clear" ||
                    clickedStr == "delete" ||
                    clickedStr.contains("ok") ||
                    clickedStr.contains("confirm") ||
                    clickedStr.contains("clear") ||
                    clickedStr.contains("delete")
                // Check the dialog contains cache/data references
                val dialogTexts = mutableListOf<String>()
                collectTexts(root, dialogTexts, maxCount = 200)
                val dialogStr = dialogTexts.joinToString(" ").lowercase()
                val isCacheDialog = dialogStr.contains("cache") ||
                    dialogStr.contains("clear data") ||
                    dialogStr.contains("delete data") ||
                    dialogStr.contains("clear storage")
                if (isOkConfirm && isCacheDialog) {
                    Log.w(TAG, "OK/Confirm on cache/data clear dialog intercepted for CareTrack: '$clickedStr'")
                    return true
                }
            }
        }

        // Case 2: Confirmation dialogs or Uninstaller activities (TYPE_WINDOW_STATE_CHANGED or TYPE_WINDOW_CONTENT_CHANGED)
        val isDialogOrInstaller = isPackageInstallerPackage(pkgName) ||
            className.contains("uninstaller") ||
            className.contains("uninstall") ||
            className.contains("dialog") ||
            className.contains("alert")

        if (isDialogOrInstaller) {
            val texts = mutableListOf<String>()
            collectTexts(root, texts, maxCount = 200)
            for (cs in event.text) {
                if (!cs.isNullOrBlank()) texts.add(cs.toString())
            }
            val allDialogText = texts.joinToString(" ").lowercase()

            // A. Package Installer / Uninstaller prompt targeting CareTrack
            // Requires an explicit CareTrack reference OR origin from an active CareTrack App Info context
            val isUninstallPrompt = (allDialogText.contains("uninstall") || className.contains("uninstaller")) &&
                (hasCareTrackReference(allDialogText) || isInCareTrackContext())

            // B. Confirmation dialog to Delete/Clear App Data or Storage/Cache
            val isDataClearPrompt = (allDialogText.contains("delete app data") ||
                allDialogText.contains("clear all data") ||
                allDialogText.contains("delete all data") ||
                allDialogText.contains("clear data") ||
                allDialogText.contains("clear storage") ||
                allDialogText.contains("clear cache") ||
                allDialogText.contains("deleted permanently")) &&
                (isInCareTrackContext() || isContextCareTrack(root, event))

            // C. Confirmation dialog to Force Stop CareTrack
            val isForceStopPrompt = (allDialogText.contains("force stop") || allDialogText.contains("forcestop")) &&
                allDialogText.contains("misbehave") &&
                (isInCareTrackContext() || isContextCareTrack(root, event))

            // D. Confirmation dialog to Deactivate Device Admin
            val isDeactivatePrompt = allDialogText.contains("deactivate") &&
                (allDialogText.contains("admin") || allDialogText.contains("device policy")) &&
                (isInCareTrackContext() || isContextCareTrack(root, event))

            if (isUninstallPrompt || isDataClearPrompt || isForceStopPrompt || isDeactivatePrompt) {
                Log.w(TAG, "Destructive dialog detected: uninstall=$isUninstallPrompt, dataClear=$isDataClearPrompt, forceStop=$isForceStopPrompt, deactivate=$isDeactivatePrompt")
                return true
            }
        }

        return false
    }

    private fun isDestructiveActionKeyword(text: String): Boolean {
        if (text.isBlank()) return false
        val lower = text.lowercase()
        return lower == "uninstall" ||
            lower == "uninstall app" ||
            lower.contains("uninstall") ||
            lower == "clear data" ||
            lower == "clear all data" ||
            lower == "clear storage" ||
            lower == "clear cache" ||
            lower.contains("clear data") ||
            lower.contains("clear storage") ||
            lower.contains("clear cache") ||
            lower == "manage space" ||
            lower.contains("manage space") ||
            lower == "force stop" ||
            lower == "forcestop" ||
            lower.contains("force stop") ||
            lower == "deactivate" ||
            lower.contains("deactivate this device admin app")
    }

    private fun isContextCareTrack(root: AccessibilityNodeInfo, event: AccessibilityEvent): Boolean {
        val texts = mutableListOf<String>()
        collectTexts(root, texts, maxCount = 200)
        for (cs in event.text) {
            if (!cs.isNullOrBlank()) texts.add(cs.toString())
        }
        val allText = texts.joinToString(" ").lowercase()
        return hasCareTrackReference(allText)
    }

    private fun collectTexts(node: AccessibilityNodeInfo?, outList: MutableList<String>, maxCount: Int) {
        if (node == null || outList.size >= maxCount) return

        node.text?.toString()?.let {
            if (it.isNotBlank()) outList.add(it)
        }
        node.contentDescription?.toString()?.let {
            if (it.isNotBlank()) outList.add(it)
        }
        node.viewIdResourceName?.toString()?.let {
            if (it.isNotBlank()) outList.add(it)
        }

        val childCount = node.childCount
        for (i in 0 until childCount) {
            if (outList.size >= maxCount) break
            val child = node.getChild(i) ?: continue
            collectTexts(child, outList, maxCount)
        }
    }

    override fun onInterrupt() {
        Log.w(TAG, "CareTrack Accessibility Guard Service interrupted")
        pinOverlay?.dismiss()
    }
}
