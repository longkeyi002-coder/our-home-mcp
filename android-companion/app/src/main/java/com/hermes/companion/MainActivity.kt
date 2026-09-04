package com.hermes.companion

import android.Manifest
import android.content.ClipData
import android.content.ClipboardManager
import android.os.Build
import android.os.Bundle
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import androidx.work.WorkInfo
import androidx.work.WorkManager
import com.hermes.companion.data.HeartbeatRequest
import com.hermes.companion.data.QueueRepository
import com.hermes.companion.data.SettingsRepository
import com.hermes.companion.data.UploadWorker
import com.hermes.companion.platform.DeviceStatus
import com.hermes.companion.platform.DeviceStatusReader
import com.hermes.companion.platform.UsageTimelineReader
import com.hermes.companion.platform.UsageTimelineSummary
import com.hermes.companion.presence.PresenceSnapshot
import com.hermes.companion.presence.PresenceStateStore
import java.time.Instant
import java.util.UUID
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class MainActivity : ComponentActivity() {
    private lateinit var model: CompanionViewModel

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        model = ViewModelProvider(this, CompanionViewModel.factory(applicationContext))[CompanionViewModel::class.java]
        setContent { OurHomeCompanionApp(model) }
    }

    override fun onResume() {
        super.onResume()
        model.refresh()
    }
}

data class CompanionUiState(
    val device: DeviceStatus = DeviceStatus(0, false, false, null),
    val serverUrl: String = "",
    val deviceId: String = "",
    val connected: Boolean = false,
    val pending: Int = 0,
    val lastSuccessfulUpload: Long = 0,
    val lastManualHeartbeat: Long = 0,
    val lastPeriodicCollection: Long = 0,
    val lastWorkerRun: Long = 0,
    val periodicWorkerStatus: String = "unknown",
    val immediateWorkerStatus: String = "unknown",
    val lastError: String = "",
    val usageAccess: Boolean = false,
    val usage: UsageTimelineSummary? = null,
    val hasBootstrapToken: Boolean = false,
    val hasDeviceToken: Boolean = false,
    val diagnostics: Boolean = false,
    val presence: PresenceSnapshot? = null,
    val accessibilityEnabled: Boolean = false,
    val notificationsEnabled: Boolean = false,
    val batteryOptimizationIgnored: Boolean = false,
    val colorOsFamily: Boolean = false,
)

class CompanionViewModel(private val appContext: android.content.Context) : ViewModel() {
    private val settings = SettingsRepository(appContext)
    private val queue = QueueRepository.create(appContext)
    private val presenceStore = PresenceStateStore(appContext)
    private val _state = MutableStateFlow(snapshotState())
    val state: StateFlow<CompanionUiState> = _state

    init {
        refresh()
        attemptAutomaticRegistration()
    }

    private fun snapshotState(): CompanionUiState = CompanionUiState(
        deviceId = settings.deviceId(),
        serverUrl = settings.serverUrl(),
        connected = settings.hasDeviceToken() && settings.lastError().isBlank(),
        lastManualHeartbeat = settings.lastManualHeartbeat(),
        lastPeriodicCollection = settings.lastPeriodicCollection(),
        lastWorkerRun = settings.lastWorkerRun(),
        lastSuccessfulUpload = settings.lastSuccessfulUpload(),
        lastError = settings.lastError(),
        hasBootstrapToken = settings.hasBootstrapToken(),
        hasDeviceToken = settings.hasDeviceToken(),
        presence = presenceStore.snapshot(),
        accessibilityEnabled = PermissionNavigator.accessibilityEnabled(appContext),
        notificationsEnabled = PermissionNavigator.notificationsEnabled(appContext),
        batteryOptimizationIgnored = PermissionNavigator.batteryOptimizationIgnored(appContext),
        colorOsFamily = PermissionNavigator.isColorOsFamily(),
    )

