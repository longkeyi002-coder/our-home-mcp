package com.hermes.companion.data

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query

@Dao
interface PendingEventDao {
    @Insert(onConflict = OnConflictStrategy.IGNORE)
    suspend fun insert(event: PendingEvent): Long

    @Query("SELECT * FROM pending_events WHERE nextAttemptAt <= :now ORDER BY createdAt ASC LIMIT :limit")
    suspend fun ready(now: Long, limit: Int): List<PendingEvent>

    @Query("SELECT COUNT(*) FROM pending_events")
    suspend fun count(): Int

    @Query("DELETE FROM pending_events WHERE id = :id")
    suspend fun delete(id: String)

    @Query("DELETE FROM pending_events")
    suspend fun deleteAll(): Int

    @Query("DELETE FROM pending_events WHERE id NOT IN (SELECT id FROM pending_events ORDER BY createdAt DESC LIMIT :limit)")
    suspend fun trimToLimit(limit: Int)

    @Query("UPDATE pending_events SET attempts = attempts + 1, lastError = :error, nextAttemptAt = :nextAttemptAt WHERE id = :id")
    suspend fun recordFailure(id: String, error: String, nextAttemptAt: Long)
}
