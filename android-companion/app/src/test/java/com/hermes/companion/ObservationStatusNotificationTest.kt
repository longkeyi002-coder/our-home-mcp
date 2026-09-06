package com.hermes.companion

import com.hermes.companion.vision.ObservationStatusMode
import com.hermes.companion.vision.observationStatusPresentation
import kotlin.test.Test
import kotlin.test.assertContains
import kotlin.test.assertEquals

class ObservationStatusNotificationTest {
    @Test
    fun sensingStateExplicitlySaysScreenIsNotBeingObserved() {
        val presentation = observationStatusPresentation(ObservationStatusMode.SENSING, "微信")

        assertEquals("仅感知 App", presentation.title)
        assertContains(presentation.text, "微信")
        assertContains(presentation.text, "尚未观察屏幕")
    }

    @Test
    fun aiComingStateSeparatesRuntimeAttentionFromActualCapture() {
        val presentation = observationStatusPresentation(ObservationStatusMode.AI_COMING, "微信")

        assertEquals("AI 已收到切换，正在过来看", presentation.title)
        assertContains(presentation.text, "微信")
        assertContains(presentation.text, "等待本次视觉观察开始")
    }

    @Test
    fun observingStateIsUnambiguous() {
        val presentation = observationStatusPresentation(ObservationStatusMode.OBSERVING, "微信")

        assertEquals("正在观察屏幕", presentation.title)
        assertContains(presentation.text, "正在截图并进行视觉分析")
    }

    @Test
    fun privateAppNeverDisplaysItsIdentity() {
        val presentation = observationStatusPresentation(ObservationStatusMode.PRIVATE_APP, "com.secret.bank")

        assertEquals("当前 App 已设为不感知", presentation.title)
        assertEquals("Our Home 不读取此 App 身份或屏幕", presentation.text)
    }

    @Test
    fun lockedAndScreenOffStatesSayObservationIsStopped() {
        val locked = observationStatusPresentation(ObservationStatusMode.LOCKED)
        val screenOff = observationStatusPresentation(ObservationStatusMode.SCREEN_OFF)

        assertContains(locked.text, "没有观察屏幕")
        assertContains(screenOff.text, "没有观察屏幕")
    }
}
