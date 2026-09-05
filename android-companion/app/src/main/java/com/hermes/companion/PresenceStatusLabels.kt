package com.hermes.companion

import com.hermes.companion.presence.PresenceSnapshot

// OH-43/OH-46: a granted permission is not evidence of a live sensor.
internal fun presenceStatusLabel(enabled: Boolean, snapshot: PresenceSnapshot?): String = when {
    !enabled -> "需要开启"
    snapshot?.accessibilityConnected != true -> "等待感知服务连接"
    !snapshot.screenInteractive -> "屏幕关闭，已暂停"
    !snapshot.unlocked -> "屏幕锁定，已暂停"
    snapshot.currentPackage == null -> "等待应用状态"
    else -> "正在感知应用切换"
}

internal fun screenStatusLabel(enabled: Boolean, snapshot: PresenceSnapshot?): String = when {
    !enabled -> "等待感知权限"
    snapshot?.accessibilityConnected != true -> "暂时未知"
    !snapshot.screenInteractive -> "屏幕已关闭"
    !snapshot.unlocked -> "屏幕已锁定"
    else -> "屏幕已解锁"
}