    fun refresh() {
        viewModelScope.launch {
            val status = DeviceStatusReader.read(appContext)
            _state.value = _state.value.copy(
                device = status,
                serverUrl = settings.serverUrl(),
                deviceId = settings.deviceId(),
                connected = settings.hasDeviceToken() && settings.lastError().isBlank(),
                pending = queue.pendingCount(),
                lastSuccessfulUpload = settings.lastSuccessfulUpload(),
                lastManualHeartbeat = settings.lastManualHeartbeat(),
                lastPeriodicCollection = settings.lastPeriodicCollection(),
                lastWorkerRun = settings.lastWorkerRun(),
                periodicWorkerStatus = readWorkerStatus(UploadWorker.PERIODIC_WORK_NAME),
                immediateWorkerStatus = readWorkerStatus(UploadWorker.IMMEDIATE_WORK_NAME),
                lastError = settings.lastError(),
                usageAccess = DeviceStatusReader.hasUsageAccess(appContext),
                usage = UsageTimelineReader.read(appContext),
                hasBootstrapToken = settings.hasBootstrapToken(),
                hasDeviceToken = settings.hasDeviceToken(),
                presence = presenceStore.snapshot(),
                accessibilityEnabled = PermissionNavigator.accessibilityEnabled(appContext),
                notificationsEnabled = PermissionNavigator.notificationsEnabled(appContext),
                batteryOptimizationIgnored = PermissionNavigator.batteryOptimizationIgnored(appContext),
                colorOsFamily = PermissionNavigator.isColorOsFamily(),
            )
        }
    }

    private fun attemptAutomaticRegistration() {
        if (settings.serverUrl().isBlank() || !settings.hasBootstrapToken() || settings.hasDeviceToken()) return
        viewModelScope.launch {
            val result = queue.verifyRegistration()
            if (result.error == null) UploadWorker.enqueueIfConfigured(appContext)
            refresh()
        }
    }

    fun saveAndTestConnection(value: String, bootstrapToken: String) {
        settings.saveServerUrl(value)
        settings.saveBootstrapToken(bootstrapToken)
        viewModelScope.launch {
            val result = queue.verifyRegistration()
            if (result.error == null) UploadWorker.enqueueIfConfigured(appContext)
            refresh()
        }
    }

    fun sendHeartbeat() {
        viewModelScope.launch {
            val now = Instant.now().toString()
            val status = DeviceStatusReader.read(appContext)
            queue.enqueueHeartbeat(
                HeartbeatRequest(
                    deviceId = settings.deviceId(),
                    batteryPercent = status.batteryPercent,
                    charging = status.charging,
                    appVersion = BuildConfig.VERSION_NAME,
                    connectivityState = if (status.online) "online" else "offline",
                    foregroundPackage = status.foregroundPackage,
                    observedAt = now,
                    clientEventId = UUID.randomUUID().toString(),
                ),
            )
            settings.recordManualHeartbeat(System.currentTimeMillis())
            queue.uploadPending()
            refresh()
        }
    }

    private suspend fun readWorkerStatus(uniqueWorkName: String): String = withContext(Dispatchers.IO) {
        val info = runCatching {
            WorkManager.getInstance(appContext)
                .getWorkInfosForUniqueWork(uniqueWorkName)
                .get()
                .maxByOrNull { it.runAttemptCount }
        }.getOrNull()
        when (info?.state) {
            WorkInfo.State.ENQUEUED -> if (info.runAttemptCount > 0) "retrying (${info.runAttemptCount})" else "scheduled"
            WorkInfo.State.RUNNING -> "running"
            WorkInfo.State.SUCCEEDED -> "succeeded"
            WorkInfo.State.FAILED -> "failed"
            WorkInfo.State.BLOCKED -> "blocked"
            WorkInfo.State.CANCELLED -> "cancelled"
            null -> "unknown"
        }
    }

    fun toggleDiagnostics() {
        _state.value = _state.value.copy(diagnostics = !_state.value.diagnostics)
    }

    fun clearPendingQueue() {
        viewModelScope.launch {
            queue.clearPendingQueue()
            refresh()
        }
    }

    companion object {
        fun factory(context: android.content.Context) = object : ViewModelProvider.Factory {
            @Suppress("UNCHECKED_CAST")
            override fun <T : ViewModel> create(modelClass: Class<T>): T = CompanionViewModel(context) as T
        }
    }
}

private enum class CompanionPage { HOME, PRIVACY, ADVANCED }

