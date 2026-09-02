package com.hermes.companion.platform

import android.content.Context
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.os.Build
import com.hermes.companion.data.SettingsRepository
import java.time.LocalDate
import kotlin.coroutines.resume
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withTimeoutOrNull

/** Converts Android's reboot-relative step counter into a best-effort local-day total. */
object StepCounterReader {
    suspend fun readToday(context: Context, settings: SettingsRepository): Long? {
        if (Build.VERSION.SDK_INT >= 29 &&
            context.checkSelfPermission(android.Manifest.permission.ACTIVITY_RECOGNITION) != android.content.pm.PackageManager.PERMISSION_GRANTED
        ) return null
        val manager = context.getSystemService(SensorManager::class.java) ?: return null
        val sensor = manager.getDefaultSensor(Sensor.TYPE_STEP_COUNTER) ?: return null
        return withTimeoutOrNull(2_000L) {
            suspendCancellableCoroutine { continuation ->
                val listener = object : SensorEventListener {
                    override fun onSensorChanged(event: SensorEvent) {
                        if (event.values.isEmpty() || continuation.isCompleted) return
                        val total = event.values[0].toLong().coerceAtLeast(0L)
                        val today = LocalDate.now().toString()
                        val baselineDate = settings.stepBaselineDate()
                        var baseline = settings.stepBaseline()
                        if (baselineDate != today || baseline == null || total < baseline) {
                            baseline = total
                            settings.saveStepBaseline(today, total)
                        }
                        manager.unregisterListener(this)
                        continuation.resume((total - baseline).coerceAtLeast(0L))
                    }

                    override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) = Unit
                }
                if (!manager.registerListener(listener, sensor, SensorManager.SENSOR_DELAY_NORMAL)) {
                    continuation.resume(null)
                }
                continuation.invokeOnCancellation { manager.unregisterListener(listener) }
            }
        }
    }
}
