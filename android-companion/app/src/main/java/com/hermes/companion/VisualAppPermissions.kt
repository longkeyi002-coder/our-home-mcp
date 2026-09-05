package com.hermes.companion

import android.content.pm.PackageManager
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.weight
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Card
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
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

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun VisualAppPermissionsSection(state: CompanionUiState) {
    val context = LocalContext.current
    val privacy = remember(context) { VisualPrivacyStore(context.applicationContext) }
    val settings = remember(context) { SettingsRepository(context.applicationContext) }
    var revision by remember { mutableIntStateOf(0) }
    var notificationMode by remember { mutableStateOf(settings.notificationPrivacyMode()) }
    var showAppPermissions by remember { mutableStateOf(false) }
    var showNotificationPrivacy by remember { mutableStateOf(false) }
    val now = System.currentTimeMillis()
    privacy.pruneExpiredGrant(now)

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

    SettingsGroup(
        notificationMode = notificationMode,
        entries = entries,
        onNotificationPrivacy = { showNotificationPrivacy = true },
        onAppPermissions = { showAppPermissions = true },
    )

    if (showNotificationPrivacy) {
        ModalBottomSheet(onDismissRequest = { showNotificationPrivacy = false }) {
            NotificationPrivacySheet(
                mode = notificationMode,
                onChange = { mode ->
                    settings.saveNotificationPrivacyMode(mode)
                    notificationMode = mode
                },
                onDone = { showNotificationPrivacy = false },
            )
        }
    }

    if (showAppPermissions) {
        ModalBottomSheet(onDismissRequest = { showAppPermissions = false }) {
            AppObservationSheet(
                entries = entries,
                onDone = { showAppPermissions = false },
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
}

@Composable
private fun SettingsGroup(
    notificationMode: NotificationPrivacyMode,
    entries: List<VisualAppEntry>,
    onNotificationPrivacy: () -> Unit,
    onAppPermissions: () -> Unit,
) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(16.dp),
    ) {
        SettingsNavigationRow(
            title = "主动消息隐私",
            value = notificationModeLabel(notificationMode),
            onClick = onNotificationPrivacy,
        )
        HorizontalDivider(modifier = Modifier.padding(start = 16.dp))
        SettingsNavigationRow(
            title = "应用观察权限",
            value = if (entries.isEmpty()) "未发现 App" else "${entries.size} 个 App",
            onClick = onAppPermissions,
        )
    }
}

@Composable
private fun SettingsNavigationRow(
    title: String,
    value: String,
    onClick: () -> Unit,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(horizontal = 16.dp, vertical = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Text(title, modifier = Modifier.weight(1f), style = MaterialTheme.typography.bodyLarge)
        Text(value, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text("›", style = MaterialTheme.typography.titleLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
private fun NotificationPrivacySheet(
    mode: NotificationPrivacyMode,
    onChange: (NotificationPrivacyMode) -> Unit,
    onDone: () -> Unit,
) {
    SheetHeader(title = "主动消息隐私", onDone = onDone)
    Text(
        "决定系统通知显示多少消息内容。",
        modifier = Modifier.padding(horizontal = 20.dp, vertical = 4.dp),
        style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
    Column(
        modifier = Modifier.padding(horizontal = 16.dp, vertical = 12.dp),
    ) {
        NotificationPrivacyRow(
            title = "锁屏隐藏正文",
            selected = mode == NotificationPrivacyMode.HIDE_ON_LOCK_SCREEN,
        ) { onChange(NotificationPrivacyMode.HIDE_ON_LOCK_SCREEN) }
        HorizontalDivider(modifier = Modifier.padding(start = 16.dp))
        NotificationPrivacyRow(
            title = "只显示有一条消息",
            selected = mode == NotificationPrivacyMode.GENERIC,
        ) { onChange(NotificationPrivacyMode.GENERIC) }
        HorizontalDivider(modifier = Modifier.padding(start = 16.dp))
        NotificationPrivacyRow(
            title = "完整显示",
            selected = mode == NotificationPrivacyMode.FULL,
        ) { onChange(NotificationPrivacyMode.FULL) }
    }
}

@Composable
private fun NotificationPrivacyRow(
    title: String,
    selected: Boolean,
    onClick: () -> Unit,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(horizontal = 16.dp, vertical = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(title, modifier = Modifier.weight(1f), style = MaterialTheme.typography.bodyLarge)
        if (selected) Text("✓", style = MaterialTheme.typography.titleMedium)
    }
}

@Composable
private fun AppObservationSheet(
    entries: List<VisualAppEntry>,
    onDone: () -> Unit,
    onPolicy: (VisualAppEntry, VisualAppPolicy) -> Unit,
) {
    SheetHeader(title = "应用观察", onDone = onDone)
    Text(
        "开关表示允许哥哥自动观察；关闭后需要你再次允许。受保护 App 不能开启。",
        modifier = Modifier.padding(horizontal = 20.dp, vertical = 4.dp),
        style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
    )

    if (entries.isEmpty()) {
        Text(
            "使用几个 App 后再回来，这里会自动出现。",
            modifier = Modifier.padding(20.dp),
            style = MaterialTheme.typography.bodyMedium,
        )
        return
    }

    LazyColumn(
        modifier = Modifier
            .fillMaxWidth()
            .heightIn(max = 520.dp)
            .padding(horizontal = 16.dp, vertical = 12.dp),
    ) {
        items(entries, key = { it.packageName }) { entry ->
            AppObservationRow(
                entry = entry,
                onAutomaticChange = { enabled ->
                    if (entry.sensitivity != SensitivityClass.PROTECTED) {
                        onPolicy(entry, if (enabled) VisualAppPolicy.AUTO else VisualAppPolicy.ASK_ONLY)
                    }
                },
            )
            HorizontalDivider(modifier = Modifier.padding(start = 52.dp))
        }
    }
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
            .padding(horizontal = 4.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Box(
            modifier = Modifier
                .size(36.dp)
                .clip(RoundedCornerShape(9.dp))
                .background(MaterialTheme.colorScheme.surfaceVariant),
            contentAlignment = Alignment.Center,
        ) {
            Text(
                entry.label.take(1).ifBlank { "·" },
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.Medium,
            )
        }

        Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(1.dp)) {
            Text(
                if (entry.isCurrent) "${entry.label} · 当前" else entry.label,
                style = MaterialTheme.typography.bodyLarge,
            )
            Text(
                when {
                    protected -> "受保护"
                    automatic -> "可自动观察"
                    effective == VisualAppPolicy.NEVER -> "永不看"
                    else -> "需要询问"
                },
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
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
private fun SheetHeader(title: String, onDone: () -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 12.dp, vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            title,
            modifier = Modifier
                .weight(1f)
                .padding(start = 8.dp),
            style = MaterialTheme.typography.titleLarge,
            fontWeight = FontWeight.SemiBold,
        )
        TextButton(onClick = onDone) { Text("完成") }
    }
}

private fun notificationModeLabel(mode: NotificationPrivacyMode): String = when (mode) {
    NotificationPrivacyMode.HIDE_ON_LOCK_SCREEN -> "锁屏隐藏"
    NotificationPrivacyMode.GENERIC -> "仅提示"
    NotificationPrivacyMode.FULL -> "完整显示"
}

private fun appLabel(packageManager: PackageManager, packageName: String): String = runCatching {
    val info = packageManager.getApplicationInfo(packageName, 0)
    packageManager.getApplicationLabel(info).toString().ifBlank { packageName }
}.getOrDefault(packageName)

private const val MAX_VISIBLE_APPS = 12
