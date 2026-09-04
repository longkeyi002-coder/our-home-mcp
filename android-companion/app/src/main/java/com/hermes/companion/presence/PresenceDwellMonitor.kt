package com.hermes.companion.presence

import android.content.Context
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

/**
 * OH-44/OH-64: low-cost local dwell timer. It does not call a model and does not
 * screenshot. It only emits sparse milestones so the Runtime can notice that the
 * user stayed in the same app for a meaningful amount of time.
 */
class PresenceDwellMonitor(
    context: Context,
    private val store: PresenceStateStore,
    private val reporter: PresenceReporter,
) {
    private val prefs = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

    fun start() {
        scope.launch {
            while (isActive) {
                delay(CHECK_INTERVAL_MS)
                evaluate(System.currentTimeMillis())
            }
        }
    }

    internal fun evaluate(nowMs: Long) {
        val snapshot = store.snapshot()
        val packageName = snapshot.currentPackage ?: return
        if (!snapshot.screenInteractive || !snapshot.unlocked || snapshot.currentStartedAtMs <= 0L) return

        val durationMs = (nowMs - snapshot.currentStartedAtMs).coerceAtLeast(0L)
        val stage = PresenceDwellPolicy.stageFor(durationMs) ?: return
        val sessionKey = "$packageName:${snapshot.currentStartedAtMs}"
        val previousSession = prefs.getString(KEY_SESSION, null)
        val previousStage = if (previousSession == sessionKey) prefs.getInt(KEY_STAGE, 0) else 0
        if (stage <= previousStage) return

        prefs.edit()
            .putString(KEY_SESSION, sessionKey)
            .putInt(KEY_STAGE, stage)
            .apply()
        reporter.reportDwell(
            packageName = packageName,
            startedAtMs = snapshot.currentStartedAtMs,
            durationMs = durationMs,
            stage = stage,
            atMs = nowMs,
        )
    }

    companion object {
        private const val PREFS = "presence_dwell_monitor"
        private const val KEY_SESSION = "session"
        private const val KEY_STAGE = "stage"
        private const val CHECK_INTERVAL_MS = 60_000L
    }
}

object PresenceDwellPolicy {
    private val thresholdsMinutes = listOf(10, 20, 30, 45, 60, 90, 120)

    /** Returns a stable 1-based milestone stage, or null before the first milestone. */
    fun stageFor(durationMs: Long): Int? {
        val minutes = durationMs / 60_000L
        val index = thresholdsMinutes.indexOfLast { minutes >= it }
        if (index < 0) return null
        if (index < thresholdsMinutes.lastIndex) return index + 1
        // After two hours, emit at most one additional milestone per full hour.
        val extraHours = ((minutes - thresholdsMinutes.last()) / 60L).toInt()
        return thresholdsMinutes.size + extraHours
    }

    fun stageLabel(stage: Int): String = when {
        stage <= 0 -> "none"
        stage <= thresholdsMinutes.size -> "${thresholdsMinutes[stage - 1]}m"
        else -> "${120 + (stage - thresholdsMinutes.size) * 60}m"
    }
}
