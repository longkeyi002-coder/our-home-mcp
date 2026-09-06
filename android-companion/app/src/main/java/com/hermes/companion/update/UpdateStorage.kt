package com.hermes.companion.update

import android.content.Context
import java.io.File

object UpdateStorage {
    private const val PREFS = "our_home_self_update"
    private const val KEY_READY_VERSION_CODE = "ready_version_code"
    private const val KEY_READY_VERSION_NAME = "ready_version_name"
    private const val KEY_READY_SHA256 = "ready_sha256"
    private const val KEY_NOTIFIED_VERSION_CODE = "notified_version_code"
    private const val READY_APK = "ready-update.apk"
    private const val TEMP_APK = "downloading-update.apk"

    fun updateDirectory(context: Context): File = File(context.filesDir, "updates").apply { mkdirs() }

    fun readyApk(context: Context): File = File(updateDirectory(context), READY_APK)

    fun tempApk(context: Context): File = File(updateDirectory(context), TEMP_APK)

    fun isReady(context: Context, manifest: UpdateManifest): Boolean {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        return readyApk(context).isFile
            && prefs.getInt(KEY_READY_VERSION_CODE, 0) == manifest.versionCode
            && prefs.getString(KEY_READY_SHA256, null)?.equals(manifest.sha256, ignoreCase = true) == true
    }

    fun markReady(context: Context, manifest: UpdateManifest) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit()
            .putInt(KEY_READY_VERSION_CODE, manifest.versionCode)
            .putString(KEY_READY_VERSION_NAME, manifest.versionName)
            .putString(KEY_READY_SHA256, manifest.sha256.lowercase())
            .apply()
    }

    fun readyVersionName(context: Context): String? =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY_READY_VERSION_NAME, null)

    fun shouldNotify(context: Context, versionCode: Int): Boolean =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .getInt(KEY_NOTIFIED_VERSION_CODE, 0) != versionCode

    fun markNotified(context: Context, versionCode: Int) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit()
            .putInt(KEY_NOTIFIED_VERSION_CODE, versionCode)
            .apply()
    }

    fun clearStale(context: Context) {
        tempApk(context).delete()
        readyApk(context).delete()
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().clear().apply()
    }
}
