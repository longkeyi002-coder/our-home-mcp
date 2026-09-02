package com.hermes.companion.data

import kotlinx.serialization.json.Json

/** JSON contract shared by persisted events and Retrofit request bodies. */
internal val WireJson = Json {
    ignoreUnknownKeys = true
    encodeDefaults = true
    // Zod's optional fields accept an absent property, but not an explicit JSON null.
    explicitNulls = false
}
