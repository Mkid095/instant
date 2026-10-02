package com.instantdb.poc

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.launch
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.slf4j.LoggerFactory
import com.instantdb.poc.transport.Transport
import java.util.UUID

/**
 * Minimal InstantDB client for the POC.
 *
 * Responsibilities (and ONLY these):
 *   - hold an InstantTransport
 *   - on connect, send `init` and await `init-ok`
 *   - provide `queryOnce(q)` -> `add-query-ok` result
 *   - provide `transact(txSteps)` -> ack with tx-id
 *   - expose a Flow of server messages so the caller can observe
 *     `refresh-ok` and other unsolicited events
 *
 * NO optimistic updates. NO mutation queue. NO persistence. NO reconnect.
 *
 * Design note: a single coroutine reads from transport.incoming() and
 * dispatches messages either to a waiter (via channel) or to subscribers
 * (via shared flow). This avoids the race where two collectors each get
 * different messages out of a single-channel source.
 */
class InstantDb(
    val config: InstantDbConfig,
    val transport: Transport,
    parentScope: CoroutineScope? = null,
) {
    private val log = LoggerFactory.getLogger(InstantDb::class.java)
    private val json = Json {
        ignoreUnknownKeys = true
        isLenient = true
        encodeDefaults = true
    }

    private val scope: CoroutineScope = parentScope ?: CoroutineScope(SupervisorJob())
    // Use a Channel so messages aren't dropped if no collector is active
    // yet. Channel is broadcast-style via a single coroutine fan-out.
    private val eventsChannel = kotlinx.coroutines.channels.Channel<JsonObject>(
        capacity = kotlinx.coroutines.channels.Channel.UNLIMITED,
    )
    private val _events = MutableSharedFlow<JsonObject>(
        replay = 0,
        extraBufferCapacity = 64,
    )

    /** Stream of every parsed server message after the transport is open. */
    val events: Flow<JsonObject> = _events.asSharedFlow()

    /**
     * Synchronously wait for the next event of a specific op. Useful
     * for tests; production code should use `events.collect` instead.
     */
    suspend fun awaitEvent(op: String, timeoutMs: Long = 10_000): JsonObject? {
        val deadline = System.currentTimeMillis() + timeoutMs
        while (System.currentTimeMillis() < deadline) {
            val msg = kotlinx.coroutines.withTimeoutOrNull(1_000) {
                eventsChannel.receive()
            } ?: return null
            if (msg["op"]?.jsonPrimitive?.content == op) return msg
        }
        return null
    }

    /** Optional waiter: if set, the next incoming message goes to it. */
    private var nextWaiter: Channel<JsonObject>? = null

    /** Cached `init-ok` payload. null until init completes. */
    var sessionInfo: InitOkMessage? = null
        private set

    private var readerJob: Job? = null

    /**
     * Subscriber for refresh messages. When the server pushes :refresh,
     * we look up the latest processed-tx-id for each subscribed query
     * and send back a refresh-ok. For the POC we don't track queries,
     * so we send an empty computations[] — the server logs a warning
     * but the protocol completes. (In the production SDK we'd maintain
     * a subscription map and call instaql on each refresh.)
     */
    private val pendingRefreshIds = mutableListOf<Long>()

    /**
     * Open the WebSocket, send `init`, await `init-ok`. After this returns
     * the client is ready for queries/transactions.
     */
    suspend fun init() {
        transport.connect()

        // Start a single reader that dispatches to either the active
        // waiter, a refresh handler, or to subscribers.
        readerJob = scope.launch {
            transport.incoming().collect { msg ->
                val op = msg["op"]?.jsonPrimitive?.content
                val waiter = nextWaiter

                // Server-pushed refresh: respond with refresh-ok.
                if (op == "refresh") {
                    val refresh = try {
                        json.decodeFromJsonElement(RefreshMessage.serializer(), msg)
                    } catch (e: Exception) {
                        log.warn("failed to parse refresh: ${e.message}")
                        null
                    }
                    if (refresh != null) {
                        pendingRefreshIds.add(refresh.txId)
                        val ack = RefreshOkMessage(
                            computations = emptyList(),
                            processedTxId = refresh.txId,
                            attrs = null,
                        )
                        val ackJson = json.encodeToJsonElement(RefreshOkMessage.serializer(), ack).jsonObject
                        transport.send(ackJson)
                    }
                    eventsChannel.trySend(msg)
                    _events.tryEmit(msg)
                    return@collect
                }

                if (waiter != null) {
                    waiter.trySend(msg)
                } else {
                    eventsChannel.trySend(msg)
                    _events.tryEmit(msg)
                }
            }
        }

        sendAndAwait(
            op = "init",
            payload = json.encodeToJsonElement(
                InitMessage.serializer(),
                InitMessage(
                    appId = config.appId,
                    refreshToken = config.refreshToken,
                    adminToken = config.adminToken,
                    versions = config.versions,
                ),
            ).jsonObject,
        ) { msg ->
            val op = msg["op"]?.jsonPrimitive?.content
            when (op) {
                "init-ok" -> {
                    sessionInfo = json.decodeFromJsonElement(InitOkMessage.serializer(), msg)
                    log.info(
                        "init-ok: session-id={} attrs_count={}",
                        sessionInfo?.sessionId,
                        sessionInfo?.attrs?.size ?: 0,
                    )
                    true
                }
                "error" -> {
                    val err = json.decodeFromJsonElement(ErrorMessage.serializer(), msg)
                    log.error("init error: {}", err.message)
                    false
                }
                else -> {
                    log.warn("unexpected message during init: op={}", op)
                    false
                }
            }
        }
    }

    /**
     * Send `add-query` and await `add-query-ok`. Returns the parsed result.
     */
    suspend fun queryOnce(q: JsonObject): AddQueryOkMessage {
        val eventId = UUID.randomUUID().toString()
        val payload = json.encodeToJsonElement(
            AddQueryMessage.serializer(),
            AddQueryMessage(op = "add-query", q = q, clientEventId = eventId),
        ).jsonObject

        return sendAndAwait(
            op = "add-query",
            payload = payload,
            match = { msg ->
                msg["op"]?.jsonPrimitive?.content == "add-query-ok" &&
                    msg["client-event-id"]?.jsonPrimitive?.content == eventId
            },
            decode = { msg ->
                json.decodeFromJsonElement(AddQueryOkMessage.serializer(), msg)
            },
        )
    }

    /**
     * Send `transact` and await `transact-ok`. Returns the ack.
     */
    suspend fun transact(txSteps: List<List<JsonElement>>): TransactOkMessage {
        val eventId = UUID.randomUUID().toString()
        val payload = json.encodeToJsonElement(
            TransactMessage.serializer(),
            TransactMessage(op = "transact", txSteps = txSteps, clientEventId = eventId),
        ).jsonObject

        return sendAndAwait(
            op = "transact",
            payload = payload,
            match = { msg ->
                msg["op"]?.jsonPrimitive?.content == "transact-ok" &&
                    msg["client-event-id"]?.jsonPrimitive?.content == eventId
            },
            decode = { msg ->
                json.decodeFromJsonElement(TransactOkMessage.serializer(), msg)
            },
        )
    }

    /**
     * Send [payload] and wait for a matching response. While waiting, all
     * non-matching messages are forwarded into `events`. On `error` we
     * throw unless the caller passes a tolerant matcher.
     */
    private suspend fun <T> sendAndAwait(
        op: String,
        payload: JsonObject,
        match: (JsonObject) -> Boolean,
        decode: (JsonObject) -> T,
    ): T {
        val waiter = Channel<JsonObject>(capacity = Channel.UNLIMITED)
        nextWaiter = waiter
        try {
            transport.send(payload)
            while (true) {
                val msg = waiter.receive()
                val opStr = msg["op"]?.jsonPrimitive?.content
                if (opStr == "error") {
                    val err = json.decodeFromJsonElement(ErrorMessage.serializer(), msg)
                    throw InstantDbException.ServerError(
                        err.message ?: "server error after $op",
                        err,
                    )
                }
                if (match(msg)) {
                    return decode(msg)
                }
                // Not ours — emit to subscribers and keep waiting.
                _events.tryEmit(msg)
            }
        } finally {
            nextWaiter = null
            waiter.close()
        }
    }

    /** Variant used by `init()`: init sends are awaited by the waiter channel. */
    private suspend fun sendAndAwait(
        op: String,
        payload: JsonObject,
        handle: (JsonObject) -> Boolean,
    ) {
        val waiter = Channel<JsonObject>(capacity = Channel.UNLIMITED)
        nextWaiter = waiter
        try {
            transport.send(payload)
            while (true) {
                val msg = waiter.receive()
                if (handle(msg)) return
                // If handle returns false, we keep waiting for the next
                // message. (We don't forward to events here because init
                // is the only call site.)
            }
        } finally {
            nextWaiter = null
            waiter.close()
        }
    }

    suspend fun close() {
        transport.close()
        scope.cancel()
    }
}

