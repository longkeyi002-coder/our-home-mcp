package com.hermes.companion.tunnel

import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import androidx.core.app.NotificationCompat
import com.hermes.companion.MainActivity
import com.hermes.companion.push.HermesNotifications
import java.util.concurrent.TimeUnit
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener

/**
 * P7.1 outbound-only reverse tunnel. It exposes only TunnelMcpHandler's read-only tools.
 * Ordinary HTTPS telemetry, WorkManager and FCM do not depend on this service.
 */
class ReverseTunnelService : Service() {
    private val mainHandler = Handler(Looper.getMainLooper())
    private val http = OkHttpClient.Builder()
        .pingInterval(30, TimeUnit.SECONDS)
        .retryOnConnectionFailure(true)
        .build()

    private lateinit var settings: TunnelSettingsStore
    private lateinit var mcpHandler: TunnelMcpHandler
    private var socket: WebSocket? = null
    private var reconnectRunnable: Runnable? = null
    private var reconnectAttempt = 0
    private var connectionGeneration = 0L
    private var stopping = false

    override fun onCreate() {
        super.onCreate()
        settings = TunnelSettingsStore(applicationContext)
        mcpHandler = TunnelMcpHandler(applicationContext)
        HermesNotifications.createChannel(this)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (!settings.enabled()) {
            stopSelf()
            return START_NOT_STICKY
        }
        if (settings.configuration() == null) {
            settings.recordError(ERROR_INVALID_CONFIGURATION)
            stopSelf()
            return START_NOT_STICKY
        }

        stopping = false
        startAsForeground()
        connectIfNeeded()
        return START_STICKY
    }

    private fun startAsForeground() {
        val contentIntent = PendingIntent.getActivity(
            this,
            FOREGROUND_ID,
            Intent(this, MainActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val notification = NotificationCompat.Builder(this, HermesNotifications.CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentTitle("Our Home 远程只读连接")
            .setContentText("正在维持用户开启的安全出站连接")
            .setContentIntent(contentIntent)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .build()

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            startForeground(
                FOREGROUND_ID,
                notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE,
            )
        } else {
            startForeground(FOREGROUND_ID, notification)
        }
    }

    private fun connectIfNeeded() {
        if (stopping || !settings.enabled() || socket != null || reconnectRunnable != null) return
        val config = settings.configuration()
        if (config == null) {
            settings.recordError(ERROR_INVALID_CONFIGURATION)
            stopSelf()
            return
        }
        val relayWithToken = runCatching {
            TunnelEndpointPolicy.withToken(config.relayUrl, config.token)
        }.getOrElse {
            settings.recordError(ERROR_INVALID_CONFIGURATION)
            stopSelf()
            return
        }

        settings.recordConnecting()
        val generation = ++connectionGeneration
        val request = Request.Builder().url(relayWithToken).build()
        socket = http.newWebSocket(request, listener(generation))
    }

    private fun listener(generation: Long) = object : WebSocketListener() {
        override fun onOpen(webSocket: WebSocket, response: Response) {
            if (!isCurrent(generation)) return
            reconnectAttempt = 0
            settings.recordConnected()
        }

        override fun onMessage(webSocket: WebSocket, text: String) {
            if (!isCurrent(generation)) return
            if (text.toByteArray(Charsets.UTF_8).size > RelayProtocol.MAX_RELAY_FRAME_BYTES) return
            val relayRequest = RelayProtocol.parseRequest(text) ?: return
            val body = mcpHandler.handleMcp(relayRequest.body)
            webSocket.send(RelayProtocol.response(relayRequest.id, 200, body))
        }

        override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
            if (!isCurrent(generation)) return
            webSocket.close(code, reason.take(120))
        }

        override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
            if (!isCurrent(generation)) return
            socket = null
            settings.recordDisconnected("closed_$code")
            scheduleReconnect()
        }

        override fun onFailure(webSocket: WebSocket, throwable: Throwable, response: Response?) {
            if (!isCurrent(generation)) return
            socket = null
            val errorCode = response?.code?.let { "http_$it" }
                ?: "socket_${throwable.javaClass.simpleName.take(48)}"
            settings.recordDisconnected(errorCode)
            scheduleReconnect()
        }
    }

    private fun isCurrent(generation: Long): Boolean =
        !stopping && generation == connectionGeneration && settings.enabled()

    private fun scheduleReconnect() {
        if (stopping || !settings.enabled() || reconnectRunnable != null) return
        val delay = TunnelReconnectPolicy.delayMillis(reconnectAttempt)
        reconnectAttempt += 1
        val runnable = Runnable {
            reconnectRunnable = null
            connectIfNeeded()
        }
        reconnectRunnable = runnable
        mainHandler.postDelayed(runnable, delay)
    }

    private fun cancelReconnect() {
        reconnectRunnable?.let(mainHandler::removeCallbacks)
        reconnectRunnable = null
    }

    override fun onDestroy() {
        stopping = true
        connectionGeneration += 1
        cancelReconnect()
        socket?.cancel()
        socket = null
        http.dispatcher.cancelAll()
        http.connectionPool.evictAll()
        http.dispatcher.executorService.shutdown()
        if (settings.enabled()) settings.recordDisconnected("service_stopped")
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    companion object {
        private const val FOREGROUND_ID = 8788
        private const val ERROR_INVALID_CONFIGURATION = "invalid_configuration"
    }
}
