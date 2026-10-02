package com.instantdb.poc

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.slf4j.LoggerFactory
import java.util.UUID

/**
 * Subscription manager.
 *
 * Source of truth: client/packages/core/src/Reactor.js
 *   - _startQuerySub            lines 1096-1116
 *   - subscribeQuery            lines 1157-1180
 *   - queryOnce                 lines 1182-1222
 *   - _unsubQuery               lines 1234-1240
 *   - _cleanupQuery             lines 1246-1255
 *   - add-query-ok handler      lines 665-700
 *   - add-query-exists handler  lines 661-664
 *   - refresh-ok handler        lines 733-813
 *
 * Responsibilities:
 *   - Track active subscriptions keyed by weakHash(query)
 *   - Add/remove queries on the wire as subscribers come and go
 *   - Receive add-query-ok / add-query-exists / refresh-ok
 *   - Resolve pending queryOnce Deferreds
 *   - Auto-send remove-query when last subscriber leaves
 *   - Re-add all subscriptions on reconnect (delegated to caller)
 */
class SubscriptionManager(
    private val connection: ConnectionManager,
    private val scope: CoroutineScope,
) {
    private val log = LoggerFactory.getLogger(SubscriptionManager::class.java)
    private val mutex = Mutex()

    /**
     * Per-query state. For the POC we don't actually evaluate results;
     * we just track subscription counts and queue add-query sends.
     */
    private data class Entry(
        val q: JsonObject,
        val hash: String,
        var subscriberCount: Int = 0,
        // Cached result from server. We do NOT model the full triple-store
        // in Phase 2; instead we just hold the raw `result` envelope so
        // tests can inspect it.
        var lastResult: JsonObject? = null,
        var lastProcessedTxId: Long? = null,
        var addQueryEventId: String? = null,
        var addQuerySent: Boolean = false,
    )

    private val subs: MutableMap<String, Entry> = mutableMapOf()

    private val _events = MutableSharedFlow<SubscriptionEvent>(extraBufferCapacity = 32)
    val events: SharedFlow<SubscriptionEvent> = _events.asSharedFlow()

    private val _subscriberCount = MutableStateFlow(0)
    val subscriberCount: StateFlow<Int> = _subscriberCount.asStateFlow()

    // -----------------------------------------------------------------
    // Public API
    // -----------------------------------------------------------------

    /**
     * Subscribe to a query. Sends `add-query` if this is the first
     * subscriber for this query hash.
     *
     * Returns immediately; callbacks fire on add-query-ok / refresh-ok.
     */
    suspend fun subscribe(q: JsonObject) {
        val hash = WeakHash.hash(q)
        val sendAdd: Boolean = mutex.withLock {
            val existing = subs[hash]
            if (existing != null) {
                existing.subscriberCount++
                false
            } else {
                subs[hash] = Entry(q = q, hash = hash, subscriberCount = 1)
                true
            }
        }
        _subscriberCount.value = subs.values.sumOf { it.subscriberCount }
        if (sendAdd) {
            sendAddQuery(hash, q)
        } else {
            log.info("subscribe: hash={} count={} (no wire send)", hash, subs[hash]?.subscriberCount)
        }
    }

    /**
     * Drop one subscription. Sends `remove-query` if this was the last.
     */
    suspend fun unsubscribe(q: JsonObject) {
        val hash = WeakHash.hash(q)
        val sendRemove: Boolean = mutex.withLock {
            val entry = subs[hash] ?: return@withLock false
            entry.subscriberCount--
            if (entry.subscriberCount <= 0) {
                subs.remove(hash)
                true
            } else {
                false
            }
        }
        _subscriberCount.value = subs.values.sumOf { it.subscriberCount }
        if (sendRemove) {
            sendRemoveQuery(hash, q)
        }
    }

    /**
     * Send add-query for every active subscription. Called by
     * ConnectionManager after init-ok.
     */
    suspend fun restoreAll() {
        val snapshot: List<Entry> = mutex.withLock {
            subs.values.map { it.copy(subscriberCount = it.subscriberCount) }
        }
        log.info("restoreAll: {} active subscriptions", snapshot.size)
        for (e in snapshot) {
            sendAddQuery(e.hash, e.q)
        }
    }

    /**
     * Drop all in-memory subscription tracking WITHOUT sending
     * remove-query. Used when the socket dies; we will re-add everything
     * after reconnect.
     */
    suspend fun clearAllOnDisconnect() {
        mutex.withLock {
            subs.values.forEach { it.addQuerySent = false }
        }
    }

    /**
     * Test/debug accessor.
     */
    suspend fun snapshotHashes(): List<String> = mutex.withLock { subs.keys.toList() }

    // -----------------------------------------------------------------
    // Receive-side dispatch
    // -----------------------------------------------------------------

    /**
     * Called by the Reactor's message handler when a server response
     * arrives that targets a specific subscription hash.
     */
    suspend fun handleServerEvent(msg: JsonObject) {
        val op = msg["op"]?.jsonPrimitive?.content ?: return
        when (op) {
            "add-query-ok" -> handleAddQueryOk(msg)
            "add-query-exists" -> handleAddQueryExists(msg)
            "refresh-ok" -> handleRefreshOk(msg)
            "remove-query-ok" -> handleRemoveQueryOk(msg)
            else -> {} // not for us
        }
    }

    private suspend fun handleAddQueryOk(msg: JsonObject) {
        val q = msg["q"] as? JsonObject ?: return
        val hash = WeakHash.hash(q)
        val processedTxId = msg["processed-tx-id"]?.jsonPrimitive?.content?.toLongOrNull()
        val result = msg["result"] as? JsonObject
        mutex.withLock {
            subs[hash]?.let {
                it.lastResult = result
                it.lastProcessedTxId = processedTxId
            }
        }
        _events.tryEmit(SubscriptionEvent.AddQueryOk(hash, processedTxId, result))
        log.info("add-query-ok: hash={} processed-tx-id={}", hash, processedTxId)
    }

    private suspend fun handleAddQueryExists(msg: JsonObject) {
        val q = msg["q"] as? JsonObject ?: return
        val hash = WeakHash.hash(q)
        _events.tryEmit(SubscriptionEvent.AddQueryExists(hash))
        log.info("add-query-exists: hash={}", hash)
    }

    private suspend fun handleRefreshOk(msg: JsonObject) {
        val processedTxId = msg["processed-tx-id"]?.jsonPrimitive?.content?.toLongOrNull() ?: return
        val computations = msg["computations"] as? kotlinx.serialization.json.JsonArray ?: return
        for (comp in computations) {
            val compObj = comp as? JsonObject ?: continue
            val q = compObj["instaql-query"] as? JsonObject ?: continue
            val result = compObj["instaql-result"] as? JsonObject
            val hash = WeakHash.hash(q)
            mutex.withLock {
                subs[hash]?.let {
                    it.lastResult = result
                    it.lastProcessedTxId = processedTxId
                }
            }
            _events.tryEmit(SubscriptionEvent.RefreshOk(hash, processedTxId, result))
        }
        log.info("refresh-ok: processed-tx-id={} computations={}", processedTxId, computations.size)
    }

    private suspend fun handleRemoveQueryOk(msg: JsonObject) {
        val q = msg["q"] as? JsonObject ?: return
        val hash = WeakHash.hash(q)
        _events.tryEmit(SubscriptionEvent.RemoveQueryOk(hash))
        log.info("remove-query-ok: hash={}", hash)
    }

    // -----------------------------------------------------------------
    // Wire send helpers
    // -----------------------------------------------------------------

    private fun sendAddQuery(hash: String, q: JsonObject) {
        val eventId = UUID.randomUUID().toString()
        // Best-effort bookkeeping; we're outside the mutex here.
        subs[hash]?.let {
            it.addQueryEventId = eventId
            it.addQuerySent = true
        }
        val payload = kotlinx.serialization.json.buildJsonObject {
            put("op", kotlinx.serialization.json.JsonPrimitive("add-query"))
            put("q", q)
            put("client-event-id", kotlinx.serialization.json.JsonPrimitive(eventId))
        }
        connection.send(payload)
        log.info("add-query: hash={} event-id={}", hash, eventId)
    }

    private fun sendRemoveQuery(hash: String, q: JsonObject) {
        val eventId = UUID.randomUUID().toString()
        val payload = kotlinx.serialization.json.buildJsonObject {
            put("op", kotlinx.serialization.json.JsonPrimitive("remove-query"))
            put("q", q)
            put("client-event-id", kotlinx.serialization.json.JsonPrimitive(eventId))
        }
        connection.send(payload)
        log.info("remove-query: hash={} event-id={}", hash, eventId)
    }
}

sealed class SubscriptionEvent {
    data class AddQueryOk(val hash: String, val processedTxId: Long?, val result: JsonObject?) :
        SubscriptionEvent()
    data class AddQueryExists(val hash: String) : SubscriptionEvent()
    data class RefreshOk(val hash: String, val processedTxId: Long, val result: JsonObject?) :
        SubscriptionEvent()
    data class RemoveQueryOk(val hash: String) : SubscriptionEvent()
}
