package com.hermes.companion

import com.hermes.companion.vision.ObservationStatusMode
import com.hermes.companion.vision.PromotedObservationPolicy
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PromotedObservationPolicyTest {
    @Test
    fun onlyActualObservationRequestsPromotion() {
        assertTrue(PromotedObservationPolicy.shouldRequestPromotion(ObservationStatusMode.OBSERVING))
        assertFalse(PromotedObservationPolicy.shouldRequestPromotion(ObservationStatusMode.AI_COMING))
        assertFalse(PromotedObservationPolicy.shouldRequestPromotion(ObservationStatusMode.SENSING))
        assertFalse(PromotedObservationPolicy.shouldRequestPromotion(ObservationStatusMode.PRIVATE_APP))
        assertFalse(PromotedObservationPolicy.shouldRequestPromotion(ObservationStatusMode.LOCKED))
        assertFalse(PromotedObservationPolicy.shouldRequestPromotion(ObservationStatusMode.SCREEN_OFF))
        assertFalse(PromotedObservationPolicy.shouldRequestPromotion(ObservationStatusMode.DISCONNECTED))
    }
}