private fun kotlinx.serialization.json.JsonPrimitive.contentOrNull(): String? =
    if (this is kotlinx.serialization.json.JsonNull) null else this.content

/**
 * Config holds runtime parameters. `appId` and `apiUri` are required.
 * `refreshToken`/`adminToken` are optional; `adminToken` is used by the
 * POC for convenience but never logged.
 */
data class InstantDbConfig(
    val appId: String,
    val apiUri: String,
    val websocketUri: String,
    val refreshToken: String? = null,
    val adminToken: String? = null,
    val versions: Map<String, String>? = mapOf(
        "instantdb-kotlin" to "0.1.0-poc",
    ),
) {
    val wsUrl: String
        get() {
            val base = if (websocketUri.startsWith("ws://") || websocketUri.startsWith("wss://")) {
                websocketUri
            } else {
                val secure = apiUri.startsWith("https://") || !apiUri.startsWith("http://")
                val scheme = if (secure) "wss://" else "ws://"
                val host = apiUri.removePrefix("https://").removePrefix("http://").trimEnd('/')
                "$scheme$host"
            }
            return "$base/runtime/session?app_id=$appId"
        }
}

sealed class InstantDbException(message: String) : Exception(message) {
    data class InitFailed(val detail: String) : InstantDbException("init failed: $detail")
    data class ServerError(val msg: String, val payload: ErrorMessage) :
        InstantDbException("server error: $msg (trace=${payload.traceId})")
    data class ConnectionClosed(val detail: String) : InstantDbException("connection closed: $detail")
}
