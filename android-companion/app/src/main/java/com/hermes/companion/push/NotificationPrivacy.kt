package com.hermes.companion.push

enum class NotificationPrivacyMode(val storageValue: String) {
    FULL("full"),
    GENERIC("generic"),
    HIDE_ON_LOCK_SCREEN("hide_on_lock_screen");

    companion object {
        fun fromStorage(value: String?): NotificationPrivacyMode =
            entries.firstOrNull { it.storageValue == value } ?: HIDE_ON_LOCK_SCREEN
    }
}

enum class NotificationLockScreenVisibility {
    PUBLIC,
    PRIVATE,
}

data class NotificationPresentation(
    val title: String,
    val body: String,
    val lockScreenVisibility: NotificationLockScreenVisibility,
    val publicTitle: String? = null,
    val publicBody: String? = null,
)

object NotificationPrivacyPolicy {
    const val GENERIC_TITLE = "Our Home"
    const val GENERIC_BODY = "哥哥给你发了一条消息"

    fun present(
        mode: NotificationPrivacyMode,
        title: String,
        body: String,
    ): NotificationPresentation = when (mode) {
        NotificationPrivacyMode.FULL -> NotificationPresentation(
            title = title,
            body = body,
            lockScreenVisibility = NotificationLockScreenVisibility.PUBLIC,
        )
        NotificationPrivacyMode.GENERIC -> NotificationPresentation(
            title = GENERIC_TITLE,
            body = GENERIC_BODY,
            lockScreenVisibility = NotificationLockScreenVisibility.PUBLIC,
        )
        NotificationPrivacyMode.HIDE_ON_LOCK_SCREEN -> NotificationPresentation(
            title = title,
            body = body,
            lockScreenVisibility = NotificationLockScreenVisibility.PRIVATE,
            publicTitle = GENERIC_TITLE,
            publicBody = GENERIC_BODY,
        )
    }
}

/**
 * Bounded receipt memory for already-rendered proactive candidates.
 * FCM retries can occasionally redeliver the same data message after a network
 * ambiguity. Keeping a small recent window prevents the user seeing the same
 * proactive message again after dismissing or opening the first notification.
 */
object NotificationReceiptWindow {
    const val MAX_RECEIPTS = 64

    fun contains(serialized: String?, candidateId: String): Boolean {
        val normalized = candidateId.trim()
        if (normalized.isEmpty()) return false
        return parse(serialized).contains(normalized)
    }

    fun record(serialized: String?, candidateId: String): String {
        val normalized = candidateId.trim()
        if (normalized.isEmpty()) return serialized.orEmpty()
        val next = parse(serialized).filterNot { it == normalized } + normalized
        return next.takeLast(MAX_RECEIPTS).joinToString("\n")
    }

    private fun parse(serialized: String?): List<String> =
        serialized.orEmpty()
            .lineSequence()
            .map(String::trim)
            .filter(String::isNotEmpty)
            .toList()
}
