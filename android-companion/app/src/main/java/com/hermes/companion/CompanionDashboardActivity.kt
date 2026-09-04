package com.hermes.companion

import android.Manifest
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import androidx.core.app.NotificationManagerCompat
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import com.hermes.companion.data.CompanionMode
import com.hermes.companion.data.SettingsRepository
import com.hermes.companion.data.UploadWorker
import com.hermes.companion.local.LocalMcpServer
import com.hermes.companion.platform.DeviceStatusReader
import com.hermes.companion.platform.UsageTimelineReader
import com.hermes.companion.push.HermesNotification
import com.hermes.companion.push.HermesNotifications
import com.hermes.companion.tunnel.ReverseTunnelService
import java.text.DateFormat
import java.time.Instant
import java.util.Date
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject

class CompanionDashboardActivity : ComponentActivity() {
    private lateinit var model: CompanionDashboardViewModel

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), NOTIFICATION_PERMISSION_REQUEST)
        }
        model = ViewModelProvider(this, CompanionDashboardViewModel.factory(applicationContext))[CompanionDashboardViewModel::class.java]
        setContent { CompanionDashboard(model) }
    }

    override fun onResume() {
        super.onResume()
        model.resumeIfEnabled()
        model.refresh()
    }

    companion object { private const val NOTIFICATION_PERMISSION_REQUEST = 2001 }
}

data class DashboardState(
    val enabled: Boolean = false,
    val connected: Boolean = false,
    val localMcpRunning: Boolean = false,
    val tunnelState: String = "disabled",
    val error: String = "",
    val usageAccessGranted: Boolean = false,
    val notificationEnabled: Boolean = false,
    val batteryPercent: Int = 0,
    val charging: Boolean = false,
    val online: Boolean = false,
    val currentAppLabel: String = "",
    val currentPackage: String = "",
    val currentDurationMs: Long = 0L,
    val todayUsageMs: Long = 0L,
    val lastRelayConnectedAt: Long = 0L,
    val lastMcpActivity: String = "",
    val lastMcpActivityAt: Long = 0L,
    val lastNotificationTitle: String = "",
    val lastNotificationAt: Long = 0L,
    val diagnosticsRunning: Boolean = false,
    val diagnosticReport: String = "尚未运行完整检测。",
    val diagnosticLastAt: Long = 0L,
)

class CompanionDashboardViewModel(private val appContext: android.content.Context) : ViewModel() {
    private val settings = SettingsRepository(appContext)
    private val productState = CompanionProductState(appContext)
    private val _state = MutableStateFlow(DashboardState())
    val state: StateFlow<DashboardState> = _state

    @Volatile private var diagnosticsRunning = false
    @Volatile private var diagnosticReport = "尚未运行完整检测。"
    @Volatile private var diagnosticLastAt = 0L

    init {
        settings.setMode(CompanionMode.LOCAL)
        UploadWorker.cancelCloudWork(appContext)
        refresh()
    }

    fun refresh() {
        viewModelScope.launch { _state.value = withContext(Dispatchers.Default) { readState() } }
    }

    fun start() {
        settings.setMode(CompanionMode.LOCAL)
        UploadWorker.cancelCloudWork(appContext)
        LocalMcpServer.start(appContext)
        if (!LocalMcpServer.isRunning()) {
            refresh()
            return
        }
        settings.setTunnelEnabled(true)
        if (!ReverseTunnelService.start(appContext)) {
            settings.setTunnelEnabled(false)
            LocalMcpServer.stop()
        }
        refresh()
    }

    fun stop() {
        ReverseTunnelService.stop(appContext)
        LocalMcpServer.stop()
        refresh()
    }

    fun retryConnection() {
        if (!settings.tunnelEnabled()) return
        LocalMcpServer.start(appContext)
        ReverseTunnelService.start(appContext)
        refresh()
    }

    fun resumeIfEnabled() {
        if (!settings.tunnelEnabled()) return
        settings.setMode(CompanionMode.LOCAL)
        UploadWorker.cancelCloudWork(appContext)
        LocalMcpServer.start(appContext)
        ReverseTunnelService.start(appContext)
    }

