package com.hermes.companion.data

import android.content.Context
import androidx.room.Room
import com.hermes.companion.BuildConfig
import java.util.UUID
import kotlin.math.min
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

class QueueRepository private constructor(
    private val dao: PendingEventDao,
    private val settings: SettingsRepository,
    private val apiFactory: (String) -> HermesApi = ApiClient::create,
) {
    private val json = Json { encodeDefaults = true }

    suspend fun enqueueHeartbeat(request: HeartbeatRequest, scheduleUpload: Boolean = true) = enqueue(
        type = TYPE_HEARTBEAT,
        payload = json.encodeToString(request),
        dedupeKey = "heartbeat:${request.clientEventId}",
        scheduleUpload = scheduleUpload,
    )

    suspend fun enqueueObservation(request: ObservationRequest, scheduleUpload: Boolean = true) = enqueue(
        type = TYPE_OBSERVATION,
        payload = json.encodeToString(request),
        dedupeKey = "observation:${request.deviceId}:${request.observedAt}:${request.kind}:${request.value.orEmpty()}",
        scheduleUpload = scheduleUpload,
    )

    suspend fun pendingCount(): Int = dao.count()

    suspend fun uploadPending(now: Long = System.currentTimeMillis()): UploadResult {
        val serverUrl = settings.serverUrl()
        val bootstrap = settings.bootstrapToken()
        if (serverUrl.isBlank() || bootstrap.isNullOrBlank() && settings.deviceToken().isNullOrBlank()) {
            return fail("Server URL or registration token is missing")
        }
        val api = runCatching { apiFactory(serverUrl) }.getOrElse { return fail(it.safeMessage()) }
        val authorization = try {
            val deviceToken = settings.deviceToken()
            if (deviceToken.isNullOrBlank()) {
                val response = api.register("Bearer ${bootstrap!!}", RegisterRequest(settings.deviceId(), BuildConfig.VERSION_NAME))
                settings.saveDeviceToken(response.token)
                "Bearer ${response.token}"
            } else "Bearer ${deviceToken}"
        } catch (error: Exception) {
            return fail(error.safeMessage())
        }

        var uploaded = 0
        for (event in dao.ready(now, 20)) {
            try {
                when (event.type) {
                    TYPE_HEARTBEAT -> api.heartbeat(authorization, json.decodeFromString(HeartbeatRequest.serializer(), event.payload))
                    TYPE_OBSERVATION -> api.observation(authorization, json.decodeFromString(ObservationRequest.serializer(), event.payload))
                    else -> throw IllegalArgumentException("Unknown event type")
                }
                dao.delete(event.id)
                uploaded += 1
                settings.recordSuccessfulUpload(System.currentTimeMillis())
            } catch (error: Exception) {
                val attempts = event.attempts + 1
                val delay = min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * (1L shl min(attempts, 8)))
                dao.recordFailure(event.id, error.safeMessage(), now + delay)
                settings.recordApiError(error.safeMessage())
            }
        }
        return UploadResult(uploaded, null)
    }

    private fun fail(message: String): UploadResult {
        settings.recordApiError(message)
        return UploadResult(0, message)
    }

    private suspend fun enqueue(type: String, payload: String, dedupeKey: String, scheduleUpload: Boolean) {
        dao.insert(PendingEvent(UUID.randomUUID().toString(), type, payload, dedupeKey, System.currentTimeMillis()))
        if (scheduleUpload) UploadWorker.enqueue(settings.context)
    }

    data class UploadResult(val uploaded: Int, val error: String?)

    companion object {
        const val TYPE_HEARTBEAT = "heartbeat"
        const val TYPE_OBSERVATION = "observation"
        const val BASE_BACKOFF_MS = 30_000L
        const val MAX_BACKOFF_MS = 6 * 60 * 60 * 1000L

        fun create(context: Context): QueueRepository {
            val database = Room.databaseBuilder(context, AppDatabase::class.java, "hermes-companion.db").build()
            return QueueRepository(database.pendingEventDao(), SettingsRepository(context.applicationContext))
        }

        fun forTest(dao: PendingEventDao, settings: SettingsRepository, apiFactory: (String) -> HermesApi) = QueueRepository(dao, settings, apiFactory)
    }
}

private fun Throwable.safeMessage(): String = message?.take(300) ?: this::class.simpleName.orEmpty()
