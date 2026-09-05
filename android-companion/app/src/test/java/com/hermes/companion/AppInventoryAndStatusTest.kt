package com.hermes.companion

import com.hermes.companion.presence.PresenceSnapshot
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class AppInventoryAndStatusTest {
    @Test fun inventoryKeepsOverOneHundredUnusedAppsAndSavedPolicies() {
        val installed = (1..125).map { LocalLaunchableApp("app.$it", "App $it") }
        val saved = listOf(
            LocalLaunchableApp("app.1", "Old label", false),
            LocalLaunchableApp("hidden.launcher", "Saved app", false),
        )
        val result = mergeAppInventory(installed, saved)
        assertEquals(126, result.size)
        assertTrue(result.single { it.packageName == "app.1" }.hasLauncher)
        assertEquals("App 1", result.single { it.packageName == "app.1" }.label)
        assertTrue(result.any { it.packageName == "hidden.launcher" })
    }

    private fun connected() = PresenceSnapshot(
        currentPackage = "example.app", currentStartedAtMs = 1L,
        lastTransitionAtMs = 1L, lastFromPackage = null, lastToPackage = "example.app",
        screenInteractive = true, unlocked = true, accessibilityConnected = true,
        lastAccessibilityEventAtMs = 1L,
    )

    @Test fun permissionAloneDoesNotClaimLiveSensingOrScreenOff() {
        assertEquals("等待感知服务连接", presenceStatusLabel(true, null))
        assertEquals("暂时未知", screenStatusLabel(true, null))
        val disconnected = connected().copy(accessibilityConnected = false)
        assertEquals("等待感知服务连接", presenceStatusLabel(true, disconnected))
        assertEquals("暂时未知", screenStatusLabel(true, disconnected))
        assertEquals("需要开启", presenceStatusLabel(false, connected()))
    }

    @Test fun lockAndScreenOffSuspendLiveAppStatus() {
        assertEquals("屏幕锁定，已暂停", presenceStatusLabel(true, connected().copy(unlocked = false)))
        assertEquals("屏幕关闭，已暂停", presenceStatusLabel(true, connected().copy(screenInteractive = false)))
        assertEquals("正在感知应用切换", presenceStatusLabel(true, connected()))
    }
}
