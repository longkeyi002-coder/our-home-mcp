package com.hermes.companion.push

import com.hermes.companion.data.SettingsRepository

enum class ProactiveMessageHealth {
    READY,
    NOTIFICATION_PERMISSION_REQUIRED,
    REGISTERING,
    PUSH_ERROR,
    PUSH_NOT_READY,
}

object PushHealth {
    fun evaluate(notificationsEnabled: Boolean, registrationState: String): ProactiveMessageHealth {
        if (!notificationsEnabled) return ProactiveMessageHealth.NOTIFICATION_PERMISSION_REQUIRED
        return when (registrationState) {
            SettingsRepository.PUSH_REGISTERED -> ProactiveMessageHealth.READY
            SettingsRepository.PUSH_SCHEDULED,
            SettingsRepository.PUSH_REGISTERING,
            -> ProactiveMessageHealth.REGISTERING
            SettingsRepository.PUSH_ERROR -> ProactiveMessageHealth.PUSH_ERROR
            else -> ProactiveMessageHealth.PUSH_NOT_READY
        }
    }

    fun userLabel(value: ProactiveMessageHealth): String = when (value) {
        ProactiveMessageHealth.READY -> "已开启"
        ProactiveMessageHealth.NOTIFICATION_PERMISSION_REQUIRED -> "需要通知权限"
        ProactiveMessageHealth.REGISTERING -> "正在连接"
        ProactiveMessageHealth.PUSH_ERROR -> "需要修复"
        ProactiveMessageHealth.PUSH_NOT_READY -> "等待连接"
    }
}
