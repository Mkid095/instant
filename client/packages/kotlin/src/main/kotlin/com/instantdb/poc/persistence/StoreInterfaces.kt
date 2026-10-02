package com.instantdb.poc.persistence

import kotlinx.coroutines.flow.Flow
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject

/**
 * Persistence SPI — Phase 3.
 *
 * These interfaces define the contract between the sync engine and the
 * persistence layer. The SPI must NOT depend on:
 *   - Compose
 *   - Android lifecycle / Activity / Context
 *   - ViewModels
 *   - HTTP / WebSocket
 *
 * The SPI is intentionally narrow: it exposes only the operations the
 * sync engine actually needs. Implementations are free to add internal
 * optimizations (caches, indexes, batches).
 *
 * Design notes:
 *   - All write operations are suspend so that persistent backends can
 *     dispatch to IO without blocking.
 *   - Reads return Flow where reactive notifications matter; one-shot
 *     reads are simple suspend functions.
 *   - Implementations MUST be safe to call from multiple coroutines
 *     concurrently. The sync engine treats the store as a single
 *     shared mutable resource.
 *   - The persistence layer is pure data. It does not know about the
 *     network or about query language semantics.
 */

/**
 * A 4-tuple atom of data: (entity_id, attr_id, value, tx_id).
 *
 * The server returns the 4-tuple in exactly this shape; the SDK mirrors
 * it without enrichment.
 */
data class Triple(
    val eid: String,
    val aid: String,
    val value: JsonElement,
    val txId: Long,
)

/**
 * Distinct value to identify a transaction for optimistic reconciliation.
 *
 * Server-issued txIds are monotonic per-app. Locally-generated txIds for
 * unconfirmed optimistic triples use `LocalTxIdAllocator`.
 */
@JvmInline
value class TxId(val value: Long)

/**
 * A mutation queued for sending (or replayed after a restart).
 *
 * `eventId` is the client-side UUID generated at submit time. The server
 * echoes it back in `transact-ok`. `txSteps` is the low-level mutation
 * payload. `txId` is null until the server confirms.
 */
data class PendingMutation(
    val eventId: String,
    val txSteps: List<List<JsonElement>>,
    val order: Long,
    val createdAt: Long,
    val txId: Long?,
    val confirmedAt: Long?,
)

/**
 * Opaque key/value store for app-level state (current user, oauth
 * extra fields, etc.). Mirror of `kv` in JS.
 *
 * Used for `currentUser` storage between sessions. Phase 3 uses this
 * only for the in-memory state; persistence is wired in P14.
 */
interface KeyValueStore {
    suspend fun get(key: String): JsonElement?
    suspend fun put(key: String, value: JsonElement)
    suspend fun remove(key: String)
    suspend fun keys(): List<String>
}

/**
 * Persistent triple store. Backed by SQLDelight in production; in-memory
 * in tests.
 *
 * Invariants:
 *   - For each (eid, aid) at most one `one`-cardinality triple exists.
 *   - For `many`-cardinality attrs, multiple triples are allowed.
 *   - Triples are append-only in storage; retractTriple removes them.
 *   - All write operations are atomic: either every write in a batch
 *     is visible, or none are.
 */
interface TripleStore {
    /**
     * Insert or replace a triple. Atomic with respect to other writes
     * in the same [tx].
     */
    suspend fun put(triple: Triple, tx: WriteTransaction)

    /**
     * Insert only if (eid, aid, value) does not already exist.
     */
    suspend fun putIfAbsent(triple: Triple, tx: WriteTransaction)

    /**
     * Retract a specific triple. No-op if absent.
     */
    suspend fun retract(eid: String, aid: String, value: JsonElement, tx: WriteTransaction)

    /**
     * Retract every triple for the entity. Used by delete-entity.
     */
    suspend fun retractEntity(eid: String, tx: WriteTransaction)

    /**
     * Replace the (eid, aid) slot with a new value. Used by update.
     */
    suspend fun replace(eid: String, aid: String, value: JsonElement, txId: Long, tx: WriteTransaction)

    /**
     * Look up all triples for an entity.
     */
    suspend fun lookupEntity(eid: String): List<Triple>

    /**
     * Look up all triples for (eid, aid).
     */
    suspend fun lookupAttribute(eid: String, aid: String): List<Triple>

    /**
     * Find triples matching (aid, value) — used for lookups by unique attrs.
     */
    suspend fun findByValue(aid: String, value: JsonElement): List<Triple>

    /**
     * Iterate triples matching an attr prefix. Used by index scans.
     */
    suspend fun scanByAttribute(aid: String): Flow<Triple>

    /**
     * Bulk load all triples for a set of entity ids — used by initial sync.
     */
    suspend fun loadByEntities(eids: Collection<String>): List<Triple>

    /**
     * Phase 7 — Stream every persisted triple. Used for cold-start
     * recovery when the caller does not know the entity ids up front.
     *
     * Returns a `Sequence` so the underlying SQLDelight cursor is
     * consumed lazily and the caller can short-circuit.
     */
    fun scanAll(): Sequence<Triple>

    /**
     * Highest txId currently in the store. Used to determine whether
     * an incoming triple is already known.
     */
    suspend fun maxTxId(): Long

    /**
     * Total triple count. Used by GC and benchmarks.
     */
    suspend fun count(): Long

