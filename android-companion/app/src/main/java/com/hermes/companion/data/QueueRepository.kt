package com.hermes.companion.data

import android.content.Context
import androidx.room.Room
import com.hermes.companion.BuildConfig
import com.hermes.companion.platform.UsageTimelineSummary
import com.hermes.companion.privacy.PresencePrivacyStore
import com.hermes.companion.push.PushRegistration
import com.hermes.companion.vision.VisualObservationWorker
import java.time.LocalDate
import java.util.UUID
import kotlin.math.min
import kotlinx.serialization.encodeToString
import retrofit2.HttpException

class QueueRepository private constructor(
    private val dao: PendingEventDao,
    private val settings: SettingsRepository,
    private val apiFactory: (String) -> HermesApi = ApiClient::create,
    private val visualRequestEnqueuer: (VisualRequestAck) -> Unit = {},
    private val visualDecisionPoller: () -> Unit = {},
    private val pushRefresher: () -> Unit = {},
    private val outboundPrivacy: OutboundTelemetryPrivacy = OutboundTelemetryPrivacy { true },
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
            pushRefresher()
            UploadResult(0, null)
        } catch (error: Throwable) {
            fail(describeApiError("registration", error))
        }
    }

    /**
     * Process-wide single-flight. Immediate and periodic WorkManager jobs can overlap, but
     * only one QueueRepository instance may SELECT/send/delete pending events at a time.
     * Room-level claiming remains the long-term crash-safe queue design.
     */
    suspend fun uploadPending(now: Long = System.currentTimeMillis()): UploadResult =
        UploadSingleFlight.run { uploadPendingLocked(now) }

    private suspend fun uploadPendingLocked(now: Long): UploadResult {
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
                pushRefresher()
                "Bearer ${response.token}"
            } else "Bearer $deviceToken"
        } catch (error: Throwable) {
            return fail(describeApiError("registration", error))
        }

        var uploaded = 0
        var firstError: String? = null
        for (event in dao.ready(now, 20)) {
            try {
                val outcome = send(api, authorization, event)
                dao.delete(event.id)
                if (outcome.sent) {
                    uploaded += 1
                    settings.recordSuccessfulUpload(System.currentTimeMillis())
                    enqueueVisualAck(outcome.ack)
                }
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
                        val outcome = send(api, retryAuthorization, event)
                        dao.delete(event.id)
                        if (outcome.sent) {
                            uploaded += 1
                            settings.recordSuccessfulUpload(System.currentTimeMillis())
                            enqueueVisualAck(outcome.ack)
                        }
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
        pushRefresher()
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

    /**
     * Last privacy checkpoint before any queued payload crosses the network. This deliberately
     * re-evaluates CURRENT per-App policy instead of trusting policy that existed when the event
     * was collected. A stale visual summary for a now-hidden App is consumed locally and dropped.
     */
    private suspend fun send(api: HermesApi, authorization: String, event: PendingEvent): SendOutcome = when (event.type) {
        TYPE_HEARTBEAT -> {
            val decoded = json.decodeFromString(HeartbeatRequest.serializer(), event.payload)
            val safe = outboundPrivacy.sanitizeHeartbeat(decoded)
            SendOutcome(api.heartbeat(authorization, safe), sent = true)
        }
        TYPE_OBSERVATION -> {
            val decoded = json.decodeFromString(ObservationRequest.serializer(), event.payload)
            val safe = outboundPrivacy.sanitizeObservation(decoded)
            if (safe == null) SendOutcome(ApiAck(), sent = false)
            else SendOutcome(api.observation(authorization, safe), sent = true)
        }
        else -> throw IllegalArgumentException("Unknown event type")
    }

    /**
     * ACK handling stays enqueue-only. A pending Brain decision schedules a sparse follow-up
     * heartbeat; capture/provider work still happens only in VisualObservationWorker.
     */
    private fun enqueueVisualAck(ack: ApiAck) {
        val visualRequest = ack.visualRequest
        if (visualRequest != null) {
            runCatching { visualRequestEnqueuer(visualRequest) }
            return
        }
        if (ack.visualDecisionPending) runCatching { visualDecisionPoller() }
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

    private data class SendOutcome(val ack: ApiAck, val sent: Boolean)

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
            val presencePrivacy = PresencePrivacyStore(appContext)
            return QueueRepository(
                dao = database.pendingEventDao(),
                settings = settings,
                visualRequestEnqueuer = { VisualObservationWorker.enqueue(appContext, it) },
                visualDecisionPoller = { UploadWorker.enqueueVisualDecisionPoll(appContext) },
                pushRefresher = { PushRegistration.refresh(appContext) },
                outboundPrivacy = OutboundTelemetryPrivacy(presencePrivacy::exposesIdentity),
            )
        }

        fun forTest(
            dao: PendingEventDao,
            settings: SettingsRepository,
            apiFactory: (String) -> HermesApi,
            visualRequestEnqueuer: (VisualRequestAck) -> Unit = {},
            pushRefresher: () -> Unit = {},
            identityExposure: (String) -> Boolean = { true },
            visualDecisionPoller: () -> Unit = {},
        ) = QueueRepository(
            dao = dao,
            settings = settings,
            apiFactory = apiFactory,
            visualRequestEnqueuer = visualRequestEnqueuer,
            visualDecisionPoller = visualDecisionPoller,
            pushRefresher = pushRefresher,
            outboundPrivacy = OutboundTelemetryPrivacy(identityExposure),
        )
    }
}

private fun Throwable.safeMessage(): String = message?.take(300) ?: this::class.simpleName.orEmpty()

internal fun describeApiError(stage: String, error: Throwable): String {
    val detail = when (error) {
        is HttpException -> "HTTP ${error.code()} ${error.message()}"
        else -> error.safeMessage()
    }
    return "$stage: $detail".take(400)
}

private suspend fun verifyRegistration(api: HermesApi, bootstrap: String, request: RegisterRequest): RegisterResponse {
    // health is intentionally checked first so diagnostics can distinguish an unreachable
    // endpoint from a reachable endpoint with invalid bootstrap credentials.
    val health = api.health()
    if (!health.ok) throw IllegalStateException("Runtime health check returned not-ok")
    return api.register("Bearer $bootstrap", request)
}

private object UploadSingleFlight {
    private val mutex = kotlinx.coroutines.sync.Mutex()
    suspend fun <T> run(block: suspend () -> T): T = mutex.withLock { block() }
}
