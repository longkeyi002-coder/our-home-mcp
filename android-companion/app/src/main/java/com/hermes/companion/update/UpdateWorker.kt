package com.hermes.companion.update

import android.content.Context
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import com.hermes.companion.BuildConfig
import java.io.FileOutputStream
import java.security.MessageDigest
import java.util.concurrent.TimeUnit
import kotlinx.serialization.json.Json
import okhttp3.OkHttpClient
import okhttp3.Request

class UpdateWorker(
    appContext: Context,
    params: WorkerParameters,
) : CoroutineWorker(appContext, params) {
    private val client = OkHttpClient.Builder()
        .followRedirects(true)
        .followSslRedirects(true)
        .build()
    private val json = Json { ignoreUnknownKeys = false }

    override suspend fun doWork(): Result {
        return runCatching {
            val manifest = fetchManifest() ?: return Result.success()
            val decision = UpdatePolicy.decide(BuildConfig.VERSION_CODE, manifest)
            if (!decision.available) {
                if (decision.reason == "not_newer") UpdateStorage.clearStale(applicationContext)
                return Result.success()
            }

            if (!UpdateStorage.isReady(applicationContext, manifest)) {
                downloadAndVerify(manifest)
            }
            if (UpdateStorage.shouldNotify(applicationContext, manifest.versionCode)) {
                UpdateNotifier.showReady(applicationContext, manifest.versionName)
                UpdateStorage.markNotified(applicationContext, manifest.versionCode)
            }
            Result.success()
        }.getOrElse {
            UpdateStorage.tempApk(applicationContext).delete()
            Result.retry()
        }
    }

    private fun fetchManifest(): UpdateManifest? {
        val request = Request.Builder()
            .url(MANIFEST_URL)
            .header("Accept", "application/json")
            .get()
            .build()
        client.newCall(request).execute().use { response ->
            if (response.code == 404) return null
            if (!response.isSuccessful) error("Update manifest HTTP ${response.code}")
            val body = response.body?.string() ?: error("Update manifest body is missing")
            if (body.length > MAX_MANIFEST_CHARS) error("Update manifest is too large")
            return json.decodeFromString(UpdateManifest.serializer(), body)
        }
    }

    private fun downloadAndVerify(manifest: UpdateManifest) {
        val request = Request.Builder().url(manifest.apkUrl).get().build()
        client.newCall(request).execute().use { response ->
            if (!response.isSuccessful) error("Update APK HTTP ${response.code}")
            val body = response.body ?: error("Update APK body is missing")
            val contentLength = body.contentLength()
            if (contentLength > MAX_APK_BYTES) error("Update APK exceeds size limit")

            val temp = UpdateStorage.tempApk(applicationContext)
            temp.parentFile?.mkdirs()
            temp.delete()
            val digest = MessageDigest.getInstance("SHA-256")
            var total = 0L
            body.byteStream().use { input ->
                FileOutputStream(temp).use { output ->
                    val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
                    while (true) {
                        val read = input.read(buffer)
                        if (read < 0) break
                        total += read
                        if (total > MAX_APK_BYTES) error("Update APK exceeds size limit")
                        digest.update(buffer, 0, read)
                        output.write(buffer, 0, read)
                    }
                    output.fd.sync()
                }
            }
            if (total == 0L) error("Update APK is empty")
            val actual = digest.digest().joinToString("") { "%02x".format(it) }
            if (!actual.equals(manifest.sha256, ignoreCase = true)) {
                temp.delete()
                error("Update APK SHA-256 mismatch")
            }

            val ready = UpdateStorage.readyApk(applicationContext)
            ready.delete()
            if (!temp.renameTo(ready)) {
                temp.copyTo(ready, overwrite = true)
                temp.delete()
            }
            UpdateStorage.markReady(applicationContext, manifest)
        }
    }

    companion object {
        private const val PERIODIC_WORK = "our-home-self-update-periodic"
        private const val IMMEDIATE_WORK = "our-home-self-update-immediate"
        private const val MANIFEST_URL =
            "https://github.com/longkeyi002-coder/our-home-mcp/releases/latest/download/update.json"
        private const val MAX_MANIFEST_CHARS = 16_384
        private const val MAX_APK_BYTES = 100L * 1024L * 1024L

        private fun networkConstraints() = Constraints.Builder()
            .setRequiredNetworkType(NetworkType.CONNECTED)
            .build()

        fun schedulePeriodic(context: Context) {
            val request = PeriodicWorkRequestBuilder<UpdateWorker>(6, TimeUnit.HOURS)
                .setConstraints(networkConstraints())
                .build()
            WorkManager.getInstance(context).enqueueUniquePeriodicWork(
                PERIODIC_WORK,
                ExistingPeriodicWorkPolicy.UPDATE,
                request,
            )
        }

        fun enqueueImmediate(context: Context) {
            val request = OneTimeWorkRequestBuilder<UpdateWorker>()
                .setConstraints(networkConstraints())
                .build()
            WorkManager.getInstance(context).enqueueUniqueWork(
                IMMEDIATE_WORK,
                ExistingWorkPolicy.KEEP,
                request,
            )
        }
    }
}
