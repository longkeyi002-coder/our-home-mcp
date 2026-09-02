package com.hermes.companion.data

import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

@Entity(
    tableName = "pending_events",
    indices = [Index(value = ["dedupeKey"], unique = true)],
)
data class PendingEvent(
    @PrimaryKey val id: String,
    val type: String,
    val payload: String,
    val dedupeKey: String,
    val createdAt: Long,
    val attempts: Int = 0,
    val nextAttemptAt: Long = createdAt,
    val lastError: String? = null,
)
