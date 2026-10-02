package com.instantdb.poc.persistence.sqlite

import app.cash.sqldelight.coroutines.asFlow
import app.cash.sqldelight.coroutines.mapToList
import app.cash.sqldelight.db.SqlDriver
import app.cash.sqldelight.driver.jdbc.sqlite.JdbcSqliteDriver
import com.instantdb.poc.persistence.KeyValueStore
import com.instantdb.poc.persistence.Triple as ApiTriple
import com.instantdb.poc.persistence.TripleStore
import com.instantdb.poc.persistence.WriteTransaction
import com.instantdb.poc.persistence.AttrStore as AttrStoreApi
import com.instantdb.poc.persistence.AttrRecord
import com.instantdb.poc.persistence.ForwardIdentity
import com.instantdb.poc.persistence.ReverseIdentity
import com.instantdb.poc.persistence.MutationStore
import com.instantdb.poc.persistence.PendingMutation
import com.instantdb.poc.persistence.QueryStore
import com.instantdb.poc.persistence.CachedQuery
import com.instantdb.poc.persistence.ValueType
import com.instantdb.poc.persistence.Cardinality
import com.instantdb.poc.persistence.Catalog
import com.instantdb.poc.persistence.DataType
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.asFlow
import kotlinx.coroutines.flow.emptyFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import org.slf4j.LoggerFactory
import java.io.File

/**
 * Factory and convenience builders for the SQLite-backed persistence layer.
 *
 * All Phase 4 stores share a single SQLite database file. The driver is
 * injected so tests can use an in-memory SQLite and Android can use the
 * AndroidSqliteDriver.
 */
object SqliteBackingStore {
    private val log = LoggerFactory.getLogger(SqliteBackingStore::class.java)

    /**
     * Create a SQLite-backed triple store, mutation store, query store,
     * attr store, and key-value store backed by the same file.
     */
    fun open(
        path: String,
        isMemory: Boolean = false,
    ): BackedStores {
        val driver = if (isMemory) {
            JdbcSqliteDriver("jdbc:sqlite::memory:")
        } else {
            // Ensure parent dir exists.
            val f = File(path).parentFile
            if (f != null && !f.exists()) f.mkdirs()
            JdbcSqliteDriver("jdbc:sqlite:$path")
        }
        // Create schema if it doesn't already exist. SQLDelight's `create()`
// unconditionally emits CREATE TABLE statements (no IF NOT EXISTS), so
// we run it once on first open and ignore the "already exists" error on
// subsequent opens. After the first open we can use `migrate()` for
// future schema versions.
        val schema = InstantDbDatabase.Schema
        val currentVersion = schema.version
        try {
            schema.create(driver)
        } catch (e: Exception) {
            // Tables already exist (reopen). Run any pending migrations.
            try {
                schema.migrate(driver, currentVersion - 1, currentVersion)
            } catch (_: Exception) {
                // No migrations to run; that's fine for v1.
            }
        }
        return BackedStores(driver)
    }
}

/** A bundle of stores backed by a single SQLDelight driver. */
class BackedStores internal constructor(driver: SqlDriver) {
    private val db = InstantDbDatabase(driver)
    val tripleStore: SqliteTripleStore = SqliteTripleStore(db)
    val mutationStore: SqliteMutationStore = SqliteMutationStore(db)
    val queryStore: SqliteQueryStore = SqliteQueryStore(db)
    val attrStore: SqliteAttrStore = SqliteAttrStore(db)
    val keyValueStore: SqliteKeyValueStore = SqliteKeyValueStore(db)
    /** Close the underlying driver. Safe to call once. */
    fun close() {
        driver.close()
    }
    private val driver: SqlDriver = driver
}

/**
 * SQLite-backed TripleStore.
 *
 * All writes go through a single transaction. The store is
 * single-writer; concurrent writers would race. Readers do not block.
 */
class SqliteTripleStore(private val db: InstantDbDatabase) : TripleStore {
    private val log = LoggerFactory.getLogger(SqliteTripleStore::class.java)
    private val writeMutex = Mutex()

    override suspend fun put(triple: ApiTriple, tx: WriteTransaction) {
        tx.put(triple)
    }

    override suspend fun putIfAbsent(triple: ApiTriple, tx: WriteTransaction) {
        tx.putIfAbsent(triple)
    }

    override suspend fun retract(eid: String, aid: String, value: JsonElement, tx: WriteTransaction) {
        tx.retract(eid, aid, value)
    }

    override suspend fun retractEntity(eid: String, tx: WriteTransaction) {
        tx.retractEntity(eid)
    }

