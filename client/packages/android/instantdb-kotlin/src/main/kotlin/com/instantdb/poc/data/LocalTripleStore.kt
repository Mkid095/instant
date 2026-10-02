package com.instantdb.poc.data

import com.instantdb.poc.persistence.Triple
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.json.JsonElement

/**
 * Phase 6 — `LocalTripleStore` is the interface the sync engine and
 * query engine depend on for hot-path access to the local triple
 * store.
 *
 * Two implementations:
 *   - `InMemoryTripleStore` — Phase 2/3/4/5 default. Used in unit
 *     tests and lightweight dev.
 *   - `PersistentLocalStore` — Phase 6 production default. Backed by
 *     SQLDelight / SQLite via the persistence SPI. Survives process
 *     death.
 *
 * Both expose the same surface. SyncCoordinator and QueryEngine
 * accept either.
 */
interface LocalTripleStore {
    suspend fun put(triple: com.instantdb.poc.data.Triple)
    suspend fun retract(eid: String, aid: String, value: JsonElement)
    suspend fun retractEntity(eid: String)
    suspend fun transact(txSteps: List<List<JsonElement>>)
    suspend fun loadAll(triples: Collection<com.instantdb.poc.data.Triple>)

    fun lookupEntity(eid: String): List<com.instantdb.poc.data.Triple>
    fun lookupAttribute(eid: String, aid: String): List<com.instantdb.poc.data.Triple>
    fun findByValue(aid: String, value: JsonElement): List<com.instantdb.poc.data.Triple>
    fun scanByAttribute(aid: String): Sequence<com.instantdb.poc.data.Triple>
    fun loadByEntities(eids: Collection<String>): List<com.instantdb.poc.data.Triple>
    fun count(): Int

    val changeEvents: Flow<StoreChange>
}

/**
 * Phase 6 — `PersistentLocalStore` is the SQLite-backed implementation
 * of `LocalTripleStore`. SQLite is the authoritative source of truth;
 * this class simply bridges the persistence SPI into the engine's
 * hot path.
 *
 * On startup, callers should call `rehydrate()` to load any persisted
 * triples into the in-memory view used by the query evaluator.
 */
