package com.hermes.companion.data

import kotlinx.serialization.Serializable

@Serializable
data class RegisterRequest(val deviceId: String, val appVersion: String)

@Serializable
data class RegisterResponse(val deviceId: String, val token: String)

@Serializable
data class HeartbeatRequest(
    val deviceId: String,
    val status: String = "online",
    val batteryPercent: Int,
    val charging: Boolean,
    val appVersion: String,
    val connectivityState: String,
    val foregroundPackage: String? = null,
    val observedAt: String,
    val clientEventId: String,
)

@Serializable
data class ObservationRequest(
    val kind: String,
    val label: String,
    val value: String? = null,
    val observedAt: String,
    val deviceId: String,
    val metadata: Map<String, String>? = null,
)

data class AppTimelineEntry(
    val packageName: String,
    val startedAt: String,
    val endedAt: String?,
    val durationMs: Long,
)

@Serializable
data class ApiAck(val dataSource: String? = null)
