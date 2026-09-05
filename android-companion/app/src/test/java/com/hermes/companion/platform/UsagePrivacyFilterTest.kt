package com.hermes.companion.platform

import kotlin.test.Test
import kotlin.test.assertEquals

class UsagePrivacyFilterTest {
    @Test
    fun `hidden apps are redacted from current package sessions app totals and categories`() {
        val summary = UsageTimelineSummary(
            observedAt = 10_000L,
            currentPackageName = "com.example.secret",
            currentDurationMs = 3_000L,
            sessions = listOf(
                UsageSession("com.example.allowed", 1_000L, 3_000L, 2_000L, "social"),
                UsageSession("com.example.secret", 3_000L, null, 7_000L, "shopping"),
            ),
            appTotalsMs = mapOf(
                "com.example.allowed" to 2_000L,
                "com.example.secret" to 7_000L,
            ),
            categoryTotalsMs = mapOf("social" to 2_000L, "shopping" to 7_000L),
        )

        val redacted = UsagePrivacyFilter.redact(summary) { it != "com.example.secret" }

        assertEquals(UsagePrivacyFilter.PRIVATE_APP_LABEL, redacted.currentPackageName)
        assertEquals(
            listOf("com.example.allowed", UsagePrivacyFilter.PRIVATE_APP_LABEL),
            redacted.sessions.map { it.packageName },
        )
        assertEquals(
            mapOf("com.example.allowed" to 2_000L, UsagePrivacyFilter.PRIVATE_APP_LABEL to 7_000L),
            redacted.appTotalsMs,
        )
        assertEquals(mapOf("social" to 2_000L, UsagePrivacyFilter.PRIVATE_CATEGORY to 7_000L), redacted.categoryTotalsMs)
    }

    @Test
    fun `allowed app identity remains unchanged`() {
        assertEquals(
            "com.example.allowed",
            UsagePrivacyFilter.redactCurrentPackage("com.example.allowed") { true },
        )
    }
}
