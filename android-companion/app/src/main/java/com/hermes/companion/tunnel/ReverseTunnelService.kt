package com.hermes.companion.tunnel

import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import com.hermes.companion.data.SettingsRepository
import com.hermes.companion.push.HermesNotifications
import java.util.concurrent.TimeUnit
import okhttp3.ByteString
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener

/** User-enabled outgoing reverse tunnel. It never opens a listener on the phone. */
class ReverseTunnelService : Service() {
    private val mainHandler = Handler(Looper.getMainLooper())
    private val http = OkHttpClient.Builder()
        .connectTimeout(20, TimeUnit.SECONDS)
        .pingInterval(30, TimeUnit.SECONDS)
        .build()
    private lateinit var settings: SettingsRepository
    private lateinit var handler: TunnelMcpHandler
    @Volatile private var socket: WebSocket? = null
    private var reconnectAttempt = 0
    @Volatile private var stopping = false

    override fun onCreate() {
        super.onCreate()
        settings = SettingsRepository(this)
        handler = TunnelMcpHandler(applicationContext)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (!settings.tunnelEnabled()) {
            stopSelf()
            return START_NOT_STICKY
        }
        stopping = false
        try {
            startAsForeground()
        } catch (error: Throwable) {
            settings.recordTunnelState("start_failed", error.message ?: error::class.simpleName.orEmpty())
            stopSelf()
            return START_NOT_STICKY
        }
        if (socket == null) connect()
        return START_STICKY
    }

    private fun startAsForeground() {
        val notification = NotificationCompat.Builder(this, HermesNotifications.CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentTitle("Hermes reverse tunnel")
            .setContentText("Maintaining a secure outbound relay connection")
            .setOngoing(true)
            .build()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            startForeground(FOREGROUND_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
        } else {
            startForeground(FOREGROUND_ID, notification)
        }
    }

    private fun connect() {
        if (stopping || !settings.tunnelEnabled() || socket != null) return
        val relayUrl = settings.tunnelRelayUrl()
        val token = settings.tunnelToken()
        if (!relayUrl.startsWith("wss://") || token.isNullOrBlank()) {
            settings.recordTunnelState("configuration_error", "Tunnel relay must use wss:// and a token")
            stopSelf()
            return
        }
        val relayWithToken = buildRelayWebSocketUrl(relayUrl, token)
        if (relayWithToken == null) {
            settings.recordTunnelState("configuration_error", "Tunnel relay URL must be a valid wss:// URL")
            stopSelf()
            return
        }
        settings.recordTunnelState("connecting")
        val request = Request.Builder().url(relayWithToken).build()
        socket = runCatching {
            http.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                if (socket !== webSocket) {
                    webSocket.close(1000, "superseded")
                    return
                }
                reconnectAttempt = 0
                settings.recordTunnelState("connected")
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                handleFrame(webSocket, text)
            }

            override fun onMessage(webSocket: WebSocket, bytes: ByteString) {
                handleFrame(webSocket, bytes.utf8())
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                if (socket !== webSocket) return
                socket = null
                scheduleReconnect(t.message ?: "WebSocket failure")
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                if (socket !== webSocket) return
                socket = null
                scheduleReconnect("WebSocket closed: $code ${reason.take(120)}")
            }
        })
        }.getOrElse { error ->
            settings.recordTunnelState("reconnecting", error.message ?: error::class.simpleName.orEmpty())
            scheduleReconnect(error.message ?: "WebSocket start failed")
            null
        }
    }

    private fun handleFrame(webSocket: WebSocket, frame: String) {
        if (socket !== webSocket || frame.toByteArray(Charsets.UTF_8).size > MAX_FRAME_BYTES) return
        val request = RelayProtocol.parseRequest(frame) ?: return
        val result = runCatching { handler.handleMcp(request.body) }.getOrElse { return }
        webSocket.send(RelayProtocol.response(request.id, result.status, result.body))
    }

    private fun scheduleReconnect(message: String) {
        if (stopping || !settings.tunnelEnabled()) return
        val delay = (1_000L shl reconnectAttempt.coerceAtMost(5)).coerceAtMost(MAX_RECONNECT_MS)
        reconnectAttempt += 1
        settings.recordTunnelState("reconnecting", message)
        mainHandler.removeCallbacksAndMessages(null)
        mainHandler.postDelayed({ connect() }, delay)
    }

    override fun onDestroy() {
        stopping = true
        mainHandler.removeCallbacksAndMessages(null)
        socket?.close(1000, "stopped")
        socket = null
        http.dispatcher.executorService.shutdown()
        if (settings.tunnelEnabled()) {
            val previousError = settings.tunnelLastError()
            settings.recordTunnelState("stopped", previousError.takeIf { it.isNotBlank() })
        } else {
            settings.recordTunnelState("disabled")
        }
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    companion object {
        private const val FOREGROUND_ID = 8788
        private const val MAX_FRAME_BYTES = 64 * 1024
        private const val MAX_RECONNECT_MS = 30_000L

        internal fun buildRelayWebSocketUrl(rawUrl: String, token: String): String? {
            val parsed = rawUrl.trim().toHttpUrlOrNull() ?: return null
            if (parsed.scheme != "wss" || token.isBlank()) return null
            return parsed.newBuilder()
                .removeAllQueryParameters("token")
                .addQueryParameter("token", token.trim())
                .build()
                .toString()
        }

        fun start(context: Context): Boolean {
            val app = context.applicationContext
            return runCatching {
                ContextCompat.startForegroundService(app, Intent(app, ReverseTunnelService::class.java))
                true
            }.getOrElse { error ->
                SettingsRepository(app).recordTunnelState("start_failed", error.message ?: error::class.simpleName.orEmpty())
                false
            }
        }

        fun stop(context: Context) {
            val app = context.applicationContext
            val settings = SettingsRepository(app)
            settings.setTunnelEnabled(false)
            app.stopService(Intent(app, ReverseTunnelService::class.java))
            settings.recordTunnelState("disabled")
        }
    }
}
