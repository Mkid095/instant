package com.instantdb.poc.data

import com.instantdb.poc.WeakHash
import com.instantdb.poc.persistence.InMemoryMutationStore
import com.instantdb.poc.persistence.PendingMutation
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import org.slf4j.LoggerFactory

/**
 * SyncCoordinator — wires server events into the local triple store.
 *
 * Source-of-truth citations:
 *   - client/packages/core/src/Reactor.js:733-813 (refresh-ok handler)
 *   - client/packages/core/src/model/instaqlResult.js (extractTriples)
 *
 * Responsibilities:
 *   - On `add-query-ok`: extract triples, persist into local store,
 *     record processedTxId.
 *   - On `refresh-ok`: same, for every computation, layered with
 *     optimistic mutations.
 *   - On `add-query-exists`: log and ignore (we already have the result).
 *   - Re-evaluate active queries when the store changes.
 *
 * The coordinator is a single-writer pattern: server messages are
 * delivered on a single coroutine and applied sequentially.
 */
class SyncCoordinator(
    val store: LocalTripleStore,
    val attrs: AttrStore,
    val mutations: InMemoryMutationStore,
) {
    private val log = LoggerFactory.getLogger(SyncCoordinator::class.java)
    private val mutex = Mutex()

    /** The processedTxId per query (hash → txId). */
    private val processedTxIds = mutableMapOf<String, Long>()

    private val _events = MutableSharedFlow<SyncEvent>(
        replay = 0,
        extraBufferCapacity = 64,
    )
    val events: Flow<SyncEvent> = _events.asSharedFlow()

    /**
     * Apply an add-query-ok message. Extracts triples from the result
     * envelope and merges them into the local store.
     */
    suspend fun applyAddQueryOk(hash: String, q: JsonObject, msg: JsonObject): Long = mutex.withLock {
        val processedTxId = (msg["processed-tx-id"] as? JsonPrimitive)?.content?.toLongOrNull() ?: 0L
        val result = msg["result"] as? JsonArray ?: return@withLock processedTxId
        val triples = extractTriples(result)
        store.loadAll(triples)
        processedTxIds[hash] = processedTxId
        _events.tryEmit(SyncEvent.QueryRefreshed(hash, processedTxId, triples.size))
        processedTxId
    }

    /**
     * Apply a server message. Dispatches on `op` to the right method.
     */
    suspend fun applyMessage(msg: JsonObject) {
        val op = (msg["op"] as? JsonPrimitive)?.content ?: return
        when (op) {
            "init-ok" -> applyInitOk(msg)
            "add-query-ok" -> applyAddQueryOkOrRefreshOk(msg)
            "refresh-ok" -> applyAddQueryOkOrRefreshOk(msg)
            "transact-ok" -> applyTransactOk(msg)
        }
    }

    /**
     * Apply an init-ok message. Persists attrs.
     */
    private suspend fun applyInitOk(msg: JsonObject) = mutex.withLock {
        val attrsJson = msg["attrs"]
        if (attrsJson is JsonArray) {
            val newAttrs = parseAttrs(attrsJson)
            attrs.replaceAll(newAttrs)
        }
    }

    private suspend fun applyTransactOk(msg: JsonObject) {
        // Handled at the Reactor level; the SyncCoordinator just observes.
        // Future: persist the tx-id for reconciliation.
    }

    /**
     * Apply either an add-query-ok or a refresh-ok message. The two
     * shapes differ (add-query-ok has `result`, refresh-ok has
     * `computations[]`), but the per-result work is identical:
     * extract triples, layer optimistic, persist, advance processedTxId.
     */
    private suspend fun applyAddQueryOkOrRefreshOk(msg: JsonObject) = mutex.withLock {
        val op = (msg["op"] as? JsonPrimitive)?.content ?: return@withLock
        val processedTxId = (msg["processed-tx-id"] as? JsonPrimitive)?.content?.toLongOrNull() ?: return@withLock

        // refresh-ok sometimes carries attrs.
        val attrsJson = msg["attrs"]
        if (attrsJson is JsonArray) {
            val newAttrs = parseAttrs(attrsJson)
            attrs.replaceAll(newAttrs)
        }

        // Normalize: produce a list of (hash, q, result) tuples.
        data class Entry(val hash: String, val q: JsonObject, val result: JsonArray)
        val entries = mutableListOf<Entry>()
        when (op) {
            "add-query-ok" -> {
                val q = msg["q"] as? JsonObject ?: return@withLock
                val result = msg["result"] as? JsonArray ?: return@withLock
                val hash = WeakHash.hash(q)
                entries.add(Entry(hash, q, result))
            }
            "refresh-ok" -> {
                val computations = msg["computations"] as? JsonArray ?: return@withLock
                for (comp in computations) {
                    val compObj = comp as? JsonObject ?: continue
                    val q = compObj["instaql-query"] as? JsonObject ?: continue
                    val result = compObj["instaql-result"] as? JsonArray ?: continue
                    val hash = WeakHash.hash(q)
                    entries.add(Entry(hash, q, result))
                }
            }
        }

        // Apply optimistic on top of each result.
        val pending = mutations.pending()
        val optEngine = OptimisticEngine()
        for ((hash, q, result) in entries) {
            val serverTriples = extractTriples(result)
            val combined = optEngine.apply(serverTriples, processedTxId, pending)
            store.loadAll(combined)
            processedTxIds[hash] = processedTxId
            _events.tryEmit(SyncEvent.QueryRefreshed(hash, processedTxId, combined.size))
        }

        // Drop confirmed mutations that all queries have caught up to.
        mutations.dropConfirmedAboveTxId(processedTxId)
    }

    /**
     * Extract triples from a server datalog result envelope.
     *
     * Mirrors `extractTriples` in model/instaqlResult.js:1-25 — flattens
     * the idNode tree into a single list of triples.
     *
     * Each idNode has shape:
     *   { data: { datalog-result: { join-rows: Array<Array<Triple>> } } }
     *
     * where the outer array is the rows for that idNode, and each row
     * is itself an array of 4-tuples (eid, aid, value, txId).
     */
    private fun extractTriples(idNodes: JsonArray): List<Triple> {
        val out = mutableListOf<Triple>()
        for (node in idNodes) {
            val obj = node as? JsonObject ?: continue
            val data = obj["data"] as? JsonObject ?: continue
            val datalog = data["datalog-result"] as? JsonObject ?: continue
            val joinRows = datalog["join-rows"] as? JsonArray ?: continue
            for (row in joinRows) {
                val triples = row as? JsonArray ?: continue
                for (tripleArr in triples) {
                    val arr = tripleArr as? JsonArray ?: continue
                    if (arr.size != 4) continue
                    val eid = (arr[0] as? JsonPrimitive)?.content ?: continue
                    val aid = (arr[1] as? JsonPrimitive)?.content ?: continue
                    val value = arr[2]
                    val createdAt = (arr[3] as? JsonPrimitive)?.content?.toLongOrNull() ?: continue
                    out.add(Triple(eid, aid, value, createdAt))
                }
            }
        }
        return out
    }
}