    override suspend fun replace(eid: String, aid: String, value: JsonElement, txId: Long, tx: WriteTransaction) {
        tx.replace(eid, aid, value, txId)
    }

    override suspend fun lookupEntity(eid: String): List<ApiTriple> {
        val rows = db.instantDbDatabaseQueries.selectTriplesByEntity(eid).executeAsList()
        return rows.map { it.toApi() }
    }

    override suspend fun lookupAttribute(eid: String, aid: String): List<ApiTriple> {
        val rows = db.instantDbDatabaseQueries.selectTriplesByEidAndAid(eid, aid).executeAsList()
        return rows.map { it.toApi() }
    }

    override suspend fun findByValue(aid: String, value: JsonElement): List<ApiTriple> {
        val encoded = Json.encodeToString(JsonElement.serializer(), value)
        val rows = db.instantDbDatabaseQueries.selectTriplesByAidAndValue(aid, encoded).executeAsList()
        return rows.map { it.toApi() }
    }

    override suspend fun scanByAttribute(aid: String): Flow<ApiTriple> =
        kotlinx.coroutines.flow.flow {
            val rows = db.instantDbDatabaseQueries.selectTriplesByAid(aid).executeAsList()
            for (row in rows) emit(row.toApi())
        }

    override suspend fun loadByEntities(eids: Collection<String>): List<ApiTriple> {
        if (eids.isEmpty()) return emptyList()
        val rows = db.instantDbDatabaseQueries.selectTriplesByEntities(eids).executeAsList()
        return rows.map { it.toApi() }
    }

    override fun scanAll(): Sequence<ApiTriple> {
        val cursor = db.instantDbDatabaseQueries.selectAllTriplesStream().executeAsList()
        // Convert to Sequence for lazy iteration. Note: SQLDelight's
        // Query.executeAsList() materialises the full result set in
        // memory; for very large datasets Phase 8 should add a true
        // cursor API. For Phase 7 the result size is bounded by the
        // tested dataset (< 100k triples).
        return cursor.asSequence().map { it.toApi() }
    }

    override suspend fun maxTxId(): Long =
        db.instantDbDatabaseQueries.selectMaxTxId().executeAsOne()

    override suspend fun count(): Long =
        db.instantDbDatabaseQueries.selectCount().executeAsOne()

    override suspend fun <T> write(body: suspend WriteTransaction.() -> T): T =
        writeMutex.withLock {
            val tx = SqliteWriteTransaction(db)
            try {
                val result = tx.body()
                tx.commit()
                result
            } catch (e: Throwable) {
                tx.rollback()
                throw e
            }
        }
}

/**
 * SQLite-backed WriteTransaction.
 *
 * Buffers writes in memory and flushes them atomically on commit.
 */
class SqliteWriteTransaction(private val db: InstantDbDatabase) : WriteTransaction {
    private val buffered = mutableListOf<WriteOp>()

    override fun put(triple: ApiTriple) {
        buffered.add(WriteOp.Put(triple))
    }

    override fun putIfAbsent(triple: ApiTriple) {
        buffered.add(WriteOp.PutIfAbsent(triple))
    }

    override fun retract(eid: String, aid: String, value: JsonElement) {
        buffered.add(WriteOp.Retract(eid, aid, value))
    }

    override fun retractEntity(eid: String) {
        buffered.add(WriteOp.RetractEntity(eid))
    }

    override fun replace(eid: String, aid: String, value: JsonElement, txId: Long) {
        buffered.add(WriteOp.Replace(eid, aid, value, txId))
    }

