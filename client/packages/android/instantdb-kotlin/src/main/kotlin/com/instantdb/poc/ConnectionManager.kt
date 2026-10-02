package com.instantdb.poc

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.channels.BufferOverflow
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.slf4j.LoggerFactory
import java.util.UUID

/**
 * Connection lifecycle manager.
 *
 * Source of truth: client/packages/core/src/Reactor.js
 *   - `_startSocket`       line 1878-1931
 *   - `_transportOnClose`  line 1844-1876
 *   - `_transportOnOpen`   line 1747-1798
 *   - `_scheduleReconnect` line 1820-1842
 *   - `_handleReceive`     line 633-936 (init-ok branch: 644-659)
 *   - `shutdown`           line 2119-2140
 *
 * Responsibilities:
 *   - Hold an InstantTransport lifecycle (connect, disconnect, reconnect)
 *   - Send `init` after the WebSocket opens and track init-ok
 *   - Restore subscriptions after reconnect
 *   - Linear backoff with 1s increment, 10s cap (matching JS)
 *   - Surface connection state changes via StateFlow for the UI/tests
 *   - Fan incoming server messages out to:
 *       a) the SubscriptionManager
 *       b) the MutationQueue
 *       c) any other subscribers (debug, devtool)
 *
 * Out of scope for Phase 2:
 *   - SSE fallback (deferred to Phase 3)
 *   - Persistent auth tokens (deferred)
 */