    fun runDiagnostics() {
        if (diagnosticsRunning) return
        diagnosticsRunning = true
        refresh()
        viewModelScope.launch {
            diagnosticReport = withContext(Dispatchers.IO) { CompanionDiagnosticRunner(appContext).run() }
            diagnosticLastAt = System.currentTimeMillis()
            diagnosticsRunning = false
            refresh()
        }
    }

    fun sendTestNotification() {
        if (!NotificationManagerCompat.from(appContext).areNotificationsEnabled()) return
        val title = "Hermes 手机能力测试"
        HermesNotifications.show(
            appContext,
            HermesNotification(
                candidateId = "diagnostic-${System.currentTimeMillis()}",
                title = title,
                body = "如果你看到这条通知，说明手机通知能力正常。",
            ),
        )
        productState.recordNotification(title)
        refresh()
    }

    private fun readState(): DashboardState {
        val enabled = settings.tunnelEnabled()
        val usageAccess = DeviceStatusReader.hasUsageAccess(appContext)
        val device = DeviceStatusReader.read(appContext)
        val usage = if (usageAccess) UsageTimelineReader.read(appContext) else null
        val packageName = usage?.currentPackageName.orEmpty()
        val connected = enabled && ReverseTunnelService.isConnected() && LocalMcpServer.isRunning()
        val error = when {
            settings.tunnelLastError().isNotBlank() -> settings.tunnelLastError()
            settings.localMcpLastError().isNotBlank() -> settings.localMcpLastError()
            else -> ""
        }
        return DashboardState(
            enabled = enabled,
            connected = connected,
            localMcpRunning = LocalMcpServer.isRunning(),
            tunnelState = settings.tunnelState(),
            error = error,
            usageAccessGranted = usageAccess,
            notificationEnabled = NotificationManagerCompat.from(appContext).areNotificationsEnabled(),
            batteryPercent = device.batteryPercent,
            charging = device.charging,
            online = device.online,
            currentAppLabel = appLabel(packageName),
            currentPackage = packageName,
            currentDurationMs = usage?.currentDurationMs ?: 0L,
            todayUsageMs = usage?.appTotalsMs?.values?.sum() ?: 0L,
            lastRelayConnectedAt = productState.lastRelayConnectedAt(),
            lastMcpActivity = productState.lastMcpActivity(),
            lastMcpActivityAt = productState.lastMcpActivityAt(),
            lastNotificationTitle = productState.lastNotificationTitle(),
            lastNotificationAt = productState.lastNotificationAt(),
            diagnosticsRunning = diagnosticsRunning,
            diagnosticReport = diagnosticReport,
            diagnosticLastAt = diagnosticLastAt,
        )
    }

    private fun appLabel(packageName: String): String {
        if (packageName.isBlank()) return ""
        return runCatching {
            val info = appContext.packageManager.getApplicationInfo(packageName, 0)
            appContext.packageManager.getApplicationLabel(info).toString()
        }.getOrDefault(packageName)
    }

    companion object {
        fun factory(context: android.content.Context) = object : ViewModelProvider.Factory {
            @Suppress("UNCHECKED_CAST")
            override fun <T : ViewModel> create(modelClass: Class<T>): T = CompanionDashboardViewModel(context) as T
        }
    }
}

private data class HttpCheck(val code: Int?, val body: String, val error: String?)

private class CompanionDiagnosticRunner(private val context: android.content.Context) {
    private val settings = SettingsRepository(context)
    private val productState = CompanionProductState(context)
    private val http = OkHttpClient.Builder()
        .connectTimeout(5, TimeUnit.SECONDS)
        .readTimeout(5, TimeUnit.SECONDS)
        .writeTimeout(5, TimeUnit.SECONDS)
        .build()

