package com.hermes.companion.presence

import android.content.Context
import android.content.Intent
import android.view.inputmethod.InputMethodManager

/**
 * Packages that can own an Android window without becoming the user's semantic foreground App.
 * Keyboard, notification shade/System UI, OEM system overlays and launcher windows must not replace
 * the last real App.
 */
object PresencePackageFilter {
    private val knownSystemUiPackages = setOf(
        "com.android.systemui",
        "com.google.android.systemui",
        // ColorOS / OxygenOS system overlay surfaces can emit accessibility window events while
        // the user is still semantically inside the underlying App. In particular,
        // com.oplus.appdetail is observed when opening the notification shade on current OPPO builds.
        "com.oplus.appdetail",
        "com.oplus.notificationmanager",
        "com.coloros.notificationmanager",
    )

    fun ignoredPackages(context: Context): Set<String> {
        val packageManager = context.packageManager
        val homeIntent = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME)
        val homePackages = packageManager.queryIntentActivities(homeIntent, 0)
            .mapNotNull { it.activityInfo?.packageName }
            .toSet()
        val inputMethodManager = context.getSystemService(Context.INPUT_METHOD_SERVICE) as? InputMethodManager
        val inputMethodPackages = inputMethodManager?.inputMethodList
            ?.mapNotNull { it.packageName?.trim()?.takeIf(String::isNotEmpty) }
            ?.toSet()
            .orEmpty()
        return buildSet {
            add(context.packageName)
            addAll(knownSystemUiPackages)
            addAll(homePackages)
            addAll(inputMethodPackages)
        }
    }

    fun shouldIgnore(packageName: String, ignoredPackages: Set<String>): Boolean =
        packageName.isBlank() || packageName in ignoredPackages
}
