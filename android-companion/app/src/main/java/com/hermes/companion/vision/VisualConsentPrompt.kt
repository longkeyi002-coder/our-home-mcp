package com.hermes.companion.vision

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.hermes.companion.data.VisualRequestAck
import com.hermes.companion.presence.PresenceStateStore
import com.hermes.companion.privacy.AppSensitivityClassifier
import com.hermes.companion.privacy.SensitivityClass
import com.hermes.companion.privacy.VisualAppPolicy
import com.hermes.companion.privacy.VisualPrivacyStore
import java.time.Instant

/**
 * ASK_ONLY is a real local consent flow: when Runtime curiosity requests a glance,
 * Android first verifies that the exact App/session is still foreground, then surfaces
 * a local notification. Approval is scoped to that request/session and never becomes
 * persistent AUTO permission.
 */
object VisualConsentPrompt {
    private const val CHANNEL_ID = "our_home_visual_consent"
    private const val EXTRA_ACTION = "visual_consent_action"
    private const val EXTRA_REQUEST_ID = "visual_request_id"
    private const val EXTRA_PACKAGE_NAME = "visual_package_name"
    private const val EXTRA_SESSION_ID = "visual_session_id"
    private const val EXTRA_REASON = "visual_reason"
    private const val EXTRA_ISSUED_AT = "visual_issued_at"
    private const val EXTRA_EXPIRES_AT = "visual_expires_at"
    private const val ACTION_ALLOW_ONCE = "allow_once"
    private const val ACTION_DENY_ONCE = "deny_once"

    /** Returns true when this request requires consent and has been surfaced to the user. */
    fun promptIfNeeded(context: Context, ack: VisualRequestAck): Boolean {
        val appContext = context.applicationContext
        val now = System.currentTimeMillis()
        val expiresAt = parseTime(ack.expiresAt) ?: return false
        if (now >= expiresAt) return false

        val privacy = VisualPrivacyStore(appContext)
        privacy.pruneExpiredGrant(now)
        val request = ack.toCaptureRequest()
        val snapshot = PresenceStateStore(appContext).snapshot()
        if (!VisualCapturePreflight.decide(snapshot, request).allowed) return false

        val policy = privacy.policyFor(ack.packageName)
        if (policy == VisualAppPolicy.NEVER) return false

        val existingGrant = privacy.temporaryGrant()?.isUsable(
            packageName = ack.packageName,
            sessionId = ack.sessionId,
            nowMs = now,
        ) == true
        if (existingGrant) return false

        // A manual "仅这一次允许" from the Privacy page is an armed package grant.
        // Let the capture path bind it to this verified session instead of prompting again.
        val armedGrant = privacy.armedGrant()?.isUsable(ack.packageName, now) == true
        if (armedGrant) return false

        val sensitivity = AppSensitivityClassifier.classify(ack.packageName)
        val needsConsent = sensitivity == SensitivityClass.PROTECTED ||
            sensitivity == SensitivityClass.PRIVATE ||
            policy == VisualAppPolicy.ASK_ONLY
        if (!needsConsent) return false
        if (policy == VisualAppPolicy.AUTO && sensitivity != SensitivityClass.PROTECTED) return false

        if (!canPostNotifications(appContext)) return false
        createChannel(appContext)
        val notificationId = notificationId(ack.requestId)
        val allowIntent = actionIntent(appContext, ack, ACTION_ALLOW_ONCE, notificationId)
        val denyIntent = actionIntent(appContext, ack, ACTION_DENY_ONCE, notificationId)
        val notification = NotificationCompat.Builder(appContext, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_menu_view)
            .setContentTitle("哥哥想看一眼")
            .setContentText("这次允许查看你正在使用的 App 屏幕吗？")
            .setStyle(NotificationCompat.BigTextStyle().bigText("这次允许查看你正在使用的 App 屏幕吗？只对当前 App 会话和这一次请求有效。"))
            .setAutoCancel(true)
            .setOnlyAlertOnce(true)
            .addAction(0, "这次允许", allowIntent)
            .addAction(0, "不允许", denyIntent)
            .build()
        try {
            NotificationManagerCompat.from(appContext).notify(notificationId, notification)
        } catch (_: SecurityException) {
            return false
        }
        return true
    }

