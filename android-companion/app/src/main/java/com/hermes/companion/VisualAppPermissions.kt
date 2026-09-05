package com.hermes.companion

import android.content.pm.PackageManager
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
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

    Card(modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text("App 视觉权限", style = MaterialTheme.typography.titleMedium)
            Text("未知 App 默认不会自动截图。你可以逐个决定；高度敏感 App 永远不能永久设为自动观察。")
            if (entries.isEmpty()) {
                Text("还没有可管理的 App。开启实时 App 感知或使用情况访问后，这里会出现当前和近期使用过的 App。")
            } else {
                entries.forEach { entry ->
                    VisualAppPermissionCard(
                        entry = entry,
                        armedPackage = privacy.armedGrant()?.takeIf { now < it.expiresAtMs }?.packageName,
                        visionReady = state.visionEnabled && state.visionHasApiKey,
                        onPolicy = { policy ->
                            privacy.setPolicy(entry.packageName, policy)
                            if (policy == VisualAppPolicy.NEVER) {
                                if (privacy.armedGrant()?.packageName == entry.packageName) privacy.clearArmedGrant()
                                if (privacy.temporaryGrant()?.packageName == entry.packageName) privacy.clearTemporaryGrant()
                            }
                            revision += 1
                        },
                        onAllowOnce = {
                            privacy.armOneTimeGrant(
                                packageName = entry.packageName,
                                nowMs = System.currentTimeMillis(),
                                ttlMs = VisualPrivacyStore.MAX_TEMPORARY_GRANT_MS,
                            )
                            revision += 1
                        },
                    )
                }
            }
        }
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

@Composable
private fun VisualAppPermissionCard(
    entry: VisualAppEntry,
    armedPackage: String?,
    visionReady: Boolean,
    onPolicy: (VisualAppPolicy) -> Unit,
    onAllowOnce: () -> Unit,
) {
    val effective = entry.policy ?: VisualAppPolicy.ASK_ONLY
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(
                if (entry.isCurrent) "${entry.label} · 当前" else entry.label,
                style = MaterialTheme.typography.titleSmall,
            )
            Text(entry.packageName, style = MaterialTheme.typography.bodySmall)
            Text(
                when (entry.sensitivity) {
                    SensitivityClass.PROTECTED -> "高度敏感：只允许一次性授权"
                    SensitivityClass.PRIVATE -> "默认谨慎：未明确允许时不会自动观察"
                    SensitivityClass.NORMAL -> "普通 App"
                },
                style = MaterialTheme.typography.bodySmall,
            )

            PolicyButton("永不看", effective == VisualAppPolicy.NEVER) { onPolicy(VisualAppPolicy.NEVER) }
            PolicyButton("每次询问", effective == VisualAppPolicy.ASK_ONLY) { onPolicy(VisualAppPolicy.ASK_ONLY) }
            if (entry.sensitivity != SensitivityClass.PROTECTED) {
                PolicyButton("可自动观察", effective == VisualAppPolicy.AUTO) { onPolicy(VisualAppPolicy.AUTO) }
            }

            if (effective != VisualAppPolicy.NEVER) {
                if (armedPackage == entry.packageName) {
                    Text("已允许一次：10 分钟内返回这个 App 后，下一次符合条件的观察可使用一次。")
                } else {
                    OutlinedButton(
                        onClick = onAllowOnce,
                        enabled = visionReady,
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Text(if (visionReady) "仅这一次允许" else "先开启视觉观察")
                    }
                }
            }
        }
    }
}

@Composable
private fun PolicyButton(label: String, selected: Boolean, onClick: () -> Unit) {
    if (selected) {
        Button(onClick = onClick, modifier = Modifier.fillMaxWidth()) { Text(label) }
    } else {
        OutlinedButton(onClick = onClick, modifier = Modifier.fillMaxWidth()) { Text(label) }
    }
}

private fun appLabel(packageManager: PackageManager, packageName: String): String = runCatching {
    val info = packageManager.getApplicationInfo(packageName, 0)
    packageManager.getApplicationLabel(info).toString().ifBlank { packageName }
}.getOrDefault(packageName)

private const val MAX_VISIBLE_APPS = 12
