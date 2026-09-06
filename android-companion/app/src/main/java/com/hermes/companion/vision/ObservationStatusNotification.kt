package com.hermes.companion.vision

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.hermes.companion.MainActivity
import com.hermes.companion.privacy.PresencePrivacyStore

enum class ObservationStatusMode {
    DISCONNECTED,
    SCREEN_OFF,
    LOCKED,
    PRIVATE_APP,
    SENSING,
    AI_COMING,
    OBSERVING,
}

data class ObservationStatusPresentation(
    val title: String,
    val text: String,
)

fun observationStatusPresentation(
    mode: ObservationStatusMode,
    appLabel: String? = null,
): ObservationStatusPresentation = when (mode) {
    ObservationStatusMode.DISCONNECTED -> ObservationStatusPresentation(
        title = "Our Home 感知未连接",
        text = "开启“应用观察权限”后才会感知前台 App",
    )
    ObservationStatusMode.SCREEN_OFF -> ObservationStatusPresentation(
        title = "感知暂停",
        text = "屏幕已关闭，没有观察屏幕",
    )
    ObservationStatusMode.LOCKED -> ObservationStatusPresentation(
        title = "感知暂停",
        text = "设备已锁定，没有观察屏幕",
    )
    ObservationStatusMode.PRIVATE_APP -> ObservationStatusPresentation(
        title = "当前 App 已设为不感知",
        text = "Our Home 不读取此 App 身份或屏幕",
    )
    ObservationStatusMode.SENSING -> ObservationStatusPresentation(
        title = "仅感知 App",
        text = if (appLabel.isNullOrBlank()) {
            "等待识别当前前台 App · AI 尚未观察屏幕"
        } else {
            "当前：$appLabel · AI 尚未观察屏幕"
        },
    )
    ObservationStatusMode.AI_COMING -> ObservationStatusPresentation(
        title = "AI 已收到切换，正在过来看",
        text = if (appLabel.isNullOrBlank()) {
            "正在等待本次视觉观察开始"
        } else {
            "当前：$appLabel · 正在等待本次视觉观察开始"
        },
    )
    ObservationStatusMode.OBSERVING -> ObservationStatusPresentation(
        title = "正在观察屏幕",
        text = if (appLabel.isNullOrBlank()) {
            "正在截图并进行视觉分析"
        } else {
            "当前：$appLabel · 正在截图并进行视觉分析"
        },
    )
}

/**
 * User-visible truth surface for Presence vs AI attention vs actual visual observation.
 *
 * Ordinary Presence remains a low-priority ongoing notification. Actual screenshot work requests
 * Android 16 promoted-ongoing/live-update presentation so supported ColorOS/OxygenOS devices can
 * surface the short-lived state in the top capsule / Fluid Cloud area without requiring the shade.
 * Promotion is best-effort and never weakens the existing visual guard.
 */
object ObservationStatusNotification {
    private const val CHANNEL_ID = "our_home_sensing_status"
    private const val CHANNEL_NAME = "感知状态"
    private const val NOTIFICATION_ID = 0x4f485354
    private const val API_36 = 36

    private data class PresenceState(
        val packageName: String?,
        val screenInteractive: Boolean,
        val unlocked: Boolean,
        val accessibilityConnected: Boolean,
    )

    private var latestPresence = PresenceState(null, false, false, false)
    private val activeVisualRequests = linkedSetOf<String>()
    private var latestVisualPackage: String? = null
    private var pendingAiPackage: String? = null

    @Synchronized
    fun updatePresence(
        context: Context,
        packageName: String?,
        screenInteractive: Boolean,
        unlocked: Boolean,
        accessibilityConnected: Boolean,
    ) {
        latestPresence = PresenceState(packageName, screenInteractive, unlocked, accessibilityConnected)
        if (!accessibilityConnected) {
            activeVisualRequests.clear()
            latestVisualPackage = null
            pendingAiPackage = null
            cancel(context)
            return
        }
        if (pendingAiPackage != null && pendingAiPackage != packageName) pendingAiPackage = null
        if (activeVisualRequests.isEmpty()) renderPresence(context.applicationContext)
    }

    @Synchronized
    fun markAiComing(context: Context, packageName: String?) {
        val appContext = context.applicationContext
        if (!latestPresence.accessibilityConnected || !latestPresence.screenInteractive || !latestPresence.unlocked) return
        if (packageName.isNullOrBlank()) return
        if (!PresencePrivacyStore(appContext).exposesIdentity(packageName)) return
        pendingAiPackage = packageName
        if (activeVisualRequests.isEmpty()) {
            val label = visibleAppLabel(appContext, packageName)
            notify(appContext, ObservationStatusMode.AI_COMING, observationStatusPresentation(ObservationStatusMode.AI_COMING, label))
        }
    }

    @Synchronized
    fun beginObservation(context: Context, request: VisualCaptureRequest): Boolean {
        val appContext = context.applicationContext
        if (!canShow(appContext)) return false
        pendingAiPackage = null
        activeVisualRequests.add(request.requestId)
        latestVisualPackage = request.packageName
        val label = visibleAppLabel(appContext, request.packageName)
        val shown = notify(
            appContext,
            ObservationStatusMode.OBSERVING,
            observationStatusPresentation(ObservationStatusMode.OBSERVING, label),
        )
        if (!shown) {
            activeVisualRequests.remove(request.requestId)
            if (activeVisualRequests.isEmpty()) latestVisualPackage = null
        }
        return shown
    }

