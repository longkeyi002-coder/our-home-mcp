package com.hermes.companion.local

import android.content.Context
import androidx.core.app.NotificationManagerCompat
import com.hermes.companion.data.SettingsRepository
import com.hermes.companion.platform.DeviceStatusReader
import com.hermes.companion.platform.UsageTimelineReader
import com.hermes.companion.push.HermesNotification
import com.hermes.companion.push.HermesNotifications
import java.io.BufferedWriter
import java.io.OutputStreamWriter
import java.io.ByteArrayOutputStream
import java.io.InputStream
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.net.Socket
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.ExecutorService
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.ThreadPoolExecutor
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import org.json.JSONArray
import org.json.JSONObject

/** Loopback-only MCP server. It intentionally ends when the Android process ends. */
object LocalMcpServer {
    private const val HOST = "127.0.0.1"
    private const val PORT = 5000
    private const val MAX_BODY_BYTES = 64 * 1024
    private const val READ_TIMEOUT_MS = 10_000
    private const val MAX_CLIENTS = 4
    private const val MAX_QUEUED_CLIENTS = 8
    private val running = AtomicBoolean(false)
    @Volatile private var startedAt = 0L
    @Volatile private var socket: ServerSocket? = null
    @Volatile private var clients: ExecutorService? = null

    fun endpoint(context: Context): String = "http://$HOST:$PORT/mcp/${SettingsRepository(context).localMcpSecret()}"
    fun ensureForCurrentMode(context: Context) { if (SettingsRepository(context).isLocalMode()) start(context) else stop() }
    fun isRunning(): Boolean = running.get()

    @Synchronized fun start(context: Context) {
        if (running.get()) return
        val app = context.applicationContext
        val settings = SettingsRepository(app)
        try {
            val server = ServerSocket()
            server.reuseAddress = true
            server.bind(InetSocketAddress(InetAddress.getByName(HOST), PORT))
            val executor = ThreadPoolExecutor(
                MAX_CLIENTS,
                MAX_CLIENTS,
                0L,
                TimeUnit.MILLISECONDS,
                ArrayBlockingQueue(MAX_QUEUED_CLIENTS),
                { runnable -> Thread(runnable, "hermes-local-mcp-client").apply { isDaemon = true } },
                ThreadPoolExecutor.AbortPolicy(),
            )
            socket = server
            clients = executor
            startedAt = System.currentTimeMillis()
            running.set(true)
            settings.clearLocalMcpError()
            Thread({
                while (running.get()) {
                    val client = try {
                        server.accept()
                    } catch (error: Exception) {
                        if (running.get()) settings.recordLocalMcpError(error.message ?: error::class.simpleName.orEmpty())
                        break
                    }
                    val pool = clients
                    if (pool == null) {
                        runCatching { client.close() }
                        continue
                    }
                    try {
                        pool.execute {
                            client.use {
                                it.soTimeout = READ_TIMEOUT_MS
                                runCatching { handle(app, it) }.onFailure { error ->
                                    settings.recordLocalMcpError(error.message ?: error::class.simpleName.orEmpty())
                                }
                            }
                        }
                    } catch (_: RejectedExecutionException) {
                        // The bounded executor is saturated; do not let one client starve the server.
                        runCatching { client.close() }
                    }
                }
            }, "hermes-local-mcp-accept").apply { isDaemon = true }.start()
        } catch (error: Exception) {
            runCatching { socket?.close() }
            socket = null
            clients?.shutdownNow()
            clients = null
            startedAt = 0L
            running.set(false)
            settings.recordLocalMcpError(error.message ?: error::class.simpleName.orEmpty())
        }
    }

    @Synchronized fun stop() {
        running.set(false)
        runCatching { socket?.close() }
        socket = null
        clients?.shutdownNow()
        clients = null
        startedAt = 0L
    }

    private fun handle(context: Context, client: Socket) {
        if (!client.inetAddress.isLoopbackAddress) return
        val input = client.getInputStream()
        val writer = BufferedWriter(OutputStreamWriter(client.getOutputStream(), Charsets.UTF_8))
        val parts = (readAsciiLine(input) ?: return).split(" ")
        if (parts.size < 2 || parts[0] != "POST") return write(writer, 405, error(null, -32600, "POST required"))
        val headers = mutableMapOf<String, String>()
        while (true) {
            val line = readAsciiLine(input) ?: return
            if (line.isEmpty()) break
            line.indexOf(':').takeIf { it > 0 }?.let { headers[line.substring(0, it).lowercase()] = line.substring(it + 1).trim() }
        }
        if (headers.containsKey("origin")) return write(writer, 403, error(null, -32001, "Browser origins are not allowed"))
        if (parts[1] != "/mcp/${SettingsRepository(context).localMcpSecret()}") return write(writer, 404, error(null, -32601, "Not found"))
        val length = headers["content-length"]?.toIntOrNull() ?: 0
        if (length !in 1..MAX_BODY_BYTES) return write(writer, 400, error(null, -32600, "Invalid body"))
        val body = readUtf8Body(input, length) ?: return write(writer, 400, error(null, -32600, "Truncated body"))
        val request = runCatching { JSONObject(body) }.getOrElse { return write(writer, 400, error(null, -32700, "Invalid JSON")) }
        val id = request.opt("id")
        val result = when (request.optString("method")) {
            "initialize" -> JSONObject().put("protocolVersion", "2025-03-26").put("serverInfo", JSONObject().put("name", "our-home-companion-local").put("version", "0.1.0")).put("capabilities", JSONObject().put("tools", JSONObject()))
            "notifications/initialized" -> return write(writer, 202, "")
            "tools/list" -> JSONObject().put("tools", tools())
            "tools/call" -> callTool(context, request.optJSONObject("params"))
            else -> return write(writer, 200, error(id, -32601, "Method not found"))
        }
        write(writer, 200, JSONObject().put("jsonrpc", "2.0").put("id", id).put("result", result).toString())
    }

