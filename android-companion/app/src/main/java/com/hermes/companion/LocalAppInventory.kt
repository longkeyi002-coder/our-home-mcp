package com.hermes.companion

import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager

internal data class LocalLaunchableApp(
    val packageName: String,
    val label: String,
)

/**
 * Local-only inventory used to render privacy controls.
 * The full installed-app list is not uploaded to Runtime/Brain.
 */
internal class LocalAppInventory(context: Context) {
    private val packageManager = context.applicationContext.packageManager
    private val ownPackage = context.applicationContext.packageName

    @Suppress("DEPRECATION")
    fun launchableApps(): List<LocalLaunchableApp> {
        val intent = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
        return packageManager
            .queryIntentActivities(intent, PackageManager.MATCH_ALL)
            .asSequence()
            .mapNotNull { resolveInfo ->
                val activityInfo = resolveInfo.activityInfo ?: return@mapNotNull null
                val packageName = activityInfo.packageName?.trim().orEmpty()
                if (packageName.isBlank() || packageName == ownPackage) return@mapNotNull null
                val label = runCatching {
                    resolveInfo.loadLabel(packageManager).toString().trim()
                }.getOrDefault(packageName).ifBlank { packageName }
                LocalLaunchableApp(packageName = packageName, label = label)
            }
            .distinctBy { it.packageName }
            .sortedBy { it.label.lowercase() }
            .toList()
    }
}
