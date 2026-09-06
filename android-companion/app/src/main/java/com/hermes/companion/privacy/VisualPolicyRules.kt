package com.hermes.companion.privacy

/**
 * Persistent visual policy invariants.
 *
 * App observation now uses a binary user-controlled permission model:
 * AUTO means enabled and NEVER means disabled. AppSensitivityClassifier may describe
 * an App, but it must not silently downgrade the user's durable permission.
 * Android secure-window and screen-state restrictions are enforced separately at capture time.
 */
object VisualPolicyRules {
    fun normalizePersistentPolicy(
        sensitivity: SensitivityClass,
        policy: VisualAppPolicy?,
    ): VisualAppPolicy? = policy

    fun requirePersistable(
        sensitivity: SensitivityClass,
        policy: VisualAppPolicy?,
    ) {
        // All persistent policies are valid. System-level screenshot restrictions are
        // enforced by capture preflight/AccessibilityService rather than by App category.
    }
}