class ConnectionManager(
    val config: InstantDbConfig,
    val scope: CoroutineScope = CoroutineScope(SupervisorJob() + Dispatchers.Default),
    val createTransport: (String) -> InstantTransport = ::defaultTransport,
) {
    private val log = LoggerFactory.getLogger(ConnectionManager::class.java)
    private val json = Json {
        ignoreUnknownKeys = true
        isLenient = true
        encodeDefaults = true
    }

    private val _state = MutableStateFlow(ConnectionState.Disconnected)
    val state: StateFlow<ConnectionState> = _state.asStateFlow()

    private val _incoming = MutableSharedFlow<JsonObject>(
        replay = 0,
        extraBufferCapacity = 128,
        onBufferOverflow = BufferOverflow.DROP_OLDEST,
    )
    val incoming: SharedFlow<JsonObject> = _incoming.asSharedFlow()

    /** Set by `init` once init-ok has been received. */
    @Volatile var sessionId: String? = null
        private set

    /** Set by `init` once init-ok has been received. */
    @Volatile var attrs: JsonObject? = null
        private set

    private val _appStatus = MutableStateFlow<String?>(null)
    val appStatus: StateFlow<String?> = _appStatus.asStateFlow()

    /** Set when `shutdown()` has been invoked. */
    @Volatile private var isShutdown = false

    private var transport: InstantTransport? = null
    private var connectJob: Job? = null
    private var reconnectJob: Job? = null
    private var readerJob: Job? = null
    private var backoffMs = 0

    private val mutex = Mutex()

    // -----------------------------------------------------------------
    // Public API
    // -----------------------------------------------------------------

    /**
     * Open the connection and run `init`. Returns once init-ok has
     * been received and the connection is in `Connected` state.
     *
     * Mirrors `_startSocket` + `_transportOnOpen` + init-ok handler in
     * Reactor.js. On failure, schedules a reconnect.
     */
    suspend fun connect() {
        if (isShutdown) throw IllegalStateException("ConnectionManager is shut down")
        mutex.withLock {
            if (_state.value != ConnectionState.Disconnected) return@withLock
            connectJob = scope.launch { doConnect() }
        }
        connectJob?.join()
    }

    /**
     * Send a JSON object. Throws if the connection is not in
     * `Connected` state.
     */
    fun send(message: JsonObject) {
        val t = transport
            ?: throw IllegalStateException("not connected (state=${_state.value})")
        val text = json.encodeToString(JsonObject.serializer(), message)
        log.debug("-> {}", text.take(300))
        if (!t.send(message)) {
            throw IllegalStateException("send() returned false (state=${_state.value})")
        }
    }

    /**
     * Permanently stop the connection. Mirrors `shutdown()` in
     * Reactor.js:2119-2140. Cannot be restarted.
     */
    suspend fun shutdown() {
        if (isShutdown) return
        isShutdown = true
        log.info("shutdown requested")
        reconnectJob?.cancel()
        connectJob?.cancel()
        readerJob?.cancel()
        transport?.close()
        transition(ConnectionState.Closed, ConnectionEvent.Shutdown)
    }

    // -----------------------------------------------------------------
    // Lifecycle internals
    // -----------------------------------------------------------------

    private suspend fun doConnect() {
        transition(ConnectionState.Connecting, ConnectionEvent.StartConnect)

        val t = try {
            createTransport(config.wsUrl).also { transport = it }
        } catch (e: Exception) {
            log.error("failed to create transport: ${e.message}")
            scheduleReconnect()
            return
        }

        try {
            t.connect()
        } catch (e: Exception) {
            log.warn("connect() failed: ${e.message}")
            transport = null
            scheduleReconnect()
            return
        }

        transition(ConnectionState.Initializing, ConnectionEvent.SocketOpen)
        startReader(t)

        // Send init immediately.
        val initMsg = InitMessage(
            appId = config.appId,
            refreshToken = config.refreshToken,
            adminToken = config.adminToken,
            versions = config.versions,
        )
        val initJson = json.encodeToJsonElement(InitMessage.serializer(), initMsg).jsonObject
        t.send(initJson)

        // Wait for init-ok (or error). The reader will transition us
        // to Connected on success, or to Reconnecting on failure.
        // Bound the wait so we can recover if the server never replies.
        try {
            withTimeout(15_000) {
                while (_state.value == ConnectionState.Initializing && isActive) {
                    delay(100)
                }
            }
        } catch (e: Exception) {
            log.warn("init timed out: ${e.message}")
            scheduleReconnect()
        }
    }

    /**
     * Reads incoming messages from the transport, dispatches them to
     * subscribers, and reacts to init-ok / close / error.
     */
    private fun startReader(t: InstantTransport) {
        readerJob?.cancel()
        readerJob = scope.launch {
            t.incoming().collect { msg ->
                val op = msg["op"]?.jsonPrimitive?.content
                when (op) {
                    "init-ok" -> handleInitOk(msg)
                    "error" -> handleError(msg)
                    else -> _incoming.tryEmit(msg)
                }
            }
        }
    }

    private fun handleInitOk(msg: JsonObject) {
        sessionId = msg["session-id"]?.jsonPrimitive?.content
        // Server sends attrs as a JSON array of attribute descriptors.
        // Wrap it in a JsonObject under the "attrs" key for callers.
        val attrsArr = msg["attrs"] as? kotlinx.serialization.json.JsonArray
        attrs = if (attrsArr != null) {
            kotlinx.serialization.json.JsonObject(mapOf("attrs" to attrsArr))
        } else {
            msg["attrs"] as? JsonObject
        }
        val status = msg["app-status"]?.jsonObject?.get("status")?.jsonPrimitive?.content
        _appStatus.value = status
        log.info("init-ok: session-id={} app-status={}", sessionId, status)
        // Reset backoff on successful connect.
        backoffMs = 0
        transition(ConnectionState.Connected, ConnectionEvent.InitOk)
        // Notify the application layer (e.g., to replay subscriptions).
        _incoming.tryEmit(msg)
    }

    private fun handleError(msg: JsonObject) {
        log.error("server error during init/operation: {}", msg)
        // Surface as an event so the application can react. The connection
        // remains in Connected (or Initializing) — the server may continue
        // accepting messages. For init errors, schedule a reconnect.
        _incoming.tryEmit(msg)
        if (_state.value == ConnectionState.Initializing) {
            scheduleReconnect()
        }
    }

    /**
     * Mirror of `_scheduleReconnect`. Linear backoff: starts at 0,
     * increments by 1s each retry, capped at 10s. Resets on successful
     * init-ok.
     */
    private fun scheduleReconnect() {
        if (isShutdown) return
        if (_state.value == ConnectionState.Reconnecting) return // already scheduled

        // Close the current transport cleanly.
        scope.launch { transport?.close() }
        transport = null
        readerJob?.cancel()
        readerJob = null

        backoffMs = (backoffMs + 1_000).coerceAtMost(10_000)
        transition(ConnectionState.Reconnecting, ConnectionEvent.ScheduleReconnect)

        reconnectJob?.cancel()
        reconnectJob = scope.launch {
            log.info("reconnect scheduled in ${backoffMs}ms")
            delay(backoffMs.toLong())
            if (isShutdown) return@launch
            connectJob = scope.launch { doConnect() }
        }
    }

    /**
     * External entrypoint for forced disconnect (used by tests).
     */
    fun forceDisconnectForTest() {
        log.warn("forceDisconnectForTest")
        scheduleReconnect()
    }

    // -----------------------------------------------------------------
    // State helpers
    // -----------------------------------------------------------------

    private fun transition(next: ConnectionState, via: ConnectionEvent) {
        val prev = _state.value
        if (prev == next) return
        log.info("state: $prev -> $next (via=$via)")
        _state.value = next
        when (via) {
            ConnectionEvent.SocketClose,
            ConnectionEvent.SocketError,
            ConnectionEvent.NetworkOffline ->
                if (!isShutdown) scheduleReconnect()
            else -> {}
        }
    }
}

private fun defaultTransport(url: String): InstantTransport = InstantTransport(url)
