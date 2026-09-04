package com.hermes.companion.privacy

/**
 * OH-45: conservative package-level defaults. Users may make PRIVATE apps more open,
 * but PROTECTED apps still require an explicit temporary grant.
 *
 * Scene-level password/OTP/payment detection is intentionally NOT claimed here.
 * Until a pre-upload local detector exists, package-level financial/auth apps stay protected.
 */
object AppSensitivityClassifier {
    private val protectedExact = setOf(
        "com.eg.android.AlipayGphone", // Alipay
        "com.unionpay",               // UnionPay app family exact legacy id
        "com.unionpay.tsmservice",    // UnionPay TSM
    )

    private val protectedTokens = listOf(
        ".bank",
        "bank.",
        ".banking",
        "banking.",
        ".wallet",
        "wallet.",
        ".payment",
        "payment.",
        ".authenticator",
        "authenticator.",
        ".password",
        "password.",
    )

    private val privateTokens = listOf(
        ".camera",
        "camera.",
        ".gallery",
        "gallery.",
        ".photos",
        "photos.",
        ".file",
        "file.",
        ".drive",
        "drive.",
        ".chat",
        "chat.",
        ".messaging",
        "messaging.",
    )

    fun classify(packageName: String): SensitivityClass {
        val normalized = packageName.trim().lowercase()
        if (normalized.isBlank()) return SensitivityClass.PRIVATE
        if (protectedExact.any { it.lowercase() == normalized } || protectedTokens.any(normalized::contains)) {
            return SensitivityClass.PROTECTED
        }
        if (privateTokens.any(normalized::contains)) return SensitivityClass.PRIVATE
        return SensitivityClass.NORMAL
    }
}
