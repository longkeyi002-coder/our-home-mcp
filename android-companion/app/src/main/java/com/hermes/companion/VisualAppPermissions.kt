package com.hermes.companion

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Card
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
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
import com.hermes.companion.privacy.PresenceAppPolicy
import com.hermes.companion.privacy.PresencePrivacyStore
import com.hermes.companion.privacy.VisualAppPolicy
import com.hermes.companion.privacy.VisualPrivacyStore
import com.hermes.companion.push.NotificationPrivacyMode
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

private data class VisualAppEntry(
    val packageName: String,
    val label: String,
    val enabled: Boolean,
    val isCurrent: Boolean,
    val usageMs: Long,
    val hasLauncher: Boolean,
)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun VisualAppPermissionsSection(state: CompanionUiState) {
    val context = LocalContext.current
    val visualPrivacy = remember(context) { VisualPrivacyStore(context.applicationContext) }
    val presencePrivacy = remember(context) { PresencePrivacyStore(context.applicationContext) }
    val inventory = remember(context) { LocalAppInventory(context.applicationContext) }
    val settings = remember(context) { SettingsRepository(context.applicationContext) }
    var revision by remember { mutableIntStateOf(0) }
    var notificationMode by remember { mutableStateOf(settings.notificationPrivacyMode()) }
    var showAppPermissions by remember { mutableStateOf(false) }
    var showNotificationPrivacy by remember { mutableStateOf(false) }
    val now = System.currentTimeMillis()
    visualPrivacy.pruneExpiredGrant(now)

    val currentPackage = state.presence?.currentPackage
    val usageTotals = state.usage?.appTotalsMs.orEmpty()
    var launchableApps by remember { mutableStateOf<List<LocalLaunchableApp>>(emptyList()) }
    var inventoryLoading by remember { mutableStateOf(true) }
    var inventoryError by remember { mutableStateOf(false) }

    // Load the installed-app inventory once for this screen lifetime. Opening the permission
    // sheet must be instant and must not rescan PackageManager every time.
    LaunchedEffect(Unit) {
        inventoryLoading = true
        val result = withContext(Dispatchers.IO) {
            runCatching {
                inventory.launchableApps(
                    presencePrivacy.configuredPackages() + visualPrivacy.configuredPackages(),
                )
            }
        }
        result.onSuccess { launchableApps = it }
        inventoryError = result.isFailure
        inventoryLoading = false
    }

    val entries = remember(launchableApps, state.presence, state.usage, revision) {
        launchableApps
            .map { app ->
                val presenceAllowed = presencePrivacy.policyFor(app.packageName) == PresenceAppPolicy.ALLOW
                val visualPolicy = visualPrivacy.policyFor(app.packageName)
                VisualAppEntry(
                    packageName = app.packageName,
                    label = app.label,
                    // New two-state model: default/legacy ASK_ONLY remains enabled unless the
                    // user explicitly disabled either identity exposure or visual observation.
                    enabled = presenceAllowed && visualPolicy != VisualAppPolicy.NEVER,
                    isCurrent = app.packageName == currentPackage,
                    usageMs = usageTotals[app.packageName] ?: 0L,
                    hasLauncher = app.hasLauncher,
                )
            }
            .sortedWith(
                compareByDescending<VisualAppEntry> { it.isCurrent }
                    .thenByDescending { it.usageMs }
                    .thenBy { it.label.lowercase() },
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
                loading = inventoryLoading,
                loadError = inventoryError,
                onDone = { showAppPermissions = false },
                onEnabledChange = { entry, enabled ->
                    presencePrivacy.setPolicy(
                        entry.packageName,
                        if (enabled) PresenceAppPolicy.ALLOW else PresenceAppPolicy.HIDE_IDENTITY,
                    )
                    visualPrivacy.setPolicy(
                        entry.packageName,
                        if (enabled) VisualAppPolicy.AUTO else VisualAppPolicy.NEVER,
                    )
                    if (!enabled) {
                        if (visualPrivacy.armedGrant()?.packageName == entry.packageName) {
                            visualPrivacy.clearArmedGrant()
                        }
                        if (visualPrivacy.temporaryGrant()?.packageName == entry.packageName) {
                            visualPrivacy.clearTemporaryGrant()
                        }
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
            title = "应用感知权限",
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
            .padding(horizontal = 16.dp, vertical = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        TextButton(
            onClick = onClick,
            modifier = Modifier.weight(1f),
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                Text(title, modifier = Modifier.weight(1f), style = MaterialTheme.typography.bodyLarge)
                Text(value, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Text("›", style = MaterialTheme.typography.titleLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
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
    TextButton(
        onClick = onClick,
        modifier = Modifier.fillMaxWidth(),
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 8.dp, vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(title, modifier = Modifier.weight(1f), style = MaterialTheme.typography.bodyLarge)
            if (selected) Text("✓", style = MaterialTheme.typography.titleMedium)
        }
    }
}

@Composable
private fun AppObservationSheet(
    entries: List<VisualAppEntry>,
    loading: Boolean,
    loadError: Boolean,
    onDone: () -> Unit,
    onEnabledChange: (VisualAppEntry, Boolean) -> Unit,
) {
    var query by remember { mutableStateOf("") }
    val normalizedQuery = query.trim()
    val filteredEntries = if (normalizedQuery.isBlank()) {
        entries
    } else {
        entries.filter {
            it.label.contains(normalizedQuery, ignoreCase = true) ||
                it.packageName.contains(normalizedQuery, ignoreCase = true)
        }
    }

    SheetHeader(title = "应用感知", onDone = onDone)
    Text(
        "启用后哥哥可以知道你正在使用这个 App，并在需要时直接观察屏幕；禁用后本机仍可感知切换，但不会上传 App 身份或截图。",
        modifier = Modifier.padding(horizontal = 20.dp, vertical = 4.dp),
        style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
    OutlinedTextField(
        value = query,
        onValueChange = { query = it },
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 8.dp),
        singleLine = true,
        placeholder = { Text("搜索应用") },
    )

    if (entries.isEmpty()) {
        Text(
            when {
                loading -> "正在读取应用列表…"
                loadError -> "读取失败，请重新打开页面后再试。"
                else -> "未找到可启动的 App。"
            },
            modifier = Modifier.padding(20.dp),
            style = MaterialTheme.typography.bodyMedium,
        )
        return
    }

    if (filteredEntries.isEmpty()) {
        Text(
            "没有匹配的应用。",
            modifier = Modifier.padding(20.dp),
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        return
    }

    LazyColumn(
        modifier = Modifier
            .fillMaxWidth()
            .heightIn(max = 520.dp)
            .padding(horizontal = 16.dp, vertical = 4.dp),
    ) {
        items(filteredEntries, key = { it.packageName }) { entry ->
            AppObservationRow(
                entry = entry,
                onEnabledChange = { enabled -> onEnabledChange(entry, enabled) },
            )
            HorizontalDivider(modifier = Modifier.padding(start = 52.dp))
        }
    }
}

@Composable
private fun AppObservationRow(
    entry: VisualAppEntry,
    onEnabledChange: (Boolean) -> Unit,
) {
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

        Column(
            modifier = Modifier.weight(1f),
            verticalArrangement = Arrangement.spacedBy(1.dp),
        ) {
            Text(
                if (entry.isCurrent) "${entry.label} · 当前" else entry.label,
                style = MaterialTheme.typography.bodyLarge,
            )
            Text(
                (if (entry.enabled) "已启用 · 可上传信息 · 可自动观察" else "已禁用 · 不上传身份 · 不截图") +
                    if (entry.hasLauncher) "" else " · 已保存设置（无启动入口）",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }

        Switch(
            checked = entry.enabled,
            onCheckedChange = onEnabledChange,
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
