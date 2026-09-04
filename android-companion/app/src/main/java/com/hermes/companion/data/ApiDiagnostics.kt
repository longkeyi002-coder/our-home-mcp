package com.hermes.companion.data

import retrofit2.HttpException

internal fun describeApiError(stage: String, error: Throwable): String {
    if (error is HttpException) {
        val suffix = when (error.code()) {
            401 -> " — token rejected"
            403 -> " — forbidden"
            else -> ""
        }
        return "$stage HTTP ${error.code()}$suffix"
    }
    val detail = error.message?.trim().orEmpty().ifBlank { error::class.simpleName.orEmpty() }
    return "$stage: ${detail.take(240)}"
}

internal suspend fun verifyRegistration(
    api: HermesApi,
    bootstrapToken: String,
    request: RegisterRequest,
): RegisterResponse {
    val health = api.health()
    check(health.ok) { "health check returned ok=false" }
    return api.register("Bearer $bootstrapToken", request)
}
