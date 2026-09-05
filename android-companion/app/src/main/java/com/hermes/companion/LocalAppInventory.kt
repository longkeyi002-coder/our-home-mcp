package com.hermes.companion

import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager

internal data class LocalLaunchableApp(
    val packageName: String,
    val label: String,
    val hasLauncher: Boolean = true,
)

/**
 * Local-only inventory used to render privacy controls.
 * The full installed-app list is not uploaded to Runtime/Brain.
 */
internal class LocalAppInventory(context: Context) {
    private val packageManager = context.applicationContext.packageManager
    private val ownPackage = context.applicationContext.packageName

    @Suppress("DEPRECATION")
    fun launchableApps(savedPackages: Set<String> = emptySet()): List<LocalLaunchableApp> {
        val intent = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
        val launchable = packageManager
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
        val saved = savedPackages.filter { it != ownPackage }.map { packageName ->
            val label = runCatching {
                packageManager.getApplicationLabel(packageManager.getApplicationInfo(packageName, 0)).toString()
            }.getOrDefault(packageName)
            LocalLaunchableApp(packageName, label, hasLauncher = false)
        }
        return mergeAppInventory(launchable, saved)
    }
}


internal fun mergeAppInventory(
    launchable: List<LocalLaunchableApp>,
    saved: List<LocalLaunchableApp>,
): List<LocalLaunchableApp> = (launchable + saved)
    .distinctBy { it.packageName }
    .sortedBy { it.label.lowercase() }
