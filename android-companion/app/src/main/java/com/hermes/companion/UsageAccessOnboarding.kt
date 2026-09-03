package com.hermes.companion

/**
 * Decides whether the app may automatically open Usage Access settings.
 *
 * The attempt is recorded before launching Settings, so returning without granting the
 * permission (or an Activity recreation) cannot cause a launch loop.
 */
class UsageAccessOnboarding(private val state: State) {
    interface State {
        fun hasShownUsageAccessGuide(): Boolean
        fun markUsageAccessGuideShown()
    }

    fun consumeInitialGuide(hasUsageAccess: Boolean): Boolean {
        if (hasUsageAccess || state.hasShownUsageAccessGuide()) return false
        state.markUsageAccessGuideShown()
        return true
    }
}
