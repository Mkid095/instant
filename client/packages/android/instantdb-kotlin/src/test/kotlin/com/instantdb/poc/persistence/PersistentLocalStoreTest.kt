package com.instantdb.poc.persistence

import com.instantdb.poc.data.InstantAttr
import com.instantdb.poc.data.JsonElementKey
import com.instantdb.poc.data.LocalTripleStore
import com.instantdb.poc.data.PersistentLocalStore
import com.instantdb.poc.data.Triple as DataTriple
import com.instantdb.poc.persistence.sqlite.BackedStores
import com.instantdb.poc.persistence.sqlite.SqliteBackingStore
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import java.nio.file.Path

/**
 * Phase 6 — PersistentLocalStore authoritative source-of-truth tests.
 *
 * These tests prove that:
 *   1. SQLite is the source of truth (writes are persisted).
 *   2. A new store opened against the same SQLite file can rehydrate
 *      the state without any server connection.
 *   3. The query engine reads from the in-memory view that is rebuilt
 *      from SQLite.
 */
class PersistentLocalStoreTest {
    @TempDir lateinit var tempDir: Path
    private lateinit var backing: BackedStores

    @BeforeEach fun setUp() {
        backing = SqliteBackingStore.open(
            tempDir.resolve("store.db").toString(),
            isMemory = false,
        )
    }

    @AfterEach fun tearDown() {
        backing.close()
    }

    @Test fun `writes are persisted to SQLite`() = runBlocking {
        val store: LocalTripleStore = PersistentLocalStore(backing.tripleStore)
        store.put(DataTriple("e1", "aid-name", JsonPrimitive("Alice"), 1L))
        store.put(DataTriple("e2", "aid-name", JsonPrimitive("Bob"), 2L))
        assertEquals(2, store.count())
        // SQLite count matches.
        assertEquals(2L, backing.tripleStore.count())
    }

    @Test fun `restart recovers state from SQLite before any network sync`() = runBlocking {
        // Phase 1: write some triples.
        val store1: LocalTripleStore = PersistentLocalStore(backing.tripleStore)
        store1.put(DataTriple("e1", "aid-name", JsonPrimitive("Alice"), 1L))
        store1.put(DataTriple("e1", "aid-email", JsonPrimitive("a@x.com"), 1L))
        store1.put(DataTriple("e2", "aid-name", JsonPrimitive("Bob"), 2L))
        assertEquals(3, store1.count())
        backing.close()

        // Phase 2: simulate process death by closing backing.
        // Reopen against the same file — no server connection.
        backing = SqliteBackingStore.open(
            tempDir.resolve("store.db").toString(),
            isMemory = false,
        )

        // The new PersistentLocalStore, after rehydrate, must see the
        // triples. Because the in-memory view is empty on cold start,
        // we rehydrate by passing in the entity ids that should exist.
        val store2: PersistentLocalStore = PersistentLocalStore(backing.tripleStore)
        // Direct read from SPI (proves SQLite contains the data).
        val sqliteE1 = backing.tripleStore.loadByEntities(listOf("e1", "e2"))
        assertEquals(3, sqliteE1.size, "expected SQLite to have 3 triples pre-rehydrate")
        store2.rehydrate(listOf("e1", "e2"))
        assertEquals(3, store2.count())
        val e1Triples = store2.lookupEntity("e1")
        assertEquals(2, e1Triples.size)
        val e1Name = e1Triples.firstOrNull { it.aid == "aid-name" }
        assertEquals("Alice", (e1Name?.value as JsonPrimitive).content)
    }

    @Test fun `retract propagates to SQLite`() = runBlocking {
        val store: LocalTripleStore = PersistentLocalStore(backing.tripleStore)
        store.put(DataTriple("e1", "aid-name", JsonPrimitive("Alice"), 1L))
        store.put(DataTriple("e1", "aid-name", JsonPrimitive("Bob"), 1L))
        assertEquals(2, store.count())
        store.retract("e1", "aid-name", JsonPrimitive("Alice"))
        assertEquals(1, store.count())
        // SQLite count drops too.
        assertEquals(1L, backing.tripleStore.count())
    }

    @Test fun `transact is atomic per call`() = runBlocking {
        val store: LocalTripleStore = PersistentLocalStore(backing.tripleStore)
        store.transact(listOf(
            listOf(JsonPrimitive("add-triple"), JsonPrimitive("e1"), JsonPrimitive("aid"), JsonPrimitive("v1"), kotlinx.serialization.json.JsonNull),
            listOf(JsonPrimitive("add-triple"), JsonPrimitive("e2"), JsonPrimitive("aid"), JsonPrimitive("v2"), kotlinx.serialization.json.JsonNull),
        ))
        assertEquals(2, store.count())
        assertEquals(2L, backing.tripleStore.count())
    }

    @Test fun `findByValue and scanByAttribute return persisted triples`() = runBlocking {
        val store: LocalTripleStore = PersistentLocalStore(backing.tripleStore)
        store.put(DataTriple("e1", "aid-id", JsonPrimitive("e1"), 1L))
        store.put(DataTriple("e2", "aid-id", JsonPrimitive("e2"), 2L))
        val matches = store.findByValue("aid-id", JsonPrimitive("e1"))
        assertEquals(1, matches.size)
        assertEquals("e1", matches[0].eid)
        val all = store.scanByAttribute("aid-id").toList()
        assertEquals(2, all.size)
    }

    @Test fun `survives multiple back-to-back process death simulations`() = runBlocking {
        val store1: LocalTripleStore = PersistentLocalStore(backing.tripleStore)
        store1.put(DataTriple("e1", "aid", JsonPrimitive("v"), 1L))
        backing.close()

        // Round 2.
        backing = SqliteBackingStore.open(
            tempDir.resolve("store.db").toString(),
            isMemory = false,
        )
        val store2: LocalTripleStore = PersistentLocalStore(backing.tripleStore)
        store2.put(DataTriple("e2", "aid", JsonPrimitive("v2"), 2L))
        backing.close()

        // Round 3.
        backing = SqliteBackingStore.open(
            tempDir.resolve("store.db").toString(),
            isMemory = false,
        )
        val store3: PersistentLocalStore = PersistentLocalStore(backing.tripleStore)
        store3.rehydrate(listOf("e1", "e2"))
        assertEquals(2, store3.count())
    }
}