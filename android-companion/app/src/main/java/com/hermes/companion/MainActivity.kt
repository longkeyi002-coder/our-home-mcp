package com.hermes.companion

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
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
import com.hermes.companion.tunnel.ReverseTunnelService
import java.text.DateFormat
import java.util.Date
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class MainActivity : ComponentActivity() {
    private lateinit var model: CompanionViewModel

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), NOTIFICATION_PERMISSION_REQUEST)
        }
        model = ViewModelProvider(this, CompanionViewModel.factory(applicationContext))[CompanionViewModel::class.java]
        setContent { HermesCompanionApp(model) }
    }

    override fun onResume() {
        super.onResume()
        model.resumeTunnelIfEnabled()
        model.refresh()
    }

    companion object { private const val NOTIFICATION_PERMISSION_REQUEST = 1001 }
}

data class CompanionUiState(
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
)

class CompanionViewModel(private val appContext: android.content.Context) : ViewModel() {
    private val settings = SettingsRepository(appContext)
    private val productState = CompanionProductState(appContext)
    private val _state = MutableStateFlow(CompanionUiState())
    val state: StateFlow<CompanionUiState> = _state

    init {
        settings.setMode(CompanionMode.LOCAL)
        UploadWorker.cancelCloudWork(appContext)
        refresh()
    }

    fun refresh() {
        viewModelScope.launch {
            _state.value = withContext(Dispatchers.Default) { readState() }
        }
    }

    fun start() {
        settings.setMode(CompanionMode.LOCAL)
        UploadWorker.cancelCloudWork(appContext)
        LocalMcpServer.start(appContext)
        if (!LocalMcpServer.isRunning()) {
            _state.value = _state.value.copy(error = settings.localMcpLastError().ifBlank { "本地手机桥接启动失败" })
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

    fun resumeTunnelIfEnabled() {
        if (!settings.tunnelEnabled()) return
        settings.setMode(CompanionMode.LOCAL)
        UploadWorker.cancelCloudWork(appContext)
        LocalMcpServer.start(appContext)
        ReverseTunnelService.start(appContext)
    }

    private fun readState(): CompanionUiState {
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
        return CompanionUiState(
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
            override fun <T : ViewModel> create(modelClass: Class<T>): T = CompanionViewModel(context) as T
        }
    }
}

@Composable
fun HermesCompanionApp(model: CompanionViewModel) {
    val state by model.state.collectAsStateWithLifecycle()
    val context = LocalContext.current
    Scaffold { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .verticalScroll(rememberScrollState())
                .padding(20.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            Text("Hermes 手机伴侣", style = MaterialTheme.typography.headlineMedium)
            Text(
                "这是 Hermes 在这台手机上的感知与行动端。连接后，他可以读取设备状态和 App 使用情况，并在需要时向你发送手机通知。",
                style = MaterialTheme.typography.bodyMedium,
            )

            ConnectionCard(state, model)

            if (!state.usageAccessGranted || !state.notificationEnabled) {
                PermissionCard(state)
            }

            WhatHermesKnowsCard(state)
            RecentHermesActivityCard(state)
            CapabilityCard(state)

            if (state.enabled && !state.connected) {
                DiagnosticsCard(state, model)
            }
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
private fun ConnectionCard(state: CompanionUiState, model: CompanionViewModel) {
    val title = when {
        state.connected -> "Hermes 已连接"
        state.enabled && state.tunnelState in setOf("connecting", "reconnecting", "enabled") -> "正在连接 Hermes"
        state.enabled -> "Hermes 暂时未连接"
        else -> "Hermes 尚未开始陪伴"
    }
    val subtitle = when {
        state.connected -> "手机桥接在线。Hermes 现在可以调用这台手机已经开放的能力。"
        state.enabled -> "陪伴已开启，连接会自动重试。"
        else -> "开始陪伴后，手机会建立安全桥接并等待 Hermes。"
    }

    Card(modifier = Modifier.fillMaxWidth()) {
        Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(title, style = MaterialTheme.typography.titleLarge)
            Text(subtitle, style = MaterialTheme.typography.bodyMedium)
            if (state.lastRelayConnectedAt > 0L) {
                Text("最近成功连接：${state.lastRelayConnectedAt.asDisplayTime()}", style = MaterialTheme.typography.bodySmall)
            }
            Button(
                onClick = { if (state.enabled) model.stop() else model.start() },
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text(if (state.enabled) "暂停陪伴" else "开始陪伴")
            }
        }
    }
}

@Composable
private fun PermissionCard(state: CompanionUiState) {
    val context = LocalContext.current
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("还差一点权限", style = MaterialTheme.typography.titleMedium)
            if (!state.usageAccessGranted) {
                Text("需要“使用情况访问”才能让 Hermes 看见当前 App 和今天的使用情况。")
                Button(
                    onClick = { context.startActivity(Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS)) },
                    modifier = Modifier.fillMaxWidth(),
                ) { Text("授予使用情况权限") }
            }
            if (!state.notificationEnabled) {
                Text("通知权限关闭时，Hermes 无法稳定地在手机上主动提醒你。")
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
private fun WhatHermesKnowsCard(state: CompanionUiState) {
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("这台手机现在能告诉 Hermes", style = MaterialTheme.typography.titleMedium)
            FactRow("电量", "${state.batteryPercent}%${if (state.charging) " · 正在充电" else ""}")
            FactRow("网络", if (state.online) "在线" else "离线")
            if (state.usageAccessGranted) {
                FactRow("当前 App", state.currentAppLabel.ifBlank { "暂未识别" })
                FactRow("本次使用", state.currentDurationMs.asDuration())
                FactRow("今天已记录", state.todayUsageMs.asDuration())
            } else {
                FactRow("App 使用情况", "等待授权")
            }
            Text(
                if (state.connected) "这些信息会在 Hermes 调用手机能力时实时返回。" else "连接成功后，Hermes 才能从远端读取这些信息。",
                style = MaterialTheme.typography.bodySmall,
            )
        }
    }
}

@Composable
private fun RecentHermesActivityCard(state: CompanionUiState) {
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("Hermes 最近在手机上做了什么", style = MaterialTheme.typography.titleMedium)
            if (state.lastMcpActivityAt == 0L) {
                Text("还没有收到 Hermes 的手机能力调用。真正发生读取后，这里会留下记录。")
            } else {
                Text("${state.lastMcpActivity.asActivityLabel()} · ${state.lastMcpActivityAt.asDisplayTime()}")
            }
            if (state.lastNotificationAt > 0L) {
                Text("最近通知：${state.lastNotificationTitle.ifBlank { "手机通知" }} · ${state.lastNotificationAt.asDisplayTime()}")
            }
        }
    }
}

@Composable
private fun CapabilityCard(state: CompanionUiState) {
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("当前能力", style = MaterialTheme.typography.titleMedium)
            CapabilityRow("读取设备状态", "可用")
            CapabilityRow("查看 App 使用情况", if (state.usageAccessGranted) "可用" else "需要授权")
            CapabilityRow("发送手机通知", if (state.notificationEnabled) "可用" else "需要授权")
            HorizontalDivider()
            CapabilityRow("位置感知", "还没有")
            CapabilityRow("日程感知", "还没有")
            CapabilityRow("打开 App / 链接等手机动作", "还没有")
            Text("“还没有”的能力不会假装已经实现，我们会在后续版本逐项加入。", style = MaterialTheme.typography.bodySmall)
        }
    }
}

