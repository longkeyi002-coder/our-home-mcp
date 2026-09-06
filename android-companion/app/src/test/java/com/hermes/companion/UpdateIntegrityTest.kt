package com.hermes.companion

import com.hermes.companion.update.UpdateIntegrity
import kotlin.test.assertFalse
import kotlin.test.assertTrue
import org.junit.Test

class UpdateIntegrityTest {
    @Test
    fun exactSha256MatchesCaseInsensitively() {
        val digest = "0123456789abcdef".repeat(4)
        assertTrue(UpdateIntegrity.matchesSha256(digest, digest.uppercase()))
    }

    @Test
    fun mismatchedSha256FailsClosed() {
        val actual = "a".repeat(64)
        val expected = "b".repeat(64)
        assertFalse(UpdateIntegrity.matchesSha256(actual, expected))
    }

    @Test
    fun malformedDigestFailsClosed() {
        assertFalse(UpdateIntegrity.matchesSha256("abc", "abc"))
    }
}
