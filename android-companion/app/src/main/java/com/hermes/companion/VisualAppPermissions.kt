package com.hermes.companion

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
import com.hermes.companion.privacy.PresenceAppPolicy
import com.hermes.companion.privacy.PresencePrivacyStore
import com.hermes.companion.privacy.SensitivityClass
import com.hermes.companion.privacy.VisualAppPolicy
import com.hermes.companion.privacy.VisualPrivacyStore
import com.hermes.companion.push.NotificationPrivacyMode

private data class VisualAppEntry(
    val packageName: String,
    val label: String,
    val sensitivity: SensitivityClass,
    val visualPolicy: VisualAppPolicy?,
    val presencePolicy: PresenceAppPolicy,
    val isCurrent: Boolean,
    val usageMs: Long,
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
    val launchableApps = remember(state.presence, state.usage, revision) {
        inventory.launchableApps()
    }

    val entries = remember(launchableApps, state.presence, state.usage, revision) {
        launchableApps
            .map { app ->
                VisualAppEntry(
                    packageName = app.packageName,
                    label = app.label,
                    sensitivity = AppSensitivityClassifier.classify(app.packageName),
                    visualPolicy = visualPrivacy.policyFor(app.packageName),
                    presencePolicy = presencePrivacy.policyFor(app.packageName),
                    isCurrent = app.packageName == currentPackage,
                    usageMs = usageTotals[app.packageName] ?: 0L,
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
                onDone = { showAppPermissions = false },
                onPresencePolicy = { entry, policy ->
                    presencePrivacy.setPolicy(entry.packageName, policy)
                    if (policy == PresenceAppPolicy.HIDE_IDENTITY) {
                        if (visualPrivacy.armedGrant()?.packageName == entry.packageName) visualPrivacy.clearArmedGrant()
                        if (visualPrivacy.temporaryGrant()?.packageName == entry.packageName) visualPrivacy.clearTemporaryGrant()
                    }
                    revision += 1
                },
                onVisualPolicy = { entry, policy ->
                    visualPrivacy.setPolicy(entry.packageName, policy)
                    if (policy == VisualAppPolicy.NEVER) {
                        if (visualPrivacy.armedGrant()?.packageName == entry.packageName) visualPrivacy.clearArmedGrant()
                        if (visualPrivacy.temporaryGrant()?.packageName == entry.packageName) visualPrivacy.clearTemporaryGrant()
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
    onPresencePolicy: (VisualAppEntry, PresenceAppPolicy) -> Unit,
    onVisualPolicy: (VisualAppEntry, VisualAppPolicy) -> Unit,
) {
    var query by remember { mutableStateOf("") }
    var expandedPackage by remember { mutableStateOf<String?>(null) }
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
        "选择哥哥可以知道你正在使用哪些 App。点应用可设置屏幕观察。",
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
            "未找到可启动的 App。",
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
                expanded = expandedPackage == entry.packageName,
                onExpand = {
                    expandedPackage = if (expandedPackage == entry.packageName) null else entry.packageName
                },
                onPresenceChange = { allowed ->
                    onPresencePolicy(
                        entry,
                        if (allowed) PresenceAppPolicy.ALLOW else PresenceAppPolicy.HIDE_IDENTITY,
                    )
                },
                onVisualPolicy = { policy -> onVisualPolicy(entry, policy) },
            )
            HorizontalDivider(modifier = Modifier.padding(start = 52.dp))
        }
    }
}

@Composable
private fun AppObservationRow(
    entry: VisualAppEntry,
    expanded: Boolean,
    onExpand: () -> Unit,
    onPresenceChange: (Boolean) -> Unit,
    onVisualPolicy: (VisualAppPolicy) -> Unit,
) {
    val presenceAllowed = entry.presencePolicy == PresenceAppPolicy.ALLOW
    val effectiveVisual = entry.visualPolicy ?: VisualAppPolicy.ASK_ONLY
    val protected = entry.sensitivity == SensitivityClass.PROTECTED

    Column(
        modifier = Modifier.fillMaxWidth(),
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
                modifier = Modifier
                    .weight(1f)
                    .clickable(onClick = onExpand),
                verticalArrangement = Arrangement.spacedBy(1.dp),
            ) {
                Text(
                    if (entry.isCurrent) "${entry.label} · 当前" else entry.label,
                    style = MaterialTheme.typography.bodyLarge,
                )
                Text(
                    appPermissionSummary(presenceAllowed, protected, effectiveVisual),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }

            Switch(
                checked = presenceAllowed,
                onCheckedChange = onPresenceChange,
            )
        }

        if (expanded) {
            VisualPolicyEditor(
                presenceAllowed = presenceAllowed,
                protected = protected,
                policy = effectiveVisual,
                onPolicy = onVisualPolicy,
            )
        }
    }
}

@Composable
private fun VisualPolicyEditor(
    presenceAllowed: Boolean,
    protected: Boolean,
    policy: VisualAppPolicy,
    onPolicy: (VisualAppPolicy) -> Unit,
) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(start = 52.dp, end = 8.dp, bottom = 10.dp),
        verticalArrangement = Arrangement.spacedBy(2.dp),
    ) {
        Text(
            "屏幕观察",
            style = MaterialTheme.typography.labelLarge,
            fontWeight = FontWeight.Medium,
        )
        if (!presenceAllowed) {
            Text(
                "此 App 不会向哥哥透露身份，屏幕也不会被观察。",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            return
        }
        if (protected) {
            Text(
                "受保护 App 不能自动观察。",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            if (!protected) {
                VisualPolicyChoice("自动", policy == VisualAppPolicy.AUTO) { onPolicy(VisualAppPolicy.AUTO) }
            }
            VisualPolicyChoice("询问", policy == VisualAppPolicy.ASK_ONLY) { onPolicy(VisualAppPolicy.ASK_ONLY) }
            VisualPolicyChoice("永不看", policy == VisualAppPolicy.NEVER) { onPolicy(VisualAppPolicy.NEVER) }
        }
    }
}

@Composable
private fun VisualPolicyChoice(
    title: String,
    selected: Boolean,
    onClick: () -> Unit,
) {
    TextButton(onClick = onClick) {
        Text(if (selected) "✓ $title" else title)
    }
}

private fun appPermissionSummary(
    presenceAllowed: Boolean,
    protected: Boolean,
    visualPolicy: VisualAppPolicy,
): String {
    if (!presenceAllowed) return "不透露此 App · 屏幕不观察"
    val visual = when {
        protected -> "屏幕受保护"
        visualPolicy == VisualAppPolicy.AUTO -> "屏幕可自动观察"
        visualPolicy == VisualAppPolicy.NEVER -> "屏幕永不看"
        else -> "屏幕需询问"
    }
    return "可感知 · $visual"
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