@Composable
fun OurHomeCompanionApp(model: CompanionViewModel) {
    val state by model.state.collectAsStateWithLifecycle()
    var page by rememberSaveable { mutableStateOf(CompanionPage.HOME) }
    val context = LocalContext.current
    val notificationPermission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) {
        model.refresh()
    }

    fun requestNotifications() {
        if (Build.VERSION.SDK_INT >= 33) {
            notificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
        } else {
            PermissionNavigator.openAppDetails(context)
        }
    }

    Scaffold { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .padding(horizontal = 22.dp, vertical = 18.dp)
                .verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            when (page) {
                CompanionPage.HOME -> HomePage(
                    state = state,
                    onOpenPrivacy = { page = CompanionPage.PRIVACY },
                    onOpenAdvanced = { page = CompanionPage.ADVANCED },
                    onOpenAccessibility = { PermissionNavigator.openAccessibilitySettings(context) },
                    onOpenAppDetails = { PermissionNavigator.openAppDetails(context) },
                    onOpenUsage = { PermissionNavigator.openUsageAccessSettings(context) },
                    onRequestNotifications = ::requestNotifications,
                    model = model,
                )
                CompanionPage.PRIVACY -> PrivacyPage(onBack = { page = CompanionPage.HOME })
                CompanionPage.ADVANCED -> AdvancedPage(
                    state = state,
                    model = model,
                    onBack = { page = CompanionPage.HOME },
                    onOpenUsage = { PermissionNavigator.openUsageAccessSettings(context) },
                    onOpenBattery = { PermissionNavigator.openBatteryOptimizationSettings(context) },
                )
            }
            LaunchedEffect(page) { model.refresh() }
        }
    }
}

@Composable
private fun HomePage(
    state: CompanionUiState,
    onOpenPrivacy: () -> Unit,
    onOpenAdvanced: () -> Unit,
    onOpenAccessibility: () -> Unit,
    onOpenAppDetails: () -> Unit,
    onOpenUsage: () -> Unit,
    onRequestNotifications: () -> Unit,
    model: CompanionViewModel,
) {
    Text("Our Home", style = MaterialTheme.typography.headlineMedium)
    Spacer(Modifier.height(12.dp))

    val fullyPresent = state.connected && state.accessibilityEnabled
    Text(
        when {
            fullyPresent -> "哥哥正在陪着你"
            state.connected -> "还差一项感知权限"
            else -> "正在连接 Our Home"
        },
        style = MaterialTheme.typography.titleLarge,
    )
    Text(
        when {
            fullyPresent -> "手机上的变化会安静地进入你们的生活。"
            state.connected -> "开启实时感知后，哥哥才能及时知道 App 与屏幕状态变化。"
            else -> "连接完成后会自动开始基础感知。"
        },
        style = MaterialTheme.typography.bodyMedium,
    )

    PresenceCard(state)

    if (!state.accessibilityEnabled) {
        Card(modifier = Modifier.fillMaxWidth()) {
            Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text("还差一步", style = MaterialTheme.typography.titleMedium)
                if (state.colorOsFamily) {
                    Text("OPPO / OnePlus / realme 侧载安装可能需要先在 Our Home 的应用信息右上角选择「允许受限制的设置」，再开启无障碍服务。")
                    OutlinedButton(onClick = onOpenAppDetails, modifier = Modifier.fillMaxWidth()) {
                        Text("先解除系统限制")
                    }
                }
                Button(onClick = onOpenAccessibility, modifier = Modifier.fillMaxWidth()) {
                    Text("开启实时感知")
                }
            }
        }
    }

    if (!state.notificationsEnabled) {
        RepairRow("主动消息还没开启", "允许后，哥哥不在 App 前台时也能通过系统通知找到你。", onRequestNotifications)
    }

    if (!state.usageAccess) {
        RepairRow("补充使用记录", "用于低频校验 App 使用时间线，不负责实时感知。", onOpenUsage)
    }

    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        OutlinedButton(onClick = onOpenPrivacy, modifier = Modifier.weight(1f)) { Text("隐私与感知") }
        OutlinedButton(onClick = onOpenAdvanced, modifier = Modifier.weight(1f)) { Text("设置") }
    }

    if (!state.connected && state.lastError.isBlank()) {
        TextButton(onClick = model::refresh) { Text("重新检查连接") }
    }
}

