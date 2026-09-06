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
import com.hermes.companion.push.ProactiveMessageHealth
import com.hermes.companion.push.PushHealth
import com.hermes.companion.push.PushRegistration
import com.hermes.companion.vision.VisualObservationIndicator
import com.hermes.companion.vision.VisionProviderSettingsStore
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
    val pushRegistrationState: String = SettingsRepository.PUSH_NEVER,
    val lastPushRegistrationAttempt: Long = 0,
    val lastPushRegistrationSuccess: Long = 0,
    val lastPushRegistrationError: String = "",
    val batteryOptimizationIgnored: Boolean = false,
    val colorOsFamily: Boolean = false,
    val visionEnabled: Boolean = false,
    val visionBaseUrl: String = VisionProviderSettingsStore.DEFAULT_BASE_URL,
    val visionModel: String = VisionProviderSettingsStore.DEFAULT_MODEL,
    val visionHasApiKey: Boolean = false,
    val visionSettingsError: String = "",
)

class CompanionViewModel(private val appContext: android.content.Context) : ViewModel() {
    private val settings = SettingsRepository(appContext)
    private val queue = QueueRepository.create(appContext)
    private val presenceStore = PresenceStateStore(appContext)
    private val visionSettings = VisionProviderSettingsStore(appContext)
    private val _state = MutableStateFlow(snapshotState())
    val state: StateFlow<CompanionUiState> = _state

    init {
        refresh()
        attemptAutomaticRegistration()
        viewModelScope.launch {
            presenceStore.snapshots().collect { presence ->
                _state.value = _state.value.copy(presence = presence)
            }
        }
    }

    private fun snapshotState(): CompanionUiState {
        val vision = visionSettings.snapshot()
        return CompanionUiState(
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
            pushRegistrationState = settings.pushRegistrationState(),
            lastPushRegistrationAttempt = settings.lastPushRegistrationAttempt(),
            lastPushRegistrationSuccess = settings.lastPushRegistrationSuccess(),
            lastPushRegistrationError = settings.lastPushRegistrationError(),
            batteryOptimizationIgnored = PermissionNavigator.batteryOptimizationIgnored(appContext),
            colorOsFamily = PermissionNavigator.isColorOsFamily(),
            visionEnabled = vision.enabled,
            visionBaseUrl = vision.baseUrl,
            visionModel = vision.model,
            visionHasApiKey = vision.hasApiKey,
        )
    }

