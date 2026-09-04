package com.hermes.companion.privacy

/**
 * OH-45: fail-closed package-level defaults.
 *
 * An unrecognized package is PRIVATE, not NORMAL. Automatic visual observation is only
 * possible after the user explicitly marks that app AUTO (or after a future reviewed
 * low-sensitivity allowlist classifies it NORMAL). This prevents novel banking/payment/
 * identity apps from becoming screenshot-eligible just because their package name lacks
 * an obvious keyword.
 *
 * Scene-level password/OTP/payment detection is intentionally NOT claimed here.
 * Until a reliable pre-upload local scene detector exists, known financial/auth apps stay
 * PROTECTED and browsers/private-content apps stay PRIVATE.
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
        "mobilebank",
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

    private val privateExact = setOf(
        "com.android.chrome",
        "com.sec.android.app.sbrowser",
        "org.mozilla.firefox",
        "com.microsoft.emmx",
        "com.opera.browser",
        "com.brave.browser",
        "com.kiwibrowser.browser",
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
        ".browser",
        "browser.",
    )

    fun classify(packageName: String): SensitivityClass {
        val normalized = packageName.trim().lowercase()
        if (normalized.isBlank()) return SensitivityClass.PRIVATE
        if (protectedExact.any { it.lowercase() == normalized } || protectedTokens.any(normalized::contains)) {
            return SensitivityClass.PROTECTED
        }
        if (privateExact.any { it.lowercase() == normalized } || privateTokens.any(normalized::contains)) {
            return SensitivityClass.PRIVATE
        }
        return SensitivityClass.PRIVATE
    }
}
