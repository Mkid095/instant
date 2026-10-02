package com.instantdb.poc

import com.instantdb.poc.transport.SseTransport
import com.instantdb.poc.transport.Transport
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable

/**
 * Live verification tests against the real InstantDB VPS.
 * These tests only run when LIVE_TEST=1 is set.
 */
@EnabledIfEnvironmentVariable(named = "LIVE_TEST", matches = "1")
class LiveTransportVerificationTest {
    companion object {
        private const val HOST = "https://api.instantdb.com"
        private const val APP_ID = "24a4d71b-7bb2-4630-9aee-01146af26239"
    }

    @Test
    fun `SSE transport connects and receives sse-init from live VPS`(): Unit = runBlocking {
        val transport = SseTransport(
            sseUrl = "$HOST/runtime/sse?app_id=$APP_ID",
            messageUrl = "$HOST/runtime/session?app_id=$APP_ID",
            appId = APP_ID,
            adminToken = null,
            refreshToken = null,
        )

        assertEquals("sse", transport.name)

        transport.connect()

        val msg = withTimeoutOrNull(10_000) {
            transport.incoming().first()
        }

        assertNotNull(msg, "Should receive sse-init message")
        assertEquals("sse-init", msg!!.get("op")?.jsonPrimitive?.content)

        val sseToken = msg["sse-token"]?.jsonPrimitive?.content
        assertNotNull(sseToken, "Should have sse-token")
        println("SSE connected! token=${sseToken!!.take(8)}...")

        transport.close()
    }

    @Test
    fun `Transport polymorphism - InstantDb accepts Transport interface with both implementations`() {
        // Verify both transport types implement the Transport interface
        val wsTransport: Transport = InstantTransport("$HOST/runtime/session?app_id=$APP_ID")
        val sseTransport: Transport = SseTransport(
            sseUrl = "$HOST/runtime/sse",
            messageUrl = "$HOST/runtime/session",
            appId = APP_ID,
            adminToken = null,
            refreshToken = null,
        )

        assertEquals("websocket", wsTransport.name)
        assertEquals("sse", sseTransport.name)

        println("Transport polymorphism verified: both WebSocket and SSE implement Transport interface")
    }
}
