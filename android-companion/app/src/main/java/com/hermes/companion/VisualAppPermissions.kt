package com.hermes.companion

import android.content.pm.PackageManager
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.weight
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import com.hermes.companion.data.SettingsRepository
import com.hermes.companion.privacy.AppSensitivityClassifier
import com.hermes.companion.privacy.SensitivityClass
import com.hermes.companion.privacy.VisualAppPolicy
import com.hermes.companion.privacy.VisualPrivacyStore
import com.hermes.companion.push.NotificationPrivacyMode

private data class VisualAppEntry(
    val packageName: String,
    val label: String,
    val sensitivity: SensitivityClass,
    val policy: VisualAppPolicy?,
    val isCurrent: Boolean,
    val usageMs: Long,
)

@Composable
internal fun VisualAppPermissionsSection(state: CompanionUiState) {
    val context = LocalContext.current
    val privacy = remember(context) { VisualPrivacyStore(context.applicationContext) }
    val settings = remember(context) { SettingsRepository(context.applicationContext) }
    var revision by remember { mutableIntStateOf(0) }
    var notificationMode by remember { mutableStateOf(settings.notificationPrivacyMode()) }
    var showAppPermissions by remember { mutableStateOf(false) }
    val now = System.currentTimeMillis()
    privacy.pruneExpiredGrant(now)

    NotificationPrivacyCard(
        mode = notificationMode,
        onChange = { mode ->
            settings.saveNotificationPrivacyMode(mode)
            notificationMode = mode
        },
    )

    val currentPackage = state.presence?.currentPackage
    val usageTotals = state.usage?.appTotalsMs.orEmpty()
    val packages = linkedSetOf<String>().apply {
        currentPackage?.takeIf { it != BuildConfig.APPLICATION_ID }?.let(::add)
        state.presence?.lastToPackage?.takeIf { it != BuildConfig.APPLICATION_ID }?.let(::add)
        state.presence?.lastFromPackage?.takeIf { it != BuildConfig.APPLICATION_ID }?.let(::add)
        state.usage?.currentPackageName?.takeIf { it != BuildConfig.APPLICATION_ID }?.let(::add)
        usageTotals.entries
            .sortedByDescending { it.value }
            .take(MAX_VISIBLE_APPS)
            .mapTo(this) { it.key }
    }

    val entries = remember(state.presence, state.usage, revision) {
        packages
            .map { packageName ->
                VisualAppEntry(
                    packageName = packageName,
                    label = appLabel(context.packageManager, packageName),
                    sensitivity = AppSensitivityClassifier.classify(packageName),
                    policy = privacy.policyFor(packageName),
                    isCurrent = packageName == currentPackage,
                    usageMs = usageTotals[packageName] ?: 0L,
                )
            }
            .sortedWith(
                compareByDescending<VisualAppEntry> { it.isCurrent }
                    .thenByDescending { it.usageMs }
                    .thenBy { it.label },
            )
    }

    AppObservationSummaryCard(
        entries = entries,
        onManage = { showAppPermissions = true },
    )

    if (showAppPermissions) {
        AppObservationDialog(
            entries = entries,
            onDismiss = { showAppPermissions = false },
            onPolicy = { entry, policy ->
                privacy.setPolicy(entry.packageName, policy)
                if (policy == VisualAppPolicy.NEVER) {
                    if (privacy.armedGrant()?.packageName == entry.packageName) privacy.clearArmedGrant()
                    if (privacy.temporaryGrant()?.packageName == entry.packageName) privacy.clearTemporaryGrant()
                }
                revision += 1
            },
        )
    }
}

@Composable
private fun AppObservationSummaryCard(
    entries: List<VisualAppEntry>,
    onManage: () -> Unit,
) {
    val automaticCount = entries.count { it.policy == VisualAppPolicy.AUTO }
    val protectedCount = entries.count { it.sensitivity == SensitivityClass.PROTECTED }

    Card(modifier = Modifier.fillMaxWidth()) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 14.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text("应用观察权限", style = MaterialTheme.typography.titleMedium)
                Text(
                    when {
                        entries.isEmpty() -> "还没有发现近期使用的 App"
                        protectedCount > 0 -> "自动观察 $automaticCount 个 · 受保护 $protectedCount 个"
                        else -> "自动观察 $automaticCount 个"
                    },
                    style = MaterialTheme.typography.bodySmall,
                )
            }
            OutlinedButton(onClick = onManage) { Text("管理") }
        }
    }
}

