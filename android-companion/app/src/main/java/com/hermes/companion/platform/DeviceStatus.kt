package com.hermes.companion.platform

import android.app.AppOpsManager
import android.app.usage.UsageEvents
import android.app.usage.UsageStatsManager
import android.content.Context
import android.content.Intent
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.BatteryManager
import android.os.Process

data class DeviceStatus(val batteryPercent: Int, val charging: Boolean, val online: Boolean, val foregroundPackage: String?)

object DeviceStatusReader {
    fun read(context: Context): DeviceStatus {
        val battery = context.registerReceiver(null, IntentFilterCompat.batteryFilter)
        val level = battery?.getIntExtra(BatteryManager.EXTRA_LEVEL, 0) ?: 0
        val scale = battery?.getIntExtra(BatteryManager.EXTRA_SCALE, 100) ?: 100
        val chargingState = battery?.getIntExtra(BatteryManager.EXTRA_STATUS, -1)
        val connectivity = context.getSystemService(ConnectivityManager::class.java)
        val network = connectivity?.activeNetwork?.let(connectivity::getNetworkCapabilities)
        return DeviceStatus(
            batteryPercent = (level * 100 / scale.coerceAtLeast(1)).coerceIn(0, 100),
            charging = chargingState == BatteryManager.BATTERY_STATUS_CHARGING || chargingState == BatteryManager.BATTERY_STATUS_FULL,
            online = network?.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) == true,
            foregroundPackage = currentForegroundPackage(context),
        )
    }

    fun hasUsageAccess(context: Context): Boolean {
        val appOps = context.getSystemService(AppOpsManager::class.java)
        return appOps.checkOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), context.packageName) == AppOpsManager.MODE_ALLOWED
    }

    fun currentForegroundPackage(context: Context): String? {
        if (!hasUsageAccess(context)) return null
        val manager = context.getSystemService(UsageStatsManager::class.java) ?: return null
        val end = System.currentTimeMillis()
        val events = manager.queryEvents(end - 24 * 60 * 60 * 1000L, end)
        val event = UsageEvents.Event()
        var latest: String? = null
        var latestTime = 0L
        while (events.hasNextEvent()) {
            events.getNextEvent(event)
            if (event.eventType == UsageEvents.Event.ACTIVITY_RESUMED && event.timeStamp >= latestTime) {
                latestTime = event.timeStamp
                latest = event.packageName
            }
        }
        return latest
    }
}

private object IntentFilterCompat {
    val batteryFilter = android.content.IntentFilter(Intent.ACTION_BATTERY_CHANGED)
}