class PersistentLocalStore(
    private val spi: com.instantdb.poc.persistence.TripleStore,
) : LocalTripleStore {
    private val log = org.slf4j.LoggerFactory.getLogger(PersistentLocalStore::class.java)
    private val mutex = kotlinx.coroutines.sync.Mutex()

    // In-memory read cache; rebuilt from SQLite on rehydrate(). This is
    // a cache, never the source of truth.
    @Volatile private var eav: Map<String, Map<String, Map<JsonElementKey, com.instantdb.poc.data.Triple>>> = emptyMap()
    @Volatile private var aev: Map<String, Map<String, Map<JsonElementKey, com.instantdb.poc.data.Triple>>> = emptyMap()
    @Volatile private var vae: Map<JsonElementKey, Map<String, Map<String, com.instantdb.poc.data.Triple>>> = emptyMap()
    @Volatile private var cachedCount: Int = -1

    private val changes = MutableSharedFlow<StoreChange>(
        replay = 0,
        extraBufferCapacity = 256,
    )
    override val changeEvents: Flow<StoreChange> = changes.asSharedFlow()

    /**
     * Read every persisted triple from SQLite and rebuild the
     * in-memory cache. Must be called once after opening the SQLite
     * database, before any query operation.
     *
     * Phase 7 — uses the new `scanAll()` SPI primitive.
     */
    suspend fun rehydrate() {
        val allTriples = spi.scanAll().toList()
        for (t in allTriples) cacheTriple(toDataTriple(t))
    }

    /**
     * Load triples from a list of entity IDs into the cache. Used when
     * the caller knows the entity ids up front (e.g., a subscription
     * already knows the etypes).
     */
    suspend fun rehydrate(eids: Collection<String>) {
        val triples = spi.loadByEntities(eids)
        for (t in triples) cacheTriple(toDataTriple(t))
    }

    private fun cacheTriple(t: com.instantdb.poc.data.Triple) {
        eav = updateNestedMap(eav, t.eid, t.aid, JsonElementKey(t.value)) { _, existing ->
            val createdAt = existing?.createdAt ?: t.createdAt
            t.copy(createdAt = createdAt)
        }
        aev = updateNestedMap(aev, t.aid, t.eid, JsonElementKey(t.value)) { _, existing ->
            val createdAt = existing?.createdAt ?: t.createdAt
            t.copy(createdAt = createdAt)
        }
        if (t.value is kotlinx.serialization.json.JsonPrimitive && t.value.isString) {
            vae = updateNestedMap(vae, JsonElementKey(t.value), t.aid, t.eid) { _, _ -> t }
        }
        cachedCount = -1
    }

    override suspend fun put(triple: com.instantdb.poc.data.Triple) {
        mutex.withLock {
            spi.write { put(toSpiTriple(triple)) }
            cacheTriple(triple)
            changes.tryEmit(StoreChange.TripleAdded(triple))
        }
    }

    override suspend fun retract(eid: String, aid: String, value: JsonElement) {
        mutex.withLock {
            spi.write { retract(eid, aid, value) }
            val key = JsonElementKey(value)
            eav = removeFromNestedMap(eav, eid, aid, key)
            aev = removeFromNestedMap(aev, aid, eid, key)
            if (value is kotlinx.serialization.json.JsonPrimitive && value.isString) {
                vae = removeFromNestedMap(vae, key, aid, eid)
            }
            cachedCount = -1
            changes.tryEmit(StoreChange.TripleRetracted(eid, aid, value))
        }
    }

    override suspend fun retractEntity(eid: String) {
        mutex.withLock {
            spi.write { retractEntity(eid) }
            eav = eav - eid
            cachedCount = -1
            changes.tryEmit(StoreChange.EntityRetracted(eid))
        }
    }

    override suspend fun transact(txSteps: List<List<JsonElement>>) {
        mutex.withLock {
            // Persist each step to SQLite first, then mirror to memory.
            // This ensures SQLite is authoritative even if the in-memory
            // update throws.
            spi.write {
                    for (step in txSteps) {
                        applyStepToSpi(this, step)
                    }
                }
            for (step in txSteps) {
                applyStepInLock(step)
            }
            changes.tryEmit(StoreChange.TransactionApplied(txSteps.size))
        }
    }

    /**
     * Translate a tx-step into the SPI's persistence primitives. This is
     * called from inside a `spi.write { ... }` block.
     */
    private fun applyStepToSpi(
        tx: com.instantdb.poc.persistence.WriteTransaction,
        step: List<JsonElement>,
    ) {
        if (step.isEmpty()) return
        val action = (step[0] as? kotlinx.serialization.json.JsonPrimitive)?.content ?: return
        when (action) {
            "add-triple" -> {
                val eid = (step.getOrNull(1) as? kotlinx.serialization.json.JsonPrimitive)?.content ?: return
                val aid = (step.getOrNull(2) as? kotlinx.serialization.json.JsonPrimitive)?.content ?: return
                val value = step.getOrNull(3) ?: return
                val createdAt = System.currentTimeMillis()
                tx.put(com.instantdb.poc.persistence.Triple(eid, aid, value, createdAt))
            }
            "retract-triple" -> {
                val eid = (step.getOrNull(1) as? kotlinx.serialization.json.JsonPrimitive)?.content ?: return
                val aid = (step.getOrNull(2) as? kotlinx.serialization.json.JsonPrimitive)?.content ?: return
                val value = step.getOrNull(3) ?: return
                tx.retract(eid, aid, value)
            }
            "delete-entity" -> {
                val eid = (step.getOrNull(1) as? kotlinx.serialization.json.JsonPrimitive)?.content ?: return
                tx.retractEntity(eid)
            }
        }
    }

    override suspend fun loadAll(triples: Collection<com.instantdb.poc.data.Triple>) {
        mutex.withLock {
            // Persist all in one transaction.
            spi.write {
                for (t in triples) {
                    put(toSpiTriple(t))
                }
            }
            for (t in triples) cacheTriple(t)
            changes.tryEmit(StoreChange.TransactionApplied(triples.size))
        }
    }

    override fun lookupEntity(eid: String): List<com.instantdb.poc.data.Triple> {
        val aidMap = eav[eid] ?: return emptyList()
        return aidMap.values.flatMap { it.values }
    }

    override fun lookupAttribute(eid: String, aid: String): List<com.instantdb.poc.data.Triple> {
        val aidMap = eav[eid] ?: return emptyList()
        return aidMap[aid]?.values?.toList() ?: emptyList()
    }

    override fun findByValue(aid: String, value: JsonElement): List<com.instantdb.poc.data.Triple> {
        val aidMap: Map<String, Map<JsonElementKey, com.instantdb.poc.data.Triple>> = aev[aid] ?: return emptyList()
        val valueKey = JsonElementKey(value)
        for ((_, eidToTriple) in aidMap) {
            val t = eidToTriple[valueKey] ?: continue
            return listOf(t)
        }
        return emptyList()
    }

    override fun scanByAttribute(aid: String): Sequence<com.instantdb.poc.data.Triple> = sequence {
        val aidMap = aev[aid] ?: return@sequence
        for (eidMap in aidMap.values) {
            for (t in eidMap.values) yield(t)
        }
    }

    override fun loadByEntities(eids: Collection<String>): List<com.instantdb.poc.data.Triple> =
        eids.flatMap { lookupEntity(it) }

    override fun count(): Int {
        if (cachedCount == -1) {
            var n = 0
            for (eidMap in eav.values) for (aidMap in eidMap.values) n += aidMap.size
            cachedCount = n
        }
        return cachedCount
    }

    private fun applyStepInLock(step: List<JsonElement>) {
        if (step.isEmpty()) return
        val action = (step[0] as? kotlinx.serialization.json.JsonPrimitive)?.content ?: return
        when (action) {
            "add-triple" -> {
                val eid = (step.getOrNull(1) as? kotlinx.serialization.json.JsonPrimitive)?.content ?: return
                val aid = (step.getOrNull(2) as? kotlinx.serialization.json.JsonPrimitive)?.content ?: return
                val value = step.getOrNull(3) ?: return
                val createdAt = System.currentTimeMillis()
                val t = com.instantdb.poc.data.Triple(eid, aid, value, createdAt)
                cacheTriple(t)
                // Note: not persisted here; transact caller is responsible for persistence.
            }
            "retract-triple" -> {
                val eid = (step.getOrNull(1) as? kotlinx.serialization.json.JsonPrimitive)?.content ?: return
                val aid = (step.getOrNull(2) as? kotlinx.serialization.json.JsonPrimitive)?.content ?: return
                val value = step.getOrNull(3) ?: return
                val key = JsonElementKey(value)
                eav = removeFromNestedMap(eav, eid, aid, key)
                aev = removeFromNestedMap(aev, aid, eid, key)
                if (value is kotlinx.serialization.json.JsonPrimitive && value.isString) {
                    vae = removeFromNestedMap(vae, key, aid, eid)
                }
                cachedCount = -1
            }
            "delete-entity" -> {
                val eid = (step.getOrNull(1) as? kotlinx.serialization.json.JsonPrimitive)?.content ?: return
                eav = eav - eid
                cachedCount = -1
            }
        }
    }

    // ----- helpers -----

    private fun toDataTriple(t: com.instantdb.poc.persistence.Triple): com.instantdb.poc.data.Triple =
        com.instantdb.poc.data.Triple(t.eid, t.aid, t.value, t.txId)

    private fun toSpiTriple(t: com.instantdb.poc.data.Triple): com.instantdb.poc.persistence.Triple =
        com.instantdb.poc.persistence.Triple(t.eid, t.aid, t.value, t.createdAt)

    private fun <A, B, C, V> updateNestedMap(
        m: Map<A, Map<B, Map<C, V>>>,
        l1: A,
        l2: B,
        l3: C,
        update: (oldL2: Map<C, V>?, existing: V?) -> V,
    ): Map<A, Map<B, Map<C, V>>> {
        val l2Map = m[l1] ?: emptyMap()
        val l3Map = l2Map[l2] ?: emptyMap()
        val existing = l3Map[l3]
        val newV = update(l3Map, existing)
        val newL3Map = l3Map + (l3 to newV)
        val newL2Map = l2Map + (l2 to newL3Map)
        return m + (l1 to newL2Map)
    }

    private fun <A, B, C, V> removeFromNestedMap(
        m: Map<A, Map<B, Map<C, V>>>,
        l1: A,
        l2: B,
        l3: C,
    ): Map<A, Map<B, Map<C, V>>> {
        val l2Map = m[l1] ?: return m
        val l3Map = l2Map[l2] ?: return m
        val newL3Map = l3Map - l3
        val newL2Map = if (newL3Map.isEmpty()) l2Map - l2 else l2Map + (l2 to newL3Map)
        return if (newL2Map.isEmpty()) m - l1 else m + (l1 to newL2Map)
    }
}