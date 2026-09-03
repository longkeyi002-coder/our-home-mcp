package com.hermes.companion.data

import android.content.Context
import com.hermes.companion.UsageAccessOnboarding
import java.util.UUID

class SettingsRepository(context: Context) : UsageAccessOnboarding.State {
    internal val context = context.applicationContext
    private val prefs = context.getSharedPreferences("companion_settings", Context.MODE_PRIVATE)
    private val secure = SecureTokenStore(context)

    fun serverUrl(): String = prefs.getString(KEY_SERVER_URL, "") ?: ""
    fun tunnelRelayUrl(): String = prefs.getString(KEY_TUNNEL_RELAY_URL, "") ?: ""
    fun saveTunnelRelayUrl(value: String) { prefs.edit().putString(KEY_TUNNEL_RELAY_URL, value.trim()).apply() }
    fun tunnelToken(): String? = secure.get(KEY_TUNNEL_TOKEN)
    fun saveTunnelToken(value: String) {
        val normalized = value.trim()
        if (normalized.isBlank()) secure.put(KEY_TUNNEL_TOKEN, null) else secure.put(KEY_TUNNEL_TOKEN, normalized)
    }
    fun tunnelEnabled(): Boolean = prefs.getBoolean(KEY_TUNNEL_ENABLED, false)
    fun setTunnelEnabled(value: Boolean) { prefs.edit().putBoolean(KEY_TUNNEL_ENABLED, value).apply() }
    fun saveServerUrl(value: String) { prefs.edit().putString(KEY_SERVER_URL, value.trim()).apply() }
    fun deviceId(): String = prefs.getString(KEY_DEVICE_ID, null) ?: "android-${UUID.randomUUID()}".also { prefs.edit().putString(KEY_DEVICE_ID, it).apply() }
    fun bootstrapToken(): String? = secure.get(KEY_BOOTSTRAP_TOKEN)
    fun saveBootstrapToken(value: String) {
        val normalized = value.trim()
        if (normalized.isBlank()) return
        if (normalized != secure.get(KEY_BOOTSTRAP_TOKEN)) secure.put(KEY_DEVICE_TOKEN, null)
        secure.put(KEY_BOOTSTRAP_TOKEN, normalized)
    }
    fun deviceToken(): String? = secure.get(KEY_DEVICE_TOKEN)
    fun saveDeviceToken(value: String) = secure.put(KEY_DEVICE_TOKEN, value)
    fun clearDeviceToken() = secure.put(KEY_DEVICE_TOKEN, null)
    fun pushFid(): String? = secure.get(KEY_PUSH_FID)
    fun pushToken(): String? = secure.get(KEY_PUSH_TOKEN)
    fun savePushAddress(fid: String?, token: String) {
        secure.put(KEY_PUSH_FID, fid)
        secure.put(KEY_PUSH_TOKEN, token)
    }
    fun lastSuccessfulUpload(): Long = prefs.getLong(KEY_LAST_SUCCESSFUL_UPLOAD, prefs.getLong(KEY_LAST_UPLOAD_LEGACY, 0L))
    fun lastUpload(): Long = lastSuccessfulUpload()
    fun lastManualHeartbeat(): Long = prefs.getLong(KEY_LAST_MANUAL_HEARTBEAT, prefs.getLong(KEY_LAST_HEARTBEAT_LEGACY, 0L))
    fun lastHeartbeat(): Long = lastManualHeartbeat()
    fun lastPeriodicCollection(): Long = prefs.getLong(KEY_LAST_PERIODIC_COLLECTION, 0L)
    fun recordManualHeartbeat(at: Long) {
        prefs.edit()
            .putLong(KEY_LAST_MANUAL_HEARTBEAT, at)
            .putLong(KEY_LAST_HEARTBEAT_LEGACY, at)
            .apply()
    }
    fun recordHeartbeat(at: Long) = recordManualHeartbeat(at)
    fun recordPeriodicCollection(at: Long) {
        prefs.edit().putLong(KEY_LAST_PERIODIC_COLLECTION, at).apply()
    }
    fun recordSuccessfulUpload(at: Long) {
        prefs.edit()
            .putLong(KEY_LAST_SUCCESSFUL_UPLOAD, at)
            .putLong(KEY_LAST_UPLOAD_LEGACY, at)
            .remove(KEY_LAST_ERROR)
            .apply()
    }
    fun lastError(): String = prefs.getString(KEY_LAST_ERROR, "") ?: ""
    fun recordApiError(value: String) { prefs.edit().putString(KEY_LAST_ERROR, value.take(300)).apply() }
    override fun hasShownUsageAccessGuide(): Boolean = prefs.getBoolean(KEY_USAGE_ACCESS_GUIDE_SHOWN, false)
    override fun markUsageAccessGuideShown() { prefs.edit().putBoolean(KEY_USAGE_ACCESS_GUIDE_SHOWN, true).apply() }

    companion object {
        private const val KEY_SERVER_URL = "server_url"
        private const val KEY_TUNNEL_RELAY_URL = "tunnel_relay_url"
        private const val KEY_TUNNEL_TOKEN = "tunnel_token"
        private const val KEY_TUNNEL_ENABLED = "tunnel_enabled"
        private const val KEY_DEVICE_ID = "device_id"
        private const val KEY_BOOTSTRAP_TOKEN = "bootstrap_token"
        private const val KEY_DEVICE_TOKEN = "device_token"
        private const val KEY_PUSH_FID = "push_fid"
        private const val KEY_PUSH_TOKEN = "push_token"
        private const val KEY_LAST_SUCCESSFUL_UPLOAD = "last_successful_upload"
        private const val KEY_LAST_MANUAL_HEARTBEAT = "last_manual_heartbeat"
        private const val KEY_LAST_PERIODIC_COLLECTION = "last_periodic_collection"
        private const val KEY_LAST_UPLOAD_LEGACY = "last_upload"
        private const val KEY_LAST_HEARTBEAT_LEGACY = "last_heartbeat"
        private const val KEY_LAST_ERROR = "last_error"
        private const val KEY_USAGE_ACCESS_GUIDE_SHOWN = "usage_access_guide_shown"
    }
}
