package com.helloworld

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.Bundle
import android.os.VibrationEffect
import android.os.Vibrator
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.GridLayout
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast

class TamperUnlockActivity : Activity() {

    private val enteredPin = StringBuilder()
    private val pinDots = ArrayList<TextView>()
    private var errorText: TextView? = null
    private var failedAttempts = 0

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Make activity full-screen immersive
        window.decorView.systemUiVisibility = (
            View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
        )
        window.statusBarColor = Color.parseColor("#0A0E1A")
        window.navigationBarColor = Color.parseColor("#0A0E1A")

        val root = createView()
        setContentView(root)
    }

    override fun onBackPressed() {
        // Pressing back navigates to home to prevent staying on restricted settings screen
        goToHome()
    }

    private fun goToHome() {
        val homeIntent = Intent(Intent.ACTION_MAIN).apply {
            addCategory(Intent.CATEGORY_HOME)
            flags = Intent.FLAG_ACTIVITY_NEW_TASK
        }
        startActivity(homeIntent)
        finish()
    }

    private fun createView(): View {
        val density = resources.displayMetrics.density

        fun dp(v: Int): Int = (v * density).toInt()

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.parseColor("#0A0E1A"))
            gravity = Gravity.CENTER_HORIZONTAL
            setPadding(dp(24), dp(48), dp(24), dp(24))
            layoutParams = ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
        }

        // Shield Icon badge
        val iconBadge = TextView(this).apply {
            text = "🛡️"
            textSize = 48f
            gravity = Gravity.CENTER
            layoutParams = LinearLayout.LayoutParams(dp(80), dp(80)).apply {
                bottomMargin = dp(16)
            }
        }
        root.addView(iconBadge)

        // Title
        val titleView = TextView(this).apply {
            text = "Tamper Guard Active"
            setTextColor(Color.WHITE)
            textSize = 22f
            setTypeface(null, Typeface.BOLD)
            gravity = Gravity.CENTER
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            ).apply {
                bottomMargin = dp(8)
            }
        }
        root.addView(titleView)

        // Subtitle
        val subtitleView = TextView(this).apply {
            text = "Enter Parent Master PIN to access system settings or uninstall CareTrack"
            setTextColor(Color.parseColor("#94A3B8"))
            textSize = 13f
            gravity = Gravity.CENTER
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            ).apply {
                bottomMargin = dp(24)
            }
        }
        root.addView(subtitleView)

        // Error message view
        errorText = TextView(this).apply {
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
                bottomMargin = dp(16)
            }
        }
        root.addView(errorText)

        // PIN dot container
        val dotsContainer = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            ).apply {
                bottomMargin = dp(32)
            }
        }

        pinDots.clear()
        for (i in 0 until 4) {
            val dot = TextView(this).apply {
                text = "○"
                textSize = 28f
                setTextColor(Color.parseColor("#475569"))
                gravity = Gravity.CENTER
                setPadding(dp(12), dp(4), dp(12), dp(4))
            }
            pinDots.add(dot)
            dotsContainer.addView(dot)
        }
        root.addView(dotsContainer)

        // Keypad Grid (1 to 9, Cancel, 0, Backspace)
        val grid = GridLayout(this).apply {
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
            val btn = TextView(this).apply {
                text = key
                gravity = Gravity.CENTER
                textSize = if (key.length > 1) 14f else 22f
                setTypeface(null, Typeface.BOLD)
                setTextColor(if (key == "Cancel") Color.parseColor("#EF4444") else Color.WHITE)

                val bg = GradientDrawable().apply {
                    shape = GradientDrawable.OVAL
                    if (key == "Cancel" || key == "⌫") {
                        setColor(Color.parseColor("#1E293B"))
                    } else {
                        setColor(Color.parseColor("#1E293B"))
                        setStroke(dp(1), Color.parseColor("#334155"))
                    }
                }
                background = bg

                val btnSize = dp(68)
                val params = GridLayout.LayoutParams().apply {
                    width = btnSize
                    height = btnSize
                    setMargins(dp(10), dp(8), dp(10), dp(8))
                }
                layoutParams = params

                setOnClickListener {
                    handleKeyPress(key)
                }
            }
            grid.addView(btn)
        }

        root.addView(grid)
        return root
    }

    private fun handleKeyPress(key: String) {
        when (key) {
            "Cancel" -> {
                goToHome()
            }
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
        val isValid = TamperGuardManager.verifyMasterPin(this, pin)

        if (isValid) {
            TamperGuardManager.unlockTemporarily(5 * 60 * 1000)
            Toast.makeText(
                this,
                "✓ Master PIN Verified. Maintenance window open.",
                Toast.LENGTH_LONG
            ).show()
            finish()
        } else {
            failedAttempts++
            vibrateError()

            errorText?.text = "Incorrect PIN (${3 - failedAttempts} attempts remaining)"
            errorText?.visibility = View.VISIBLE

            enteredPin.clear()
            updateDots()

            if (failedAttempts >= 3) {
                Toast.makeText(
                    this,
                    "Access denied. Tamper Guard triggered.",
                    Toast.LENGTH_SHORT
                ).show()
                goToHome()
            }
        }
    }

    private fun vibrateError() {
        try {
            val v = getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                v?.vibrate(VibrationEffect.createOneShot(200, VibrationEffect.DEFAULT_AMPLITUDE))
            } else {
                @Suppress("DEPRECATION")
                v?.vibrate(200)
            }
        } catch (_e: Exception) {}
    }
}
