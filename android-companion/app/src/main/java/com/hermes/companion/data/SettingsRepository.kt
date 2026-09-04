package com.hermes.companion.data

import android.content.Context
import com.hermes.companion.UsageAccessOnboarding
import java.util.UUID

class SettingsRepository(context: Context) : UsageAccessOnboarding.State {
    internal val context = context.applicationContext
    private val prefs = context.getSharedPreferences("companion_settings", Context.MODE_PRIVATE)
    private val secure = SecureTokenStore(context)

    fun serverUrl(): String = prefs.getString(KEY_SERVER_URL, DEFAULT_SERVER_URL) ?: DEFAULT_SERVER_URL
    fun saveServerUrl(value: String) {
        val normalized = value.trim()
        if (TelemetryPolicy.shouldInvalidateDeviceToken(serverUrl(), normalized)) {
            secure.put(KEY_DEVICE_TOKEN, null)
        }
        prefs.edit().putString(KEY_SERVER_URL, normalized).apply()
    }
    fun deviceId(): String = prefs.getString(KEY_DEVICE_ID, null) ?: "android-${UUID.randomUUID()}".also { prefs.edit().putString(KEY_DEVICE_ID, it).apply() }
    fun bootstrapToken(): String? = secure.get(KEY_BOOTSTRAP_TOKEN)
    fun hasBootstrapToken(): Boolean = !bootstrapToken().isNullOrBlank()
    fun saveBootstrapToken(value: String) {
        val normalized = value.trim()
        if (normalized.isBlank()) return
        if (normalized != secure.get(KEY_BOOTSTRAP_TOKEN)) secure.put(KEY_DEVICE_TOKEN, null)
        secure.put(KEY_BOOTSTRAP_TOKEN, normalized)
    }
    fun deviceToken(): String? = secure.get(KEY_DEVICE_TOKEN)
    fun hasDeviceToken(): Boolean = !deviceToken().isNullOrBlank()
    fun saveDeviceToken(value: String) = secure.put(KEY_DEVICE_TOKEN, value)
    fun clearDeviceToken() = secure.put(KEY_DEVICE_TOKEN, null)
    fun pushFid(): String? = secure.get(KEY_PUSH_FID)
    fun pushToken(): String? = secure.get(KEY_PUSH_TOKEN)
    fun savePushAddress(fid: String?, token: String) {
        secure.put(KEY_PUSH_FID, fid)
        secure.put(KEY_PUSH_TOKEN, token)
    }

    fun pushRegistrationState(): String = prefs.getString(KEY_PUSH_STATE, PUSH_NEVER) ?: PUSH_NEVER
    fun lastPushRegistrationAttempt(): Long = prefs.getLong(KEY_LAST_PUSH_ATTEMPT, 0L)
    fun lastPushRegistrationSuccess(): Long = prefs.getLong(KEY_LAST_PUSH_SUCCESS, 0L)
    fun lastPushRegistrationError(): String = prefs.getString(KEY_LAST_PUSH_ERROR, "") ?: ""
    fun recordPushRegistrationScheduled() {
        prefs.edit().putString(KEY_PUSH_STATE, PUSH_SCHEDULED).apply()
    }
    fun recordPushRegistrationAttempt(at: Long = System.currentTimeMillis()) {
        prefs.edit()
            .putString(KEY_PUSH_STATE, PUSH_REGISTERING)
            .putLong(KEY_LAST_PUSH_ATTEMPT, at)
            .remove(KEY_LAST_PUSH_ERROR)
            .apply()
    }
    fun recordPushRegistrationSuccess(at: Long = System.currentTimeMillis()) {
        prefs.edit()
            .putString(KEY_PUSH_STATE, PUSH_REGISTERED)
            .putLong(KEY_LAST_PUSH_SUCCESS, at)
            .remove(KEY_LAST_PUSH_ERROR)
            .apply()
    }
    fun recordPushRegistrationError(value: String) {
        prefs.edit()
            .putString(KEY_PUSH_STATE, PUSH_ERROR)
            .putString(KEY_LAST_PUSH_ERROR, value.take(300))
            .apply()
    }

    fun lastSuccessfulUpload(): Long = prefs.getLong(KEY_LAST_SUCCESSFUL_UPLOAD, prefs.getLong(KEY_LAST_UPLOAD_LEGACY, 0L))
    fun lastUpload(): Long = lastSuccessfulUpload()
    fun lastManualHeartbeat(): Long = prefs.getLong(KEY_LAST_MANUAL_HEARTBEAT, prefs.getLong(KEY_LAST_HEARTBEAT_LEGACY, 0L))
    fun lastHeartbeat(): Long = lastManualHeartbeat()
    fun lastPeriodicCollection(): Long = prefs.getLong(KEY_LAST_PERIODIC_COLLECTION, 0L)
    fun lastWorkerRun(): Long = prefs.getLong(KEY_LAST_WORKER_RUN, 0L)
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
    fun recordWorkerRun(at: Long) {
        prefs.edit().putLong(KEY_LAST_WORKER_RUN, at).apply()
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
    fun clearApiError() { prefs.edit().remove(KEY_LAST_ERROR).apply() }
    override fun hasShownUsageAccessGuide(): Boolean = prefs.getBoolean(KEY_USAGE_ACCESS_GUIDE_SHOWN, false)
    override fun markUsageAccessGuideShown() { prefs.edit().putBoolean(KEY_USAGE_ACCESS_GUIDE_SHOWN, true).apply() }

    companion object {
        const val DEFAULT_SERVER_URL = "https://api.yeqingxu.cyou"
        const val PUSH_NEVER = "never"
        const val PUSH_SCHEDULED = "scheduled"
        const val PUSH_REGISTERING = "registering"
        const val PUSH_REGISTERED = "registered"
        const val PUSH_ERROR = "error"
        private const val KEY_SERVER_URL = "server_url"
        private const val KEY_DEVICE_ID = "device_id"
        private const val KEY_BOOTSTRAP_TOKEN = "bootstrap_token"
        private const val KEY_DEVICE_TOKEN = "device_token"
        private const val KEY_PUSH_FID = "push_fid"
        private const val KEY_PUSH_TOKEN = "push_token"
        private const val KEY_PUSH_STATE = "push_registration_state"
        private const val KEY_LAST_PUSH_ATTEMPT = "last_push_registration_attempt"
        private const val KEY_LAST_PUSH_SUCCESS = "last_push_registration_success"
        private const val KEY_LAST_PUSH_ERROR = "last_push_registration_error"
        private const val KEY_LAST_SUCCESSFUL_UPLOAD = "last_successful_upload"
        private const val KEY_LAST_MANUAL_HEARTBEAT = "last_manual_heartbeat"
        private const val KEY_LAST_PERIODIC_COLLECTION = "last_periodic_collection"
        private const val KEY_LAST_WORKER_RUN = "last_worker_run"
        private const val KEY_LAST_UPLOAD_LEGACY = "last_upload"
        private const val KEY_LAST_HEARTBEAT_LEGACY = "last_heartbeat"
        private const val KEY_LAST_ERROR = "last_error"
        private const val KEY_USAGE_ACCESS_GUIDE_SHOWN = "usage_access_guide_shown"
    }
}