    fun run(): String {
        if (!LocalMcpServer.isRunning()) LocalMcpServer.start(context)
        val localRunning = LocalMcpServer.isRunning()
        val usageAccess = DeviceStatusReader.hasUsageAccess(context)
        val notificationEnabled = NotificationManagerCompat.from(context).areNotificationsEnabled()
        val device = DeviceStatusReader.read(context)
        val usage = if (usageAccess) UsageTimelineReader.read(context) else null
        val checks = mutableListOf<String>()

        checks += checkLine("Local MCP :${AppDefaults.LOCAL_MCP_PORT}", localRunning, settings.localMcpLastError())
        if (localRunning) {
            val initialize = postJson(
                JSONObject()
                    .put("jsonrpc", "2.0")
                    .put("id", 1)
                    .put("method", "initialize")
                    .put(
                        "params",
                        JSONObject()
                            .put("protocolVersion", "2025-03-26")
                            .put("capabilities", JSONObject())
                            .put("clientInfo", JSONObject().put("name", "gpt-diagnostic").put("version", BuildConfig.VERSION_NAME)),
                    )
                    .toString(),
            )
            checks += httpLine("MCP initialize", initialize, 200)

            val initialized = postJson(
                JSONObject().put("jsonrpc", "2.0").put("method", "notifications/initialized").toString(),
            )
            checks += if (initialized.code == 202 && initialized.body.isEmpty()) {
                "[PASS] MCP notifications/initialized -> 202 empty"
            } else {
                "[FAIL] MCP notifications/initialized -> ${initialized.describe()}"
            }

            checks += httpLine(
                "MCP tools/list",
                postJson(JSONObject().put("jsonrpc", "2.0").put("id", 2).put("method", "tools/list").toString()),
                200,
            )
            checks += httpLine("tool get_local_health", callTool(3, "get_local_health"), 200)
            checks += httpLine("tool get_device_context", callTool(4, "get_device_context"), 200)
            if (usageAccess) {
                checks += httpLine("tool get_current_usage", callTool(5, "get_current_usage"), 200)
            } else {
                checks += "[SKIP] tool get_current_usage -> Usage Access 未授权"
            }
        }

        checks += checkLine("Usage Access", usageAccess, if (usageAccess) "" else "需要在系统设置中授权")
        checks += checkLine("通知权限", notificationEnabled, if (notificationEnabled) "" else "通知被关闭")
        checks += checkLine("手机网络", device.online, if (device.online) "" else "设备当前离线")
        checks += if (ReverseTunnelService.isConnected()) {
            "[PASS] Remote Relay -> WebSocket 当前真实 onOpen"
        } else {
            "[INFO] Remote Relay -> ${settings.tunnelState()}${settings.tunnelLastError().takeIf { it.isNotBlank() }?.let { ": $it" } ?: ""}"
        }

        val currentPackage = usage?.currentPackageName ?: "unavailable"
        val lastError = when {
            settings.tunnelLastError().isNotBlank() -> settings.tunnelLastError()
            settings.localMcpLastError().isNotBlank() -> settings.localMcpLastError()
            else -> "none"
        }
        val relayHost = AppDefaults.TUNNEL_RELAY_URL.removePrefix("wss://").substringBefore('/')

        val report = buildString {
            appendLine("=== Hermes Companion / GPT Diagnostic Report ===")
            appendLine("generatedAt=${Instant.now()}")
            appendLine("appVersion=${BuildConfig.VERSION_NAME} (${BuildConfig.VERSION_CODE})")
            appendLine("deviceId=${AppDefaults.DEVICE_ID}")
            appendLine("debugStage=GPT_DIAGNOSTIC")
            appendLine("note=此报告不包含 Tunnel Token，可直接复制给 GPT 排查。")
            appendLine()
            appendLine("[CURRENT STATE]")
            appendLine("companionEnabled=${settings.tunnelEnabled()}")
            appendLine("localMcpRunning=${LocalMcpServer.isRunning()}")
            appendLine("localMcpPort=${AppDefaults.LOCAL_MCP_PORT}")
            appendLine("remoteRelayHost=$relayHost")
            appendLine("remoteRelayLiveConnected=${ReverseTunnelService.isConnected()}")
            appendLine("remoteRelayState=${settings.tunnelState()}")
            appendLine("networkOnline=${device.online}")
            appendLine("usageAccess=$usageAccess")
            appendLine("notificationEnabled=$notificationEnabled")
            appendLine("batteryPercent=${device.batteryPercent}")
            appendLine("charging=${device.charging}")
            appendLine("foregroundPackage=$currentPackage")
            appendLine("currentUsageMs=${usage?.currentDurationMs ?: 0L}")
            appendLine("todayRecordedUsageMs=${usage?.appTotalsMs?.values?.sum() ?: 0L}")
            appendLine("lastRelayConnectedAt=${productState.lastRelayConnectedAt()}")
            appendLine("lastMcpActivity=${productState.lastMcpActivity().ifBlank { "none" }}")
            appendLine("lastMcpActivityAt=${productState.lastMcpActivityAt()}")
            appendLine("lastNotificationTitle=${productState.lastNotificationTitle().ifBlank { "none" }}")
            appendLine("lastNotificationAt=${productState.lastNotificationAt()}")
            appendLine("lastError=$lastError")
            appendLine()
            appendLine("[SELF TEST]")
            checks.forEach { appendLine(it) }
            appendLine()
            appendLine("[CAPABILITIES]")
            appendLine("get_local_health=implemented")
            appendLine("get_device_context=implemented")
            appendLine("get_current_usage=${if (usageAccess) "implemented+authorized" else "implemented+permission-required"}")
            appendLine("send_local_notification=${if (notificationEnabled) "implemented+authorized" else "implemented+permission-required"}")
            appendLine("location=not-implemented")
            appendLine("calendar=not-implemented")
            appendLine("open_app/open_url=not-implemented")
            appendLine("device-originated-life-wake=not-implemented")
        }
        http.dispatcher.executorService.shutdown()
        return report
    }

