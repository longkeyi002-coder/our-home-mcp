package com.hermes.companion

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.hermes.companion.data.ApiAck
import com.hermes.companion.data.AppDatabase
import com.hermes.companion.data.HeartbeatRequest
import com.hermes.companion.data.HermesApi
import com.hermes.companion.data.QueueRepository
import com.hermes.companion.data.RegisterRequest
import com.hermes.companion.data.RegisterResponse
import com.hermes.companion.data.SettingsRepository
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

    private fun sampleHeartbeat() = HeartbeatRequest("android-test", batteryPercent = 82, charging = false, appVersion = "0.1.0", connectivityState = "online", observedAt = "2026-09-02T00:00:00Z", clientEventId = "event-${System.nanoTime()}")

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
}
