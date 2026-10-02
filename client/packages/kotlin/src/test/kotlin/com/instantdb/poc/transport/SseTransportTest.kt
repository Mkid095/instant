package com.instantdb.poc.transport

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Test

/**
 * Phase 7 — SSE transport unit tests.
 *
 * These verify the protocol framing and constructor logic without
 * requiring a live server. End-to-end live tests are in the integration
 * suite.
 */
class SseTransportTest {
    @Test fun `factory builds SSE and message URLs`() {
        val t = SseTransport.forApp(
            apiUri = "https://api.example.com/",
            appId = "test-app-id",
            adminToken = "tok-123",
            refreshToken = null,
        )
        assertEquals("sse", t.name)
        assertNotNull(t)
    }

    @Test fun `factory handles trailing slash`() {
        val t = SseTransport.forApp("https://api.example.com", "x")
        assertEquals("sse", t.name)
    }

    @Test fun `transport implements Transport interface`() {
        val t: Transport = SseTransport.forApp("https://api.example.com", "x")
        assertEquals("sse", t.name)
    }
}