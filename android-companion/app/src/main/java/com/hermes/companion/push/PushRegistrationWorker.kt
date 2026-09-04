package com.hermes.companion.push

import android.content.Context
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import com.google.firebase.FirebaseApp
import com.google.firebase.installations.FirebaseInstallations
import com.google.firebase.messaging.FirebaseMessaging
import com.hermes.companion.data.QueueRepository
import com.hermes.companion.data.SettingsRepository
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.tasks.await

/** Independent push-address registration with retry and diagnostics. */
class PushRegistrationWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        val settings = SettingsRepository(applicationContext)
        settings.recordPushRegistrationAttempt()
        if (FirebaseApp.getApps(applicationContext).isEmpty()) {
            settings.recordPushRegistrationError("Firebase is not configured in this build")
            return Result.failure()
        }

        return try {
            val token = settings.pushToken()?.takeIf { it.isNotBlank() }
                ?: FirebaseMessaging.getInstance().token.await()
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

        fun enqueue(context: Context) {
            val appContext = context.applicationContext
            SettingsRepository(appContext).recordPushRegistrationScheduled()
            val request = OneTimeWorkRequestBuilder<PushRegistrationWorker>()
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
                .build()
            WorkManager.getInstance(appContext).enqueueUniqueWork(
                UNIQUE_WORK_NAME,
                ExistingWorkPolicy.REPLACE,
                request,
            )
        }
    }
}