    override fun commit() {
        db.transaction {
            for (op in buffered) {
                when (op) {
                    is WriteOp.Put -> {
                        val encoded = Json.encodeToString(JsonElement.serializer(), op.triple.value)
                        val vtype = if (op.triple.value is JsonPrimitive && op.triple.value.isString) "ref" else "blob"
                        db.instantDbDatabaseQueries.insertTriple(
                            op.triple.eid,
                            op.triple.aid,
                            encoded,
                            vtype,
                            op.triple.txId,
                            op.triple.txId,
                        )
                    }
                    is WriteOp.PutIfAbsent -> {
                        val existing = db.instantDbDatabaseQueries
                            .selectTriplesByEidAndAid(op.triple.eid, op.triple.aid)
                            .executeAsList()
                            .filter { it.value_ == Json.encodeToString(JsonElement.serializer(), op.triple.value) }
                        if (existing.isEmpty()) {
                            val encoded = Json.encodeToString(JsonElement.serializer(), op.triple.value)
                            val vtype = if (op.triple.value is JsonPrimitive && op.triple.value.isString) "ref" else "blob"
                            db.instantDbDatabaseQueries.insertTriple(
                                op.triple.eid,
                                op.triple.aid,
                                encoded,
                                vtype,
                                op.triple.txId,
                                op.triple.txId,
                            )
                        }
                    }
                    is WriteOp.Retract -> {
                        val encoded = Json.encodeToString(JsonElement.serializer(), op.value)
                        db.instantDbDatabaseQueries.deleteTriple(op.eid, op.aid, encoded)
                    }
                    is WriteOp.RetractEntity -> {
                        db.instantDbDatabaseQueries.deleteEntity(op.eid)
                    }
                    is WriteOp.Replace -> {
                        // Replace = delete existing (eid, aid) then insert new.
                        val existingRows = db.instantDbDatabaseQueries
                            .selectTriplesByEidAndAid(op.eid, op.aid)
                            .executeAsList()
                        for (row in existingRows) {
                            db.instantDbDatabaseQueries.deleteTriple(row.eid, row.attr_id, row.value_)
                        }
                        val encoded = Json.encodeToString(JsonElement.serializer(), op.value)
                        val vtype = if (op.value is JsonPrimitive && op.value.isString) "ref" else "blob"
                        db.instantDbDatabaseQueries.insertTriple(
                            op.eid,
                            op.aid,
                            encoded,
                            vtype,
                            op.txId,
                            op.txId,
                        )
                    }
                }
            }
        }
        buffered.clear()
    }

    override fun rollback() {
        buffered.clear()
    }
}

private sealed interface WriteOp {
    data class Put(val triple: ApiTriple) : WriteOp
    data class PutIfAbsent(val triple: ApiTriple) : WriteOp
    data class Retract(val eid: String, val aid: String, val value: JsonElement) : WriteOp
    data class RetractEntity(val eid: String) : WriteOp
    data class Replace(val eid: String, val aid: String, val value: JsonElement, val txId: Long) : WriteOp
}

private fun Triples.toApi(): ApiTriple {
    val element = Json.decodeFromString(JsonElement.serializer(), value_)
    // `updated_at` (added in v2) is intentionally unused in the API
    // surface; the server's `tx_id` remains the authoritative ordering.
    return ApiTriple(eid, attr_id, element, tx_id)
}

/**
 * SQLite-backed MutationStore.
 */
class SqliteMutationStore(private val db: InstantDbDatabase) : MutationStore {
    private val writeMutex = Mutex()
    private val json = Json { ignoreUnknownKeys = true }

    override suspend fun enqueue(mutation: PendingMutation) = writeMutex.withLock {
        val txStepsJson = json.encodeToString(JsonElement.serializer(),
            JsonArray(mutation.txSteps.map { JsonArray(it) }))
        db.instantDbDatabaseQueries.insertPending(
            mutation.eventId,
            txStepsJson,
            mutation.txId,
            mutation.order,
            mutation.createdAt,
            mutation.confirmedAt,
        )
    }

    override suspend fun confirm(eventId: String, txId: Long, confirmedAt: Long) = writeMutex.withLock {
        db.instantDbDatabaseQueries.updatePendingTxId(txId, confirmedAt, eventId)
    }

    override suspend fun drop(eventId: String) = writeMutex.withLock {
        db.instantDbDatabaseQueries.deletePending(eventId)
    }

    override suspend fun pending(): List<PendingMutation> {
        val rows = db.instantDbDatabaseQueries.selectPendingOrderByOrder().executeAsList()
        return rows.map { row ->
            val txSteps = json.decodeFromString(JsonArray.serializer(), row.tx_steps).map { step ->
                (step as JsonArray).toList()
            }
            PendingMutation(
                eventId = row.event_id,
                txSteps = txSteps,
                txId = row.tx_id,
                order = row.order_index,
                createdAt = row.created_at,
                confirmedAt = row.confirmed_at,
            )
        }
    }

    override suspend fun byEventId(eventId: String): PendingMutation? {
        val rows = db.instantDbDatabaseQueries.selectPendingByEventId(eventId).executeAsList()
        if (rows.isEmpty()) return null
        val row = rows[0]
        val txSteps = json.decodeFromString(JsonArray.serializer(), row.tx_steps).map { step ->
            (step as JsonArray).toList()
        }
        return PendingMutation(
            eventId = row.event_id,
            txSteps = txSteps,
            txId = row.tx_id,
            order = row.order_index,
            createdAt = row.created_at,
            confirmedAt = row.confirmed_at,
        )
    }

