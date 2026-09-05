package com.hermes.companion.push

import android.content.Context
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import com.google.firebase.FirebaseApp
import com.google.firebase.installations.FirebaseInstallations
import com.google.firebase.messaging.FirebaseMessaging
import com.hermes.companion.data.QueueRepository
import com.hermes.companion.data.SettingsRepository
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.tasks.await

/** Independent push-address registration with retry, periodic self-healing and diagnostics. */
class PushRegistrationWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        val settings = SettingsRepository(applicationContext)
        settings.recordPushRegistrationAttempt()
        if (FirebaseApp.getApps(applicationContext).isEmpty()) {
            settings.recordPushRegistrationError("Firebase is not configured in this build")
            return Result.failure()
        }

        return try {
            // Always ask Firebase for the current token. A cached local token is useful for
            // diagnostics, but must not prevent periodic repair after a missed token rotation.
            val token = FirebaseMessaging.getInstance().token.await()
            val fid = FirebaseInstallations.getInstance().id.await()
            QueueRepository.create(applicationContext).registerPushAddress(fid, token)
            settings.recordPushRegistrationSuccess()
            Result.success()
        } catch (error: Throwable) {
            settings.recordPushRegistrationError(error.message ?: error::class.simpleName.orEmpty())
            Result.retry()
        }
    }

    companion object {
        const val UNIQUE_WORK_NAME = "our-home-push-registration"
        const val PERIODIC_WORK_NAME = "our-home-push-registration-periodic"
        const val PERIODIC_REFRESH_HOURS = 12L

        private fun networkConstraint() =
            Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()

        fun enqueue(context: Context) {
            val appContext = context.applicationContext
            SettingsRepository(appContext).recordPushRegistrationScheduled()
            val request = OneTimeWorkRequestBuilder<PushRegistrationWorker>()
                .setConstraints(networkConstraint())
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
                .build()
            WorkManager.getInstance(appContext).enqueueUniqueWork(
                UNIQUE_WORK_NAME,
                ExistingWorkPolicy.REPLACE,
                request,
            )
        }

        /**
         * Low-frequency repair path. This is not a life-loop heartbeat and does not wake
         * Hermes; it only re-confirms the device's current Firebase address with Runtime.
         */
        fun schedulePeriodic(context: Context) {
            val appContext = context.applicationContext
            val request = PeriodicWorkRequestBuilder<PushRegistrationWorker>(PERIODIC_REFRESH_HOURS, TimeUnit.HOURS)
                .setConstraints(networkConstraint())
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
                .build()
            WorkManager.getInstance(appContext).enqueueUniquePeriodicWork(
                PERIODIC_WORK_NAME,
                ExistingPeriodicWorkPolicy.UPDATE,
                request,
            )
        }
    }
}
