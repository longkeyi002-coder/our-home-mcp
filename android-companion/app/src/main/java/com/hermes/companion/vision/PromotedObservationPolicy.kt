package com.hermes.companion.vision

/**
 * Short-lived promoted/live notification policy for actual screenshot activity.
 * Presence sensing itself must never request promotion; only real visual observation does.
 */
object PromotedObservationPolicy {
    fun shouldRequestPromotion(mode: ObservationStatusMode): Boolean =
        mode == ObservationStatusMode.OBSERVING
}
