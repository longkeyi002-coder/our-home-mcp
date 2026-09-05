package com.hermes.companion

import com.hermes.companion.update.UpdateManifest
import com.hermes.companion.update.UpdatePolicy
import kotlin.test.assertFalse
import kotlin.test.assertTrue
import org.junit.Test

class UpdatePolicyTest {
    private fun manifest(
        versionCode: Int = 2,
        apkUrl: String = "https://github.com/longkeyi002-coder/our-home-mcp/releases/download/android-stable-v0.1.2/our-home-android-stable.apk",
        sha256: String = "a".repeat(64),
        schemaVersion: Int = 1,
    ) = UpdateManifest(
        schemaVersion = schemaVersion,
        versionCode = versionCode,
        versionName = "0.1.$versionCode",
        apkUrl = apkUrl,
        sha256 = sha256,
        publishedAt = "2026-09-06T00:00:00Z",
    )

    @Test
    fun newerStableReleaseIsAccepted() {
        assertTrue(UpdatePolicy.decide(1, manifest()).available)
    }

    @Test
    fun equalOrOlderVersionIsRejected() {
        assertFalse(UpdatePolicy.decide(2, manifest(versionCode = 2)).available)
        assertFalse(UpdatePolicy.decide(3, manifest(versionCode = 2)).available)
    }

    @Test
    fun invalidHashFailsClosed() {
        assertFalse(UpdatePolicy.decide(1, manifest(sha256 = "not-a-hash")).available)
    }

    @Test
    fun nonGithubOrNonHttpsApkFailsClosed() {
        assertFalse(UpdatePolicy.decide(1, manifest(apkUrl = "https://example.com/app.apk")).available)
        assertFalse(UpdatePolicy.decide(1, manifest(apkUrl = "http://github.com/longkeyi002-coder/our-home-mcp/releases/download/x/our-home-android-stable.apk")).available)
    }

    @Test
    fun unsupportedSchemaFailsClosed() {
        assertFalse(UpdatePolicy.decide(1, manifest(schemaVersion = 2)).available)
    }
}