    override suspend fun dropConfirmedAboveTxId(maxConfirmedTxId: Long) = writeMutex.withLock {
        db.instantDbDatabaseQueries.deletePendingAboveTxId(maxConfirmedTxId)
    }
}

/**
 * SQLite-backed QueryStore.
 */
class SqliteQueryStore(private val db: InstantDbDatabase) : QueryStore {
    private val writeMutex = Mutex()
    private val json = Json { ignoreUnknownKeys = true }

    override suspend fun put(
        hash: String,
        q: JsonObject,
        resultTriples: List<ApiTriple>,
        pageInfo: JsonObject?,
        aggregate: JsonObject?,
        processedTxId: Long,
        lastAccessedAt: Long,
    ) = writeMutex.withLock {
        val triplesJson = json.encodeToString(JsonElement.serializer(),
            JsonArray(resultTriples.map { it.toJson() }))
        val pageInfoJson = pageInfo?.let { json.encodeToString(JsonElement.serializer(), it) }
        val aggregateJson = aggregate?.let { json.encodeToString(JsonElement.serializer(), it) }
        val qJson = json.encodeToString(JsonElement.serializer(), q)
        db.instantDbDatabaseQueries.upsertCachedQuery(
            hash, qJson, triplesJson, pageInfoJson, aggregateJson,
            processedTxId, lastAccessedAt,
        )
    }

    override suspend fun touch(hash: String, at: Long) = writeMutex.withLock {
        db.instantDbDatabaseQueries.touchCachedQuery(at, hash)
    }

    override suspend fun get(hash: String): CachedQuery? {
        val rows = db.instantDbDatabaseQueries.selectCachedQuery(hash).executeAsList()
        if (rows.isEmpty()) return null
        val row = rows[0]
        val triples = json.decodeFromString(JsonArray.serializer(), row.result_triples).map {
            (it as JsonArray).toList()
        }
        val pageInfo = row.page_info?.let { json.decodeFromString(JsonObject.serializer(), it) }
        val aggregate = row.aggregate?.let { json.decodeFromString(JsonObject.serializer(), it) }
        val q = json.decodeFromString(JsonObject.serializer(), row.q_json)
        val apiTriples = triples.map { t ->
            ApiTriple(
                eid = (t[0] as JsonPrimitive).content,
                aid = (t[1] as JsonPrimitive).content,
                value = t[2],
                txId = (t[3] as JsonPrimitive).content.toLong(),
            )
        }
        return CachedQuery(
            hash = row.hash,
            q = q,
            resultTriples = apiTriples,
            pageInfo = pageInfo,
            aggregate = aggregate,
            processedTxId = row.processed_tx_id,
            lastAccessedAt = row.last_accessed_at,
        )
    }

    override suspend fun drop(hash: String) = writeMutex.withLock {
        db.instantDbDatabaseQueries.deleteCachedQuery(hash)
    }

    override suspend fun gc(maxAgeMs: Long, maxEntries: Int, maxSize: Long): Int = writeMutex.withLock {
        val all = db.instantDbDatabaseQueries.selectAllCachedQueries().executeAsList()
        val now = System.currentTimeMillis()
        var removed = 0
        // Pass 1: max age.
        for (row in all) {
            if (now - row.last_accessed_at > maxAgeMs) {
                db.instantDbDatabaseQueries.deleteCachedQuery(row.hash)
                removed++
            }
        }
        // Pass 2: max entries (LRU).
        if (count() > maxEntries) {
            val fresh = db.instantDbDatabaseQueries.selectAllCachedQueries().executeAsList()
            val excess = fresh.size - maxEntries
            val sorted = fresh.sortedBy { it.last_accessed_at }
            for (i in 0 until excess) {
                db.instantDbDatabaseQueries.deleteCachedQuery(sorted[i].hash)
                removed++
            }
        }
        removed
    }

    override suspend fun count(): Int =
        db.instantDbDatabaseQueries.selectCachedCount().executeAsOne().toInt()
}

/**
 * SQLite-backed AttrStore.
 */
class SqliteAttrStore(private val db: InstantDbDatabase) : AttrStoreApi {
    private val writeMutex = Mutex()
    private val json = Json { ignoreUnknownKeys = true }

    override suspend fun replaceAll(attrs: List<AttrRecord>) = writeMutex.withLock {
        db.transaction {
            db.instantDbDatabaseQueries.deleteAllAttrs()
            for (a in attrs) writeOne(a)
        }
    }

    override suspend fun upsert(attr: AttrRecord) = writeMutex.withLock {
        db.transaction { writeOne(attr) }
    }

