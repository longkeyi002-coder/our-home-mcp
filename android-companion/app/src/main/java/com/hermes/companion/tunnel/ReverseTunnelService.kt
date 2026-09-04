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
import com.hermes.companion.CompanionProductState
import com.hermes.companion.data.CompanionMode
import com.hermes.companion.data.SettingsRepository
import com.hermes.companion.data.UploadWorker
import com.hermes.companion.local.LocalMcpServer
import com.hermes.companion.push.HermesNotifications
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import okhttp3.Call
import okhttp3.Callback
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okio.ByteString

/** User-enabled outgoing reverse tunnel. MCP frames are forwarded to the loopback MCP server. */
class ReverseTunnelService : Service() {
    private val mainHandler = Handler(Looper.getMainLooper())
    private val http = OkHttpClient.Builder()
        .connectTimeout(20, TimeUnit.SECONDS)
        .readTimeout(20, TimeUnit.SECONDS)
        .writeTimeout(20, TimeUnit.SECONDS)
        .pingInterval(30, TimeUnit.SECONDS)
        .build()
    private lateinit var settings: SettingsRepository
    private lateinit var productState: CompanionProductState
    @Volatile private var socket: WebSocket? = null
    private var reconnectAttempt = 0
    @Volatile private var stopping = false

    override fun onCreate() {
        super.onCreate()
        settings = SettingsRepository(this)
        productState = CompanionProductState(this)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (!settings.tunnelEnabled()) {
            liveConnected.set(false)
            stopSelf()
            return START_NOT_STICKY
        }
        stopping = false
        try {
            startAsForeground()
        } catch (error: Throwable) {
            liveConnected.set(false)
            settings.recordTunnelState("start_failed", error.message ?: error::class.simpleName.orEmpty())
            stopSelf()
            return START_NOT_STICKY
        }

        settings.setMode(CompanionMode.LOCAL)
        UploadWorker.cancelCloudWork(this)
        LocalMcpServer.start(applicationContext)
        if (!LocalMcpServer.isRunning()) {
            liveConnected.set(false)
            settings.recordTunnelState("local_mcp_error", settings.localMcpLastError().ifBlank { "Local MCP failed to start" })
            stopSelf()
            return START_NOT_STICKY
        }

        if (socket == null) connect()
        return START_STICKY
    }

