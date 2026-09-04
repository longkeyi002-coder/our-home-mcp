package com.hermes.companion.privacy

/**
 * OH-45: privacy preference is user-configurable, but system safety always wins.
 */
enum class VisualAppPolicy {
    AUTO,
    ASK_ONLY,
    NEVER,
}

enum class SensitivityClass {
    NORMAL,
    PRIVATE,
    PROTECTED,
}

data class ArmedVisualGrant(
    val packageName: String,
    val issuedAtMs: Long,
    val expiresAtMs: Long,
) {
    fun isUsable(packageName: String, nowMs: Long): Boolean =
        this.packageName == packageName && nowMs in issuedAtMs until expiresAtMs
}

data class TemporaryVisualGrant(
    val packageName: String,
    val issuedAtMs: Long,
    val expiresAtMs: Long,
    val sessionId: String,
    val consumed: Boolean = false,
) {
    fun isUsable(packageName: String, sessionId: String, nowMs: Long): Boolean =
        !consumed &&
            this.packageName == packageName &&
            this.sessionId == sessionId &&
            nowMs in issuedAtMs until expiresAtMs
}

enum class VisualDecisionReason {
    ALLOWED_NORMAL,
    ALLOWED_USER_AUTO,
    ALLOWED_TEMPORARY_GRANT,
    USER_NEVER,
    PRIVATE_REQUIRES_CONSENT,
    PROTECTED_REQUIRES_TEMPORARY_GRANT,
    SCREEN_NOT_USABLE,
    SECURE_WINDOW,
}

data class VisualDecision(
    val allowed: Boolean,
    val reason: VisualDecisionReason,
    val consumeTemporaryGrant: Boolean = false,
)

data class VisualRequestContext(
    val packageName: String,
    val sensitivity: SensitivityClass,
    val userPolicy: VisualAppPolicy?,
    val screenUsable: Boolean,
    val secureWindow: Boolean,
    val sessionId: String,
    val nowMs: Long,
    val temporaryGrant: TemporaryVisualGrant? = null,
)

object SensitiveVisualGuard {
    fun decide(value: VisualRequestContext): VisualDecision {
        // System restrictions are absolute. A user grant never bypasses a secure window.
        if (!value.screenUsable) return VisualDecision(false, VisualDecisionReason.SCREEN_NOT_USABLE)
        if (value.secureWindow) return VisualDecision(false, VisualDecisionReason.SECURE_WINDOW)

        // User's explicit NEVER always wins, including over temporary grant mistakes.
        if (value.userPolicy == VisualAppPolicy.NEVER) {
            return VisualDecision(false, VisualDecisionReason.USER_NEVER)
        }

        val grantUsable = value.temporaryGrant?.isUsable(
            packageName = value.packageName,
            sessionId = value.sessionId,
            nowMs = value.nowMs,
        ) == true

        if (value.sensitivity == SensitivityClass.PROTECTED) {
            return if (grantUsable) {
                VisualDecision(true, VisualDecisionReason.ALLOWED_TEMPORARY_GRANT, consumeTemporaryGrant = true)
            } else {
                VisualDecision(false, VisualDecisionReason.PROTECTED_REQUIRES_TEMPORARY_GRANT)
            }
        }

        if (value.userPolicy == VisualAppPolicy.AUTO) {
            return VisualDecision(true, VisualDecisionReason.ALLOWED_USER_AUTO)
        }

        if (grantUsable) {
            return VisualDecision(true, VisualDecisionReason.ALLOWED_TEMPORARY_GRANT, consumeTemporaryGrant = true)
        }

        if (value.sensitivity == SensitivityClass.PRIVATE || value.userPolicy == VisualAppPolicy.ASK_ONLY) {
            return VisualDecision(false, VisualDecisionReason.PRIVATE_REQUIRES_CONSENT)
        }

        return VisualDecision(true, VisualDecisionReason.ALLOWED_NORMAL)
    }
}
