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
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import com.hermes.companion.data.CompanionMode
import com.hermes.companion.data.SettingsRepository
import com.hermes.companion.data.UploadWorker
import com.hermes.companion.local.LocalMcpServer
import com.hermes.companion.platform.DeviceStatusReader
import com.hermes.companion.tunnel.ReverseTunnelService
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch

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
    val tunnelState: String = "disabled",
    val error: String = "",
    val usageAccessGranted: Boolean = false,
)

class CompanionViewModel(private val appContext: android.content.Context) : ViewModel() {
    private val settings = SettingsRepository(appContext)
    private val _state = MutableStateFlow(readState())
    val state: StateFlow<CompanionUiState> = _state

    init {
        settings.setMode(CompanionMode.LOCAL)
        UploadWorker.cancelCloudWork(appContext)
        refresh()
    }

    fun refresh() {
        viewModelScope.launch { _state.value = readState() }
    }

    fun start() {
        settings.setMode(CompanionMode.LOCAL)
        UploadWorker.cancelCloudWork(appContext)
        LocalMcpServer.start(appContext)
        if (!LocalMcpServer.isRunning()) {
            _state.value = readState().copy(error = settings.localMcpLastError().ifBlank { "Local MCP failed to start" })
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

    fun resumeTunnelIfEnabled() {
        if (!settings.tunnelEnabled()) return
        settings.setMode(CompanionMode.LOCAL)
        UploadWorker.cancelCloudWork(appContext)
        LocalMcpServer.start(appContext)
        // Always ensure the foreground service is running. Persisted tunnel state is diagnostics only.
        ReverseTunnelService.start(appContext)
    }

    private fun readState(): CompanionUiState {
        val enabled = settings.tunnelEnabled()
        val connected = enabled && ReverseTunnelService.isConnected() && LocalMcpServer.isRunning()
        val error = when {
            settings.tunnelLastError().isNotBlank() -> settings.tunnelLastError()
            settings.localMcpLastError().isNotBlank() -> settings.localMcpLastError()
            else -> ""
        }
        return CompanionUiState(
            enabled = enabled,
            connected = connected,
            tunnelState = settings.tunnelState(),
            error = error,
            usageAccessGranted = DeviceStatusReader.hasUsageAccess(appContext),
        )
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
            modifier = Modifier.fillMaxSize().padding(padding).padding(24.dp),
            verticalArrangement = Arrangement.spacedBy(20.dp),
        ) {
            Text("赫尔墨斯伴侣", style = MaterialTheme.typography.headlineMedium)
            Text(
                if (state.connected) "已连接" else "未连接",
                style = MaterialTheme.typography.titleLarge,
                color = if (state.connected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.error,
            )
            Button(
                onClick = { if (state.enabled) model.stop() else model.start() },
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text(if (state.enabled) "停止" else "启动")
            }
            if (!state.usageAccessGranted) {
                Button(
                    onClick = { context.startActivity(Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS)) },
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Text("授予使用情况权限")
                }
            }
            if (!state.connected && state.enabled && state.error.isNotBlank()) {
                Text(state.error, style = MaterialTheme.typography.bodySmall)
            }
        }
    }
    LaunchedEffect(Unit) {
        while (true) {
            delay(1_000)
            model.refresh()
        }
    }
}