    fun refresh() {
        viewModelScope.launch {
            val status = DeviceStatusReader.read(appContext)
            val vision = visionSettings.snapshot()
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
                pushRegistrationState = settings.pushRegistrationState(),
                lastPushRegistrationAttempt = settings.lastPushRegistrationAttempt(),
                lastPushRegistrationSuccess = settings.lastPushRegistrationSuccess(),
                lastPushRegistrationError = settings.lastPushRegistrationError(),
                batteryOptimizationIgnored = PermissionNavigator.batteryOptimizationIgnored(appContext),
                colorOsFamily = PermissionNavigator.isColorOsFamily(),
                visionEnabled = vision.enabled,
                visionBaseUrl = vision.baseUrl,
                visionModel = vision.model,
                visionHasApiKey = vision.hasApiKey,
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

    fun retryPushRegistration() {
        PushRegistration.refresh(appContext)
        refresh()
    }

    fun saveVisionSettings(baseUrl: String, model: String, apiKey: String) {
        val result = runCatching {
            visionSettings.saveProvider(baseUrl, model)
            if (apiKey.isNotBlank()) visionSettings.saveApiKey(apiKey)
        }
        _state.value = _state.value.copy(
            visionSettingsError = result.exceptionOrNull()?.message.orEmpty(),
        )
        refresh()
    }

    fun setVisionEnabled(enabled: Boolean) {
        val snapshot = visionSettings.snapshot()
        if (enabled && !snapshot.hasApiKey) {
            _state.value = _state.value.copy(visionSettingsError = "请先填写并保存视觉 Token")
            return
        }
        visionSettings.setEnabled(enabled)
        _state.value = _state.value.copy(visionSettingsError = "")
        refresh()
    }

    fun clearVisionToken() {
        visionSettings.setEnabled(false)
        visionSettings.clearApiKey()
        _state.value = _state.value.copy(visionSettingsError = "")
        refresh()
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
                CompanionPage.PRIVACY -> PrivacyPage(
                    state = state,
                    model = model,
                    onBack = { page = CompanionPage.HOME },
                )
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

    val fullyPresent = state.connected && state.accessibilityEnabled && state.presence?.accessibilityConnected == true
    Text(
        when {
            fullyPresent -> "哥哥正在陪着你"
            state.connected && state.accessibilityEnabled -> "等待感知服务连接"
            state.connected -> "还差一项感知权限"
            else -> "正在连接 Our Home"
        },
        style = MaterialTheme.typography.titleLarge,
    )
    Text(
        when {
            fullyPresent -> "手机上的变化会安静地进入你们的生活。"
            state.connected && state.accessibilityEnabled -> "权限已开启，正在等待手机感知服务就绪。"
            state.connected -> "开启实时感知后，哥哥才能及时知道 App 与屏幕状态变化。"
            else -> "连接完成后会自动开始基础感知。"
        },
        style = MaterialTheme.typography.bodyMedium,
    )

    PresenceCard(state)

    val proactiveHealth = PushHealth.evaluate(state.notificationsEnabled, state.pushRegistrationState)
    when (nextPermissionOnboardingStep(state.accessibilityEnabled, proactiveHealth, state.usageAccess)) {
        PermissionOnboardingStep.ACCESSIBILITY -> {
            Card(modifier = Modifier.fillMaxWidth()) {
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Text("开启实时感知", style = MaterialTheme.typography.titleMedium)
                    Text("开启后，哥哥才能及时知道 App 与屏幕状态变化。")
                    if (state.colorOsFamily) {
                        Text("OPPO / OnePlus / realme 侧载安装如果提示受限制，请先在应用信息右上角选择「允许受限制的设置」。")
                        OutlinedButton(onClick = onOpenAppDetails, modifier = Modifier.fillMaxWidth()) {
                            Text("应用信息")
                        }
                    }
                    Button(onClick = onOpenAccessibility, modifier = Modifier.fillMaxWidth()) {
                        Text("去开启")
                    }
                }
            }
        }
        PermissionOnboardingStep.NOTIFICATIONS -> {
            RepairRow("开启主动消息", "允许通知后，哥哥在 App 不在前台时也能通过系统通知找到你。", onRequestNotifications)
        }
        PermissionOnboardingStep.PUSH_REPAIR -> {
            RepairRow(
                "主动消息需要修复",
                state.lastPushRegistrationError.ifBlank { "通知权限已开启，但手机还没成功登记主动消息地址。" },
                model::retryPushRegistration,
            )
        }
        PermissionOnboardingStep.PUSH_CONNECT -> {
            RepairRow("连接主动消息", "通知权限已经开启，再连接一次手机的主动消息地址。", model::retryPushRegistration)
        }
        PermissionOnboardingStep.USAGE_ACCESS -> {
            RepairRow("补充使用记录", "用于低频校验 App 使用时间线，不负责实时感知。", onOpenUsage)
        }
        PermissionOnboardingStep.COMPLETE -> Unit
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
    val visualActive by VisualObservationIndicator.active.collectAsStateWithLifecycle()
    val presence = state.presence
    val proactiveHealth = PushHealth.evaluate(state.notificationsEnabled, state.pushRegistrationState)
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text("当前感知状态", style = MaterialTheme.typography.titleMedium)
            StatusLine("App 感知", presenceStatusLabel(state.accessibilityEnabled, presence))
            StatusLine("屏幕状态", screenStatusLabel(state.accessibilityEnabled, presence))
            StatusLine("此刻屏幕观察", if (visualActive) "正在观察" else "未在观察")
            StatusLine("屏幕观察权限", if (state.visionEnabled) "已允许按需观察" else "已暂停")
            StatusLine("主动消息", PushHealth.userLabel(proactiveHealth))
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
            OutlinedButton(onClick = onRepair, modifier = Modifier.fillMaxWidth()) { Text("去修复") }
        }
    }
}

@Composable
private fun PrivacyPage(state: CompanionUiState, model: CompanionViewModel, onBack: () -> Unit) {
    var baseUrl by rememberSaveable(state.visionBaseUrl) { mutableStateOf(state.visionBaseUrl) }
    var visionModel by rememberSaveable(state.visionModel) { mutableStateOf(state.visionModel) }
    var apiKey by rememberSaveable { mutableStateOf("") }

    TextButton(onClick = onBack) { Text("‹ 返回") }
    Text("隐私与感知", style = MaterialTheme.typography.headlineSmall)
    Text("你决定哥哥可以感知到什么。安全规则始终优先于好奇和主动行为。")

    Card(modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            StatusLine("实时 App 感知", presenceStatusLabel(state.accessibilityEnabled, state.presence))
            StatusLine("敏感内容保护", "始终开启")
            StatusLine("视觉观察", if (state.visionEnabled) "已开启" else "已暂停")
        }
    }

