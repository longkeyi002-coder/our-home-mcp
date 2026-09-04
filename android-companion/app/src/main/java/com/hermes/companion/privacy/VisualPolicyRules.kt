package com.hermes.companion.privacy

/**
 * Persistent visual policy invariants. PROTECTED apps may never receive a durable AUTO grant.
 * A legacy/invalid AUTO value is interpreted conservatively as ASK_ONLY.
 */
object VisualPolicyRules {
    fun normalizePersistentPolicy(
        sensitivity: SensitivityClass,
        policy: VisualAppPolicy?,
    ): VisualAppPolicy? =
        if (sensitivity == SensitivityClass.PROTECTED && policy == VisualAppPolicy.AUTO) {
            VisualAppPolicy.ASK_ONLY
        } else {
            policy
        }

    fun requirePersistable(
        sensitivity: SensitivityClass,
        policy: VisualAppPolicy?,
    ) {
        require(!(sensitivity == SensitivityClass.PROTECTED && policy == VisualAppPolicy.AUTO)) {
            "protected apps cannot be granted persistent AUTO visual access"
        }
    }
}
