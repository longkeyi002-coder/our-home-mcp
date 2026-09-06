package com.hermes.companion.privacy

/**
 * Persistent visual policy invariants.
 *
 * App observation now uses one binary user-controlled permission:
 * AUTO means enabled and NEVER means disabled. Legacy ASK_ONLY values from older builds
 * are treated as AUTO so upgrades do not keep prompting after the UI has moved to a
 * two-state enabled/disabled model. An unset policy is also enabled by default, matching
 * PresencePrivacyStore's default ALLOW behavior.
 *
 * Android secure-window and screen-state restrictions are enforced separately at capture time.
 */
object VisualPolicyRules {
    fun normalizePersistentPolicy(
        sensitivity: SensitivityClass,
        policy: VisualAppPolicy?,
    ): VisualAppPolicy =
        if (policy == VisualAppPolicy.NEVER) VisualAppPolicy.NEVER else VisualAppPolicy.AUTO

    fun requirePersistable(
        sensitivity: SensitivityClass,
        policy: VisualAppPolicy?,
    ) {
        // Binary model accepts the persisted value for migration compatibility.
        // Reading normalizes legacy ASK_ONLY/null to AUTO and preserves only NEVER as disabled.
    }
}
