package com.hermes.companion.presence

import android.app.KeyguardManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.PowerManager
import com.hermes.companion.privacy.VisualPrivacyStore

/**
 * Keep screen usability conservative without relying on whether the keyguard UI is merely
 * showing. Some OEMs can report isKeyguardLocked=true after the user is already inside an App.
 * isDeviceLocked answers the question Visual Capture actually needs: is the current user locked?
 */
object ScreenPresencePolicy {
    fun unlocked(interactive: Boolean, deviceLocked: Boolean): Boolean = interactive && !deviceLocked
}

/**
 * OH-43/OH-68: low-cost process-local screen presence monitor.
 * AccessibilityService keeps the realtime foreground-app channel separate from the
 * existing WorkManager/UsageEvents reconciliation path.
 */
object PresenceRuntime {
    @Volatile
    private var started = false

    @Synchronized
    fun start(context: Context) {
        if (started) return
        val appContext = context.applicationContext
        val store = PresenceStateStore(appContext)
        val reporter = PresenceReporter(appContext)
        val privacy = VisualPrivacyStore(appContext)
        val power = appContext.getSystemService(PowerManager::class.java)
        val keyguard = appContext.getSystemService(KeyguardManager::class.java)

        fun currentUnlocked(interactive: Boolean): Boolean = ScreenPresencePolicy.unlocked(
            interactive = interactive,
            deviceLocked = keyguard?.isDeviceLocked != false,
        )

        val initiallyInteractive = power?.isInteractive == true
        store.setScreenState(
            interactive = initiallyInteractive,
            unlocked = currentUnlocked(initiallyInteractive),
        )
        privacy.pruneExpiredGrant(System.currentTimeMillis())
        PresenceDwellMonitor(appContext, store, reporter).start()

        val receiver = object : BroadcastReceiver() {
            override fun onReceive(receiverContext: Context?, intent: Intent?) {
                val now = System.currentTimeMillis()
                when (intent?.action) {
                    Intent.ACTION_SCREEN_OFF -> {
                        val before = store.snapshot()
                        privacy.invalidateGrantForLock()
                        if (before.screenInteractive || before.unlocked) {
                            store.setScreenState(interactive = false, unlocked = false)
                            store.endCurrentSession(now, "screen_off")?.let(reporter::reportSessionEnd)
                            reporter.reportScreen(interactive = false, unlocked = false, atMs = now, reason = "screen_off")
                        }
                    }
                    Intent.ACTION_SCREEN_ON -> {
                        val unlocked = currentUnlocked(interactive = true)
                        val before = store.snapshot()
                        if (!before.screenInteractive || before.unlocked != unlocked) {
                            store.setScreenState(interactive = true, unlocked = unlocked)
                            reporter.reportScreen(interactive = true, unlocked = unlocked, atMs = now, reason = "screen_on")
                        }
                    }
                    Intent.ACTION_USER_PRESENT,
                    Intent.ACTION_USER_UNLOCKED -> {
                        val before = store.snapshot()
                        // A user-present/user-unlocked broadcast is stronger evidence than an
                        // OEM keyguard-UI flag. The OS only sends these after the user is unlocked.
                        if (!before.screenInteractive || !before.unlocked) {
                            store.setScreenState(interactive = true, unlocked = true)
                            reporter.reportScreen(interactive = true, unlocked = true, atMs = now, reason = "user_unlocked")
                        }
                    }
                }
            }
        }

        val filter = IntentFilter().apply {
            addAction(Intent.ACTION_SCREEN_ON)
            addAction(Intent.ACTION_SCREEN_OFF)
            addAction(Intent.ACTION_USER_PRESENT)
            addAction(Intent.ACTION_USER_UNLOCKED)
        }
        // Receiver accepts only system broadcasts listed above.
        appContext.registerReceiver(receiver, filter)
        started = true
    }
}
