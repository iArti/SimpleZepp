package com.thewizrd.simplewear.zepp

import android.util.Base64
import org.json.JSONArray
import org.json.JSONObject
import java.nio.ByteBuffer
import java.nio.charset.CharacterCodingException
import java.nio.charset.CodingErrorAction
import java.nio.charset.StandardCharsets

/**
 * Phone -> watch half of the Zepp OS transport.
 *
 * Wear OS pushes messages to the watch; a Zepp OS app-side can only make HTTP requests, so
 * outgoing messages are queued here and collected by the app-side with a long poll on /events.
 */
object ZeppBridge {
    /** Node id used in place of a Wear OS node for messages that come from the Zepp watch */
    const val NODE_ID = "zepp"

    /** Loopback port the Zepp app-side connects to */
    const val PORT = 47821

    /** Zepp's fetch gives up after ~10 s, so a long poll must answer before that */
    const val MAX_WAIT_MS = 8000L

    /** Watch counts as connected while it keeps polling */
    private const val CONNECTED_WINDOW_MS = 30_000L
    private const val MAX_QUEUE = 200

    private val lock = Object()
    private val outbox = ArrayDeque<Pair<String, ByteArray?>>()

    @Volatile
    private var lastPoll = 0L

    fun isConnected(): Boolean = System.currentTimeMillis() - lastPoll < CONNECTED_WINDOW_MS

    fun enqueue(path: String, data: ByteArray?) {
        // Nobody is listening: replies would only pile up and arrive stale
        if (!isConnected()) {
            android.util.Log.d("ZeppBridge", "drop $path (watch not polling)")
            return
        }

        synchronized(lock) {
            outbox.addLast(path to data)
            while (outbox.size > MAX_QUEUE) outbox.removeFirst()
            lock.notifyAll()
        }
    }

    /** Waits up to [waitMs] for at least one message, then returns everything queued */
    fun take(waitMs: Long): List<Pair<String, ByteArray?>> {
        lastPoll = System.currentTimeMillis()
        synchronized(lock) {
            if (outbox.isEmpty() && waitMs > 0) {
                lock.wait(waitMs.coerceAtMost(MAX_WAIT_MS))
            }
            val messages = outbox.toList()
            outbox.clear()
            lastPoll = System.currentTimeMillis()
            return messages
        }
    }

    fun clear() {
        synchronized(lock) { outbox.clear() }
    }

    fun toJson(messages: List<Pair<String, ByteArray?>>): JSONObject {
        val arr = JSONArray()
        for ((path, data) in messages) {
            arr.put(JSONObject().apply {
                put("path", path)
                if (data != null) {
                    put("b64", Base64.encodeToString(data, Base64.NO_WRAP))
                    // Most payloads are JSON or enum names; spare the watch from decoding them
                    decodeUtf8(data)?.let { put("text", it) }
                }
            })
        }
        return JSONObject().put("messages", arr)
    }

    private fun decodeUtf8(data: ByteArray): String? {
        if (data.isEmpty()) return ""
        return try {
            val text = StandardCharsets.UTF_8.newDecoder()
                .onMalformedInput(CodingErrorAction.REPORT)
                .onUnmappableCharacter(CodingErrorAction.REPORT)
                .decode(ByteBuffer.wrap(data))
                .toString()
            // Single bytes / ints / longs decode as control characters: leave those to b64
            if (text.any { it.code < 0x20 && it != '\n' && it != '\r' && it != '\t' }) null else text
        } catch (e: CharacterCodingException) {
            null
        }
    }
}
