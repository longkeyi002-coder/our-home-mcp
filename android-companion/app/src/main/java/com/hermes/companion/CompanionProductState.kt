package com.hermes.companion

import android.content.Context

/** Small local activity ledger used only to explain what Hermes has actually done on this phone. */
class CompanionProductState(context: Context) {
    private val prefs = context.applicationContext.getSharedPreferences("companion_product_state", Context.MODE_PRIVATE)

    fun recordRelayConnected(at: Long = System.currentTimeMillis()) {
        prefs.edit().putLong(KEY_LAST_RELAY_CONNECTED_AT, at).apply()
    }

    fun lastRelayConnectedAt(): Long = prefs.getLong(KEY_LAST_RELAY_CONNECTED_AT, 0L)

    fun recordMcpActivity(activity: String, at: Long = System.currentTimeMillis()) {
        prefs.edit()
            .putString(KEY_LAST_MCP_ACTIVITY, activity.take(80))
            .putLong(KEY_LAST_MCP_ACTIVITY_AT, at)
            .apply()
    }

    fun lastMcpActivity(): String = prefs.getString(KEY_LAST_MCP_ACTIVITY, "") ?: ""
    fun lastMcpActivityAt(): Long = prefs.getLong(KEY_LAST_MCP_ACTIVITY_AT, 0L)

    fun recordNotification(title: String, at: Long = System.currentTimeMillis()) {
        prefs.edit()
            .putString(KEY_LAST_NOTIFICATION_TITLE, title.take(120))
            .putLong(KEY_LAST_NOTIFICATION_AT, at)
            .apply()
    }

    fun lastNotificationTitle(): String = prefs.getString(KEY_LAST_NOTIFICATION_TITLE, "") ?: ""
    fun lastNotificationAt(): Long = prefs.getLong(KEY_LAST_NOTIFICATION_AT, 0L)

    companion object {
        private const val KEY_LAST_RELAY_CONNECTED_AT = "last_relay_connected_at"
        private const val KEY_LAST_MCP_ACTIVITY = "last_mcp_activity"
        private const val KEY_LAST_MCP_ACTIVITY_AT = "last_mcp_activity_at"
        private const val KEY_LAST_NOTIFICATION_TITLE = "last_notification_title"
        private const val KEY_LAST_NOTIFICATION_AT = "last_notification_at"
    }
}
