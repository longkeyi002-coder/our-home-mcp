package com.hermes.companion.platform

object UsagePrivacyFilter {
    const val PRIVATE_APP_LABEL = "private_app_active"
    const val PRIVATE_CATEGORY = "private"

    fun redact(
        summary: UsageTimelineSummary,
        exposesIdentity: (String) -> Boolean,
    ): UsageTimelineSummary {
        val redactedSessions = summary.sessions.map { session ->
            if (exposesIdentity(session.packageName)) {
                session
            } else {
                session.copy(packageName = PRIVATE_APP_LABEL, category = PRIVATE_CATEGORY)
            }
        }
        val appTotals = redactedSessions
            .groupingBy { it.packageName }
            .fold(0L) { total, session -> total + session.durationMs }
        val categoryTotals = redactedSessions
            .groupingBy { it.category }
            .fold(0L) { total, session -> total + session.durationMs }
        val currentPackage = summary.currentPackageName?.let { packageName ->
            if (exposesIdentity(packageName)) packageName else PRIVATE_APP_LABEL
        }
        return summary.copy(
            currentPackageName = currentPackage,
            sessions = redactedSessions,
            appTotalsMs = appTotals,
            categoryTotalsMs = categoryTotals,
        )
    }

    fun redactCurrentPackage(
        packageName: String?,
        exposesIdentity: (String) -> Boolean,
    ): String? = packageName?.let { if (exposesIdentity(it)) it else PRIVATE_APP_LABEL }
}
