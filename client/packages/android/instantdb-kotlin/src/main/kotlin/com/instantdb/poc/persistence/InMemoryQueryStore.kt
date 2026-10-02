package com.instantdb.poc.persistence

import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.json.JsonObject

/**
 * In-memory query cache.
 *
 * Mirrors the JS `querySubs` PersistedObject (Reactor.js:457-499). Used
 * to remember the result of a query so that re-subscribing (e.g., after
 * reconnect) doesn't have to refetch from the server.
 *
 * Phase 3 ships in-memory; Phase 4 adds disk persistence.
 */
class InMemoryQueryStore : QueryStore {
    private val mutex = Mutex()
    private val cache = LinkedHashMap<String, CachedQuery>()

    override suspend fun put(
        hash: String,
        q: JsonObject,
        resultTriples: List<Triple>,
        pageInfo: JsonObject?,
        aggregate: JsonObject?,
        processedTxId: Long,
        lastAccessedAt: Long,
    ) = mutex.withLock {
        cache[hash] = CachedQuery(
            hash = hash,
            q = q,
            resultTriples = resultTriples,
            pageInfo = pageInfo,
            aggregate = aggregate,
            processedTxId = processedTxId,
            lastAccessedAt = lastAccessedAt,
        )
    }

    override suspend fun touch(hash: String, at: Long) = mutex.withLock {
        val existing = cache[hash] ?: return@withLock
        cache[hash] = existing.copy(lastAccessedAt = at)
    }

    override suspend fun get(hash: String): CachedQuery? = mutex.withLock {
        cache[hash]
    }

    override suspend fun drop(hash: String): Unit = mutex.withLock {
        cache.remove(hash)
        Unit
    }

    override suspend fun gc(maxAgeMs: Long, maxEntries: Int, maxSize: Long): Int = mutex.withLock {
        val now = System.currentTimeMillis()
        var removed = 0
        // Pass 1: max age.
        val it1 = cache.entries.iterator()
        while (it1.hasNext()) {
            val (k, v) = it1.next()
            if (now - v.lastAccessedAt > maxAgeMs) {
                it1.remove()
                removed++
            }
        }
        // Pass 2: max entries (LRU).
        if (cache.size > maxEntries) {
            val sorted = cache.entries.sortedBy { it.value.lastAccessedAt }
            val excess = cache.size - maxEntries
            for (i in 0 until excess) {
                cache.remove(sorted[i].key)
                removed++
            }
        }
        // Pass 3: max total size (by total triple count).
        var total = cache.values.sumOf { it.resultTriples.size }
        if (total > maxSize) {
            val sortedByAge = cache.entries.sortedBy { it.value.lastAccessedAt }
            for ((k, v) in sortedByAge) {
                if (total <= maxSize) break
                cache.remove(k)
                total -= v.resultTriples.size
                removed++
            }
        }
        removed
    }

    override suspend fun count(): Int = mutex.withLock {
        cache.size
    }
}
