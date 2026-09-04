package com.hermes.companion.privacy

import android.content.Context
import java.util.UUID

class VisualPrivacyStore(context: Context) {
    private val prefs = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun policyFor(packageName: String): VisualAppPolicy? {
        val stored = prefs.getString(policyKey(packageName), null)
            ?.let { runCatching { VisualAppPolicy.valueOf(it) }.getOrNull() }
        return VisualPolicyRules.normalizePersistentPolicy(
            sensitivity = AppSensitivityClassifier.classify(packageName),
            policy = stored,
        )
    }

    fun setPolicy(packageName: String, policy: VisualAppPolicy?) {
        VisualPolicyRules.requirePersistable(
            sensitivity = AppSensitivityClassifier.classify(packageName),
            policy = policy,
        )
        val edit = prefs.edit()
        if (policy == null) edit.remove(policyKey(packageName)) else edit.putString(policyKey(packageName), policy.name)
        edit.apply()
    }

    fun armOneTimeGrant(
        packageName: String,
        nowMs: Long,
        ttlMs: Long = MAX_TEMPORARY_GRANT_MS,
    ): ArmedVisualGrant {
        require(packageName.isNotBlank()) { "temporary visual grant package is required" }
        require(ttlMs in 1..MAX_TEMPORARY_GRANT_MS) { "temporary visual grant ttl out of range" }
        val grant = ArmedVisualGrant(
            packageName = packageName,
            issuedAtMs = nowMs,
            expiresAtMs = nowMs + ttlMs,
        )
        prefs.edit()
            .putString(KEY_ARMED_PACKAGE, grant.packageName)
            .putLong(KEY_ARMED_ISSUED_AT, grant.issuedAtMs)
            .putLong(KEY_ARMED_EXPIRES_AT, grant.expiresAtMs)
            .apply()
        return grant
    }

    fun armedGrant(): ArmedVisualGrant? {
        val packageName = prefs.getString(KEY_ARMED_PACKAGE, null) ?: return null
        val issuedAt = prefs.getLong(KEY_ARMED_ISSUED_AT, 0L)
        val expiresAt = prefs.getLong(KEY_ARMED_EXPIRES_AT, 0L)
        if (issuedAt <= 0L || expiresAt <= issuedAt) return null
        return ArmedVisualGrant(packageName, issuedAt, expiresAt)
    }

    fun bindArmedGrantToSession(packageName: String, sessionId: String, nowMs: Long): TemporaryVisualGrant? {
        val armed = armedGrant() ?: return null
        if (!armed.isUsable(packageName, nowMs)) return null
        val remaining = armed.expiresAtMs - nowMs
        if (remaining <= 0L) {
            clearArmedGrant()
            return null
        }
        val grant = issueTemporaryGrant(
            packageName = packageName,
            nowMs = nowMs,
            ttlMs = remaining.coerceAtMost(MAX_TEMPORARY_GRANT_MS),
            sessionId = sessionId,
        )
        clearArmedGrant()
        return grant
    }

    fun clearArmedGrant() {
        prefs.edit()
            .remove(KEY_ARMED_PACKAGE)
            .remove(KEY_ARMED_ISSUED_AT)
            .remove(KEY_ARMED_EXPIRES_AT)
            .apply()
    }

    fun issueTemporaryGrant(packageName: String, nowMs: Long, ttlMs: Long, sessionId: String = UUID.randomUUID().toString()): TemporaryVisualGrant {
        require(ttlMs in 1..MAX_TEMPORARY_GRANT_MS) { "temporary visual grant ttl out of range" }
        val grant = TemporaryVisualGrant(
            packageName = packageName,
            issuedAtMs = nowMs,
            expiresAtMs = nowMs + ttlMs,
            sessionId = sessionId,
        )
        prefs.edit()
            .putString(KEY_GRANT_PACKAGE, grant.packageName)
            .putLong(KEY_GRANT_ISSUED_AT, grant.issuedAtMs)
            .putLong(KEY_GRANT_EXPIRES_AT, grant.expiresAtMs)
            .putString(KEY_GRANT_SESSION_ID, grant.sessionId)
            .putBoolean(KEY_GRANT_CONSUMED, false)
            .apply()
        return grant
    }

    fun temporaryGrant(): TemporaryVisualGrant? {
        val packageName = prefs.getString(KEY_GRANT_PACKAGE, null) ?: return null
        val sessionId = prefs.getString(KEY_GRANT_SESSION_ID, null) ?: return null
        val issuedAt = prefs.getLong(KEY_GRANT_ISSUED_AT, 0L)
        val expiresAt = prefs.getLong(KEY_GRANT_EXPIRES_AT, 0L)
        if (issuedAt <= 0L || expiresAt <= issuedAt) return null
        return TemporaryVisualGrant(
            packageName = packageName,
            issuedAtMs = issuedAt,
            expiresAtMs = expiresAt,
            sessionId = sessionId,
            consumed = prefs.getBoolean(KEY_GRANT_CONSUMED, false),
        )
    }

    fun consumeTemporaryGrant() {
        if (temporaryGrant() != null) prefs.edit().putBoolean(KEY_GRANT_CONSUMED, true).apply()
    }

    fun clearTemporaryGrant() {
        prefs.edit()
            .remove(KEY_GRANT_PACKAGE)
            .remove(KEY_GRANT_ISSUED_AT)
            .remove(KEY_GRANT_EXPIRES_AT)
            .remove(KEY_GRANT_SESSION_ID)
            .remove(KEY_GRANT_CONSUMED)
            .apply()
    }

    fun invalidateGrantForPackageChange(newPackageName: String?) {
        val grant = temporaryGrant() ?: return
        if (newPackageName == null || newPackageName != grant.packageName) clearTemporaryGrant()
    }

    fun invalidateGrantForLock() {
        clearTemporaryGrant()
        clearArmedGrant()
    }

    fun pruneExpiredGrant(nowMs: Long) {
        val grant = temporaryGrant()
        if (grant != null && (nowMs >= grant.expiresAtMs || grant.consumed)) clearTemporaryGrant()
        val armed = armedGrant()
        if (armed != null && nowMs >= armed.expiresAtMs) clearArmedGrant()
    }

    companion object {
        const val MAX_TEMPORARY_GRANT_MS = 10 * 60 * 1000L
        const val DEFAULT_TEMPORARY_GRANT_MS = 3 * 60 * 1000L
        private const val PREFS = "visual_privacy"
        private const val KEY_GRANT_PACKAGE = "grant_package"
        private const val KEY_GRANT_ISSUED_AT = "grant_issued_at"
        private const val KEY_GRANT_EXPIRES_AT = "grant_expires_at"
        private const val KEY_GRANT_SESSION_ID = "grant_session_id"
        private const val KEY_GRANT_CONSUMED = "grant_consumed"
        private const val KEY_ARMED_PACKAGE = "armed_package"
        private const val KEY_ARMED_ISSUED_AT = "armed_issued_at"
        private const val KEY_ARMED_EXPIRES_AT = "armed_expires_at"
        private fun policyKey(packageName: String) = "policy:${packageName.trim()}"
    }
}