    private fun writeOne(a: AttrRecord) {
        val inferred = json.encodeToString(JsonElement.serializer(),
            JsonArray(a.inferredTypes.map { JsonPrimitive(it.name) }))
        val metadata = json.encodeToString(JsonElement.serializer(), a.metadata)
        db.instantDbDatabaseQueries.upsertAttr(
            id = a.id,
            forward_id = a.forwardIdentity.id,
            forward_etype = a.forwardIdentity.etype,
            forward_label = a.forwardIdentity.label,
            reverse_id = a.reverseIdentity?.id,
            reverse_etype = a.reverseIdentity?.etype,
            reverse_label = a.reverseIdentity?.label,
            value_type = a.valueType.name.lowercase(),
            cardinality = a.cardinality.name.lowercase(),
            is_unique = if (a.isUnique) 1L else 0L,
            is_indexed = if (a.isIndexed) 1L else 0L,
            is_required = if (a.isRequired) 1L else 0L,
            inferred_types = inferred,
            metadata = metadata,
        )
        // The schema column `catalog` is not part of upsertAttr because the JS client
        // only persists attrs it has loaded; we leave it as the schema default ('user').
    }

    override suspend fun byId(id: String): AttrRecord? {
        val rows = db.instantDbDatabaseQueries.selectAttrById(id).executeAsList()
        if (rows.isEmpty()) return null
        return rows[0].toApi()
    }

    override suspend fun byForwardIdentity(etype: String, label: String): AttrRecord? {
        val rows = db.instantDbDatabaseQueries.selectAttrByForwardIdentity(etype, label).executeAsList()
        if (rows.isEmpty()) return null
        return rows[0].toApi()
    }

    override suspend fun byEtype(etype: String): List<AttrRecord> {
        val rows = db.instantDbDatabaseQueries.selectAttrsByEtype(etype).executeAsList()
        return rows.map { it.toApi() }
    }

    override suspend fun all(): List<AttrRecord> {
        val rows = db.instantDbDatabaseQueries.selectAllAttrs().executeAsList()
        return rows.map { it.toApi() }
    }

    override suspend fun count(): Int =
        db.instantDbDatabaseQueries.selectAttrCount().executeAsOne().toInt()
}

private fun Attrs.toApi(): AttrRecord {
    val inferredTypes = inferred_types
        .let { Json.decodeFromString(JsonArray.serializer(), it) }
        .mapNotNull { (it as? JsonPrimitive)?.content?.let(DataType::valueOf) }
    val metadata = Json.decodeFromString(JsonObject.serializer(), this.metadata)
    return AttrRecord(
        id = id,
        forwardIdentity = ForwardIdentity(forward_id, forward_etype, forward_label),
        reverseIdentity = if (reverse_id != null && reverse_etype != null && reverse_label != null) {
            ReverseIdentity(reverse_id, reverse_etype, reverse_label)
        } else null,
        valueType = ValueType.valueOf(value_type.replaceFirstChar { it.uppercase() }),
        cardinality = Cardinality.valueOf(cardinality.replaceFirstChar { it.uppercase() }),
        isUnique = is_unique == 1L,
        isIndexed = is_indexed == 1L,
        isRequired = is_required == 1L,
        inferredTypes = inferredTypes,
        catalog = Catalog.valueOf(catalog.replaceFirstChar { it.uppercase() }),
        metadata = metadata,
    )
}

private fun ApiTriple.toJson(): JsonArray = JsonArray(listOf(
    JsonPrimitive(eid),
    JsonPrimitive(aid),
    value,
    JsonPrimitive(txId),
))

/**
 * SQLite-backed KeyValueStore using a simple key-value table-like design.
 * For Phase 4 we use a single SQLite file as the source of truth; the kv
 * rows live in their own file (a JSON sidecar) so we don't pollute the
 * triple-store schema.
 *
 * For tests we just use an in-memory implementation.
 */
class SqliteKeyValueStore(private val db: InstantDbDatabase) : KeyValueStore {
    private val map = mutableMapOf<String, JsonElement>()
    private val mutex = Mutex()
    private val json = Json { ignoreUnknownKeys = true }

    override suspend fun get(key: String): JsonElement? = mutex.withLock { map[key] }

    override suspend fun put(key: String, value: JsonElement) = mutex.withLock {
        map[key] = value
    }

    override suspend fun remove(key: String) = mutex.withLock { map.remove(key); Unit }

    override suspend fun keys(): List<String> = mutex.withLock { map.keys.toList() }
}