    /** Reads exactly the byte count declared by HTTP Content-Length, then decodes UTF-8 once. */
    internal fun readUtf8Body(input: InputStream, length: Int): String? {
        val bytes = ByteArray(length)
        var offset = 0
        while (offset < length) {
            val count = input.read(bytes, offset, length - offset)
            if (count < 0) return null
            offset += count
        }
        return String(bytes, Charsets.UTF_8)
    }

    private fun readAsciiLine(input: InputStream): String? {
        val bytes = ByteArrayOutputStream()
        while (bytes.size() <= 8 * 1024) {
            val value = input.read()
            if (value < 0) return if (bytes.size() == 0) null else String(bytes.toByteArray(), Charsets.ISO_8859_1)
            if (value == '\n'.code) {
                val line = bytes.toByteArray()
                val end = if (line.lastOrNull() == '\r'.code.toByte()) line.size - 1 else line.size
                return String(line, 0, end, Charsets.ISO_8859_1)
            }
            bytes.write(value)
        }
        return null
    }

    private fun tools() = JSONArray()
        .put(tool("get_local_health", "Read local MCP health.", JSONObject()))
        .put(tool("get_device_context", "Read current device facts.", JSONObject()))
        .put(tool("get_current_usage", "Read current usage summary.", JSONObject()))
        .put(tool("send_local_notification", "Show a local notification.", JSONObject().put("type", "object").put("required", JSONArray().put("title").put("message")).put("properties", JSONObject().put("title", JSONObject().put("type", "string")).put("message", JSONObject().put("type", "string")))))

    private fun tool(name: String, description: String, schema: JSONObject) = JSONObject().put("name", name).put("description", description).put("inputSchema", schema)

    private fun callTool(context: Context, params: JSONObject?): JSONObject {
        val args = params?.optJSONObject("arguments") ?: JSONObject()
        val payload = when (params?.optString("name")) {
            "get_local_health" -> JSONObject()
                .put("mode", "LOCAL")
                .put("serverRunning", isRunning())
                .put("bindAddress", HOST)
                .put("port", PORT)
                .put("usageAccess", DeviceStatusReader.hasUsageAccess(context))
                .put("notificationPermission", NotificationManagerCompat.from(context).areNotificationsEnabled())
                .put("startedAt", startedAt)
                .put("lastError", SettingsRepository(context).localMcpLastError())
            "get_device_context" -> {
                val status = DeviceStatusReader.read(context)
                JSONObject().put("battery", status.batteryPercent).put("charging", status.charging).put("connectivity", if (status.online) "online" else "offline").put("foregroundPackage", status.foregroundPackage).put("observedAt", System.currentTimeMillis()).put("freshness", if (status.foregroundPackage == null) "unavailable" else "current")
            }
            "get_current_usage" -> usage(context)
            "send_local_notification" -> {
                val title = args.optString("title").trim(); val message = args.optString("message").trim()
                require(title.isNotEmpty() && message.isNotEmpty()) { "title and message are required" }
                HermesNotifications.show(context, HermesNotification("local-mcp:$title:$message", title, message)); JSONObject().put("accepted", true)
            }
            else -> throw IllegalArgumentException("Unknown tool")
        }
        return JSONObject().put("content", JSONArray().put(JSONObject().put("type", "text").put("text", payload.toString())))
    }

    private fun usage(context: Context): JSONObject {
        val summary = UsageTimelineReader.read(context) ?: return JSONObject().put("available", false)
        return JSONObject().put("available", true).put("currentPackage", summary.currentPackageName).put("currentDuration", summary.currentDurationMs)
            .put("recentSessions", JSONArray(summary.sessions.takeLast(50).map { s -> JSONObject().put("packageName", s.packageName).put("startedAt", s.startedAt).put("endedAt", s.endedAt).put("duration", s.durationMs).put("category", s.category) }))
            .put("todayAppTotals", JSONObject(summary.appTotalsMs)).put("categoryTotals", JSONObject(summary.categoryTotalsMs)).put("observedAt", summary.observedAt)
    }

    private fun error(id: Any?, code: Int, message: String) = JSONObject().put("jsonrpc", "2.0").put("id", id).put("error", JSONObject().put("code", code).put("message", message)).toString()
    private fun write(writer: BufferedWriter, status: Int, body: String) {
        val bytes = body.toByteArray(Charsets.UTF_8)
        writer.write("HTTP/1.1 $status OK\r\nContent-Type: application/json\r\nContent-Length: ${bytes.size}\r\nConnection: close\r\n\r\n$body")
        writer.flush()
    }
}
