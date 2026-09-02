package com.hermes.companion.data

import androidx.room.Database
import androidx.room.RoomDatabase

@Database(entities = [PendingEvent::class], version = 1, exportSchema = false)
abstract class AppDatabase : RoomDatabase() {
    abstract fun pendingEventDao(): PendingEventDao
}