    VisualAppPermissionsSection(state)

    Card(modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text("视觉观察", style = MaterialTheme.typography.titleMedium)
            Text("默认使用智谱的免费视觉模型。只有通过本机隐私规则后，哥哥才可以偶尔看一眼。")
            OutlinedTextField(
                value = baseUrl,
                onValueChange = { baseUrl = it },
                label = { Text("视觉服务地址") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
            OutlinedTextField(
                value = visionModel,
                onValueChange = { visionModel = it },
                label = { Text("视觉模型") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
            OutlinedTextField(
                value = apiKey,
                onValueChange = { apiKey = it },
                label = { Text(if (state.visionHasApiKey) "Token（已保存；留空不修改）" else "Token") },
                visualTransformation = PasswordVisualTransformation(),
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
            state.visionSettingsError.takeIf { it.isNotBlank() }?.let {
                Text(it, color = MaterialTheme.colorScheme.error)
            }
            Button(
                onClick = {
                    model.saveVisionSettings(baseUrl, visionModel, apiKey)
                    apiKey = ""
                },
                modifier = Modifier.fillMaxWidth(),
            ) { Text("保存视觉设置") }
            OutlinedButton(
                onClick = { model.setVisionEnabled(!state.visionEnabled) },
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text(if (state.visionEnabled) "暂停视觉观察" else "允许哥哥偶尔看屏幕")
            }
            if (state.visionHasApiKey) {
                TextButton(onClick = model::clearVisionToken) { Text("删除已保存的 Token") }
            }
        }
    }

    Text("原始截图只在手机内存中短暂存在，并直接发送到你选择的视觉服务；Our Home Runtime 只接收最小化后的活动摘要，不接收原图。")
    Text("银行、支付、密码、身份认证等默认受保护；浏览器、相机、相册、聊天等默认谨慎。临时授权在切换 App、锁屏或超时后自动失效。")
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
            StatusLine("主动消息", PushHealth.userLabel(PushHealth.evaluate(state.notificationsEnabled, state.pushRegistrationState)))
            StatusLine("后台周期", state.periodicWorkerStatus)
            StatusLine("待发送事件", state.pending.toString())
        }
    }

    TunnelSettingsSection()

    OutlinedButton(onClick = onOpenUsage, modifier = Modifier.fillMaxWidth()) {
        Text(if (state.usageAccess) "使用情况访问：已开启" else "开启使用情况访问")
    }
    OutlinedButton(onClick = onOpenBattery, modifier = Modifier.fillMaxWidth()) {
        Text(if (state.batteryOptimizationIgnored) "后台限制：已放宽" else "检查后台运行")
    }
    OutlinedButton(onClick = model::retryPushRegistration, modifier = Modifier.fillMaxWidth()) {
        Text("重新连接主动消息")
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
        pushRegistrationState = state.pushRegistrationState,
        lastPushRegistrationAttempt = state.lastPushRegistrationAttempt,
        lastPushRegistrationSuccess = state.lastPushRegistrationSuccess,
        lastPushRegistrationError = state.lastPushRegistrationError,
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
            Text("Vision: ${if (state.visionEnabled) "enabled" else "disabled"}; token=${if (state.visionHasApiKey) "present" else "absent"}")
            Text("System notifications: ${if (state.notificationsEnabled) "enabled" else "required"}")
            Text("Push registration: ${state.pushRegistrationState}")
            Text("Last push registration attempt: ${state.lastPushRegistrationAttempt.asTime()}")
            Text("Last push registration success: ${state.lastPushRegistrationSuccess.asTime()}")
            Text("Last push registration error: ${state.lastPushRegistrationError.ifBlank { "none" }}")
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