    private fun callTool(id: Int, name: String): HttpCheck = postJson(
        JSONObject()
            .put("jsonrpc", "2.0")
            .put("id", id)
            .put("method", "tools/call")
            .put("params", JSONObject().put("name", name).put("arguments", JSONObject()))
            .toString(),
    )

    private fun postJson(body: String): HttpCheck = runCatching {
        val request = Request.Builder()
            .url(LocalMcpServer.endpoint(context))
            .post(body.toRequestBody(JSON_MEDIA_TYPE))
            .build()
        http.newCall(request).execute().use { response ->
            HttpCheck(response.code, response.body?.string().orEmpty(), null)
        }
    }.getOrElse { error -> HttpCheck(null, "", error.message ?: error::class.simpleName) }

    private fun httpLine(label: String, check: HttpCheck, expectedCode: Int): String =
        if (check.code == expectedCode && check.error == null) "[PASS] $label -> HTTP $expectedCode"
        else "[FAIL] $label -> ${check.describe()}"

    private fun HttpCheck.describe(): String = when {
        error != null -> "error=$error"
        code != null -> "HTTP $code body=${body.take(160)}"
        else -> "unknown"
    }

    private fun checkLine(label: String, pass: Boolean, detail: String): String =
        if (pass) "[PASS] $label" else "[FAIL] $label${detail.takeIf { it.isNotBlank() }?.let { " -> $it" } ?: ""}"

    companion object {
        private val JSON_MEDIA_TYPE = "application/json; charset=utf-8".toMediaType()
    }
}

@Composable
private fun CompanionDashboard(model: CompanionDashboardViewModel) {
    val state by model.state.collectAsStateWithLifecycle()
    val context = LocalContext.current
    Scaffold { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .verticalScroll(rememberScrollState())
                .padding(18.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text("Hermes 手机伴侣", style = MaterialTheme.typography.headlineMedium)
            Text(
                "当前先作为 GPT 调试版：把手机端能力、权限和连接状态跑通。检测报告可以一键复制给 GPT，等稳定后再切回阿里云 Hermes。",
                style = MaterialTheme.typography.bodyMedium,
            )
            StatusCard(state, model)
            PermissionCard(state)
            PhoneStateCard(state)
            CapabilityCard(state, model)
            RecentActivityCard(state)
            DiagnosticReportCard(state, model, context)
        }
    }

    LaunchedEffect(Unit) {
        while (true) {
            delay(3_000)
            model.refresh()
        }
    }
}

