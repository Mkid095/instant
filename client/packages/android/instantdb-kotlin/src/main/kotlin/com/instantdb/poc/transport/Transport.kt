package com.instantdb.poc.transport

import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.serialization.json.JsonObject

/**
 * Phase 7 — Transport abstraction.
 *
 * Decouples SyncCoordinator from any specific transport mechanism
 * (WebSocket or SSE). Two implementations are provided:
 *   - [WebSocketTransport] (Phase 2/3/4/5/6)
 *   - [SseTransport] (Phase 7)
 *
 * The transport is responsible for:
 *   - authentication
 *   - message framing
 *   - reconnect
 *   - sending outgoing payloads
 *   - exposing incoming payloads as a Flow
 *
 * SyncCoordinator must not care which transport is in use.
 */
interface Transport {
    /** Open the underlying connection. Suspends until ready. */
    suspend fun connect()

    /** Send a JSON payload. Returns false if the connection is closed. */
    fun send(message: JsonObject): Boolean

    /** Stream of parsed server messages. */
    fun incoming(): Flow<JsonObject>

    /** Open / close / error events for diagnostic surfaces. */
    fun events(): Flow<TransportEvent>

    /** Close the underlying connection. */
    suspend fun close(code: Int = 1000, reason: String = "client_close")

    /** Human-readable name for diagnostics ("websocket", "sse"). */
    val name: String
}

sealed class TransportEvent {
    data object Open : TransportEvent()
    data class Close(val code: Int, val reason: String) : TransportEvent()
    data class Error(val cause: Throwable) : TransportEvent()
    data class Reconnecting(val attempt: Int, val nextDelayMs: Int) : TransportEvent()
}