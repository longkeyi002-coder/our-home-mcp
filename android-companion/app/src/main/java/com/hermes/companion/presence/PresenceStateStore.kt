package com.hermes.companion.presence

import android.content.Context
import android.content.SharedPreferences
import com.hermes.companion.vision.ObservationStatusNotification
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlin.math.max

data class PresenceSnapshot(
    val currentPackage: String?,
    val currentStartedAtMs: Long,
    val lastTransitionAtMs: Long,
    val lastFromPackage: String?,
    val lastToPackage: String?,
    val screenInteractive: Boolean,
    val unlocked: Boolean,
    val accessibilityConnected: Boolean,
    val lastAccessibilityEventAtMs: Long,
)

class PresenceStateStore(context: Context) {
    private val appContext = context.applicationContext
    private val prefs = appContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun snapshots() = callbackFlow {
        val listener = SharedPreferences.OnSharedPreferenceChangeListener { _, _ -> trySend(snapshot()); Unit }
        prefs.registerOnSharedPreferenceChangeListener(listener)
        trySend(snapshot())
        awaitClose { prefs.unregisterOnSharedPreferenceChangeListener(listener) }
    }.distinctUntilChanged()

    @Synchronized
    fun commitPackage(candidatePackage: String, nowMs: Long): AppTransition? {
        val previousPackage = prefs.getString(KEY_CURRENT_PACKAGE, null)
        val previousStartedAt = prefs.getLong(KEY_CURRENT_STARTED_AT, 0L)
        val transition = PresenceReducer.transition(previousPackage, previousStartedAt, candidatePackage, nowMs) ?: return null
        prefs.edit()
            .putString(KEY_CURRENT_PACKAGE, transition.toPackage)
            .putLong(KEY_CURRENT_STARTED_AT, nowMs)
            .putLong(KEY_LAST_TRANSITION_AT, nowMs)
            .putString(KEY_LAST_FROM_PACKAGE, transition.fromPackage)
            .putString(KEY_LAST_TO_PACKAGE, transition.toPackage)
            .apply()
        publishStatus()
        return transition
    }

    @Synchronized
    fun endCurrentSession(nowMs: Long, reason: String): AppSessionEnd? {
        val current = prefs.getString(KEY_CURRENT_PACKAGE, null) ?: return null
        val startedAt = prefs.getLong(KEY_CURRENT_STARTED_AT, 0L)
        val end = AppSessionEnd(
            packageName = current,
            startedAtMs = startedAt,
            endedAtMs = nowMs,
            durationMs = if (startedAt > 0L) max(0L, nowMs - startedAt) else 0L,
            reason = reason,
        )
        prefs.edit()
            .remove(KEY_CURRENT_PACKAGE)
            .remove(KEY_CURRENT_STARTED_AT)
            .apply()
        publishStatus()
        return end
    }

    fun recordAccessibilityEvent(atMs: Long) {
        prefs.edit().putLong(KEY_LAST_ACCESSIBILITY_EVENT_AT, atMs).apply()
    }

    fun setAccessibilityConnected(connected: Boolean) {
        prefs.edit().putBoolean(KEY_ACCESSIBILITY_CONNECTED, connected).apply()
        publishStatus()
    }

    fun setScreenState(interactive: Boolean, unlocked: Boolean) {
        prefs.edit()
            .putBoolean(KEY_SCREEN_INTERACTIVE, interactive)
            .putBoolean(KEY_UNLOCKED, unlocked)
            .apply()
        publishStatus()
    }

    fun snapshot(): PresenceSnapshot = PresenceSnapshot(
        currentPackage = prefs.getString(KEY_CURRENT_PACKAGE, null),
        currentStartedAtMs = prefs.getLong(KEY_CURRENT_STARTED_AT, 0L),
        lastTransitionAtMs = prefs.getLong(KEY_LAST_TRANSITION_AT, 0L),
        lastFromPackage = prefs.getString(KEY_LAST_FROM_PACKAGE, null),
        lastToPackage = prefs.getString(KEY_LAST_TO_PACKAGE, null),
        screenInteractive = prefs.getBoolean(KEY_SCREEN_INTERACTIVE, false),
        unlocked = prefs.getBoolean(KEY_UNLOCKED, false),
        accessibilityConnected = prefs.getBoolean(KEY_ACCESSIBILITY_CONNECTED, false),
        lastAccessibilityEventAtMs = prefs.getLong(KEY_LAST_ACCESSIBILITY_EVENT_AT, 0L),
    )

    private fun publishStatus() {
        val state = snapshot()
        ObservationStatusNotification.updatePresence(
            context = appContext,
            packageName = state.currentPackage,
            screenInteractive = state.screenInteractive,
            unlocked = state.unlocked,
            accessibilityConnected = state.accessibilityConnected,
        )
    }

    companion object {
        private const val PREFS = "presence_state"
        private const val KEY_CURRENT_PACKAGE = "current_package"
        private const val KEY_CURRENT_STARTED_AT = "current_started_at"
        private const val KEY_LAST_TRANSITION_AT = "last_transition_at"
        private const val KEY_LAST_FROM_PACKAGE = "last_from_package"
        private const val KEY_LAST_TO_PACKAGE = "last_to_package"
        private const val KEY_SCREEN_INTERACTIVE = "screen_interactive"
        private const val KEY_UNLOCKED = "unlocked"
        private const val KEY_ACCESSIBILITY_CONNECTED = "accessibility_connected"
        private const val KEY_LAST_ACCESSIBILITY_EVENT_AT = "last_accessibility_event_at"
    }
}
