package com.hermes.companion.presence

import android.accessibilityservice.AccessibilityService
import android.content.Intent
import android.os.Handler
import android.os.Looper
import android.view.accessibility.AccessibilityEvent
import com.hermes.companion.privacy.VisualPrivacyStore

class PresenceAccessibilityService : AccessibilityService() {
    private val handler = Handler(Looper.getMainLooper())
    private lateinit var store: PresenceStateStore
    private lateinit var reporter: PresenceReporter
    private lateinit var privacy: VisualPrivacyStore
    private var pendingPackage: String? = null
    private val commitPending = Runnable {
        val candidate = pendingPackage ?: return@Runnable
        pendingPackage = null
        val now = System.currentTimeMillis()
        store.commitPackage(candidate, now)?.let { transition ->
            // OH-45: a sensitive visual grant is scoped to the current App session.
            // Switching away invalidates it before any future visual request can use it.
            privacy.invalidateGrantForPackageChange(transition.toPackage)
            reporter.reportTransition(transition)
        }
    }

    override fun onServiceConnected() {
        super.onServiceConnected()
        store = PresenceStateStore(applicationContext)
        reporter = PresenceReporter(applicationContext)
        privacy = VisualPrivacyStore(applicationContext)
        privacy.pruneExpiredGrant(System.currentTimeMillis())
        store.setAccessibilityConnected(true)
        PresenceRuntime.start(applicationContext)
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        if (!::store.isInitialized || !::reporter.isInitialized) return
        val type = event?.eventType ?: return
        if (type != AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED && type != AccessibilityEvent.TYPE_WINDOWS_CHANGED) return
        val candidate = event.packageName?.toString()?.trim()?.takeIf { it.isNotEmpty() } ?: return
        val now = System.currentTimeMillis()
        store.recordAccessibilityEvent(now)

        // OH-68: Accessibility can emit several window events for one semantic switch.
        // A short local debounce prevents transient windows from becoming noisy Presence events.
        pendingPackage = candidate
        handler.removeCallbacks(commitPending)
        handler.postDelayed(commitPending, APP_TRANSITION_DEBOUNCE_MS)
    }

    override fun onInterrupt() = Unit

    override fun onUnbind(intent: Intent?): Boolean {
        if (::store.isInitialized) store.setAccessibilityConnected(false)
        handler.removeCallbacks(commitPending)
        pendingPackage = null
        return super.onUnbind(intent)
    }

    override fun onDestroy() {
        if (::store.isInitialized) store.setAccessibilityConnected(false)
        handler.removeCallbacks(commitPending)
        pendingPackage = null
        super.onDestroy()
    }

    companion object {
        const val APP_TRANSITION_DEBOUNCE_MS = 400L
    }
}
