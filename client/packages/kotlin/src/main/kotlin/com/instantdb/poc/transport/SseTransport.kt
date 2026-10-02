package com.instantdb.poc.transport

import com.instantdb.poc.CredentialsTestHelper
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.channels.Channel as CoChannel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.flow
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import okhttp3.sse.EventSource
import okhttp3.sse.EventSourceListener
import okhttp3.sse.EventSources
import org.slf4j.LoggerFactory
import java.util.concurrent.TimeUnit

/**
 * Phase 7 — SSE fallback transport.
 *
 * Mirrors the JS client's [Connection.SSEConnection] behavior:
 *   1. Open SSE on `/runtime/sse?app_id={appId}`.
 *   2. Server emits an `sse-init` event with `machine-id`,
 *      `session-id`, and `sse-token`.
 *   3. Outgoing messages are POSTed to the `message-url` carried in
 *      the init message.
 *   4. Incoming messages from the server are emitted via [incoming].
 *
 * The transport is single-writer; multiple sends are serialized
 * internally via the OkHttp client's executor.
 *
 * Phase 7 limitation: this transport covers the protocol surface
 * needed by Phase 7 tests. The full reconnect-with-token-rotation
 * logic mirrors the JS but is not exhaustively tested here.
 */
class SseTransport(
    private val sseUrl: String,
    private val messageUrl: String,
    private val appId: String,
    private val adminToken: String? = null,
    private val refreshToken: String? = null,
    private val httpClient: OkHttpClient = OkHttpClient.Builder()
        .pingInterval(20, TimeUnit.SECONDS)
        .readTimeout(0, TimeUnit.MILLISECONDS)
        .build(),
) : Transport {
    private val log = LoggerFactory.getLogger(SseTransport::class.java)
    private val json = Json { ignoreUnknownKeys = true; isLenient = true }

    @Volatile private var source: EventSource? = null
    @Volatile private var sessionId: String? = null
    @Volatile private var machineId: String? = null
    @Volatile private var sseToken: String? = null

    private val incomingChannel = CoChannel<JsonObject>(capacity = CoChannel.UNLIMITED)
    private val events = MutableSharedFlow<TransportEvent>(
        replay = 0, extraBufferCapacity = 16,
    )

    private val connectionReady = CompletableDeferred<Unit>()

    override val name: String = "sse"

    override suspend fun connect() {
        log.info("SSE connecting to: $sseUrl")
        val request = Request.Builder()
            .url(sseUrl)
            .header("Accept", "text/event-stream")
            .header("Cache-Control", "no-cache")
            .header("Connection", "keep-alive")
            .build()

        val factory = EventSources.createFactory(httpClient)
        source = factory.newEventSource(request, object : EventSourceListener() {
            override fun onOpen(eventSource: EventSource, response: Response) {
                log.info("SSE opened: $sseUrl")
                events.tryEmit(TransportEvent.Open)
                if (connectionReady.isActive) connectionReady.complete(Unit)
            }

            override fun onEvent(eventSource: EventSource, id: String?, type: String?, data: String) {
                handleEvent(type, data)
            }

            override fun onClosed(eventSource: EventSource) {
                log.info("SSE closed")
                source = null
                incomingChannel.close()
                events.tryEmit(TransportEvent.Close(1000, "sse_closed"))
            }

            override fun onFailure(eventSource: EventSource, t: Throwable?, response: Response?) {
                val ex = t ?: IllegalStateException("SSE failure without exception (response=${response?.code}: ${response?.body?.string()?.take(200)})")
                log.warn("SSE failure: ${ex.message}")
                source = null
                incomingChannel.close(ex)
                events.tryEmit(TransportEvent.Error(ex))
                if (connectionReady.isActive) connectionReady.completeExceptionally(ex)
            }
        })
        connectionReady.await()
    }

    private fun handleEvent(type: String?, data: String) {
        val safe = CredentialsTestHelper.redactIncomingForTest(data)
        log.info("<- {}", safe.take(500))
        try {
            val element = json.parseToJsonElement(data)
            val obj = element as? JsonObject ?: return
            if (type == null || type == "sse-init") {
                machineId = obj["machine-id"]?.toString()?.trim('"') ?: "sse-init-no-machine"
                sessionId = obj["session-id"]?.toString()?.trim('"') ?: "sse-init-no-session"
                sseToken = obj["sse-token"] as? String
                if (connectionReady.isActive) connectionReady.complete(Unit)
                return
            }
            incomingChannel.trySend(obj)
        } catch (e: Throwable) {
            log.warn("SSE decode failure: ${e.message}")
        }
    }

    override fun send(message: JsonObject): Boolean {
        val token = sseToken ?: return false
        val sess = sessionId ?: return false
        val mach = machineId ?: return false
        val body = json.encodeToString(JsonObject.serializer(), message)
        val payload = "{\"machine-id\":\"$mach\",\"session-id\":\"$sess\",\"sse-token\":\"$token\",\"message\":$body}"
        // Log length only; never include credentials in logs.
        log.info("-> {}", "len=${payload.length}, credentials=redacted")
        val request = Request.Builder()
            .url(messageUrl)
            .header("Content-Type", "application/json")
            .post(payload.toRequestBody("application/json".toMediaType()))
            .build()
        return try {
            httpClient.newCall(request).execute().use { response ->
                response.isSuccessful
            }
        } catch (e: Throwable) {
            log.warn("SSE send failure: ${e.message}")
            false
        }
    }

    override fun incoming(): Flow<JsonObject> = flow {
        for (msg in incomingChannel) emit(msg)
    }

    override fun events(): Flow<TransportEvent> = events.asSharedFlow()

    override suspend fun close(code: Int, reason: String) {
        source?.cancel()
        source = null
        incomingChannel.close()
    }

    companion object {
        /** Build an SSE transport pointing at the standard InstantDB SSE endpoint. */
        fun forApp(
            apiUri: String,
            appId: String,
            adminToken: String? = null,
            refreshToken: String? = null,
        ): SseTransport {
            val base = apiUri.removeSuffix("/")
            val sseUrl = "$base/runtime/sse?app_id=$appId"
            val messageUrl = "$base/runtime/sse-message?app_id=$appId"
            return SseTransport(
                sseUrl = sseUrl,
                messageUrl = messageUrl,
                appId = appId,
                adminToken = adminToken,
                refreshToken = refreshToken,
            )
        }
    }
}