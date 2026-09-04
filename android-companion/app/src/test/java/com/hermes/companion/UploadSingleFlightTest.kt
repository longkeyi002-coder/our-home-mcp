package com.hermes.companion

import com.hermes.companion.data.UploadSingleFlight
import java.util.concurrent.atomic.AtomicInteger
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.async
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals

class UploadSingleFlightTest {
    @Test
    fun overlappingUploadJobsNeverEnterCriticalSectionTogether() = runTest {
        val active = AtomicInteger(0)
        val maxActive = AtomicInteger(0)
        val firstEntered = CompletableDeferred<Unit>()
        val releaseFirst = CompletableDeferred<Unit>()

        val first = async {
            UploadSingleFlight.run {
                val now = active.incrementAndGet()
                maxActive.updateAndGet { maxOf(it, now) }
                firstEntered.complete(Unit)
                releaseFirst.await()
                active.decrementAndGet()
            }
        }
        firstEntered.await()

        val second = async {
            UploadSingleFlight.run {
                val now = active.incrementAndGet()
                maxActive.updateAndGet { maxOf(it, now) }
                active.decrementAndGet()
            }
        }

        releaseFirst.complete(Unit)
        first.await()
        second.await()
        assertEquals(1, maxActive.get())
    }
}
