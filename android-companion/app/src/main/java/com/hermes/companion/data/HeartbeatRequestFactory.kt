package com.hermes.companion.data

import com.hermes.companion.platform.DeviceStatus
import java.time.Instant
import java.util.UUID

object HeartbeatRequestFactory {
    fun create(
        deviceId: String,
        appVersion: String,
        status: DeviceStatus,
        observedAt: String = Instant.now().toString(),
        clientEventId: String = UUID.randomUUID().toString(),
    ): HeartbeatRequest = HeartbeatRequest(
        deviceId = deviceId,
        batteryPercent = status.batteryPercent,
        charging = status.charging,
        appVersion = appVersion,
        connectivityState = if (status.online) "online" else "offline",
        foregroundPackage = status.foregroundPackage,
        observedAt = observedAt,
        clientEventId = clientEventId,
    )
}
