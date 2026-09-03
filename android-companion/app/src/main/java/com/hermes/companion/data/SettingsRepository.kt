package com.hermes.companion.data

import android.content.Context
import java.util.UUID

class SettingsRepository(context: Context) {
    internal val context = context.applicationContext
    private val prefs = context.getSharedPreferences("companion_settings", Context.MODE_PRIVATE)
    private val secure = SecureTokenStore(context)

    fun serverUrl(): String = prefs.getString(KEY_SERVER_URL, "") ?: ""
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
    fun lastUpload(): Long = prefs.getLong(KEY_LAST_UPLOAD, 0L)
    fun lastHeartbeat(): Long = prefs.getLong(KEY_LAST_HEARTBEAT, 0L)
    fun recordHeartbeat(at: Long) { prefs.edit().putLong(KEY_LAST_HEARTBEAT, at).apply() }
    fun recordSuccessfulUpload(at: Long) { prefs.edit().putLong(KEY_LAST_UPLOAD, at).remove(KEY_LAST_ERROR).apply() }
    fun lastError(): String = prefs.getString(KEY_LAST_ERROR, "") ?: ""
    fun recordApiError(value: String) { prefs.edit().putString(KEY_LAST_ERROR, value.take(300)).apply() }

    companion object {
        private const val KEY_SERVER_URL = "server_url"
        private const val KEY_DEVICE_ID = "device_id"
        private const val KEY_BOOTSTRAP_TOKEN = "bootstrap_token"
        private const val KEY_DEVICE_TOKEN = "device_token"
        private const val KEY_PUSH_FID = "push_fid"
        private const val KEY_PUSH_TOKEN = "push_token"
        private const val KEY_LAST_UPLOAD = "last_upload"
        private const val KEY_LAST_HEARTBEAT = "last_heartbeat"
        private const val KEY_LAST_ERROR = "last_error"
    }
}
