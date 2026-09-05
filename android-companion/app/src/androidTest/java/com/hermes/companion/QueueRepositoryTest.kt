package com.hermes.companion

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.hermes.companion.data.ApiAck
import com.hermes.companion.data.AppDatabase
import com.hermes.companion.data.HeartbeatRequest
import com.hermes.companion.data.HealthResponse
import com.hermes.companion.data.HermesApi
import com.hermes.companion.data.QueueRepository
import com.hermes.companion.data.RegisterRequest
import com.hermes.companion.data.RegisterResponse
import com.hermes.companion.data.SettingsRepository
import com.hermes.companion.data.VisualRequestAck
import com.hermes.companion.platform.UsageTimelineSummary
import com.hermes.companion.platform.UsageSession
import java.io.IOException
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import kotlin.test.assertEquals

@RunWith(AndroidJUnit4::class)
class QueueRepositoryTest {
    private lateinit var database: AppDatabase

    @Before
    fun setUp() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        database = Room.inMemoryDatabaseBuilder(context, AppDatabase::class.java).build()
    }

    @After
    fun tearDown() { database.close() }

    @Test
    fun failedUploadKeepsEvent() = runBlocking {
        val settings = SettingsRepository(ApplicationProvider.getApplicationContext())
        settings.saveServerUrl("https://example.com")
        settings.saveBootstrapToken("bootstrap")
        val api = failingApi()
        val repository = QueueRepository.forTest(database.pendingEventDao(), settings) { api }
        repository.enqueueHeartbeat(sampleHeartbeat())
        val result = repository.uploadPending()
        assertEquals(0, result.uploaded)
        assertEquals(1, database.pendingEventDao().count())
    }

    @Test
    fun successfulAckDeletesEvent() = runBlocking {
        val settings = SettingsRepository(ApplicationProvider.getApplicationContext())
        settings.saveServerUrl("https://example.com")
        settings.saveBootstrapToken("bootstrap")
        val repository = QueueRepository.forTest(database.pendingEventDao(), settings, { successfulApi() })
        repository.enqueueHeartbeat(sampleHeartbeat())
        val result = repository.uploadPending()
        assertEquals(1, result.uploaded)
        assertEquals(0, database.pendingEventDao().count())
    }

    @Test
    fun usageSummaryIsDeduplicatedByStableEventId() = runBlocking {
        val settings = SettingsRepository(ApplicationProvider.getApplicationContext())
        settings.saveServerUrl("https://example.com")
        settings.saveBootstrapToken("bootstrap")
        val repository = QueueRepository.forTest(database.pendingEventDao(), settings) { successfulApi() }
        val summary = UsageTimelineSummary(
            observedAt = 1_700_000_000_000,
            currentPackageName = "com.example.app",
            currentDurationMs = 5_000,
            sessions = listOf(UsageSession("com.example.app", 1_699_999_995_000, null, 5_000, "other")),
            appTotalsMs = mapOf("com.example.app" to 5_000),
            categoryTotalsMs = mapOf("other" to 5_000),
        )

        repository.enqueueUsageSummary(summary, "android-test", scheduleUpload = false)
        repository.enqueueUsageSummary(summary, "android-test", scheduleUpload = false)
        assertEquals(1, database.pendingEventDao().count())
    }

    @Test
    fun periodicHeartbeatIsDeduplicatedByStableEventId() = runBlocking {
        val settings = SettingsRepository(ApplicationProvider.getApplicationContext())
        settings.saveServerUrl("https://example.com")
        settings.saveBootstrapToken("bootstrap")
        val request = sampleHeartbeat().copy(clientEventId = "periodic-heartbeat:android-test:42")
        val repository = QueueRepository.forTest(database.pendingEventDao(), settings) { successfulApi() }

        repository.enqueueHeartbeat(request, scheduleUpload = false)
        repository.enqueueHeartbeat(request, scheduleUpload = false)

        assertEquals(1, database.pendingEventDao().count())
    }

    @Test
    fun pendingBrainVisualDecisionSchedulesOnlyOnePollPerUploadCycle() = runBlocking {
        val settings = SettingsRepository(ApplicationProvider.getApplicationContext())
        settings.saveServerUrl("https://example.com")
        settings.saveBootstrapToken("bootstrap")
        var pollCount = 0
        val repository = QueueRepository.forTest(
            dao = database.pendingEventDao(),
            settings = settings,
            apiFactory = { successfulApi(ApiAck("phone-ingest", visualDecisionPending = true)) },
            visualDecisionPoller = { pollCount += 1 },
        )

        repository.enqueueHeartbeat(sampleHeartbeat().copy(clientEventId = "visual-pending-1"), scheduleUpload = false)
        repository.enqueueHeartbeat(sampleHeartbeat().copy(clientEventId = "visual-pending-2"), scheduleUpload = false)
        val result = repository.uploadPending()

        assertEquals(2, result.uploaded)
        assertEquals(1, pollCount)
        assertEquals(0, database.pendingEventDao().count())
    }

    @Test
    fun approvedVisualRequestEnqueuesCaptureAndDoesNotScheduleAnotherPoll() = runBlocking {
        val settings = SettingsRepository(ApplicationProvider.getApplicationContext())
        settings.saveServerUrl("https://example.com")
        settings.saveBootstrapToken("bootstrap")
        var pollCount = 0
        val visualRequests = mutableListOf<VisualRequestAck>()
        val request = VisualRequestAck(
            requestId = "visual-brain:wake-1",
            packageName = "com.example.game",
            sessionId = "com.example.game:123",
            reason = "Brain approved one glance",
            issuedAt = "2026-09-05T12:11:00Z",
            expiresAt = "2026-09-05T12:13:00Z",
        )
        val repository = QueueRepository.forTest(
            dao = database.pendingEventDao(),
            settings = settings,
            apiFactory = { successfulApi(ApiAck("phone-ingest", visualRequest = request, visualDecisionPending = true)) },
            visualRequestEnqueuer = { visualRequests += it },
            visualDecisionPoller = { pollCount += 1 },
        )

        repository.enqueueHeartbeat(sampleHeartbeat().copy(clientEventId = "visual-approved"), scheduleUpload = false)
        val result = repository.uploadPending()

        assertEquals(1, result.uploaded)
        assertEquals(listOf(request), visualRequests)
        assertEquals(0, pollCount)
    }

    private fun sampleHeartbeat() = HeartbeatRequest("android-test", batteryPercent = 82, charging = false, appVersion = "0.1.0", connectivityState = "online", observedAt = "2026-09-02T00:00:00Z", clientEventId = "event-${System.nanoTime()}")

    private fun successfulApi(ack: ApiAck = ApiAck("phone-ingest")) = object : HermesApi {
        override suspend fun health() = HealthResponse(true)
        override suspend fun register(authorization: String, request: RegisterRequest) = RegisterResponse(request.deviceId, "device-token")
        override suspend fun heartbeat(authorization: String, request: HeartbeatRequest) = ack
        override suspend fun observation(authorization: String, request: com.hermes.companion.data.ObservationRequest) = ack
    }

    private fun failingApi() = object : HermesApi {
        override suspend fun health() = HealthResponse(true)
        override suspend fun register(authorization: String, request: RegisterRequest): RegisterResponse = throw IOException("offline")
        override suspend fun heartbeat(authorization: String, request: HeartbeatRequest): ApiAck = throw IOException("offline")
        override suspend fun observation(authorization: String, request: com.hermes.companion.data.ObservationRequest): ApiAck = throw IOException("offline")
    }
}