@Composable
private fun StatusCard(state: DashboardState, model: CompanionDashboardViewModel) {
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("我现在是什么状态", style = MaterialTheme.typography.titleLarge)
            StatusRow("手机能力服务", if (state.localMcpRunning) "正常" else "未运行")
            StatusRow("手机网络", if (state.online) "在线" else "离线")
            StatusRow(
                "远端桥接",
                when {
                    state.connected -> "已连接"
                    state.enabled && state.tunnelState in setOf("connecting", "reconnecting", "enabled") -> "正在连接"
                    state.enabled -> "未连接"
                    else -> "未启动"
                },
            )
            StatusRow("GPT 调试报告", if (state.diagnosticLastAt > 0L) "已生成" else "等待检测")
            if (state.lastRelayConnectedAt > 0L) Text("最近一次远端连接：${state.lastRelayConnectedAt.displayTime()}")
            if (state.error.isNotBlank()) Text("当前错误：${state.error}", style = MaterialTheme.typography.bodySmall)
            Button(
                onClick = { if (state.enabled) model.stop() else model.start() },
                modifier = Modifier.fillMaxWidth(),
            ) { Text(if (state.enabled) "暂停手机桥接" else "开始手机桥接") }
            if (state.enabled && !state.connected) {
                OutlinedButton(onClick = model::retryConnection, modifier = Modifier.fillMaxWidth()) { Text("立即重连") }
            }
        }
    }
}

@Composable
private fun PermissionCard(state: DashboardState) {
    if (state.usageAccessGranted && state.notificationEnabled) return
    val context = LocalContext.current
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("需要你确认的权限", style = MaterialTheme.typography.titleMedium)
            if (!state.usageAccessGranted) {
                Text("使用情况访问：让手机读取当前 App 和使用时间。")
                Button(
                    onClick = { context.startActivity(Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS)) },
                    modifier = Modifier.fillMaxWidth(),
                ) { Text("授予使用情况权限") }
            }
            if (!state.notificationEnabled) {
                Text("通知：让手机接收 Hermes/GPT 调试通知。")
                OutlinedButton(
                    onClick = {
                        context.startActivity(
                            Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
                                .putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName),
                        )
                    },
                    modifier = Modifier.fillMaxWidth(),
                ) { Text("打开通知设置") }
            }
        }
    }
}

@Composable
private fun PhoneStateCard(state: DashboardState) {
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("这台手机现在能看到什么", style = MaterialTheme.typography.titleMedium)
            StatusRow("电量", "${state.batteryPercent}%${if (state.charging) " · 充电中" else ""}")
            StatusRow("网络", if (state.online) "在线" else "离线")
            if (state.usageAccessGranted) {
                StatusRow("当前 App", state.currentAppLabel.ifBlank { "暂未识别" })
                StatusRow("当前 App 包名", state.currentPackage.ifBlank { "无" })
                StatusRow("本次使用", state.currentDurationMs.durationText())
                StatusRow("今天已记录", state.todayUsageMs.durationText())
            } else {
                StatusRow("App 使用情况", "需要授权")
            }
        }
    }
}

@Composable
private fun CapabilityCard(state: DashboardState, model: CompanionDashboardViewModel) {
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("当前功能", style = MaterialTheme.typography.titleMedium)
            StatusRow("读取设备状态", "可用")
            StatusRow("查看当前 App / 使用时间", if (state.usageAccessGranted) "可用" else "需要授权")
            StatusRow("本地 MCP :${AppDefaults.LOCAL_MCP_PORT}", if (state.localMcpRunning) "运行中" else "未运行")
            StatusRow("发送手机通知", if (state.notificationEnabled) "可用" else "需要授权")
            StatusRow("远端 WebSocket", if (state.connected) "已连接" else "未连接")
            StatusRow("GPT 检测报告", "可用")
            if (state.notificationEnabled) {
                OutlinedButton(onClick = model::sendTestNotification, modifier = Modifier.fillMaxWidth()) {
                    Text("发送一条测试通知")
                }
            }
            HorizontalDivider()
            Text("下一阶段", style = MaterialTheme.typography.titleSmall)
            StatusRow("位置感知", "还没有")
            StatusRow("日程感知", "还没有")
            StatusRow("打开 App / 链接", "还没有")
            StatusRow("手机变化主动唤醒 Hermes", "还没有")
        }
    }
}