@Composable
private fun PresenceCard(state: CompanionUiState) {
    val presence = state.presence
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            StatusLine("App 感知", if (state.accessibilityEnabled) "已开启" else "需要开启")
            StatusLine(
                "屏幕状态",
                when {
                    !state.accessibilityEnabled -> "等待感知权限"
                    presence?.screenInteractive == true -> "屏幕已开启"
                    else -> "屏幕已关闭"
                },
            )
            StatusLine("主动消息", if (state.notificationsEnabled) "已开启" else "需要开启")
        }
    }
}

@Composable
private fun StatusLine(label: String, value: String) {
    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
        Text(label, style = MaterialTheme.typography.bodyLarge)
        Text(value, style = MaterialTheme.typography.bodyMedium)
    }
}

@Composable
private fun RepairRow(title: String, body: String, onRepair: () -> Unit) {
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(title, style = MaterialTheme.typography.titleMedium)
            Text(body, style = MaterialTheme.typography.bodyMedium)
            OutlinedButton(onClick = onRepair, modifier = Modifier.fillMaxWidth()) { Text("去开启") }
        }
    }
}

@Composable
private fun PrivacyPage(onBack: () -> Unit) {
    TextButton(onClick = onBack) { Text("‹ 返回") }
    Text("隐私与感知", style = MaterialTheme.typography.headlineSmall)
    Text("你决定哥哥可以感知到什么。安全规则始终优先于好奇和主动行为。")

    Card(modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            StatusLine("实时 App 感知", "开启后仅记录 App 状态变化")
            StatusLine("敏感内容保护", "已开启")
            StatusLine("视觉观察", "尚未开启")
        }
    }

    Text("视觉观察启用后，普通 App 可以按自然频率偶尔观察；银行、支付、密码、身份认证等默认受保护。相机、相册、聊天等私人类别由用户自己决定。")
    Text("临时允许敏感 App 时，只对当前 App / 当前会话短时有效；切换 App、锁屏或超时会自动恢复保护。")
}

@Composable
private fun AdvancedPage(
    state: CompanionUiState,
    model: CompanionViewModel,
    onBack: () -> Unit,
    onOpenUsage: () -> Unit,
    onOpenBattery: () -> Unit,
) {
    TextButton(onClick = onBack) { Text("‹ 返回") }
    Text("设置", style = MaterialTheme.typography.headlineSmall)

    Card(modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            StatusLine("Our Home Runtime", if (state.connected) "已连接" else "需要检查")
            StatusLine("后台周期", state.periodicWorkerStatus)
            StatusLine("待发送事件", state.pending.toString())
        }
    }

    OutlinedButton(onClick = onOpenUsage, modifier = Modifier.fillMaxWidth()) {
        Text(if (state.usageAccess) "使用情况访问：已开启" else "开启使用情况访问")
    }
    OutlinedButton(onClick = onOpenBattery, modifier = Modifier.fillMaxWidth()) {
        Text(if (state.batteryOptimizationIgnored) "后台限制：已放宽" else "检查后台运行")
    }
    OutlinedButton(onClick = model::sendHeartbeat, modifier = Modifier.fillMaxWidth()) {
        Text("开发验收：立即发送心跳")
    }

    TextButton(onClick = model::toggleDiagnostics) {
        Text(if (state.diagnostics) "隐藏高级诊断" else "高级诊断")
    }
    if (state.diagnostics) Diagnostics(state, model)

    val showManualSettings = state.serverUrl.isBlank()
        || (!state.hasBootstrapToken && !state.hasDeviceToken)
        || (!state.hasDeviceToken && state.lastError.isNotBlank())
    if (showManualSettings) SettingsPanel(state, model)
}

