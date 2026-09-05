package com.hermes.companion.privacy

import android.content.Context

class PresencePrivacyStore(context: Context) {
    private val prefs = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    /** Saved policies remain manageable even without a launcher entry. */
    fun configuredPackages(): Set<String> = prefs.all.keys
        .filter { it.startsWith("policy:") }
        .map { it.removePrefix("policy:") }
        .filter { it.isNotBlank() }
        .toSet()

    fun policyFor(packageName: String): PresenceAppPolicy {
        val stored = prefs.getString(policyKey(packageName), null)
            ?.let { runCatching { PresenceAppPolicy.valueOf(it) }.getOrNull() }
        return PresencePrivacyRules.effectivePolicy(stored)
    }

    fun exposesIdentity(packageName: String): Boolean =
        PresencePrivacyRules.exposesIdentity(policyFor(packageName))

    fun setPolicy(packageName: String, policy: PresenceAppPolicy) {
        require(packageName.isNotBlank()) { "presence privacy package is required" }
        prefs.edit().putString(policyKey(packageName), policy.name).apply()
    }

    companion object {
        private const val PREFS = "presence_privacy"
        private fun policyKey(packageName: String) = "policy:${packageName.trim()}"
    }
}

