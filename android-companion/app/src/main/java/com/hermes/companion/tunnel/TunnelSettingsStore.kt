package com.hermes.companion.tunnel

import android.content.Context
import com.hermes.companion.data.SecureTokenStore

internal data class TunnelConfiguration(
    val relayUrl: String,
    val token: String,
)

/** User-owned reverse-tunnel configuration. The relay token is kept in Android Keystore-backed storage. */
internal class TunnelSettingsStore(context: Context) {
    private val appContext = context.applicationContext
    private val prefs = appContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    private val secure = SecureTokenStore(appContext)

    fun enabled(): Boolean = prefs.getBoolean(KEY_ENABLED, false)

    fun relayUrl(): String = prefs.getString(KEY_RELAY_URL, "").orEmpty()

    fun hasToken(): Boolean = !secure.get(KEY_TOKEN).isNullOrBlank()

    fun configuration(): TunnelConfiguration? {
        val relay = relayUrl()
        val token = secure.get(KEY_TOKEN)?.trim().orEmpty()
        if (token.isBlank() || !TunnelEndpointPolicy.isAllowedRelayUrl(relay)) return null
        return TunnelConfiguration(relay, token)
    }

    fun saveConfiguration(relayUrl: String, token: String) {
        val normalizedRelay = TunnelEndpointPolicy.normalizeRelayUrl(relayUrl)
        val normalizedToken = token.trim()
        require(normalizedToken.isNotEmpty()) { "Tunnel token is required" }
        prefs.edit().putString(KEY_RELAY_URL, normalizedRelay).apply()
        secure.put(KEY_TOKEN, normalizedToken)
    }

    fun clearToken() {
        secure.put(KEY_TOKEN, null)
        setEnabled(false)
    }

    fun setEnabled(value: Boolean) {
        if (value) require(configuration() != null) { "Valid tunnel configuration is required" }
        prefs.edit().putBoolean(KEY_ENABLED, value).apply()
        if (!value) recordState(STATE_DISABLED)
    }

    fun connectionState(): String = prefs.getString(KEY_CONNECTION_STATE, STATE_DISABLED) ?: STATE_DISABLED

    fun lastConnectedAt(): Long = prefs.getLong(KEY_LAST_CONNECTED_AT, 0L)

    fun lastErrorCode(): String = prefs.getString(KEY_LAST_ERROR_CODE, "").orEmpty()

    fun lastMcpRequestAt(): Long = prefs.getLong(KEY_LAST_MCP_REQUEST_AT, 0L)

    fun lastServedTool(): String = prefs.getString(KEY_LAST_SERVED_TOOL, "").orEmpty()

    fun recordConnecting() = recordState(STATE_CONNECTING)

    fun recordConnected(at: Long = System.currentTimeMillis()) {
        prefs.edit()
            .putString(KEY_CONNECTION_STATE, STATE_CONNECTED)
            .putLong(KEY_LAST_CONNECTED_AT, at)
            .remove(KEY_LAST_ERROR_CODE)
            .apply()
    }

    fun recordDisconnected(errorCode: String? = null) {
        val edit = prefs.edit().putString(KEY_CONNECTION_STATE, STATE_DISCONNECTED)
        if (errorCode.isNullOrBlank()) edit.remove(KEY_LAST_ERROR_CODE)
        else edit.putString(KEY_LAST_ERROR_CODE, errorCode.take(80))
        edit.apply()
    }

    fun recordError(errorCode: String) {
        prefs.edit()
            .putString(KEY_CONNECTION_STATE, STATE_ERROR)
            .putString(KEY_LAST_ERROR_CODE, errorCode.take(80))
            .apply()
    }

    fun recordMcpToolServed(toolName: String, at: Long = System.currentTimeMillis()) {
        prefs.edit()
            .putLong(KEY_LAST_MCP_REQUEST_AT, at)
            .putString(KEY_LAST_SERVED_TOOL, toolName.take(80))
            .apply()
    }

    private fun recordState(value: String) {
        prefs.edit()
            .putString(KEY_CONNECTION_STATE, value)
            .remove(KEY_LAST_ERROR_CODE)
            .apply()
    }

    companion object {
        const val STATE_DISABLED = "disabled"
        const val STATE_CONNECTING = "connecting"
        const val STATE_CONNECTED = "connected"
        const val STATE_DISCONNECTED = "disconnected"
        const val STATE_ERROR = "error"

        private const val PREFS = "reverse_tunnel"
        private const val KEY_ENABLED = "enabled"
        private const val KEY_RELAY_URL = "relay_url"
        private const val KEY_TOKEN = "reverse_tunnel_token"
        private const val KEY_CONNECTION_STATE = "connection_state"
        private const val KEY_LAST_CONNECTED_AT = "last_connected_at"
        private const val KEY_LAST_ERROR_CODE = "last_error_code"
        private const val KEY_LAST_MCP_REQUEST_AT = "last_mcp_request_at"
        private const val KEY_LAST_SERVED_TOOL = "last_served_tool"
    }
}
