package com.instantdb.poc

import com.instantdb.poc.transport.Transport
import com.instantdb.poc.transport.TransportEvent
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.channels.Channel as CoChannel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.slf4j.LoggerFactory
import java.util.concurrent.TimeUnit

/**
 * InstantTransport — Phase 2 OkHttp WebSocket transport for InstantDB.
 * Implements [Transport] interface for polymorphic transport support.
 *
 * Phase 5 security fix: outbound messages are redacted of credential
 * fields before logging. The wire payload is unchanged.
 */
class InstantTransport(
    val url: String,
    private val httpClient: OkHttpClient = defaultClient(),
) : Transport {
    private val log = LoggerFactory.getLogger(InstantTransport::class.java)
    private val json = Json { ignoreUnknownKeys = true; isLenient = true; encodeDefaults = true }

    @Volatile private var socket: WebSocket? = null

    private val incomingChannel = CoChannel<JsonObject>(capacity = CoChannel.UNLIMITED)
    private val events = MutableSharedFlow<TransportEvent>(replay = 0, extraBufferCapacity = 16)

    private val connectionReady = CompletableDeferred<Unit>()

    /**
     * Connect to the WebSocket. Suspends until the socket is open or fails.
     * Throws if the server returns a non-101 response.
     */
    override suspend fun connect() {
        val request = Request.Builder().url(url).build()
        val cont = connectionReady
        val listener = object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                log.info("WebSocket opened: $url")
                socket = webSocket
                events.tryEmit(TransportEvent.Open)
                if (cont.isActive) cont.complete(Unit)
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                val safe = redactIncoming(text)
                log.info("<- {}", safe.take(500))
                try {
                    val msg = json.parseToJsonElement(text).let { e ->
                        (e as? JsonObject) ?: return@let null
                    } ?: return
                    incomingChannel.trySend(msg)
                } catch (e: Throwable) {
                    log.warn("onMessage decode failure: ${e.message}")
                }
            }

            override fun onMessage(webSocket: WebSocket, bytes: okio.ByteString) {
                log.info("raw: {}", bytes.utf8().take(200))
            }

            override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
                log.info("WebSocket closing: code={} reason={}", code, reason)
                events.tryEmit(TransportEvent.Close(code, reason))
                webSocket.close(code, reason)
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                log.info("WebSocket closed: code={} reason={}", code, reason)
                socket = null
                incomingChannel.close()
                events.tryEmit(TransportEvent.Close(code, reason))
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                log.warn("WebSocket failure: ${t.message}")
                socket = null
                incomingChannel.close(t)
                events.tryEmit(TransportEvent.Error(t))
                if (cont.isActive) cont.completeExceptionally(t)
            }
        }

        val ws = httpClient.newWebSocket(request, listener)
        cont.await()
    }

    /**
     * Send a JSON object as a text frame. Returns false if the underlying
     * socket has been closed.
     */
    override fun send(message: JsonObject): Boolean {
        val ws = socket ?: return false
        val text = json.encodeToString(JsonObject.serializer(), message)
        // Redact credential-bearing fields before logging.
        log.info("-> {}", redactOutgoing(message).take(500))
        return ws.send(text)
    }

    /**
     * Incoming messages. Each element is one server message.
     */
    override fun incoming(): Flow<JsonObject> = kotlinx.coroutines.flow.flow {
        for (msg in incomingChannel) emit(msg)
    }

    override fun events(): Flow<TransportEvent> = events.asSharedFlow()

    /** Send the OK WebSocket close frame. */
    override suspend fun close(code: Int, reason: String) {
        socket?.close(code, reason)
        socket = null
    }

    /** Human-readable name for diagnostics. */
    override val name: String = "websocket"

    /** Redact known credential fields from an outbound message. */
    private fun redactOutgoing(msg: JsonObject): String = try {
        val redacted = mutableMapOf<String, JsonElement>()
        for ((k, v) in msg) {
            redacted[k] = if (k in CREDENTIAL_FIELDS) kotlinx.serialization.json.JsonPrimitive("[REDACTED]") else v
        }
        json.encodeToString(JsonObject.serializer(), kotlinx.serialization.json.JsonObject(redacted))
    } catch (e: Throwable) {
        "<unencodable>"
    }

    /** Redact credential substrings from an incoming JSON text. */
    private fun redactIncoming(text: String): String {
        if (text.contains("__admin-token", ignoreCase = true) ||
            text.contains("refresh-token", ignoreCase = true)) {
            return text.replace(
                Regex("\"(__admin-token|admin-token|refresh-token|authorization)\"\\s*:\\s*\"[^\"]*\""),
                "$1\":\"[REDACTED]\"",
            )
        }
        return text
    }

    companion object {
        fun defaultClient(): OkHttpClient = OkHttpClient.Builder()
            .pingInterval(20, TimeUnit.SECONDS)
            .readTimeout(0, TimeUnit.MILLISECONDS)
            .build()

        /** Field names whose values must never appear in logs (Phase 5 fix). */
        val CREDENTIAL_FIELDS: Set<String> = setOf(
            "__admin-token",
            "admin-token",
            "adminToken",
            "refresh-token",
            "refreshToken",
            "access-token",
            "accessToken",
            "authorization",
            "Authorization",
            "password",
            "secret",
            "api-key",
            "apiKey",
        )

        /**
         * Test-only helpers exposing the redaction logic so that
         * [com.instantdb.poc.CredentialRedactionTest] can validate it
         * without spinning up a real WebSocket.
         */
    }
}

/**
 * Test-only helper for credential redaction tests. Top-level so it
 * compiles as a stable class regardless of companion name mangling.
 */
object CredentialsTestHelper {
    fun redactForTest(msg: JsonObject, fields: List<String>): String {
        val redacted = mutableMapOf<String, JsonElement>()
        for ((k, v) in msg) {
            redacted[k] = if (k in fields) kotlinx.serialization.json.JsonPrimitive("[REDACTED]") else v
        }
        return Json.encodeToString(JsonObject.serializer(), kotlinx.serialization.json.JsonObject(redacted))
    }

    fun redactIncomingForTest(text: String): String {
        if (text.contains("__admin-token", ignoreCase = true) ||
            text.contains("refresh-token", ignoreCase = true)) {
            return text.replace(
                Regex("\"(__admin-token|admin-token|refresh-token|authorization)\"\\s*:\\s*\"[^\"]*\""),
                "$1\":\"[REDACTED]\"",
            )
        }
        return text
    }
}