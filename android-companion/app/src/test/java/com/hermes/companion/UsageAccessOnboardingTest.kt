package com.hermes.companion

import org.junit.Test
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class UsageAccessOnboardingTest {
    @Test
    fun missingAccessIsGuidedOnlyOnceAndTheAttemptIsPersisted() {
        val state = FakeState()

        assertTrue(UsageAccessOnboarding(state).consumeInitialGuide(hasUsageAccess = false))
        assertTrue(state.shown)

        // Simulates Activity recreation or a return from Settings without granting access.
        assertFalse(UsageAccessOnboarding(state).consumeInitialGuide(hasUsageAccess = false))
    }

    @Test
    fun grantedAccessNeverStartsTheGuide() {
        val state = FakeState()

        assertFalse(UsageAccessOnboarding(state).consumeInitialGuide(hasUsageAccess = true))
        assertFalse(state.shown)
    }

    private class FakeState(var shown: Boolean = false) : UsageAccessOnboarding.State {
        override fun hasShownUsageAccessGuide(): Boolean = shown
        override fun markUsageAccessGuideShown() { shown = true }
    }
}
