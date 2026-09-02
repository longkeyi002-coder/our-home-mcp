package com.hermes.companion

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.hermes.companion.data.ApiAck
import com.hermes.companion.data.AppDatabase
import com.hermes.companion.data.HeartbeatRequest
import com.hermes.companion.data.HermesApi
import com.hermes.companion.data.ObservationRequest
import com.hermes.companion.data.QueueRepository
import com.hermes.companion.data.RegisterRequest
import com.hermes.companion.data.RegisterResponse
import com.hermes.companion.data.SettingsRepository
import java.io.IOException
import kotlinx.coroutines.runBlocking
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.After
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import retrofit2.HttpException
import retrofit2.Response

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
    fun eventUploadFailureReturnsRetryableErrorAndKeepsEvent() = runBlocking {
        val settings = SettingsRepository(ApplicationProvider.getApplicationContext())
        settings.saveServerUrl("https://example.com")
        settings.saveBootstrapToken("bootstrap-failure")
        val repository = QueueRepository.forTest(database.pendingEventDao(), settings) { failingEventApi() }
        repository.enqueueHeartbeat(sampleHeartbeat())
        val result = repository.uploadPending()
        assertEquals(0, result.uploaded)
        assertNotNull(result.error)
        assertEquals(1, database.pendingEventDao().count())
    }

    @Test
    fun unauthorizedDeviceTokenIsClearedAndRecoveredByRegistration() = runBlocking {
        val settings = SettingsRepository(ApplicationProvider.getApplicationContext())
        settings.saveServerUrl("https://example.com")
        settings.saveBootstrapToken("bootstrap-recovery")
        settings.saveDeviceToken("stale-token")
        var registerCalls = 0
        var heartbeatCalls = 0
        val api = object : HermesApi {
            override suspend fun register(authorization: String, request: RegisterRequest): RegisterResponse {
                registerCalls += 1
                return RegisterResponse(request.deviceId, "fresh-token")
            }

            override suspend fun heartbeat(authorization: String, request: HeartbeatRequest): ApiAck {
                heartbeatCalls += 1
                if (heartbeatCalls == 1) throw HttpException(Response.error<Any>(401, "unauthorized".toResponseBody()))
                assertEquals("Bearer fresh-token", authorization)
                return ApiAck("phone-ingest")
            }

            override suspend fun observation(authorization: String, request: ObservationRequest) = ApiAck("phone-ingest")
        }
        val repository = QueueRepository.forTest(database.pendingEventDao(), settings) { api }
        repository.enqueueHeartbeat(sampleHeartbeat())
        val result = repository.uploadPending()
        assertEquals(1, result.uploaded)
        assertEquals(1, registerCalls)
        assertEquals(0, database.pendingEventDao().count())
        assertEquals("fresh-token", settings.deviceToken())
    }

    private fun sampleHeartbeat() = HeartbeatRequest("android-test", batteryPercent = 82, charging = false, appVersion = "0.2.0", connectivityState = "online", observedAt = "2026-09-02T00:00:00Z", clientEventId = "event-${System.nanoTime()}")

    private fun successfulApi() = object : HermesApi {
        override suspend fun register(authorization: String, request: RegisterRequest) = RegisterResponse(request.deviceId, "device-token")
        override suspend fun heartbeat(authorization: String, request: HeartbeatRequest) = ApiAck("phone-ingest")
        override suspend fun observation(authorization: String, request: com.hermes.companion.data.ObservationRequest) = ApiAck("phone-ingest")
    }

    private fun failingApi() = object : HermesApi {
        override suspend fun register(authorization: String, request: RegisterRequest): RegisterResponse = throw IOException("offline")
        override suspend fun heartbeat(authorization: String, request: HeartbeatRequest): ApiAck = throw IOException("offline")
        override suspend fun observation(authorization: String, request: com.hermes.companion.data.ObservationRequest): ApiAck = throw IOException("offline")
    }

    private fun failingEventApi() = object : HermesApi {
        override suspend fun register(authorization: String, request: RegisterRequest) = RegisterResponse(request.deviceId, "device-token")
        override suspend fun heartbeat(authorization: String, request: HeartbeatRequest): ApiAck = throw IOException("event offline")
        override suspend fun observation(authorization: String, request: ObservationRequest): ApiAck = throw IOException("event offline")
    }
}
