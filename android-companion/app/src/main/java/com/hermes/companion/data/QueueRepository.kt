package com.hermes.companion.data

import android.content.Context
import androidx.room.Room
import com.hermes.companion.BuildConfig
import com.hermes.companion.platform.UsageTimelineSummary
import java.time.LocalDate
import java.util.UUID
import kotlin.math.min
import kotlinx.serialization.encodeToString
import retrofit2.HttpException

class QueueRepository private constructor(
    private val dao: PendingEventDao,
    private val settings: SettingsRepository,
    private val apiFactory: (String) -> HermesApi = ApiClient::create,
) {
    private val json = WireJson

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

    suspend fun enqueueUsageSummary(summary: UsageTimelineSummary, deviceId: String, scheduleUpload: Boolean = true) {
        val day = LocalDate.now().toString()
        val bucket = summary.observedAt / (60 * 60 * 1000L)
        val clientEventId = "usage-summary:$deviceId:$day:$bucket"
        val metadata = mapOf(
            "day" to day,
            "currentPackage" to (summary.currentPackageName ?: ""),
            "currentDurationMs" to summary.currentDurationMs.toString(),
            "appTotalsMs" to json.encodeToString(summary.appTotalsMs),
            "categoryTotalsMs" to json.encodeToString(summary.categoryTotalsMs),
            "sessions" to json.encodeToString(summary.sessions),
        )
        enqueue(
            type = TYPE_OBSERVATION,
            payload = json.encodeToString(ObservationRequest(
                kind = "usage_summary",
                label = "app usage timeline",
                value = summary.currentPackageName,
                observedAt = java.time.Instant.ofEpochMilli(summary.observedAt).toString(),
                deviceId = deviceId,
                metadata = metadata,
                clientEventId = clientEventId,
            )),
            dedupeKey = clientEventId,
            scheduleUpload = scheduleUpload,
        )
    }

    suspend fun pendingCount(): Int = dao.count()

    suspend fun clearPendingQueue(): Int = dao.deleteAll()

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
                val response = api.register("Bearer ${bootstrap!!}", registrationRequest())
                settings.saveDeviceToken(response.token)
                "Bearer ${response.token}"
            } else "Bearer $deviceToken"
        } catch (error: Exception) {
            return fail(error.safeMessage())
        }

        var uploaded = 0
        var firstError: String? = null
        for (event in dao.ready(now, 20)) {
            try {
                send(api, authorization, event)
                dao.delete(event.id)
                uploaded += 1
                settings.recordSuccessfulUpload(System.currentTimeMillis())
            } catch (error: Exception) {
                val retryAuthorization = if (error is HttpException && error.code() == 401 && settings.deviceToken() != null) {
                    settings.clearDeviceToken()
                    runCatching { registerDevice(api) }.getOrNull()
                } else null
                try {
                    if (retryAuthorization == null) throw error
                    send(api, retryAuthorization, event)
                    dao.delete(event.id)
                    uploaded += 1
                    settings.recordSuccessfulUpload(System.currentTimeMillis())
                } catch (retryError: Exception) {
                    val message = retryError.safeMessage()
                    firstError = firstError ?: message
                    val attempts = event.attempts + 1
                    val delay = min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * (1L shl min(attempts, 8)))
                    dao.recordFailure(event.id, message, now + delay)
                    settings.recordApiError(message)
                }
            }
        }
        return UploadResult(uploaded, firstError)
    }

    private suspend fun registerDevice(api: HermesApi): String {
        val bootstrap = settings.bootstrapToken() ?: throw IllegalStateException("Registration token is missing")
        val response = api.register("Bearer $bootstrap", registrationRequest())
        settings.saveDeviceToken(response.token)
        return "Bearer ${response.token}"
    }

    suspend fun registerPushAddress(pushFid: String?, pushToken: String) {
        settings.savePushAddress(pushFid, pushToken)
        val serverUrl = settings.serverUrl()
        val bootstrap = settings.bootstrapToken() ?: throw IllegalStateException("Registration token is missing")
        require(serverUrl.isNotBlank()) { "Server URL is missing" }
        val response = apiFactory(serverUrl).register("Bearer $bootstrap", registrationRequest())
        settings.saveDeviceToken(response.token)
    }

    private fun registrationRequest() = RegisterRequest(
        deviceId = settings.deviceId(),
        appVersion = BuildConfig.VERSION_NAME,
        pushFid = settings.pushFid(),
        pushToken = settings.pushToken(),
    )

    private suspend fun send(api: HermesApi, authorization: String, event: PendingEvent) {
        when (event.type) {
            TYPE_HEARTBEAT -> api.heartbeat(authorization, json.decodeFromString(HeartbeatRequest.serializer(), event.payload))
            TYPE_OBSERVATION -> api.observation(authorization, json.decodeFromString(ObservationRequest.serializer(), event.payload))
            else -> throw IllegalArgumentException("Unknown event type")
        }
    }

    private fun fail(message: String): UploadResult {
        settings.recordApiError(message)
        return UploadResult(0, message)
    }

    private suspend fun enqueue(type: String, payload: String, dedupeKey: String, scheduleUpload: Boolean = true) {
        dao.insert(PendingEvent(UUID.randomUUID().toString(), type, payload, dedupeKey, System.currentTimeMillis()))
        dao.trimToLimit(MAX_PENDING_EVENTS)
        if (scheduleUpload) UploadWorker.enqueue(settings.context)
    }

    data class UploadResult(val uploaded: Int, val error: String?)

    companion object {
        const val TYPE_HEARTBEAT = "heartbeat"
        const val TYPE_OBSERVATION = "observation"
        const val BASE_BACKOFF_MS = 30_000L
        const val MAX_BACKOFF_MS = 6 * 60 * 60 * 1000L
        const val MAX_PENDING_EVENTS = 500

        fun create(context: Context): QueueRepository {
            val database = Room.databaseBuilder(context, AppDatabase::class.java, "hermes-companion.db").build()
            return QueueRepository(database.pendingEventDao(), SettingsRepository(context.applicationContext))
        }

        fun forTest(dao: PendingEventDao, settings: SettingsRepository, apiFactory: (String) -> HermesApi) = QueueRepository(dao, settings, apiFactory)
    }
}

private fun Throwable.safeMessage(): String = message?.take(300) ?: this::class.simpleName.orEmpty()
