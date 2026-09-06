package com.hermes.companion.update

import kotlinx.serialization.Serializable

@Serializable
data class UpdateManifest(
    val schemaVersion: Int,
    val versionCode: Int,
    val versionName: String,
    val apkUrl: String,
    val sha256: String,
    val publishedAt: String,
)

data class UpdateDecision(
    val available: Boolean,
    val reason: String,
)

object UpdatePolicy {
    private val sha256Pattern = Regex("^[0-9a-fA-F]{64}$")
    private val stableReleaseUrl = Regex(
        "^https://github\\.com/longkeyi002-coder/our-home-mcp/releases/download/[^/]+/our-home-android-stable\\.apk$",
    )

    fun decide(installedVersionCode: Int, manifest: UpdateManifest): UpdateDecision {
        if (manifest.schemaVersion != 1) return UpdateDecision(false, "unsupported_schema")
        if (manifest.versionCode <= 0) return UpdateDecision(false, "invalid_version_code")
        if (manifest.versionName.isBlank() || manifest.versionName.length > 100) {
            return UpdateDecision(false, "invalid_version_name")
        }
        if (!sha256Pattern.matches(manifest.sha256)) return UpdateDecision(false, "invalid_sha256")
        if (!stableReleaseUrl.matches(manifest.apkUrl)) return UpdateDecision(false, "invalid_apk_url")
        if (manifest.publishedAt.isBlank()) return UpdateDecision(false, "invalid_published_at")
        if (manifest.versionCode <= installedVersionCode) return UpdateDecision(false, "not_newer")
        return UpdateDecision(true, "newer_version")
    }
}