    /**
     * Open a write transaction. All write operations passed this
     * transaction are committed atomically on [commit]. [rollback]
     * discards the writes. The transaction is single-threaded; do not
     * call write operations on the same transaction concurrently.
     */
    suspend fun <T> write(body: suspend WriteTransaction.() -> T): T
}

/**
 * A single in-flight batch of writes. Use only inside `TripleStore.write`.
 *
 * The SPI does not impose isolation level (SQLite uses serializable;
 * Postgres could use repeatable-read). Implementations MAY use optimistic
 * concurrency control with retries.
 */
interface WriteTransaction {
    fun put(triple: Triple)
    fun putIfAbsent(triple: Triple)
    fun retract(eid: String, aid: String, value: JsonElement)
    fun retractEntity(eid: String)
    fun replace(eid: String, aid: String, value: JsonElement, txId: Long)
    fun commit()
    fun rollback()
}

/**
 * Persisted attr metadata. Mirror of `attrs[]` in init-ok and refresh-ok.
 *
 * Only fields actually used by the local query engine are persisted.
 * Fields the server returns but we don't yet use (e.g., `setting-unique?`,
 * `indexing?`) are stored in `metadata` as a JSON blob so we can add
 * features without a schema migration.
 */
data class AttrRecord(
    val id: String,
    val forwardIdentity: ForwardIdentity,
    val reverseIdentity: ReverseIdentity?,
    val valueType: ValueType,
    val cardinality: Cardinality,
    val isUnique: Boolean,
    val isIndexed: Boolean,
    val isRequired: Boolean,
    val inferredTypes: List<DataType>,
    val catalog: Catalog,
    val metadata: JsonObject,
)

data class ForwardIdentity(
    val id: String,
    val etype: String,
    val label: String,
)

data class ReverseIdentity(
    val id: String,
    val etype: String,
    val label: String,
)

enum class ValueType { Blob, Ref }
enum class Cardinality { One, Many }
enum class Catalog { System, User }
enum class DataType { Number, String, Boolean, Json }

interface AttrStore {
    /**
     * Replace the entire attr catalog for an app. Called on init-ok
     * (initial load) and refresh-ok (incremental update with attrs).
     */
    suspend fun replaceAll(attrs: List<AttrRecord>)

    /**
     * Add a single attr (typically from an auto-generated `add-attr`
     * tx-step). Incremental.
     */
    suspend fun upsert(attr: AttrRecord)

    /**
     * Look up by id.
     */
    suspend fun byId(id: String): AttrRecord?

    /**
     * Look up by forward-identity (etype, label).
     */
    suspend fun byForwardIdentity(etype: String, label: String): AttrRecord?

    /**
     * All attrs for a given etype. Used by query validator.
     */
    suspend fun byEtype(etype: String): List<AttrRecord>

    /**
     * All attrs. Used by tests.
     */
    suspend fun all(): List<AttrRecord>

    /**
     * Total count. Used by GC and benchmarks.
     */
    suspend fun count(): Int
}

/**
 * Persisted mutation queue. Survives process restart.
 *
 * Storage shape matches `pendingMutations` in JS (Reactor.js:557-576).
 */
interface MutationStore {
    suspend fun enqueue(mutation: PendingMutation)
    suspend fun confirm(eventId: String, txId: Long, confirmedAt: Long)
    suspend fun drop(eventId: String)
    suspend fun pending(): List<PendingMutation>
    suspend fun byEventId(eventId: String): PendingMutation?
    suspend fun dropConfirmedAboveTxId(maxConfirmedTxId: Long)
}

/**
 * Persisted query cache.
 *
 * Storage shape matches `querySubs` in JS (Reactor.js:457-499). Cached
 * triples + processed-tx-id are persisted so a re-subscribed query can
 * resume without a network round-trip.
 */
interface QueryStore {
    /**
     * Persist the result of a query. [resultTriples] is the flat list of
     * triples that were used to compute the result. [pageInfo] /
     * [aggregate] are JSON blobs from the server envelope.
     */
    suspend fun put(
        hash: String,
        q: JsonObject,
        resultTriples: List<Triple>,
        pageInfo: JsonObject?,
        aggregate: JsonObject?,
        processedTxId: Long,
        lastAccessedAt: Long,
    )

    /**
     * Touch the lastAccessedAt without re-writing the result.
     */
    suspend fun touch(hash: String, at: Long)

    /**
     * Look up a cached result by query hash.
     */
    suspend fun get(hash: String): CachedQuery?

    /**
     * Drop a query from the cache (e.g., on `remove-query`).
     */
    suspend fun drop(hash: String)

    /**
     * Run garbage collection. [maxAgeMs], [maxEntries], [maxSize] mirror
     * the JS `gc()` policy (Reactor.js:467-472).
     */
    suspend fun gc(maxAgeMs: Long, maxEntries: Int, maxSize: Long): Int

    /**
     * Total cached query count. Used by GC and benchmarks.
     */
    suspend fun count(): Int
}

data class CachedQuery(
    val hash: String,
    val q: JsonObject,
    val resultTriples: List<Triple>,
    val pageInfo: JsonObject?,
    val aggregate: JsonObject?,
    val processedTxId: Long,
    val lastAccessedAt: Long,
)
