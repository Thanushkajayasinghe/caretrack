package com.helloworld

import android.accessibilityservice.AccessibilityService
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.VibrationEffect
import android.os.Vibrator
import android.util.Log
import android.view.Gravity
import android.view.KeyEvent
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.widget.FrameLayout
import android.widget.GridLayout
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast

class TamperPinOverlay(private val service: AccessibilityService) {

    companion object {
        private const val TAG = "TamperPinOverlay"
    }

    private val windowManager: WindowManager =
        service.getSystemService(Context.WINDOW_SERVICE) as WindowManager
    private val mainHandler = Handler(Looper.getMainLooper())

    private var overlayView: FrameLayout? = null
    var isShowing: Boolean = false
        private set

    private val enteredPin = StringBuilder()
    private val pinDots = ArrayList<TextView>()
    private var errorText: TextView? = null
    private var failedAttempts = 0

    fun show() {
        mainHandler.post {
            if (isShowing || overlayView != null) {
                Log.d(TAG, "Overlay already showing, ignoring duplicate show request")
                return@post
            }

            try {
                enteredPin.clear()
                failedAttempts = 0

                val view = createOverlayView()
                val params = WindowManager.LayoutParams().apply {
                    width = WindowManager.LayoutParams.MATCH_PARENT
                    height = WindowManager.LayoutParams.MATCH_PARENT
                    type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                        WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY
                    } else {
                        @Suppress("DEPRECATION")
                        WindowManager.LayoutParams.TYPE_SYSTEM_ALERT
                    }
                    flags = WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN or
                            WindowManager.LayoutParams.FLAG_FULLSCREEN or
                            WindowManager.LayoutParams.FLAG_HARDWARE_ACCELERATED
                    format = PixelFormat.TRANSLUCENT
                    gravity = Gravity.CENTER
                }

                windowManager.addView(view, params)
                overlayView = view
                isShowing = true
                Log.i(TAG, "Tamper PIN overlay successfully displayed via WindowManager")
            } catch (e: Exception) {
                Log.e(TAG, "Failed to display overlay via WindowManager: ${e.message}", e)
                isShowing = false
                overlayView = null
                tryLaunchActivity()
            }
        }
    }

    fun dismiss() {
        mainHandler.post {
            if (!isShowing && overlayView == null) return@post
            try {
                overlayView?.let { windowManager.removeView(it) }
            } catch (e: Exception) {
                Log.e(TAG, "Error removing overlay view: ${e.message}")
            } finally {
                overlayView = null
                isShowing = false
            }
        }
    }

    private fun createOverlayView(): FrameLayout {
        val density = service.resources.displayMetrics.density
        fun dp(v: Int): Int = (v * density).toInt()

        val root = object : FrameLayout(service) {
            override fun dispatchKeyEvent(event: KeyEvent): Boolean {
                if (event.keyCode == KeyEvent.KEYCODE_BACK && event.action == KeyEvent.ACTION_UP) {
                    onCancelPressed()
                    return true
                }
                return super.dispatchKeyEvent(event)
            }
        }.apply {
            isFocusable = true
            isFocusableInTouchMode = true
            setBackgroundColor(Color.parseColor("#F50A0E1A"))
            layoutParams = ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
        }

        val content = LinearLayout(service).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            setPadding(dp(24), dp(48), dp(24), dp(24))
            layoutParams = FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            ).apply {
                gravity = Gravity.CENTER
            }
        }

        // Shield Icon badge
        val iconBadge = TextView(service).apply {
            text = "🛡️"
            textSize = 46f
            gravity = Gravity.CENTER
            layoutParams = LinearLayout.LayoutParams(dp(76), dp(76)).apply {
                bottomMargin = dp(12)
            }
        }
        content.addView(iconBadge)

        // Title
        val titleView = TextView(service).apply {
            text = "Tamper Guard Active"
            setTextColor(Color.WHITE)
            textSize = 22f
            setTypeface(null, Typeface.BOLD)
            gravity = Gravity.CENTER
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            ).apply {
                bottomMargin = dp(6)
            }
        }
        content.addView(titleView)

        // Subtitle
        val subtitleView = TextView(service).apply {
            text = "Enter Parent Master PIN to uninstall CareTrack or access protected settings"
            setTextColor(Color.parseColor("#94A3B8"))
            textSize = 13f
            gravity = Gravity.CENTER
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            ).apply {
                bottomMargin = dp(16)
            }
        }
        content.addView(subtitleView)

        // Error message text
        errorText = TextView(service).apply {
            text = ""
            setTextColor(Color.parseColor("#EF4444"))
            textSize = 14f
            setTypeface(null, Typeface.BOLD)
            gravity = Gravity.CENTER
            visibility = View.INVISIBLE
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            ).apply {
                bottomMargin = dp(12)
            }
        }
        content.addView(errorText)

        // PIN dot indicators
        val dotsContainer = LinearLayout(service).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            ).apply {
                bottomMargin = dp(24)
            }
        }

        pinDots.clear()
        for (i in 0 until 4) {
            val dot = TextView(service).apply {
                text = "○"
                textSize = 28f
                setTextColor(Color.parseColor("#475569"))
                gravity = Gravity.CENTER
                setPadding(dp(12), dp(4), dp(12), dp(4))
            }
            pinDots.add(dot)
            dotsContainer.addView(dot)
        }
        content.addView(dotsContainer)

        // Keypad Grid (3 columns x 4 rows)
        val grid = GridLayout(service).apply {
            columnCount = 3
            rowCount = 4
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            )
        }

        val keys = arrayOf(
            "1", "2", "3",
            "4", "5", "6",
            "7", "8", "9",
            "Cancel", "0", "⌫"
        )

        for (key in keys) {
            val btn = TextView(service).apply {
                text = key
                gravity = Gravity.CENTER
                textSize = if (key.length > 1) 14f else 22f
                setTypeface(null, Typeface.BOLD)
                setTextColor(if (key == "Cancel") Color.parseColor("#EF4444") else Color.WHITE)

                val bg = GradientDrawable().apply {
                    shape = GradientDrawable.OVAL
                    setColor(Color.parseColor("#1E293B"))
                    if (key != "Cancel" && key != "⌫") {
                        setStroke(dp(1), Color.parseColor("#334155"))
                    }
                }
                background = bg

                val btnSize = dp(68)
                val params = GridLayout.LayoutParams().apply {
                    width = btnSize
                    height = btnSize
                    setMargins(dp(10), dp(6), dp(10), dp(6))
                }
                layoutParams = params

                setOnClickListener {
                    handleKeyPress(key)
                }
            }
            grid.addView(btn)
        }

        content.addView(grid)
        root.addView(content)
        return root
    }

    private fun handleKeyPress(key: String) {
        when (key) {
            "Cancel" -> onCancelPressed()
            "⌫" -> {
                if (enteredPin.isNotEmpty()) {
                    enteredPin.deleteCharAt(enteredPin.length - 1)
                    updateDots()
                }
            }
            else -> {
                if (enteredPin.length < 4) {
                    enteredPin.append(key)
                    updateDots()
                    if (enteredPin.length == 4) {
                        verifyAndProceed()
                    }
                }
            }
        }
    }

    private fun updateDots() {
        for (i in 0 until 4) {
            if (i < enteredPin.length) {
                pinDots[i].text = "●"
                pinDots[i].setTextColor(Color.parseColor("#6C63FF"))
            } else {
                pinDots[i].text = "○"
                pinDots[i].setTextColor(Color.parseColor("#475569"))
            }
        }
        errorText?.visibility = View.INVISIBLE
    }

    private fun verifyAndProceed() {
        val pin = enteredPin.toString()
        val isValid = TamperGuardManager.verifyMasterPin(service, pin)

        if (isValid) {
            TamperGuardManager.unlockTemporarily(5 * 60 * 1000)
            Toast.makeText(
                service,
                "✓ Master PIN Verified. Maintenance window open (5 min).",
                Toast.LENGTH_LONG
            ).show()
            dismiss()
        } else {
            failedAttempts++
            vibrateError()

            errorText?.text = "Incorrect PIN (${3 - failedAttempts} attempts remaining)"
            errorText?.visibility = View.VISIBLE

            enteredPin.clear()
            updateDots()

            if (failedAttempts >= 3) {
                Toast.makeText(
                    service,
                    "Access denied. Master PIN required.",
                    Toast.LENGTH_SHORT
                ).show()
                onCancelPressed()
            }
        }
    }

    private fun onCancelPressed() {
        dismiss()
        service.performGlobalAction(AccessibilityService.GLOBAL_ACTION_HOME)
    }

    private fun vibrateError() {
        try {
            val v = service.getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                v?.vibrate(VibrationEffect.createOneShot(200, VibrationEffect.DEFAULT_AMPLITUDE))
            } else {
                @Suppress("DEPRECATION")
                v?.vibrate(200)
            }
        } catch (_e: Exception) {}
    }

    private fun tryLaunchActivity() {
        try {
            val intent = Intent(service, TamperUnlockActivity::class.java).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or
                         Intent.FLAG_ACTIVITY_CLEAR_TOP or
                         Intent.FLAG_ACTIVITY_SINGLE_TOP)
            }
            service.startActivity(intent)
        } catch (e: Exception) {
            Log.e(TAG, "Fallback startActivity failed: ${e.message}")
            service.performGlobalAction(AccessibilityService.GLOBAL_ACTION_HOME)
        }
    }
}
