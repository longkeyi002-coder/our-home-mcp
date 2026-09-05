package com.hermes.companion.update

object UpdateIntegrity {
    fun matchesSha256(actualHex: String, expectedHex: String): Boolean {
        if (actualHex.length != 64 || expectedHex.length != 64) return false
        return actualHex.equals(expectedHex, ignoreCase = true)
    }
}
