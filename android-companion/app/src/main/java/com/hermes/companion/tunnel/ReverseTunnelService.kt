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
import java.net.URLEncoder
import java.util.concurrent.TimeUnit
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
    private var socket: WebSocket? = null
    private var reconnectAttempt = 0
    private var stopping = false

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
        startAsForeground()
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
        settings.recordTunnelState("connecting")
        val separator = if (relayUrl.contains("?")) "&" else "?"
        val relayWithToken = relayUrl + separator + "token=" + URLEncoder.encode(token, Charsets.UTF_8.name())
        val request = Request.Builder().url(relayWithToken).build()
        socket = http.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                reconnectAttempt = 0
                settings.recordTunnelState("connected")
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                if (text.toByteArray(Charsets.UTF_8).size > MAX_FRAME_BYTES) return
                val request = RelayProtocol.parseRequest(text) ?: return
                val result = handler.handleMcp(request.body)
                webSocket.send(RelayProtocol.response(request.id, result.status, result.body))
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                socket = null
                scheduleReconnect(t.message ?: "WebSocket failure")
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                socket = null
                scheduleReconnect("WebSocket closed: $code ${reason.take(120)}")
            }
        })
    }

    private fun scheduleReconnect(message: String) {
        if (stopping || !settings.tunnelEnabled()) return
        val delay = (1_000L shl reconnectAttempt.coerceAtMost(6)).coerceAtMost(MAX_RECONNECT_MS)
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
        if (settings.tunnelEnabled()) settings.recordTunnelState("stopped") else settings.recordTunnelState("disabled")
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    companion object {
        private const val FOREGROUND_ID = 8788
        private const val MAX_FRAME_BYTES = 64 * 1024
        private const val MAX_RECONNECT_MS = 60_000L

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