    @Synchronized
    fun endObservation(context: Context, request: VisualCaptureRequest) {
        activeVisualRequests.remove(request.requestId)
        if (activeVisualRequests.isNotEmpty()) {
            val label = visibleAppLabel(context.applicationContext, latestVisualPackage)
            notify(
                context.applicationContext,
                ObservationStatusMode.OBSERVING,
                observationStatusPresentation(ObservationStatusMode.OBSERVING, label),
            )
            return
        }
        latestVisualPackage = null
        pendingAiPackage = null
        if (latestPresence.accessibilityConnected) renderPresence(context.applicationContext) else cancel(context)
    }

    @Synchronized
    fun clear(context: Context) {
        activeVisualRequests.clear()
        latestVisualPackage = null
        pendingAiPackage = null
        latestPresence = PresenceState(null, false, false, false)
        cancel(context)
    }

    private fun renderPresence(context: Context) {
        if (!canShow(context)) return
        val state = latestPresence
        val mode: ObservationStatusMode
        val label: String?
        when {
            !state.accessibilityConnected -> {
                mode = ObservationStatusMode.DISCONNECTED
                label = null
            }
            !state.screenInteractive -> {
                mode = ObservationStatusMode.SCREEN_OFF
                label = null
            }
            !state.unlocked -> {
                mode = ObservationStatusMode.LOCKED
                label = null
            }
            state.packageName != null && !PresencePrivacyStore(context).exposesIdentity(state.packageName) -> {
                mode = ObservationStatusMode.PRIVATE_APP
                label = null
            }
            pendingAiPackage != null && pendingAiPackage == state.packageName -> {
                mode = ObservationStatusMode.AI_COMING
                label = visibleAppLabel(context, pendingAiPackage)
            }
            else -> {
                mode = ObservationStatusMode.SENSING
                label = visibleAppLabel(context, state.packageName)
            }
        }
        notify(context, mode, observationStatusPresentation(mode, label))
    }

    private fun notify(
        context: Context,
        mode: ObservationStatusMode,
        presentation: ObservationStatusPresentation,
    ): Boolean {
        createChannel(context)
        if (!channelEnabled(context)) return false
        val intent = Intent(context, MainActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        val pendingIntent = PendingIntent.getActivity(
            context,
            NOTIFICATION_ID,
            intent,
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val base = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_menu_view)
            .setContentTitle(presentation.title)
            .setContentText(presentation.text)
            .setStyle(NotificationCompat.BigTextStyle().bigText(presentation.text))
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .setShowWhen(false)
            .setContentIntent(pendingIntent)
            .build()

        val notification = if (PromotedObservationPolicy.shouldRequestPromotion(mode)) {
            requestPromotedOngoing(context, base)
        } else {
            base
        }

        return try {
            NotificationManagerCompat.from(context).notify(NOTIFICATION_ID, notification)
            true
        } catch (_: SecurityException) {
            false
        }
    }

    /**
     * compileSdk remains 35 for the canonical app today, while the user's OnePlus 12 is already
     * Android 16. Reflection lets API 36/36.1 opt in without raising the whole project's compile
     * SDK just for this presentation hint. Any missing/changed OEM/platform method falls back to
     * the normal ongoing notification rather than breaking observation.
     */
    private fun requestPromotedOngoing(context: Context, notification: Notification): Notification {
        if (Build.VERSION.SDK_INT < API_36) return notification
        return runCatching {
            val builder = Notification.Builder.recoverBuilder(context, notification)
            builder.javaClass
                .getMethod("setRequestPromotedOngoing", Boolean::class.javaPrimitiveType)
                .invoke(builder, true)
            runCatching {
                builder.javaClass
                    .getMethod("setShortCriticalText", String::class.java)
                    .invoke(builder, "观察中")
            }
            builder.build()
        }.getOrDefault(notification)
    }

    private fun createChannel(context: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = context.getSystemService(NotificationManager::class.java)
        val channel = NotificationChannel(CHANNEL_ID, CHANNEL_NAME, NotificationManager.IMPORTANCE_LOW).apply {
            description = "显示 Our Home 当前是在感知 App、AI 正在过来看，还是实际观察屏幕"
            setShowBadge(false)
        }
        manager.createNotificationChannel(channel)
    }

    private fun canShow(context: Context): Boolean {
        if (!NotificationManagerCompat.from(context).areNotificationsEnabled()) return false
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) return false
        createChannel(context)
        return channelEnabled(context)
    }

    private fun channelEnabled(context: Context): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return true
        val channel = context.getSystemService(NotificationManager::class.java).getNotificationChannel(CHANNEL_ID)
        return channel == null || channel.importance != NotificationManager.IMPORTANCE_NONE
    }

    private fun visibleAppLabel(context: Context, packageName: String?): String? {
        if (packageName.isNullOrBlank()) return null
        if (!PresencePrivacyStore(context).exposesIdentity(packageName)) return null
        return runCatching {
            val info = context.packageManager.getApplicationInfo(packageName, 0)
            context.packageManager.getApplicationLabel(info).toString().trim().ifBlank { packageName }
        }.getOrDefault(packageName)
    }

    private fun cancel(context: Context) {
        NotificationManagerCompat.from(context.applicationContext).cancel(NOTIFICATION_ID)
    }
}