    internal fun handleAction(context: Context, intent: Intent) {
        val ack = intent.toVisualRequestAck() ?: return
        val notificationId = intent.getIntExtra(EXTRA_NOTIFICATION_ID, notificationId(ack.requestId))
        NotificationManagerCompat.from(context).cancel(notificationId)
        if (intent.getStringExtra(EXTRA_ACTION) != ACTION_ALLOW_ONCE) return

        val now = System.currentTimeMillis()
        val expiresAt = parseTime(ack.expiresAt) ?: return
        if (now >= expiresAt) return
        val request = ack.toCaptureRequest()
        val snapshot = PresenceStateStore(context.applicationContext).snapshot()
        if (!VisualCapturePreflight.decide(snapshot, request).allowed) return

        val privacy = VisualPrivacyStore(context.applicationContext)
        privacy.pruneExpiredGrant(now)
        if (privacy.policyFor(ack.packageName) == VisualAppPolicy.NEVER) return
        val remainingMs = (expiresAt - now).coerceAtMost(VisualPrivacyStore.MAX_TEMPORARY_GRANT_MS)
        if (remainingMs <= 0L) return
        privacy.issueTemporaryGrant(
            packageName = ack.packageName,
            nowMs = now,
            ttlMs = remainingMs,
            sessionId = ack.sessionId,
        )
        VisualObservationWorker.enqueueAfterConsent(context.applicationContext, ack)
    }

    private fun canPostNotifications(context: Context): Boolean {
        if (!NotificationManagerCompat.from(context).areNotificationsEnabled()) return false
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) ==
            PackageManager.PERMISSION_GRANTED
    }

    private fun createChannel(context: Context) {
        context.getSystemService(NotificationManager::class.java).createNotificationChannel(
            NotificationChannel(CHANNEL_ID, "视觉观察请求", NotificationManager.IMPORTANCE_DEFAULT),
        )
    }

    private fun actionIntent(
        context: Context,
        ack: VisualRequestAck,
        action: String,
        notificationId: Int,
    ): PendingIntent {
        val intent = Intent(context, VisualConsentReceiver::class.java)
            .putExtra(EXTRA_ACTION, action)
            .putExtra(EXTRA_REQUEST_ID, ack.requestId)
            .putExtra(EXTRA_PACKAGE_NAME, ack.packageName)
            .putExtra(EXTRA_SESSION_ID, ack.sessionId)
            .putExtra(EXTRA_REASON, ack.reason)
            .putExtra(EXTRA_ISSUED_AT, ack.issuedAt)
            .putExtra(EXTRA_EXPIRES_AT, ack.expiresAt)
            .putExtra(EXTRA_NOTIFICATION_ID, notificationId)
        val requestCode = (ack.requestId + action).hashCode()
        return PendingIntent.getBroadcast(
            context,
            requestCode,
            intent,
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
    }

    private fun VisualRequestAck.toCaptureRequest() = VisualCaptureRequest(
        requestId = requestId,
        packageName = packageName,
        sessionId = sessionId,
        reason = reason,
    )

    private fun Intent.toVisualRequestAck(): VisualRequestAck? {
        val requestId = getStringExtra(EXTRA_REQUEST_ID)?.takeIf { it.isNotBlank() } ?: return null
        val packageName = getStringExtra(EXTRA_PACKAGE_NAME)?.takeIf { it.isNotBlank() } ?: return null
        val sessionId = getStringExtra(EXTRA_SESSION_ID)?.takeIf { it.isNotBlank() } ?: return null
        val reason = getStringExtra(EXTRA_REASON)?.takeIf { it.isNotBlank() } ?: return null
        val issuedAt = getStringExtra(EXTRA_ISSUED_AT)?.takeIf { it.isNotBlank() } ?: return null
        val expiresAt = getStringExtra(EXTRA_EXPIRES_AT)?.takeIf { it.isNotBlank() } ?: return null
        return VisualRequestAck(requestId, packageName, sessionId, reason, issuedAt, expiresAt)
    }

    private fun parseTime(value: String): Long? = runCatching { Instant.parse(value).toEpochMilli() }.getOrNull()
    private fun notificationId(requestId: String): Int = requestId.hashCode()
    private const val EXTRA_NOTIFICATION_ID = "visual_notification_id"
}

class VisualConsentReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        VisualConsentPrompt.handleAction(context, intent)
    }
}
