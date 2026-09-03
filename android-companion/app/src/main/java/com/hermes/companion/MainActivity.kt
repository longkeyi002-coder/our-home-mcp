package com.hermes.companion

import android.content.Intent
import android.os.Bundle
import android.os.Build
import android.Manifest
import android.content.pm.PackageManager
import android.provider.Settings
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
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
import com.hermes.companion.data.ObservationRequest
import com.hermes.companion.data.QueueRepository
import com.hermes.companion.data.SettingsRepository
import com.hermes.companion.data.UploadWorker
import com.hermes.companion.platform.DeviceStatus
import com.hermes.companion.platform.DeviceStatusReader
import com.hermes.companion.platform.UsageTimelineReader
import com.hermes.companion.platform.UsageTimelineSummary
import java.time.Instant
import java.util.UUID
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), NOTIFICATION_PERMISSION_REQUEST)
        }
        val model = ViewModelProvider(this, CompanionViewModel.factory(applicationContext))[CompanionViewModel::class.java]
        setContent { HermesCompanionApp(model) }
    }

    companion object { private const val NOTIFICATION_PERMISSION_REQUEST = 1001 }
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
    val backgroundWorkerStatus: String = "unknown",
    val lastError: String = "",
    val usageAccess: Boolean = false,
    val usage: UsageTimelineSummary? = null,
    val diagnostics: Boolean = false,
)

class CompanionViewModel(private val appContext: android.content.Context) : ViewModel() {
    private val settings = SettingsRepository(appContext)
    private val queue = QueueRepository.create(appContext)
    private val _state = MutableStateFlow(
        CompanionUiState(
            deviceId = settings.deviceId(),
            serverUrl = settings.serverUrl(),
            lastManualHeartbeat = settings.lastManualHeartbeat(),
            lastPeriodicCollection = settings.lastPeriodicCollection(),
            lastSuccessfulUpload = settings.lastSuccessfulUpload(),
        ),
    )
    val state: StateFlow<CompanionUiState> = _state

    init {
        refresh()
    }

    fun refresh() {
        viewModelScope.launch {
            val status = DeviceStatusReader.read(appContext)
            _state.value = _state.value.copy(
                device = status,
                serverUrl = settings.serverUrl(),
                deviceId = settings.deviceId(),
                pending = queue.pendingCount(),
                lastSuccessfulUpload = settings.lastSuccessfulUpload(),
                lastManualHeartbeat = settings.lastManualHeartbeat(),
                lastPeriodicCollection = settings.lastPeriodicCollection(),
                backgroundWorkerStatus = readBackgroundWorkerStatus(),
                lastError = settings.lastError(),
                usageAccess = DeviceStatusReader.hasUsageAccess(appContext),
                usage = UsageTimelineReader.read(appContext),
            )
        }
    }

    fun saveServer(value: String, bootstrapToken: String) {
        settings.saveServerUrl(value)
        settings.saveBootstrapToken(bootstrapToken)
        refresh()
    }

    fun saveAndTestConnection(value: String, bootstrapToken: String) {
        settings.saveServerUrl(value)
        settings.saveBootstrapToken(bootstrapToken)
        viewModelScope.launch {
            val result = runCatching { com.hermes.companion.data.ApiClient.create(value).health() }
            _state.value = _state.value.copy(
                connected = result.getOrNull()?.ok == true,
                lastError = result.exceptionOrNull()?.message.orEmpty(),
            )
            refresh()
        }
    }

    fun sendHeartbeat() {
        viewModelScope.launch {
            val now = Instant.now().toString()
            val status = DeviceStatusReader.read(appContext)
            queue.enqueueHeartbeat(HeartbeatRequest(
                deviceId = settings.deviceId(),
                batteryPercent = status.batteryPercent,
                charging = status.charging,
                appVersion = BuildConfig.VERSION_NAME,
                connectivityState = if (status.online) "online" else "offline",
                foregroundPackage = status.foregroundPackage,
                observedAt = now,
                clientEventId = UUID.randomUUID().toString(),
            ))
            settings.recordManualHeartbeat(System.currentTimeMillis())
            val result = queue.uploadPending()
            _state.value = _state.value.copy(lastManualHeartbeat = System.currentTimeMillis(), connected = result.error == null, lastError = result.error.orEmpty())
            refresh()
        }
    }

    fun sendManualStatus(label: String) {
        viewModelScope.launch {
            queue.enqueueObservation(ObservationRequest(
                kind = "manual_status",
                label = label,
                value = label,
                observedAt = Instant.now().toString(),
                deviceId = settings.deviceId(),
            ))
            val result = queue.uploadPending()
            _state.value = _state.value.copy(connected = result.error == null, lastError = result.error.orEmpty())
            refresh()
        }
    }

    private suspend fun readBackgroundWorkerStatus(): String = withContext(Dispatchers.IO) {
        val state = runCatching {
            WorkManager.getInstance(appContext)
                .getWorkInfosForUniqueWork(UploadWorker.PERIODIC_WORK_NAME)
                .get()
                .firstOrNull()
                ?.state
        }.getOrNull()
        when (state) {
            WorkInfo.State.ENQUEUED -> "scheduled"
            WorkInfo.State.RUNNING -> "running"
            WorkInfo.State.SUCCEEDED -> "succeeded"
            WorkInfo.State.FAILED -> "failed"
            else -> "unknown"
        }
    }

