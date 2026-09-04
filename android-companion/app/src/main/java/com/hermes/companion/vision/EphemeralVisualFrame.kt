package com.hermes.companion.vision

/**
 * OH-42/OH-69: screenshot bytes are short-lived in-memory data. They are never a file,
 * preference value, diagnostic field, or log payload. Consumers must close the frame.
 */
class EphemeralVisualFrame private constructor(
    val requestId: String,
    val packageName: String,
    private var bytes: ByteArray?,
) : AutoCloseable {
    val size: Int
        get() = bytes?.size ?: 0

    val isClosed: Boolean
        get() = bytes == null

    fun <T> useBytes(block: (ByteArray) -> T): T {
        val value = bytes ?: throw IllegalStateException("visual frame is already closed")
        return block(value)
    }

    override fun close() {
        val value = bytes ?: return
        value.fill(0)
        bytes = null
    }

    companion object {
        fun jpeg(requestId: String, packageName: String, bytes: ByteArray): EphemeralVisualFrame {
            require(requestId.isNotBlank())
            require(packageName.isNotBlank())
            require(bytes.isNotEmpty())
            return EphemeralVisualFrame(requestId, packageName, bytes)
        }
    }
}
