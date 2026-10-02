package com.instantdb.poc.benchmarks

import com.instantdb.poc.persistence.Triple
import com.instantdb.poc.persistence.sqlite.BackedStores
import com.instantdb.poc.persistence.sqlite.SqliteBackingStore
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.JsonPrimitive
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.Timeout
import java.util.concurrent.TimeUnit

/**
 * Phase 5 — Performance benchmarks for the SQLite-backed stores.
 *
 * These are not stress tests; they measure baseline cost of basic
 * operations. Phase 6 may add more (lookup, find-by-value, large
 * result sets).
 */
class SqliteBenchmarks {
    @Test @Timeout(value = 30, unit = TimeUnit.SECONDS)
    fun `insert 1000 triples`() = runBlocking {
        val stores = SqliteBackingStore.open(":memory:", isMemory = true)
        val t0 = System.nanoTime()
        stores.tripleStore.write {
            for (i in 0 until 1000) {
                put(Triple("e-$i", "aid-name", JsonPrimitive("name-$i"), i.toLong()))
            }
        }
        val elapsedMs = (System.nanoTime() - t0) / 1_000_000
        println("[bench] insert 1000 triples: ${elapsedMs}ms")
        assert(stores.tripleStore.count() == 1000L) { "expected 1000 triples" }
        stores.close()
    }

    @Test @Timeout(value = 30, unit = TimeUnit.SECONDS)
    fun `lookup entity`() = runBlocking {
        val stores = SqliteBackingStore.open(":memory:", isMemory = true)
        stores.tripleStore.write {
            for (i in 0 until 100) {
                put(Triple("e-$i", "aid-name", JsonPrimitive("name-$i"), i.toLong()))
                put(Triple("e-$i", "aid-email", JsonPrimitive("e-$i@x"), i.toLong()))
            }
        }
        val t0 = System.nanoTime()
        val triples = stores.tripleStore.lookupEntity("e-50")
        val elapsedUs = (System.nanoTime() - t0) / 1_000
        println("[bench] lookup entity (200 triples stored): ${elapsedUs}us, got ${triples.size}")
        assert(triples.size == 2) { "expected 2 triples for e-50, got ${triples.size}" }
        stores.close()
    }

    @Test @Timeout(value = 30, unit = TimeUnit.SECONDS)
    fun `find by value`() = runBlocking {
        val stores = SqliteBackingStore.open(":memory:", isMemory = true)
        stores.tripleStore.write {
            for (i in 0 until 1000) {
                put(Triple("e-$i", "aid-id", JsonPrimitive("e-$i"), i.toLong()))
            }
        }
        val t0 = System.nanoTime()
        val matches = stores.tripleStore.findByValue("aid-id", JsonPrimitive("e-555"))
        val elapsedUs = (System.nanoTime() - t0) / 1_000
        println("[bench] find by value (1000 triples): ${elapsedUs}us, got ${matches.size}")
        assert(matches.size == 1) { "expected 1 match" }
        stores.close()
    }

    @Test @Timeout(value = 30, unit = TimeUnit.SECONDS)
    fun `mutation queue with 1000 entries`() = runBlocking {
        val stores = SqliteBackingStore.open(":memory:", isMemory = true)
        val t0 = System.nanoTime()
        for (i in 0 until 1000) {
            stores.mutationStore.enqueue(
                com.instantdb.poc.persistence.PendingMutation(
                    eventId = "e-$i",
                    txSteps = listOf(listOf(JsonPrimitive("add-triple"))),
                    order = i.toLong(),
                    createdAt = System.currentTimeMillis(),
                    txId = null,
                    confirmedAt = null,
                ),
            )
        }
        val elapsedMs = (System.nanoTime() - t0) / 1_000_000
        println("[bench] enqueue 1000 mutations: ${elapsedMs}ms")
        assert(stores.mutationStore.pending().size == 1000) { "expected 1000 pending" }
        stores.close()
    }
}