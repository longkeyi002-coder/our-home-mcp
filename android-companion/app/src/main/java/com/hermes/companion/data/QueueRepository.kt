package com.hermes.companion.data

import android.content.Context
import androidx.room.Room
import com.hermes.companion.BuildConfig
import com.hermes.companion.platform.UsageTimelineSummary
import com.hermes.companion.vision.VisualRequestAckHandler
import java.time.LocalDate
import java.util.UUID
import kotlin.math.min
import kotlinx.serialization.encodeToString
import retrofit2.HttpException

class QueueRepository private constructor(
    private val dao: PendingEventDao,
    private val settings: SettingsRepository,
    private val apiFactory: (String) -> HermesApi = ApiClient::create,
    private val visualRequestHandler: suspend (VisualRequestAck) -> ObservationRequest? = { null },
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

    suspend fun enqueueTimeline(entries: List<AppTimelineEntry>, deviceId: String) {
        entries.forEach { entry ->
            val sessionId = "timeline:$deviceId:${entry.startedAt}:${entry.packageName}"
            enqueueObservation(
                ObservationRequest(
                    kind = "app_timeline",
                    label = entry.packageName,
                    value = entry.packageName,
                    observedAt = entry.startedAt,
                    deviceId = deviceId,
                    metadata = mapOf(
                        "startedAt" to entry.startedAt,
                        "endedAt" to (entry.endedAt ?: ""),
                        "durationMs" to entry.durationMs.toString(),
                        "category" to entry.category,
                    ),
                    clientEventId = sessionId,
                ),
                dedupeKey = sessionId,
                scheduleUpload = false,
            )
        }
        if (entries.isNotEmpty()) UploadWorker.enqueue(settings.context)
    }

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

    suspend fun enqueueSteps(steps: Long, deviceId: String, observedAt: String) {
        enqueueObservation(
            ObservationRequest(
                kind = "steps",
                label = "今日步数",
                value = steps.toString(),
                observedAt = observedAt,
                deviceId = deviceId,
                metadata = mapOf("unit" to "steps", "day" to LocalDate.now().toString()),
            ),
            dedupeKey = "steps:$deviceId:${LocalDate.now()}",
        )
    }

    private suspend fun enqueueObservation(request: ObservationRequest, dedupeKey: String, scheduleUpload: Boolean = true) = enqueue(
        type = TYPE_OBSERVATION,
        payload = json.encodeToString(request),
        dedupeKey = dedupeKey,
        scheduleUpload = scheduleUpload,
    )

    suspend fun pendingCount(): Int = dao.count()

    suspend fun clearPendingQueue(): Int = dao.deleteAll()

    /**
     * OH-P1/OH-66: a connection test is not successful until both reachability and
     * bootstrap registration authentication have succeeded. A successful call stores
     * the device-scoped token that normal telemetry uses afterwards.
     */
    suspend fun verifyRegistration(): UploadResult {
        val serverUrl = settings.serverUrl()
        val bootstrap = settings.bootstrapToken()
        if (serverUrl.isBlank()) return fail("registration: Runtime URL is missing")
        if (bootstrap.isNullOrBlank()) return fail("registration: registration token is missing")
        val api = runCatching { apiFactory(serverUrl) }
            .getOrElse { return fail(describeApiError("configuration", it)) }
        return try {
            val response = verifyRegistration(api, bootstrap, registrationRequest())
            settings.saveDeviceToken(response.token)
            settings.clearApiError()
            UploadResult(0, null)
        } catch (error: Throwable) {
            fail(describeApiError("registration", error))
        }
    }

    suspend fun uploadPending(now: Long = System.currentTimeMillis()): UploadResult {
        val serverUrl = settings.serverUrl()
        val bootstrap = settings.bootstrapToken()
        if (serverUrl.isBlank() || bootstrap.isNullOrBlank() && settings.deviceToken().isNullOrBlank()) {
            return fail("configuration: Server URL or registration token is missing")
        }
        val api = runCatching { apiFactory(serverUrl) }.getOrElse { return fail(describeApiError("configuration", it)) }
        val authorization = try {
            val deviceToken = settings.deviceToken()
            if (deviceToken.isNullOrBlank()) {
                val response = api.register("Bearer ${bootstrap!!}", registrationRequest())
                settings.saveDeviceToken(response.token)
                "Bearer ${response.token}"
            } else "Bearer $deviceToken"
        } catch (error: Throwable) {
            return fail(describeApiError("registration", error))
        }

        var uploaded = 0
        var firstError: String? = null
        for (event in dao.ready(now, 20)) {
            try {
                val ack = send(api, authorization, event)
                dao.delete(event.id)
                uploaded += 1
                settings.recordSuccessfulUpload(System.currentTimeMillis())
                handleApiAck(ack)
            } catch (error: Throwable) {
                if (error is HttpException && error.code() == 401 && settings.hasDeviceToken()) {
                    settings.clearDeviceToken()
                    val retryAuthorization = try {
                        registerDevice(api)
                    } catch (registrationError: Throwable) {
                        val message = describeApiError("re-registration", registrationError)
                        firstError = firstError ?: message
                        recordFailure(event, now, message)
                        continue
                    }
                    try {
                        val ack = send(api, retryAuthorization, event)
                        dao.delete(event.id)
                        uploaded += 1
                        settings.recordSuccessfulUpload(System.currentTimeMillis())
                        handleApiAck(ack)
                    } catch (retryError: Throwable) {
                        val message = describeApiError("upload after re-registration", retryError)
                        firstError = firstError ?: message
                        recordFailure(event, now, message)
                    }
                } else {
                    val message = describeApiError("upload", error)
                    firstError = firstError ?: message
                    recordFailure(event, now, message)
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

    private suspend fun send(api: HermesApi, authorization: String, event: PendingEvent): ApiAck = when (event.type) {
        TYPE_HEARTBEAT -> api.heartbeat(authorization, json.decodeFromString(HeartbeatRequest.serializer(), event.payload))
        TYPE_OBSERVATION -> api.observation(authorization, json.decodeFromString(ObservationRequest.serializer(), event.payload))
        else -> throw IllegalArgumentException("Unknown event type")
    }

    /**
     * Telemetry success is authoritative before this side effect runs. Visual failure must
     * never resurrect a successfully uploaded Presence event or poison normal API diagnostics.
     */
    private suspend fun handleApiAck(ack: ApiAck) {
        val visualRequest = ack.visualRequest ?: return
        val summary = try {
            visualRequestHandler(visualRequest)
        } catch (_: Throwable) {
            null
        } ?: return
        enqueueObservation(summary, scheduleUpload = true)
    }

    private suspend fun recordFailure(event: PendingEvent, now: Long, message: String) {
        val attempts = event.attempts + 1
        val delay = min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * (1L shl min(attempts, 8)))
        dao.recordFailure(event.id, message, now + delay)
        settings.recordApiError(message)
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
            val appContext = context.applicationContext
            val database = Room.databaseBuilder(appContext, AppDatabase::class.java, "hermes-companion.db").build()
            val settings = SettingsRepository(appContext)
            val handler = VisualRequestAckHandler(appContext)
            return QueueRepository(
                dao = database.pendingEventDao(),
                settings = settings,
                visualRequestHandler = handler::handle,
            )
        }

        fun forTest(
            dao: PendingEventDao,
            settings: SettingsRepository,
            apiFactory: (String) -> HermesApi,
            visualRequestHandler: suspend (VisualRequestAck) -> ObservationRequest? = { null },
        ) = QueueRepository(dao, settings, apiFactory, visualRequestHandler)
    }
}

private fun Throwable.safeMessage(): String = message?.take(300) ?: this::class.simpleName.orEmpty()