@Composable
private fun AppObservationDialog(
    entries: List<VisualAppEntry>,
    onDismiss: () -> Unit,
    onPolicy: (VisualAppEntry, VisualAppPolicy) -> Unit,
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("应用观察") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(
                    "开关控制是否允许自动观察；敏感 App 会保持询问或受保护。",
                    style = MaterialTheme.typography.bodySmall,
                )
                if (entries.isEmpty()) {
                    Text("使用几个 App 后再回来，这里会自动出现。")
                } else {
                    LazyColumn(
                        modifier = Modifier
                            .fillMaxWidth()
                            .heightIn(max = 460.dp),
                    ) {
                        items(entries, key = { it.packageName }) { entry ->
                            AppObservationRow(
                                entry = entry,
                                onAutomaticChange = { enabled ->
                                    if (entry.sensitivity != SensitivityClass.PROTECTED) {
                                        onPolicy(
                                            entry,
                                            if (enabled) VisualAppPolicy.AUTO else VisualAppPolicy.ASK_ONLY,
                                        )
                                    }
                                },
                            )
                            HorizontalDivider()
                        }
                    }
                }
            }
        },
        confirmButton = {
            TextButton(onClick = onDismiss) { Text("完成") }
        },
    )
}

@Composable
private fun AppObservationRow(
    entry: VisualAppEntry,
    onAutomaticChange: (Boolean) -> Unit,
) {
    val effective = entry.policy ?: VisualAppPolicy.ASK_ONLY
    val protected = entry.sensitivity == SensitivityClass.PROTECTED
    val automatic = effective == VisualAppPolicy.AUTO && !protected

    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(
                if (entry.isCurrent) "${entry.label} · 当前" else entry.label,
                style = MaterialTheme.typography.bodyLarge,
            )
            Text(
                when {
                    protected -> "受保护"
                    automatic -> "可自动观察"
                    effective == VisualAppPolicy.NEVER -> "永不看"
                    else -> "每次询问"
                },
                style = MaterialTheme.typography.bodySmall,
            )
        }
        Switch(
            checked = automatic,
            onCheckedChange = onAutomaticChange,
            enabled = !protected,
        )
    }
}

@Composable
private fun NotificationPrivacyCard(
    mode: NotificationPrivacyMode,
    onChange: (NotificationPrivacyMode) -> Unit,
) {
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("主动消息隐私", style = MaterialTheme.typography.titleMedium)
            Text("决定哥哥主动发来的系统通知在锁屏和通知栏里显示多少内容。")

            NotificationPrivacyOption(
                label = "锁屏隐藏正文",
                description = "默认。解锁后显示完整内容；锁屏只提示哥哥发来了一条消息。",
                selected = mode == NotificationPrivacyMode.HIDE_ON_LOCK_SCREEN,
            ) { onChange(NotificationPrivacyMode.HIDE_ON_LOCK_SCREEN) }

            NotificationPrivacyOption(
                label = "只显示有一条消息",
                description = "无论是否解锁，系统通知都不显示主动消息正文。",
                selected = mode == NotificationPrivacyMode.GENERIC,
            ) { onChange(NotificationPrivacyMode.GENERIC) }

            NotificationPrivacyOption(
                label = "完整显示",
                description = "允许通知显示完整标题和正文；锁屏最终仍受 Android 系统通知设置约束。",
                selected = mode == NotificationPrivacyMode.FULL,
            ) { onChange(NotificationPrivacyMode.FULL) }
        }
    }
}

@Composable
private fun NotificationPrivacyOption(
    label: String,
    description: String,
    selected: Boolean,
    onClick: () -> Unit,
) {
    if (selected) {
        Button(onClick = onClick, modifier = Modifier.fillMaxWidth()) { Text(label) }
    } else {
        OutlinedButton(onClick = onClick, modifier = Modifier.fillMaxWidth()) { Text(label) }
    }
    Text(description, style = MaterialTheme.typography.bodySmall)
}

private fun appLabel(packageManager: PackageManager, packageName: String): String = runCatching {
    val info = packageManager.getApplicationInfo(packageName, 0)
    packageManager.getApplicationLabel(info).toString().ifBlank { packageName }
}.getOrDefault(packageName)

private const val MAX_VISIBLE_APPS = 12
