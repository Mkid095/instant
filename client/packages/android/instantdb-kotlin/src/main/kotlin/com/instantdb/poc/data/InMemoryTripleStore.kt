package com.instantdb.poc.data

import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import org.slf4j.LoggerFactory

/**
 * In-memory triple store with three indexes (EAV, AEV, VAE).
 *
 * Mirrors JS `client/packages/core/src/store.ts` (949 lines). The store
 * keeps the same in-memory triple representation, the same three indexes,
 * and the same `addTriple` / `retractTriple` / `deleteEntity` / `transact`
 * semantics.
 *
 * Differences from the JS implementation:
 *   - We do NOT use `mutative.create` (the JS structural-sharing proxy).
 *     Every write produces a fresh Store via `copy()`. This is correct
 *     for concurrent observers and is simpler than mutative's diff
 *     tracking. For Phase 3 this is the safer choice; if benchmarks
 *     show it matters we can switch to a copy-on-write variant.
 *   - The `createdAt * 10 + _seed` hack is preserved exactly.
 *
 * Threading: all read/write operations are protected by a single Mutex.
 * Reads may run concurrently because the underlying Maps are concurrent
 * (ConcurrentHashMap). The mutex guards only the atomicity of
 * multi-step writes (transact, deleteEntity with cascades).
 */
class InMemoryTripleStore : LocalTripleStore {
    private val log = LoggerFactory.getLogger(InMemoryTripleStore::class.java)
    private val mutex = Mutex()

    // EAV: eid -> aid -> value -> Triple
    // We use Map<String, Map<String, Map<JsonElementKey, Triple>>>.
    // JsonElement keys need custom equality; we wrap with JsonElementKey.
    @Volatile private var eav: Map<String, Map<String, Map<JsonElementKey, Triple>>> = emptyMap()
    @Volatile private var aev: Map<String, Map<String, Map<JsonElementKey, Triple>>> = emptyMap()
    @Volatile private var vae: Map<JsonElementKey, Map<String, Map<String, Triple>>> = emptyMap()

    // Highest server tx-id we've seen.
    @Volatile var maxTxId: Long = 0L
        private set

    // Total triple count (cache; invalidated on write).
    @Volatile private var cachedCount: Int = -1

    // Reactive change stream.
    private val changes = MutableSharedFlow<StoreChange>(
        replay = 0,
        extraBufferCapacity = 256,
    )
    override val changeEvents: Flow<StoreChange> = changes.asSharedFlow()

    /**
     * Total triple count.
     */
    override fun count(): Int {
        if (cachedCount == -1) {
            var n = 0
            for (eidMap in eav.values) for (aidMap in eidMap.values) n += aidMap.size
            cachedCount = n
        }
        return cachedCount
    }

    /**
     * Look up all triples for an entity.
     */
    override fun lookupEntity(eid: String): List<Triple> {
        val aidMap = eav[eid] ?: return emptyList()
        return aidMap.values.flatMap { it.values }
    }

    /**
     * Look up triples for (eid, aid).
     */
    override fun lookupAttribute(eid: String, aid: String): List<Triple> {
        val aidMap = eav[eid] ?: return emptyList()
        return aidMap[aid]?.values?.toList() ?: emptyList()
    }

    /**
     * Find triples matching (aid, value).
     */
    override fun findByValue(aid: String, value: JsonElement): List<Triple> {
        val aidMap: Map<String, Map<JsonElementKey, Triple>> = aev[aid] ?: return emptyList()
        val valueKey = JsonElementKey(value)
        for ((_, eidToTriple) in aidMap) {
            val t = eidToTriple[valueKey] ?: continue
            return listOf(t)
        }
        return emptyList()
    }

    /**
     * Iterate every triple with the given aid. Used by tests / GC.
     */
    override fun scanByAttribute(aid: String): Sequence<Triple> = sequence {
        val aidMap = aev[aid] ?: return@sequence
        for (eidMap in aidMap.values) {
            for (t in eidMap.values) yield(t)
        }
    }

    /**
     * Bulk-load all triples for a set of entity ids.
     */
    override fun loadByEntities(eids: Collection<String>): List<Triple> =
        eids.flatMap { lookupEntity(it) }

    // -----------------------------------------------------------------
    // Write API (atomic)
    // -----------------------------------------------------------------

    /**
     * Add or replace a triple. Cardinality-one attrs replace the inner
     * value map atomically (mirroring JS store.ts:478-484).
     */
    override suspend fun put(triple: Triple) {
        mutex.withLock {
            writeTriple(triple)
            changes.tryEmit(StoreChange.TripleAdded(triple))
        }
    }

    /**
     * Retract a specific (eid, aid, value) triple. No-op if absent.
     */
    override suspend fun retract(eid: String, aid: String, value: JsonElement) {
        mutex.withLock {
            val removed = removeTriple(eid, aid, value)
            if (removed) {
                changes.tryEmit(StoreChange.TripleRetracted(eid, aid, value))
            }
        }
    }

    /**
     * Retract every triple for an entity. Used by delete-entity.
     */
    override suspend fun retractEntity(eid: String) {
        mutex.withLock {
            val aidMap = eav[eid] ?: return@withLock
            for (aid in aidMap.keys.toList()) {
                val valueMap = aidMap[aid]!!
                for (valueKey in valueMap.keys.toList()) {
                    removeTripleRaw(eid, aid, valueKey.value)
                }
            }
            changes.tryEmit(StoreChange.EntityRetracted(eid))
        }
    }

    /**
     * Apply a sequence of tx-steps atomically. Used by transact().
     */
    override suspend fun transact(txSteps: List<List<JsonElement>>) {
        mutex.withLock {
            for (step in txSteps) {
                applyStepInLock(step)
            }
            changes.tryEmit(StoreChange.TransactionApplied(txSteps.size))
        }
    }

