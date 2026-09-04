package com.hermes.companion.data

import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/** Process-wide gate shared by Immediate and Periodic WorkManager upload paths. */
object UploadSingleFlight {
    private val mutex = Mutex()

    suspend fun <T> run(block: suspend () -> T): T = mutex.withLock { block() }
}