/**
 * Read-only attribute store backed by a mutable list. Atomic replace on
 * `replaceAll`. We do not implement `addAttr`/`deleteAttr` for Phase 3.
 */
class AttrStore {
    private val mutex = Mutex()
    private var attrs: List<InstantAttr> = emptyList()

    suspend fun replaceAll(newAttrs: List<InstantAttr>) = mutex.withLock {
        attrs = newAttrs
    }

    suspend fun upsert(attr: InstantAttr) = mutex.withLock {
        attrs = attrs.filter { it.id != attr.id } + attr
    }

    suspend fun byId(id: String): InstantAttr? = mutex.withLock {
        attrs.firstOrNull { it.id == id }
    }

    suspend fun byForwardIdentity(etype: String, label: String): InstantAttr? = mutex.withLock {
        InstantAttr.byForwardIdentity(attrs, etype, label)
    }

    suspend fun byEtype(etype: String): List<InstantAttr> = mutex.withLock {
        attrs.filter { it.forwardIdentity.etype == etype }
    }

    suspend fun all(): List<InstantAttr> = mutex.withLock { attrs }

    suspend fun count(): Int = mutex.withLock { attrs.size }
}

sealed class SyncEvent {
    data class QueryRefreshed(val hash: String, val processedTxId: Long, val tripleCount: Int) :
        SyncEvent()
    data class AttrsUpdated(val count: Int) : SyncEvent()
}