    private fun startAsForeground() {
        val notification = NotificationCompat.Builder(this, HermesNotifications.CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentTitle("Hermes 手机伴侣")
            .setContentText("Hermes 正在保持与这台手机的连接")
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
        liveConnected.set(false)
        val relayWithToken = buildRelayWebSocketUrl(settings.tunnelRelayUrl(), settings.tunnelToken())
        if (relayWithToken == null) {
            settings.recordTunnelState("configuration_error", "Hardcoded tunnel configuration is invalid")
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
                    liveConnected.set(true)
                    settings.recordTunnelState("connected")
                    productState.recordRelayConnected()
                }

                override fun onMessage(webSocket: WebSocket, text: String) = handleFrame(webSocket, text)
                override fun onMessage(webSocket: WebSocket, bytes: ByteString) = handleFrame(webSocket, bytes.utf8())

                override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                    if (socket !== webSocket) return
                    liveConnected.set(false)
                    socket = null
                    scheduleReconnect(t.message ?: "WebSocket failure")
                }

                override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                    if (socket !== webSocket) return
                    liveConnected.set(false)
                    socket = null
                    scheduleReconnect("WebSocket closed: $code ${reason.take(120)}")
                }
            })
        }.getOrElse { error ->
            liveConnected.set(false)
            settings.recordTunnelState("reconnecting", error.message ?: error::class.simpleName.orEmpty())
            scheduleReconnect(error.message ?: "WebSocket start failed")
            null
        }
    }

    private fun handleFrame(webSocket: WebSocket, frame: String) {
        if (socket !== webSocket || frame.toByteArray(Charsets.UTF_8).size > MAX_FRAME_BYTES) return
        val relayRequest = RelayProtocol.parseRequest(frame) ?: return
        forwardToLocalMcp(webSocket, relayRequest)
    }

    private fun forwardToLocalMcp(webSocket: WebSocket, relayRequest: RelayMcpRequest) {
        if (!LocalMcpServer.isRunning()) LocalMcpServer.start(applicationContext)
        if (!LocalMcpServer.isRunning()) {
            settings.recordTunnelState("local_mcp_error", settings.localMcpLastError().ifBlank { "Local MCP unavailable" })
            webSocket.send(RelayProtocol.response(relayRequest.id, 503, null))
            return
        }

        val localRequest = Request.Builder()
            .url(LocalMcpServer.endpoint(applicationContext))
            .post(relayRequest.body.toRequestBody(JSON_MEDIA_TYPE))
            .build()
        http.newCall(localRequest).enqueue(object : Callback {
            override fun onFailure(call: Call, error: java.io.IOException) {
                if (socket !== webSocket) return
                settings.recordTunnelState("local_mcp_error", error.message ?: "Local MCP request failed")
                webSocket.send(RelayProtocol.response(relayRequest.id, 502, null))
            }

            override fun onResponse(call: Call, response: Response) {
                response.use {
                    if (socket !== webSocket) return
                    val bodyText = it.body?.string().orEmpty()
                    val relayBody = if (bodyText.isEmpty()) null else bodyText
                    webSocket.send(RelayProtocol.response(relayRequest.id, it.code, relayBody))
                }
            }
        })
    }

    private fun scheduleReconnect(message: String) {
        if (stopping || !settings.tunnelEnabled()) return
        liveConnected.set(false)
        val delay = (1_000L shl reconnectAttempt.coerceAtMost(5)).coerceAtMost(MAX_RECONNECT_MS)
        reconnectAttempt += 1
        settings.recordTunnelState("reconnecting", message)
        mainHandler.removeCallbacksAndMessages(null)
        mainHandler.postDelayed({ connect() }, delay)
    }

    override fun onDestroy() {
        stopping = true
        liveConnected.set(false)
        mainHandler.removeCallbacksAndMessages(null)
        socket?.close(1000, "stopped")
        socket = null
        LocalMcpServer.stop()
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
        private val JSON_MEDIA_TYPE = "application/json; charset=utf-8".toMediaType()
        private val liveConnected = AtomicBoolean(false)

        fun isConnected(): Boolean = liveConnected.get()

        internal fun buildRelayWebSocketUrl(rawUrl: String, token: String): String? {
            val raw = rawUrl.trim()
            if (!raw.startsWith("wss://") || token.isBlank()) return null
            val withoutScheme = raw.removePrefix("wss://")
            val authorityAndPath = withoutScheme.substringBefore('?')
            val authority = authorityAndPath.substringBefore('/')
            if (authority.isBlank()) return null
            val base = "wss://" + authorityAndPath.trimEnd('/').ifBlank { authority }
            val normalizedBase = if (authorityAndPath.contains('/')) base else "$base/"
            val preserved = raw.substringAfter('?', "")
                .split('&')
                .filter { it.isNotBlank() && it.substringBefore('=').lowercase() != "token" }
            val query = (preserved + "token=${encodeQueryValue(token.trim())}").joinToString("&")
            return "$normalizedBase?$query"
        }

        private fun encodeQueryValue(value: String): String = buildString {
            value.toByteArray(Charsets.UTF_8).forEach { byte ->
                val unsigned = byte.toInt() and 0xff
                val safe = unsigned in 'a'.code..'z'.code || unsigned in 'A'.code..'Z'.code || unsigned in '0'.code..'9'.code || unsigned == '-'.code || unsigned == '_'.code || unsigned == '.'.code || unsigned == '~'.code
                if (safe) append(unsigned.toChar()) else append('%').append(HEX[unsigned ushr 4]).append(HEX[unsigned and 0x0f])
            }
        }

        private const val HEX = "0123456789ABCDEF"

        fun start(context: Context): Boolean {
            val app = context.applicationContext
            return runCatching {
                ContextCompat.startForegroundService(app, Intent(app, ReverseTunnelService::class.java))
                true
            }.getOrElse { error ->
                liveConnected.set(false)
                SettingsRepository(app).recordTunnelState("start_failed", error.message ?: error::class.simpleName.orEmpty())
                false
            }
        }

        fun stop(context: Context) {
            liveConnected.set(false)
            val app = context.applicationContext
            val settings = SettingsRepository(app)
            settings.setTunnelEnabled(false)
            app.stopService(Intent(app, ReverseTunnelService::class.java))
            LocalMcpServer.stop()
            settings.recordTunnelState("disabled")
        }
    }
}
