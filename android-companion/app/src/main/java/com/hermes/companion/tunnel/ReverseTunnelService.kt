package com.hermes.companion.tunnel

import android.app.Notification
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import androidx.core.app.ContextCompat
import androidx.core.app.NotificationCompat
import com.hermes.companion.data.SettingsRepository
import com.hermes.companion.push.HermesNotifications
import java.util.concurrent.TimeUnit
import java.net.URLEncoder
import okhttp3.Call
import okhttp3.Callback
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener

/** User-enabled outgoing reverse tunnel. It never opens a listener on the phone. */
class ReverseTunnelService : Service() {
    private val mainHandler = Handler(Looper.getMainLooper())
    private val http = OkHttpClient.Builder().pingInterval(30, TimeUnit.SECONDS).build()
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
        if (intent?.action == ACTION_STOP) {
            settings.setTunnelEnabled(false)
            stopping = true
            stopSelf()
            return START_NOT_STICKY
        }
        if (!settings.tunnelEnabled()) {
            stopSelf()
            return START_NOT_STICKY
        }
        startAsForeground()
        connect()
        return START_STICKY
    }

    private fun startAsForeground() {
        val notification = NotificationCompat.Builder(this, HermesNotifications.CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentTitle("Hermes local relay active")
            .setContentText("Maintaining a secure outbound connection")
            .setOngoing(true)
            .build()
        if (Build.VERSION.SDK_INT >= 29) {
            startForeground(FOREGROUND_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
        } else startForeground(FOREGROUND_ID, notification)
    }

    private fun connect() {
        if (stopping || !settings.tunnelEnabled()) return
        val relayUrl = settings.tunnelRelayUrl()
        val token = settings.tunnelToken()
        if (!relayUrl.startsWith("wss://") || token.isNullOrBlank()) {
            stopSelf()
            return
        }
        socket?.cancel()
        val separator = if (relayUrl.contains("?")) "&" else "?"
        val relayWithToken = relayUrl + separator + "token=" + URLEncoder.encode(token, Charsets.UTF_8.name())
        val request = Request.Builder().url(relayWithToken).build()
        socket = http.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                reconnectAttempt = 0
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                if (text.toByteArray(Charsets.UTF_8).size > MAX_FRAME_BYTES) return
                val request = RelayProtocol.parseRequest(text) ?: return
                val body = handler.handleMcp(request.body)
                webSocket.send(RelayProtocol.response(request.id, 200, body))
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) = scheduleReconnect()
            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) = scheduleReconnect()
        })
    }

    private fun scheduleReconnect() {
        if (stopping || !settings.tunnelEnabled()) return
        val delay = (1_000L shl reconnectAttempt.coerceAtMost(6)).coerceAtMost(MAX_RECONNECT_MS)
        reconnectAttempt += 1
        mainHandler.removeCallbacksAndMessages(null)
        mainHandler.postDelayed({ connect() }, delay)
    }

    override fun onDestroy() {
        stopping = true
        mainHandler.removeCallbacksAndMessages(null)
        socket?.close(1000, "stopped")
        socket = null
        http.dispatcher.executorService.shutdown()
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    companion object {
        private const val FOREGROUND_ID = 8788
        private const val MAX_FRAME_BYTES = 64 * 1024
        private const val MAX_RECONNECT_MS = 60_000L
        private const val ACTION_STOP = "com.hermes.companion.tunnel.STOP"

        fun start(context: Context) {
            ContextCompat.startForegroundService(context, Intent(context, ReverseTunnelService::class.java))
        }

        fun stop(context: Context) {
            context.startService(Intent(context, ReverseTunnelService::class.java).setAction(ACTION_STOP))
        }
    }
}