    fun toggleDiagnostics() { _state.value = _state.value.copy(diagnostics = !_state.value.diagnostics) }

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

@Composable
fun HermesCompanionApp(model: CompanionViewModel) {
    val state by model.state.collectAsStateWithLifecycle()
    val context = LocalContext.current
    Scaffold { padding ->
        Column(
            modifier = Modifier.fillMaxSize().padding(padding).padding(20.dp).verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text("赫尔墨斯伴侣", style = MaterialTheme.typography.headlineMedium)
            Text(if (state.connected) "连接状态: 已连接" else "连接状态: 离线", color = if (state.connected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.error)
            InfoCard(state)
            Text("手动状态", style = MaterialTheme.typography.titleMedium)
            val statuses = listOf("在家", "上班", "通勤", "忙", "休息", "睡觉", "累")
            LazyVerticalGrid(columns = GridCells.Fixed(2), modifier = Modifier.height(180.dp), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                items(statuses) { label -> Button(onClick = { model.sendManualStatus(label) }, modifier = Modifier.fillMaxWidth()) { Text(label) } }
            }
            var showCustom by rememberSaveable { mutableStateOf(false) }
            OutlinedButton(onClick = { showCustom = true }, modifier = Modifier.fillMaxWidth()) { Text("自定义状态") }
            if (showCustom) CustomStatusDialog(onDismiss = { showCustom = false }, onSend = { showCustom = false; model.sendManualStatus(it) })
            Button(onClick = model::sendHeartbeat, modifier = Modifier.fillMaxWidth()) { Text("立即发送心跳") }
            OutlinedButton(onClick = { context.startActivity(Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS)) }, modifier = Modifier.fillMaxWidth()) {
                Text(if (state.usageAccess) "使用权限: 已授予" else "使用权限: 打开设置")
            }
            TextButton(onClick = model::toggleDiagnostics) { Text(if (state.diagnostics) "隐藏诊断信息" else "调试 / 诊断") }
            if (state.diagnostics) Diagnostics(state, model)
            SettingsPanel(state, model)
            LaunchedEffect(Unit) { model.refresh() }
        }
    }
}

@Composable
private fun InfoCard(state: CompanionUiState) {
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text("Server: ${state.serverUrl.ifBlank { "Not configured" }}")
            Text("Battery: ${state.device.batteryPercent}%${if (state.device.charging) " · charging" else ""}")
            Text("Foreground App: ${state.device.foregroundPackage ?: if (state.usageAccess) "not detected" else "需要权限"}")
            state.usage?.let { usage ->
                Text("Current App: ${usage.currentPackageName ?: "none"} · ${usage.currentDurationMs / 1000}s")
            }
            Text("Today's tracked apps: ${state.usage?.appTotalsMs?.size ?: 0}")
            Text("Last manual heartbeat: ${state.lastManualHeartbeat.asTime()}")
            Text("Pending events: ${state.pending}")
        }
    }
}

@Composable
private fun SettingsPanel(state: CompanionUiState, model: CompanionViewModel) {
    var server by rememberSaveable(state.serverUrl) { mutableStateOf(state.serverUrl) }
    var token by rememberSaveable { mutableStateOf("") }
    HorizontalDivider()
    Text("设置", style = MaterialTheme.typography.titleMedium)
    OutlinedTextField(server, { server = it }, label = { Text("服务器地址 (HTTP)") }, singleLine = true, modifier = Modifier.fillMaxWidth())
    OutlinedTextField(token, { token = it }, label = { Text("注册令牌") }, visualTransformation = PasswordVisualTransformation(), singleLine = true, modifier = Modifier.fillMaxWidth())
    Text("Device: ${state.deviceId}")
    Button(onClick = { model.saveAndTestConnection(server, token) }, modifier = Modifier.fillMaxWidth()) { Text("保存并测试连接") }
}

@Composable
private fun Diagnostics(state: CompanionUiState, model: CompanionViewModel) {
    var confirmClear by remember { mutableStateOf(false) }
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text("Device ID: ${state.deviceId}")
            Text("Background worker: ${state.backgroundWorkerStatus}")
            Text("Last periodic collection: ${state.lastPeriodicCollection.asTime()}")
            Text("Last successful upload: ${state.lastSuccessfulUpload.asTime()}")
            Text("Last manual heartbeat: ${state.lastManualHeartbeat.asTime()}")
            Text("Pending events: ${state.pending}")
            Text("Usage summary available: ${if (state.usage != null) "yes" else "no"}")
            Text("Usage Access: ${if (state.usageAccess) "granted" else "required"}")
            Text("Last API error: ${state.lastError.ifBlank { "none" }}")
            Text("Detected foreground package: ${state.device.foregroundPackage ?: "none"}")
            OutlinedButton(onClick = { confirmClear = true }, modifier = Modifier.fillMaxWidth()) { Text("Clear pending queue") }
        }
    }
    if (confirmClear) {
        androidx.compose.material3.AlertDialog(
            onDismissRequest = { confirmClear = false },
            title = { Text("Clear pending queue?") },
            text = { Text("Only unsent events will be removed. Device registration and settings stay unchanged.") },
            confirmButton = {
                TextButton(onClick = { confirmClear = false; model.clearPendingQueue() }) { Text("Clear") }
            },
            dismissButton = { TextButton(onClick = { confirmClear = false }) { Text("Cancel") } },
        )
    }
}

@Composable
private fun CustomStatusDialog(onDismiss: () -> Unit, onSend: (String) -> Unit) {
    var value by remember { mutableStateOf("") }
    androidx.compose.material3.AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("自定义状态") },
        text = { OutlinedTextField(value, { value = it }, label = { Text("状态") }, singleLine = true) },
        confirmButton = { TextButton(onClick = { if (value.isNotBlank()) onSend(value.trim()) }) { Text("发送") } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("取消") } },
    )
}

private fun Long.asTime(): String = if (this == 0L) "never" else java.text.DateFormat.getDateTimeInstance().format(java.util.Date(this))
