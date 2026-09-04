package com.hermes.companion.data

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
data class RegisterRequest(
    @SerialName("deviceId") val deviceId: String,
    @SerialName("appVersion") val appVersion: String,
    @SerialName("pushFid") val pushFid: String? = null,
    @SerialName("pushToken") val pushToken: String? = null,
)

@Serializable
data class RegisterResponse(val deviceId: String, val token: String)

@Serializable
data class HeartbeatRequest(
    @SerialName("deviceId") val deviceId: String,
    @SerialName("status") val status: String = "online",
    @SerialName("batteryPercent") val batteryPercent: Int,
    @SerialName("charging") val charging: Boolean,
    @SerialName("appVersion") val appVersion: String,
    @SerialName("connectivityState") val connectivityState: String,
    @SerialName("foregroundPackage") val foregroundPackage: String? = null,
    @SerialName("observedAt") val observedAt: String,
    @SerialName("clientEventId") val clientEventId: String,
)

@Serializable
data class ObservationRequest(
    val kind: String,
    val label: String,
    val value: String? = null,
    val observedAt: String,
    val deviceId: String,
    val metadata: Map<String, String>? = null,
    val clientEventId: String? = null,
)

@Serializable
data class ApiAck(val dataSource: String? = null)

@Serializable
data class HealthResponse(val ok: Boolean, val service: String? = null, val schemaVersion: Int? = null)
