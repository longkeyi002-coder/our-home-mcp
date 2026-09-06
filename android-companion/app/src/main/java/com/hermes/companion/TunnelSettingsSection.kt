package com.hermes.companion

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
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
import com.hermes.companion.tunnel.ReverseTunnelController
import com.hermes.companion.tunnel.TunnelSettingsStore
import kotlinx.coroutines.delay

private data class TunnelUiSnapshot(
    val enabled: Boolean,
    val relayUrl: String,
    val hasToken: Boolean,
    val state: String,
    val lastConnectedAt: Long,
    val lastErrorCode: String,
    val lastMcpRequestAt: Long,
    val lastServedTool: String,
)

@Composable
internal fun TunnelSettingsSection() {
    val context = LocalContext.current
    val store = remember(context) { TunnelSettingsStore(context) }
    var snapshot by remember { mutableStateOf(store.uiSnapshot()) }
    var relayUrl by rememberSaveable(snapshot.relayUrl) { mutableStateOf(snapshot.relayUrl) }
    var token by rememberSaveable { mutableStateOf("") }
    var error by rememberSaveable { mutableStateOf("") }

    LaunchedEffect(Unit) {
        while (true) {
            snapshot = store.uiSnapshot()
            delay(1_000)
        }
    }

    Card(modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text("远程只读连接", style = MaterialTheme.typography.titleMedium)
            Text("允许哥哥通过你主动开启的加密 WSS 通道读取经过本机隐私过滤后的设备状态。这个开关不会影响普通上传、主动消息或后台采集。")
            TunnelStatusLine("状态", tunnelStateLabel(snapshot.state))
            TunnelStatusLine("远程读取", if (snapshot.enabled) "已开启" else "已关闭")
            TunnelStatusLine("Tunnel Token", if (snapshot.hasToken) "已保存" else "未保存")
            if (snapshot.lastConnectedAt > 0L) {
                TunnelStatusLine("最近连接", snapshot.lastConnectedAt.asTunnelTime())
            }
            if (snapshot.lastMcpRequestAt > 0L) {
                TunnelStatusLine("最近远程读取", snapshot.lastMcpRequestAt.asTunnelTime())
                snapshot.lastServedTool.takeIf { it.isNotBlank() }?.let {
                    TunnelStatusLine("最近读取工具", it)
                }
            }
            snapshot.lastErrorCode.takeIf { it.isNotBlank() }?.let {
                Text("连接错误: $it", color = MaterialTheme.colorScheme.error)
            }
            error.takeIf { it.isNotBlank() }?.let {
                Text(it, color = MaterialTheme.colorScheme.error)
            }

            OutlinedTextField(
                value = relayUrl,
                onValueChange = { relayUrl = it },
                label = { Text("WSS Relay 地址") },
                placeholder = { Text("wss://example.com/") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
            OutlinedTextField(
                value = token,
                onValueChange = { token = it },
                label = { Text(if (snapshot.hasToken) "Tunnel Token（已保存；留空不修改）" else "Tunnel Token") },
                visualTransformation = PasswordVisualTransformation(),
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )

            Button(
                onClick = {
                    val result = runCatching {
                        val tokenToSave = token.ifBlank { store.configuration()?.token.orEmpty() }
                        store.saveConfiguration(relayUrl, tokenToSave)
                        if (snapshot.enabled) ReverseTunnelController.startIfEnabled(context)
                    }
                    error = result.exceptionOrNull()?.message.orEmpty()
                    if (result.isSuccess) token = ""
                    snapshot = store.uiSnapshot()
                },
                modifier = Modifier.fillMaxWidth(),
            ) { Text("保存远程连接设置") }

            OutlinedButton(
                onClick = {
                    val result = runCatching {
                        if (snapshot.enabled) {
                            ReverseTunnelController.disable(context)
                        } else {
                            val tokenToUse = token.ifBlank { store.configuration()?.token.orEmpty() }
                            ReverseTunnelController.enable(context, relayUrl, tokenToUse)
                        }
                    }
                    error = result.exceptionOrNull()?.message.orEmpty()
                    if (result.isSuccess) token = ""
                    snapshot = store.uiSnapshot()
                },
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text(if (snapshot.enabled) "关闭远程只读连接" else "开启远程只读连接")
            }

            if (snapshot.hasToken) {
                OutlinedButton(
                    onClick = {
                        ReverseTunnelController.disable(context)
                        store.clearToken()
                        token = ""
                        error = ""
                        snapshot = store.uiSnapshot()
                    },
                    modifier = Modifier.fillMaxWidth(),
                ) { Text("删除 Tunnel Token") }
            }
        }
    }
}

@Composable
private fun TunnelStatusLine(label: String, value: String) {
    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
        Text(label, style = MaterialTheme.typography.bodyLarge)
        Text(value, style = MaterialTheme.typography.bodyMedium)
    }
}

private fun TunnelSettingsStore.uiSnapshot() = TunnelUiSnapshot(
    enabled = enabled(),
    relayUrl = relayUrl(),
    hasToken = hasToken(),
    state = connectionState(),
    lastConnectedAt = lastConnectedAt(),
    lastErrorCode = lastErrorCode(),
    lastMcpRequestAt = lastMcpRequestAt(),
    lastServedTool = lastServedTool(),
)

private fun tunnelStateLabel(value: String): String = when (value) {
    TunnelSettingsStore.STATE_DISABLED -> "Disabled"
    TunnelSettingsStore.STATE_CONNECTING -> "Connecting"
    TunnelSettingsStore.STATE_CONNECTED -> "Connected"
    TunnelSettingsStore.STATE_DISCONNECTED -> "Disconnected"
    TunnelSettingsStore.STATE_ERROR -> "Error"
    else -> "Unknown"
}

private fun Long.asTunnelTime(): String =
    java.text.DateFormat.getDateTimeInstance().format(java.util.Date(this))
