package com.instantdb.android

import android.content.Context
import com.instantdb.android.connectivity.AndroidConnectivityManager
import com.instantdb.android.credentials.SecureCredentialStorage
import com.instantdb.poc.InstantDb as JvmInstantDb
import com.instantdb.poc.InstantDbConfig as JvmConfig
import com.instantdb.poc.InstantTransport
import com.instantdb.poc.transport.SseTransport
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject

/**
 * Main InstantDB Android SDK entry point.
 *
 * Provides a simple, lifecycle-aware API for Android applications to connect
 * to an InstantDB backend, authenticate, query, mutate, and receive realtime updates.
 *
 * Example usage:
 * ```kotlin
 * val instant = InstantDb(
 *     context = applicationContext,
 *     config = InstantDbConfig(
 *         appId = "your-app-id",
 *         host = "https://api.example.com"
 *     )
 * )
 *
 * // Connect and authenticate
 * instant.connect()
 *
 * // Query with reactive updates
 * instant.queryFlow("{ todos: { $: { $: {} } } }")
 *
 * // Mutate
 * instant.transact(listOf(listOf("add", "todos", mapOf("title" to "Hello"))))
 *
 * // Get connection state
 * instant.connectionState.value
 * ```
 */
class InstantDb(
    private val context: Context,
    val config: InstantDbConfig,
) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)

    private var jvmInstantDb: JvmInstantDb? = null
    private var credentialStorage: SecureCredentialStorage? = null
    private var connectivityManager: AndroidConnectivityManager? = null

    private val _connectionState = MutableStateFlow<ConnectionState>(ConnectionState.Disconnected)
    val connectionState: StateFlow<ConnectionState> = _connectionState.asStateFlow()

    private val _connectionStateDetail = MutableStateFlow<ConnectionDetail?>(null)
    val connectionStateDetail: StateFlow<ConnectionDetail?> = _connectionStateDetail.asStateFlow()

    private var isClosed = false

    /**
     * Connect to the InstantDB backend and authenticate.
     * Uses the transport specified in config (WebSocket or SSE).
     */
    suspend fun connect() {
        checkNotClosed()

        credentialStorage = SecureCredentialStorage(context)
        val credentials = credentialStorage?.load()
        connectivityManager = AndroidConnectivityManager(context)

        val jvmConfig = JvmConfig(
            appId = config.appId,
            apiUri = config.host,
            websocketUri = config.websocketUri ?: "${config.host}/runtime/session",
            refreshToken = credentials?.refreshToken,
            adminToken = credentials?.adminToken,
        )

        _connectionState.value = ConnectionState.Connecting
        _connectionStateDetail.value = ConnectionDetail(transport = determineTransportType())

        // Both WebSocket and SSE are now supported via the Transport interface
        val transport = if (config.useSse) {
            createSseTransport(credentials)
        } else {
            createWebSocketTransport()
        }
        jvmInstantDb = JvmInstantDb(jvmConfig, transport, scope)

        try {
            jvmInstantDb?.init()
            credentials?.let { credentialStorage?.save(it.refreshToken, it.adminToken) }
            _connectionState.value = ConnectionState.Connected
        } catch (e: Exception) {
            _connectionState.value = ConnectionState.Error(e.message ?: "Connection failed")
            throw e
        }
    }

    /**
     * Execute a query once and return the result.
     */
    suspend fun query(q: JsonObject) = jvmInstantDb?.queryOnce(q)
        ?: throw IllegalStateException("Not connected. Call connect() first.")

    /**
     * Execute a query and return a Flow of results for reactive updates.
     */
    fun queryFlow(q: JsonObject) = jvmInstantDb?.events
        ?: throw IllegalStateException("Not connected. Call connect() first.")

    /**
     * Execute a mutation (transaction).
     */
    suspend fun transact(txSteps: List<List<JsonElement>>) = jvmInstantDb?.transact(txSteps)
        ?: throw IllegalStateException("Not connected. Call connect() first.")

    /**
     * Get sync status including pending mutations count.
     */
    val syncStatus: SyncStatus
        get() = SyncStatus(
            pendingMutations = 0,
            isOnline = connectivityManager?.isOnline() ?: true,
        )

    /**
     * Close the InstantDB connection and release resources.
     */
    suspend fun close() {
        isClosed = true
        jvmInstantDb?.close()
        jvmInstantDb = null
        connectivityManager?.stop()
        connectivityManager = null
        _connectionState.value = ConnectionState.Disconnected
    }

    private fun checkNotClosed() {
        if (isClosed) throw IllegalStateException("InstantDb instance has been closed")
    }

    private fun createWebSocketTransport(): InstantTransport {
        val wsUri = config.websocketUri ?: "${config.host}/runtime/session?app_id=${config.appId}"
        return InstantTransport(wsUri)
    }

    private fun createSseTransport(credentials: com.instantdb.android.credentials.StoredCredentials?): SseTransport {
        return SseTransport(
            sseUrl = "${config.host}/runtime/sse?app_id=${config.appId}",
            messageUrl = "${config.host}/runtime/session?app_id=${config.appId}",
            appId = config.appId,
            adminToken = credentials?.adminToken,
            refreshToken = credentials?.refreshToken,
        )
    }

    private fun determineTransportType(): TransportType {
        return if (config.useSse) TransportType.SSE else TransportType.WebSocket
    }
}

/**
 * Connection state enum.
 */
sealed class ConnectionState {
    data object Disconnected : ConnectionState()
    data object Connecting : ConnectionState()
    data object Connected : ConnectionState()
    data class Reconnecting(val attempt: Int) : ConnectionState()
    data class Offline(val pendingMutations: Int) : ConnectionState()
    data class Error(val message: String) : ConnectionState()
}

/**
 * Connection detail information (safe to expose).
 */
data class ConnectionDetail(
    val transport: TransportType = TransportType.Unknown,
    val sessionId: String? = null,
)

/**
 * Transport type enum.
 */
enum class TransportType {
    WebSocket,
    SSE,
    Unknown
}

/**
 * Sync status information (safe to expose).
 */
data class SyncStatus(
    val pendingMutations: Int,
    val isOnline: Boolean,
)