@Composable
private fun SettingsPanel(state: CompanionUiState, model: CompanionViewModel) {
    var server by rememberSaveable(state.serverUrl) { mutableStateOf(state.serverUrl) }
    var token by rememberSaveable { mutableStateOf("") }
    HorizontalDivider()
    Text("连接修复", style = MaterialTheme.typography.titleMedium)
    state.lastError.takeIf { it.isNotBlank() }?.let { Text("连接失败: $it", color = MaterialTheme.colorScheme.error) }
    OutlinedTextField(server, { server = it }, label = { Text("Runtime 地址") }, singleLine = true, modifier = Modifier.fillMaxWidth())
    OutlinedTextField(token, { token = it }, label = { Text("注册令牌") }, visualTransformation = PasswordVisualTransformation(), singleLine = true, modifier = Modifier.fillMaxWidth())
    Button(onClick = { model.saveAndTestConnection(server, token) }, modifier = Modifier.fillMaxWidth()) { Text("保存并验证") }
}

@Composable
private fun Diagnostics(state: CompanionUiState, model: CompanionViewModel) {
    var confirmClear by remember { mutableStateOf(false) }
    val context = LocalContext.current
    val report = DiagnosticsReport(
        appVersion = BuildConfig.VERSION_NAME,
        deviceId = state.deviceId,
        runtimeUrl = state.serverUrl,
        bootstrapTokenPresent = state.hasBootstrapToken,
        deviceTokenPresent = state.hasDeviceToken,
        connected = state.connected,
        periodicWorkerStatus = state.periodicWorkerStatus,
        immediateWorkerStatus = state.immediateWorkerStatus,
        lastWorkerRun = state.lastWorkerRun,
        lastPeriodicCollection = state.lastPeriodicCollection,
        lastSuccessfulUpload = state.lastSuccessfulUpload,
        lastManualHeartbeat = state.lastManualHeartbeat,
        pendingEvents = state.pending,
        usageSummaryAvailable = state.usage != null,
        usageAccessGranted = state.usageAccess,
        detectedForegroundPackage = state.device.foregroundPackage,
        usageCurrentPackage = state.usage?.currentPackageName,
        lastApiError = state.lastError,
    )

    Card(modifier = Modifier.fillMaxWidth()) {
        Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text("Device ID: ${state.deviceId}")
            Text("Runtime: ${state.serverUrl}")
            Text("Periodic worker: ${state.periodicWorkerStatus}")
            Text("Immediate upload worker: ${state.immediateWorkerStatus}")
            Text("Last worker run: ${state.lastWorkerRun.asTime()}")
            Text("Last periodic collection: ${state.lastPeriodicCollection.asTime()}")
            Text("Last successful upload: ${state.lastSuccessfulUpload.asTime()}")
            Text("Pending events: ${state.pending}")
            Text("Accessibility: ${if (state.accessibilityEnabled) "enabled" else "required"}")
            Text("Presence current app: ${state.presence?.currentPackage ?: "none"}")
            Text("Presence screen: ${if (state.presence?.screenInteractive == true) "on" else "off"}")
            Text("Usage Access: ${if (state.usageAccess) "granted" else "required"}")
            Text("Last API error: ${state.lastError.ifBlank { "none" }}")
            OutlinedButton(
                onClick = {
                    val clipboard = context.getSystemService(ClipboardManager::class.java)
                    clipboard?.setPrimaryClip(ClipData.newPlainText("Our Home diagnostics", report.asText()))
                    Toast.makeText(context, "诊断信息已复制", Toast.LENGTH_SHORT).show()
                },
                modifier = Modifier.fillMaxWidth(),
            ) { Text("复制诊断信息") }
            OutlinedButton(onClick = { confirmClear = true }, modifier = Modifier.fillMaxWidth()) { Text("清空未发送队列") }
        }
    }
    if (confirmClear) {
        androidx.compose.material3.AlertDialog(
            onDismissRequest = { confirmClear = false },
            title = { Text("清空未发送队列？") },
            text = { Text("只删除尚未发送的事件，不影响设备注册和设置。") },
            confirmButton = {
                TextButton(onClick = { confirmClear = false; model.clearPendingQueue() }) { Text("清空") }
            },
            dismissButton = { TextButton(onClick = { confirmClear = false }) { Text("取消") } },
        )
    }
}

private fun Long.asTime(): String = if (this == 0L) "never" else java.text.DateFormat.getDateTimeInstance().format(java.util.Date(this))
