package com.hermes.companion

import com.hermes.companion.vision.VisionProviderSettingsStore
import com.hermes.companion.vision.ZhipuVisionProvider
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertTrue
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Test

class ZhipuVisionProviderTest {
    @Test
    fun defaultsUseOfficialZhipuEndpointAndFreeVisionModel() {
        assertEquals("https://open.bigmodel.cn/api/paas/v4/", VisionProviderSettingsStore.DEFAULT_BASE_URL)
        assertEquals("glm-4.6v-flash", VisionProviderSettingsStore.DEFAULT_MODEL)
    }

    @Test
    fun baseUrlRequiresHttpsAndNormalizesSlash() {
        assertEquals(
            "https://open.bigmodel.cn/api/paas/v4/",
            VisionProviderSettingsStore.normalizeHttpsBaseUrl("https://open.bigmodel.cn/api/paas/v4"),
        )
        assertFailsWith<IllegalArgumentException> {
            VisionProviderSettingsStore.normalizeHttpsBaseUrl("http://open.bigmodel.cn/api/paas/v4/")
        }
        assertFailsWith<IllegalArgumentException> {
            VisionProviderSettingsStore.normalizeHttpsBaseUrl("https://user:secret@example.com/v1/")
        }
    }

    @Test
    fun requestUsesImageInputAndDisablesThinkingForCheapClassification() {
        val payload = ZhipuVisionProvider.buildRequestJson("glm-4.6v-flash", "fake-base64")
        val root = Json.parseToJsonElement(payload).jsonObject
        assertEquals("glm-4.6v-flash", root["model"]?.jsonPrimitive?.content)
        assertEquals("disabled", root["thinking"]?.jsonObject?.get("type")?.jsonPrimitive?.content)
        assertFalse(root["stream"]!!.jsonPrimitive.content.toBoolean())

        val content = root["messages"]!!.jsonArray[0].jsonObject["content"]!!.jsonArray
        assertEquals("image_url", content[0].jsonObject["type"]?.jsonPrimitive?.content)
        assertEquals("fake-base64", content[0].jsonObject["image_url"]?.jsonObject?.get("url")?.jsonPrimitive?.content)
        val prompt = content[1].jsonObject["text"]!!.jsonPrimitive.content
        assertTrue(prompt.contains("Do NOT transcribe"))
        assertTrue(prompt.contains("passwords"))
        assertTrue(prompt.contains("OTP"))
        assertTrue(prompt.contains("Do not perform OCR"))
    }

    @Test
    fun responseIsReducedToBoundedStructuredContext() {
        val body = """{
          "choices": [{"message": {"content": "```json\n{\\"activity\\":\\"gaming\\",\\"content\\":\\"generic battle scene\\",\\"confidence\\":0.91}\n```"}}]
        }"""
        val result = ZhipuVisionProvider.parseResponse(body, "glm-4.6v-flash")
        assertEquals("gaming", result.activity)
        assertEquals("generic battle scene", result.content)
        assertEquals(0.91, result.confidence)
        assertEquals("zhipu", result.provider)
    }

    @Test
    fun unknownActivityFailsClosedToUnknown() {
        val body = """{"choices":[{"message":{"content":"{\\"activity\\":\\"identity_theft\\",\\"content\\":\\"x\\",\\"confidence\\":7}"}}]}"""
        val result = ZhipuVisionProvider.parseResponse(body, "glm-4.6v-flash")
        assertEquals("unknown", result.activity)
        assertEquals(1.0, result.confidence)
    }
}
