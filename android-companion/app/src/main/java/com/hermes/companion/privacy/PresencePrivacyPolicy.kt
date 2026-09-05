package com.hermes.companion.privacy

/**
 * OH-41/OH-42: controls whether a foreground App identity may leave the Android device.
 * This is intentionally independent from visual-observation and action permissions.
 */
enum class PresenceAppPolicy {
    ALLOW,
    HIDE_IDENTITY,
}

object PresencePrivacyRules {
    fun effectivePolicy(stored: PresenceAppPolicy?): PresenceAppPolicy = stored ?: PresenceAppPolicy.ALLOW

    fun exposesIdentity(policy: PresenceAppPolicy?): Boolean =
        effectivePolicy(policy) == PresenceAppPolicy.ALLOW

    fun exposedPackage(packageName: String?, policy: PresenceAppPolicy?): String? =
        packageName?.takeIf { it.isNotBlank() && exposesIdentity(policy) }

    fun visualObservationAllowed(policy: PresenceAppPolicy?): Boolean = exposesIdentity(policy)
}