@Composable
private fun DiagnosticsCard(state: CompanionUiState, model: CompanionViewModel) {
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("为什么还没连上", style = MaterialTheme.typography.titleMedium)
            FactRow("手机 MCP", if (state.localMcpRunning) "正常" else "未运行")
            FactRow("远端桥接", state.tunnelState.asTunnelLabel())
            if (state.error.isNotBlank()) Text("错误：${state.error}", style = MaterialTheme.typography.bodySmall)
            OutlinedButton(onClick = model::retryConnection, modifier = Modifier.fillMaxWidth()) { Text("立即重连") }
        }
    }
}

@Composable
private fun FactRow(label: String, value: String) {
    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
        Text(label, style = MaterialTheme.typography.bodyMedium)
        Text(value, style = MaterialTheme.typography.bodyMedium)
    }
}

@Composable
private fun CapabilityRow(label: String, value: String) = FactRow(label, value)

private fun String.asActivityLabel(): String = when (this) {
    "initialize" -> "建立了手机 MCP 会话"
    "notifications/initialized" -> "完成了手机 MCP 初始化"
    "tools/list" -> "查看了这台手机的可用能力"
    "get_local_health" -> "检查了手机桥接状态"
    "get_device_context" -> "读取了设备状态"
    "get_current_usage" -> "读取了 App 使用情况"
    "send_local_notification" -> "向手机发送了通知"
    else -> ifBlank { "访问了手机能力" }
}

private fun String.asTunnelLabel(): String = when (this) {
    "connected" -> "已连接"
    "connecting", "enabled" -> "正在连接"
    "reconnecting" -> "正在重连"
    "disabled" -> "已暂停"
    "stopped" -> "已停止"
    "start_failed" -> "启动失败"
    "configuration_error" -> "配置错误"
    "local_mcp_error" -> "手机 MCP 异常"
    else -> this.ifBlank { "未知" }
}

private fun Long.asDisplayTime(): String = if (this <= 0L) "暂无" else DateFormat.getDateTimeInstance(DateFormat.SHORT, DateFormat.MEDIUM).format(Date(this))

private fun Long.asDuration(): String {
    if (this <= 0L) return "0 分钟"
    val totalMinutes = this / 60_000L
    val hours = totalMinutes / 60L
    val minutes = totalMinutes % 60L
    return when {
        hours > 0L && minutes > 0L -> "${hours} 小时 ${minutes} 分钟"
        hours > 0L -> "${hours} 小时"
        else -> "${minutes.coerceAtLeast(1L)} 分钟"
    }
}