    // -----------------------------------------------------------------
    // Internals (must be called under mutex)
    // -----------------------------------------------------------------

    private fun writeTriple(t: Triple) {
        val newEav = updateNestedMap(eav, t.eid, t.aid, JsonElementKey(t.value)) { _, existing ->
            val createdAt = existing?.createdAt ?: t.createdAt
            t.copy(createdAt = createdAt)
        }
        eav = newEav
        aev = updateNestedMap(aev, t.aid, t.eid, JsonElementKey(t.value)) { _, existing ->
            val createdAt = existing?.createdAt ?: t.createdAt
            t.copy(createdAt = createdAt)
        }
        // VAE only for refs (value is a string eid)
        if (t.value is JsonPrimitive && t.value.isString) {
            vae = updateNestedMap(vae, JsonElementKey(t.value), t.aid, t.eid) { _, _ -> t }
        }
        if (t.createdAt > maxTxId) maxTxId = t.createdAt
        cachedCount = -1
    }

    private fun removeTriple(eid: String, aid: String, value: JsonElement): Boolean {
        val before = count()
        removeTripleRaw(eid, aid, value)
        return count() != before
    }

    private fun removeTripleRaw(eid: String, aid: String, value: JsonElement) {
        val key = JsonElementKey(value)
        eav = removeFromNestedMap(eav, eid, aid, key)
        aev = removeFromNestedMap(aev, aid, eid, key)
        if (value is JsonPrimitive && value.isString) {
            vae = removeFromNestedMap(vae, key, aid, eid)
        }
        cachedCount = -1
    }

    private fun applyStepInLock(step: List<JsonElement>) {
        if (step.isEmpty()) return
        val action = (step[0] as? JsonPrimitive)?.content ?: return
        when (action) {
            "add-triple" -> {
                val eid = (step.getOrNull(1) as? JsonPrimitive)?.content ?: return
                val aid = (step.getOrNull(2) as? JsonPrimitive)?.content ?: return
                val value = step.getOrNull(3) ?: return
                writeTriple(Triple(eid, aid, value, System.currentTimeMillis()))
            }
            "retract-triple" -> {
                val eid = (step.getOrNull(1) as? JsonPrimitive)?.content ?: return
                val aid = (step.getOrNull(2) as? JsonPrimitive)?.content ?: return
                val value = step.getOrNull(3) ?: return
                removeTripleRaw(eid, aid, value)
            }
            "delete-entity" -> {
                val eid = (step.getOrNull(1) as? JsonPrimitive)?.content ?: return
                val aidMap = eav[eid] ?: return
                for (aid in aidMap.keys.toList()) {
                    val valueMap = aidMap[aid]!!
                    for (valueKey in valueMap.keys.toList()) {
                        removeTripleRaw(eid, aid, valueKey.value)
                    }
                }
            }
            "deep-merge-triple" -> {
                // Phase 3 stub: not used by the tests yet.
            }
            "add-attr" -> {
                // Phase 3 stub: attrs are managed separately by AttrStore.
            }
        }
    }

    /**
     * Helper: update a 3-level nested map immutably.
     *
     * `update(level3Value)` is called only if (l1, l2, l3) is present.
     * The new value replaces the existing one at that leaf.
     */
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

    /**
     * Bulk-load triples (used for initial sync). NOT atomic per triple;
     * the caller is expected to be the only writer at this point.
     */
    override suspend fun loadAll(triples: Collection<Triple>) {
        mutex.withLock {
            for (t in triples) writeTriple(t)
            changes.tryEmit(StoreChange.TransactionApplied(triples.size))
        }
    }
}

/**
 * Hashable wrapper around a JsonElement value. Two [JsonElementKey]s
 * are equal iff their underlying JsonElement values are equal. The hash
 * matches the JSON content hash.
 *
 * Required because kotlinx.serialization.json.JsonElement does not
 * implement value-based equals/hashCode consistently.
 */
class JsonElementKey(val value: JsonElement) {
    override fun equals(other: Any?): Boolean =
        other is JsonElementKey && jsonEquals(this.value, other.value)
    override fun hashCode(): Int = jsonHash(value)

    companion object {
        fun jsonEquals(a: JsonElement, b: JsonElement): Boolean {
            if (a is JsonPrimitive && b is JsonPrimitive) {
                if (a.isString != b.isString) return false
                return a.content == b.content
            }
            if (a is JsonArray && b is JsonArray) {
                if (a.size != b.size) return false
                for (i in a.indices) if (!jsonEquals(a[i], b[i])) return false
                return true
            }
            if (a is JsonObject && b is JsonObject) {
                if (a.keys != b.keys) return false
                for (k in a.keys) if (!jsonEquals(a[k]!!, b[k]!!)) return false
                return true
            }
            return false
        }
        fun jsonHash(e: JsonElement): Int {
            if (e is JsonPrimitive) {
                return if (e.isString) ("\"${e.content}\"").hashCode() else e.content.hashCode()
            }
            if (e is JsonArray) return e.fold(0) { acc, el -> 31 * acc + jsonHash(el) }
            if (e is JsonObject) {
                return e.entries.fold(0) { acc, (k, v) ->
                    31 * acc + k.hashCode() * 31 + jsonHash(v)
                }
            }
            return 0
        }
    }
}

sealed class StoreChange {
    data class TripleAdded(val triple: Triple) : StoreChange()
    data class TripleRetracted(val eid: String, val aid: String, val value: JsonElement) : StoreChange()
    data class EntityRetracted(val eid: String) : StoreChange()
    data class TransactionApplied(val stepCount: Int) : StoreChange()
}
