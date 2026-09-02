package com.hermes.companion.data

import retrofit2.http.Body
import retrofit2.http.Header
import retrofit2.http.POST

interface HermesApi {
    @POST("v1/phone/register")
    suspend fun register(
        @Header("Authorization") authorization: String,
        @Body request: RegisterRequest,
    ): RegisterResponse

    @POST("v1/phone/heartbeat")
    suspend fun heartbeat(
        @Header("Authorization") authorization: String,
        @Body request: HeartbeatRequest,
    ): ApiAck

    @POST("v1/observations")
    suspend fun observation(
        @Header("Authorization") authorization: String,
        @Body request: ObservationRequest,
    ): ApiAck
}