@Composable
private fun RecentActivityCard(state: DashboardState) {
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("最近发生了什么", style = MaterialTheme.typography.titleMedium)
            StatusRow(
                "最近 MCP 调用",
                if (state.lastMcpActivityAt > 0L) "${state.lastMcpActivity.activityLabel()} · ${state.lastMcpActivityAt.displayTime()}" else "还没有",
            )
            StatusRow(
                "最近通知",
                if (state.lastNotificationAt > 0L) "${state.lastNotificationTitle.ifBlank { "手机通知" }} · ${state.lastNotificationAt.displayTime()}" else "还没有",
            )
            StatusRow("最近远端连接", if (state.lastRelayConnectedAt > 0L) state.lastRelayConnectedAt.displayTime() else "还没有")
        }
    }
}

@Composable
private fun DiagnosticReportCard(
    state: DashboardState,
    model: CompanionDashboardViewModel,
    context: android.content.Context,
) {
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("GPT 检测报告", style = MaterialTheme.typography.titleMedium)
            Text("遇到问题时先运行完整检测，再复制报告直接发给 GPT。报告不会复制 Tunnel Token。")
            Button(
                onClick = model::runDiagnostics,
                enabled = !state.diagnosticsRunning,
                modifier = Modifier.fillMaxWidth(),
            ) { Text(if (state.diagnosticsRunning) "正在检测…" else "运行完整检测") }
            OutlinedButton(
                onClick = {
                    val clipboard = context.getSystemService(ClipboardManager::class.java)
                    clipboard.setPrimaryClip(ClipData.newPlainText("Hermes GPT Diagnostic Report", state.diagnosticReport))
                    Toast.makeText(context, "检测报告已复制", Toast.LENGTH_SHORT).show()
                },
                enabled = !state.diagnosticsRunning && state.diagnosticReport.isNotBlank(),
                modifier = Modifier.fillMaxWidth(),
            ) { Text("复制检测报告") }
            if (state.diagnosticLastAt > 0L) Text("最近检测：${state.diagnosticLastAt.displayTime()}")
            SelectionContainer {
                Text(
                    state.diagnosticReport,
                    style = MaterialTheme.typography.bodySmall.copy(fontFamily = FontFamily.Monospace),
                )
            }
        }
    }
}

@Composable
private fun StatusRow(label: String, value: String) {
    Column(modifier = Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Text(label, style = MaterialTheme.typography.labelMedium)
        Text(value, style = MaterialTheme.typography.bodyMedium)
    }
}

private fun Long.displayTime(): String =
    DateFormat.getDateTimeInstance(DateFormat.SHORT, DateFormat.MEDIUM).format(Date(this))

private fun Long.durationText(): String {
    val totalMinutes = this / 60_000L
    val hours = totalMinutes / 60L
    val minutes = totalMinutes % 60L
    return when {
        hours > 0L -> "${hours}小时${minutes}分"
        minutes > 0L -> "${minutes}分钟"
        this > 0L -> "不到1分钟"
        else -> "0分钟"
    }
}

private fun String.activityLabel(): String = when (this) {
    "initialize" -> "建立手机 MCP 会话"
    "notifications/initialized" -> "完成 MCP 初始化"
    "tools/list" -> "查看手机能力列表"
    "get_local_health" -> "检查手机桥接状态"
    "get_device_context" -> "读取设备状态"
    "get_current_usage" -> "读取 App 使用情况"
    "send_local_notification" -> "发送手机通知"
    else -> ifBlank { "未知" }
}
