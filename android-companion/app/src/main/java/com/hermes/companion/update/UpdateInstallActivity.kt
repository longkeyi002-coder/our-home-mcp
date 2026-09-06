package com.hermes.companion.update

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import androidx.core.content.FileProvider

class UpdateInstallActivity : Activity() {
    private var requestedInstallSourcePermission = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (intent?.action != ACTION_INSTALL_READY_UPDATE) {
            finish()
            return
        }
        launchInstallerOrPermission()
    }

    override fun onResume() {
        super.onResume()
        if (requestedInstallSourcePermission && canInstallPackages()) {
            requestedInstallSourcePermission = false
            launchInstallerOrPermission()
        }
    }

    private fun canInstallPackages(): Boolean =
        Build.VERSION.SDK_INT < Build.VERSION_CODES.O || packageManager.canRequestPackageInstalls()

    private fun launchInstallerOrPermission() {
        val apk = UpdateStorage.readyApk(this)
        if (!apk.isFile) {
            finish()
            return
        }

        if (!canInstallPackages()) {
            requestedInstallSourcePermission = true
            startActivity(
                Intent(
                    Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                    Uri.parse("package:$packageName"),
                ),
            )
            return
        }

        val uri = FileProvider.getUriForFile(this, "$packageName.updates", apk)
        val installIntent = Intent(Intent.ACTION_VIEW).apply {
            setDataAndType(uri, APK_MIME_TYPE)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        startActivity(installIntent)
        finish()
    }

    companion object {
        const val ACTION_INSTALL_READY_UPDATE = "com.hermes.companion.action.INSTALL_READY_UPDATE"
        private const val APK_MIME_TYPE = "application/vnd.android.package-archive"
    }
}
