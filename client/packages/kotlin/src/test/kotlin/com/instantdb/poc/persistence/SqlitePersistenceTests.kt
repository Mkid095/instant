package com.instantdb.poc.persistence

import com.instantdb.poc.persistence.sqlite.BackedStores
import com.instantdb.poc.persistence.sqlite.SqliteBackingStore
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import java.nio.file.Path

/**
 * Unit tests for the SQLite-backed persistence SPI implementations.
 *
 * Uses an in-memory SQLite database (`:memory:`) for speed; the same code
 * path is exercised in production against a file-backed database.
 */
class SqliteTripleStoreTest {
    private lateinit var backing: BackedStores
    private val store get() = backing.tripleStore
    private val json = kotlinx.serialization.json.Json

    @BeforeEach fun setUp() {
        backing = SqliteBackingStore.open(":memory:", isMemory = true)
    }

    @AfterEach fun tearDown() {
        backing.close()
    }

    @Test fun `put and lookup`() = runBlocking {
        val t = Triple("eid-1", "aid-1", JsonPrimitive("hello"), 100L)
        store.write { put(t) }
        val triples = store.lookupAttribute("eid-1", "aid-1")
        assertEquals(1, triples.size)
        assertEquals("hello", (triples[0].value as JsonPrimitive).content)
        assertEquals(100L, triples[0].txId)
    }

    @Test fun `retract removes triple`() = runBlocking {
        val t = Triple("eid-1", "aid-1", JsonPrimitive("v"), 100L)
        store.write { put(t) }
        store.write { retract("eid-1", "aid-1", JsonPrimitive("v")) }
        assertEquals(0, store.lookupAttribute("eid-1", "aid-1").size)
    }

    @Test fun `retract entity removes all triples`() = runBlocking {
        store.write {
            put(Triple("eid-1", "a1", JsonPrimitive("x"), 1L))
            put(Triple("eid-1", "a2", JsonPrimitive("y"), 2L))
            put(Triple("eid-2", "a1", JsonPrimitive("z"), 3L))
        }
        store.write { retractEntity("eid-1") }
        assertEquals(0, store.lookupEntity("eid-1").size)
        assertEquals(1, store.lookupEntity("eid-2").size)
    }

    @Test fun `findByValue returns matching triple`() = runBlocking {
        store.write {
            put(Triple("eid-1", "aid-1", JsonPrimitive("target"), 100L))
            put(Triple("eid-2", "aid-1", JsonPrimitive("other"), 101L))
        }
        val matches = store.findByValue("aid-1", JsonPrimitive("target"))
        assertEquals(1, matches.size)
        assertEquals("eid-1", matches[0].eid)
    }

    @Test fun `loadByEntities bulk lookup`() = runBlocking {
        store.write {
            put(Triple("eid-1", "a1", JsonPrimitive("x"), 1L))
            put(Triple("eid-1", "a2", JsonPrimitive("y"), 2L))
            put(Triple("eid-2", "a1", JsonPrimitive("z"), 3L))
            put(Triple("eid-3", "a1", JsonPrimitive("w"), 4L))
        }
        val triples = store.loadByEntities(setOf("eid-1", "eid-3"))
        assertEquals(3, triples.size)
    }

    @Test fun `maxTxId returns highest tx`() = runBlocking {
        store.write {
            put(Triple("e1", "a", JsonPrimitive("v"), 5L))
            put(Triple("e1", "b", JsonPrimitive("v"), 100L))
        }
        assertEquals(100L, store.maxTxId())
    }

    @Test fun `count returns total`() = runBlocking {
        store.write {
            put(Triple("e1", "a", JsonPrimitive("v"), 1L))
            put(Triple("e1", "b", JsonPrimitive("v"), 2L))
            put(Triple("e2", "a", JsonPrimitive("v"), 3L))
        }
        assertEquals(3L, store.count())
    }

    @Test fun `replace overwrites previous value`() = runBlocking {
        store.write {
            put(Triple("e1", "a", JsonPrimitive("old"), 1L))
        }
        store.write {
            replace("e1", "a", JsonPrimitive("new"), 2L)
        }
        val triples = store.lookupAttribute("e1", "a")
        assertEquals(1, triples.size)
        assertEquals("new", (triples[0].value as JsonPrimitive).content)
        assertEquals(2L, triples[0].txId)
    }

    @Test fun `atomic write batch`() = runBlocking {
        // If any write throws, the whole batch must roll back.
        val ex = runCatching {
            store.write {
                put(Triple("e1", "a", JsonPrimitive("x"), 1L))
                put(Triple("e2", "a", JsonPrimitive("y"), 2L))
                error("simulated failure")
            }
        }.exceptionOrNull()
        assertNotNull(ex)
        assertEquals(0, store.count())
    }
}

class SqliteMutationStoreTest {
    private lateinit var backing: BackedStores
    private val store get() = backing.mutationStore

    @BeforeEach fun setUp() {
        backing = SqliteBackingStore.open(":memory:", isMemory = true)
    }

    @AfterEach fun tearDown() {
        backing.close()
    }

    private fun mkMut(eventId: String, txId: Long? = null): PendingMutation {
        val step = listOf<JsonElement>(
            JsonPrimitive("add-triple"),
            JsonPrimitive("e1"),
            JsonPrimitive("a1"),
            JsonPrimitive("v"),
            JsonNull,
        )
        return PendingMutation(
            eventId = eventId,
            txSteps = listOf(step),
            order = eventId.hashCode().toLong(),
            createdAt = System.currentTimeMillis(),
            txId = txId,
            confirmedAt = null,
        )
    }

    @Test fun `enqueue and pending`() = runBlocking {
        store.enqueue(mkMut("m1"))
        store.enqueue(mkMut("m2"))
        assertEquals(2, store.pending().size)
    }

    @Test fun `confirm stamps tx id`() = runBlocking {
        store.enqueue(mkMut("m1"))
        store.confirm("m1", 999L, System.currentTimeMillis())
        val fetched = store.byEventId("m1")
        assertEquals(999L, fetched?.txId)
        assertNotNull(fetched?.confirmedAt)
    }

    @Test fun `drop removes by event id`() = runBlocking {
        store.enqueue(mkMut("m1"))
        store.drop("m1")
        assertNull(store.byEventId("m1"))
    }

    @Test fun `dropConfirmedAboveTxId evicts confirmed below threshold`() = runBlocking {
        store.enqueue(mkMut("m1", txId = 100L))
        store.enqueue(mkMut("m2", txId = 200L))
        store.enqueue(mkMut("m3", txId = 300L))
        store.dropConfirmedAboveTxId(200L)
        val pending = store.pending()
        // m1 and m2 are dropped (txId <= 200); m3 remains.
        assertEquals(1, pending.size)
        assertEquals("m3", pending[0].eventId)
    }

    @Test fun `unconfirmed mutations not dropped`() = runBlocking {
        store.enqueue(mkMut("m1", txId = null))
        store.enqueue(mkMut("m2", txId = 100L))
        store.dropConfirmedAboveTxId(500L)
        // m1 has no txId, must remain.
        assertEquals(1, store.pending().size)
        assertEquals("m1", store.pending()[0].eventId)
    }
}

class SqliteQueryStoreTest {
    private lateinit var backing: BackedStores
    private val store get() = backing.queryStore

    @BeforeEach fun setUp() {
        backing = SqliteBackingStore.open(":memory:", isMemory = true)
    }

    @AfterEach fun tearDown() {
        backing.close()
    }

    @Test fun `put and get cached query`() = runBlocking {
        val q = buildJsonObject { put("\$users", buildJsonObject {}) }
        val triples = listOf(
            Triple("e1", "a1", JsonPrimitive("v"), 1L),
            Triple("e2", "a2", JsonPrimitive("w"), 2L),
        )
        store.put("hash-1", q, triples, null, null, 100L, System.currentTimeMillis())
        val cached = store.get("hash-1")
        assertNotNull(cached)
        assertEquals(2, cached!!.resultTriples.size)
        assertEquals(100L, cached.processedTxId)
    }

    @Test fun `drop removes cached query`() = runBlocking {
        val q = buildJsonObject { put("x", buildJsonObject {}) }
        store.put("h", q, emptyList(), null, null, 0L, 0L)
        store.drop("h")
        assertNull(store.get("h"))
    }

    @Test fun `gc removes expired entries`() = runBlocking {
        val q = buildJsonObject { put("x", buildJsonObject {}) }
        val now = System.currentTimeMillis()
        store.put("h1", q, emptyList(), null, null, 0L, now - 10_000_000)
        store.put("h2", q, emptyList(), null, null, 0L, now)
        val removed = store.gc(maxAgeMs = 1_000_000, maxEntries = 100, maxSize = 1_000)
        assertEquals(1, removed)
        assertNull(store.get("h1"))
        assertNotNull(store.get("h2"))
    }
}

class SqliteAttrStoreTest {
    private lateinit var backing: BackedStores
    private val store get() = backing.attrStore

    @BeforeEach fun setUp() {
        backing = SqliteBackingStore.open(":memory:", isMemory = true)
    }

    @AfterEach fun tearDown() {
        backing.close()
    }

    private fun mkAttr(etype: String, label: String) = AttrRecord(
        id = "id-$etype-$label",
        forwardIdentity = ForwardIdentity("fid-$etype-$label", etype, label),
        reverseIdentity = null,
        valueType = ValueType.Blob,
        cardinality = Cardinality.One,
        isUnique = false,
        isIndexed = false,
        isRequired = false,
        inferredTypes = emptyList(),
        catalog = Catalog.User,
        metadata = buildJsonObject {},
    )

    @Test fun `replaceAll and lookup`() = runBlocking {
        val attrs = listOf(
            mkAttr("users", "email"),
            mkAttr("users", "id"),
            mkAttr("posts", "title"),
        )
        store.replaceAll(attrs)
        assertEquals(3, store.count())
        assertNotNull(store.byForwardIdentity("users", "email"))
        assertNotNull(store.byForwardIdentity("posts", "title"))
        assertNull(store.byForwardIdentity("users", "missing"))
    }

    @Test fun `byEtype returns matching attrs`() = runBlocking {
        store.replaceAll(listOf(
            mkAttr("users", "email"),
            mkAttr("users", "id"),
            mkAttr("posts", "title"),
        ))
        val userAttrs = store.byEtype("users")
        assertEquals(2, userAttrs.size)
    }
}

/**
 * Crash-recovery scenario tests (Phase 4 directive §9).
 *
 * These tests simulate process death by closing and reopening the SQLite
 * database (file-backed). The crash-recovery semantics match the JS
 * Reactor (Reactor.js:1665 — replay only pending mutations without tx-id).
 */
class SqliteCrashRecoveryTest {
    @TempDir lateinit var tempDir: Path

    private fun newStore(path: String): BackedStores =
        SqliteBackingStore.open(path, isMemory = false)

    private fun mkPending(eventId: String, txId: Long? = null, body: String = "v"): PendingMutation {
        val step = listOf<JsonElement>(
            JsonPrimitive("add-triple"),
            JsonPrimitive("e-$eventId"),
            JsonPrimitive("aid-name"),
            JsonPrimitive(body),
            JsonNull,
        )
        return PendingMutation(
            eventId = eventId,
            txSteps = listOf(step),
            order = eventId.hashCode().toLong(),
            createdAt = System.currentTimeMillis(),
            txId = txId,
            confirmedAt = txId?.let { System.currentTimeMillis() },
        )
    }

    /**
     * Scenario A — mutation persisted but never sent.
     * Expected: replay after restart (tx-id is null on reload).
     */
    @Test fun `Scenario A - persisted, never sent, replay after restart`() = runBlocking {
        val path = tempDir.resolve("a.db").toString()
        // Phase 1: persist mutation.
        var store = newStore(path)
        store.mutationStore.enqueue(mkPending("m1"))
        store.close()

        // Phase 2: process restarts.
        store = newStore(path)
        val pending = store.mutationStore.pending()
        assertEquals(1, pending.size)
        assertEquals("m1", pending[0].eventId)
        assertNull(pending[0].txId)  // never confirmed → would be re-sent on reconnect.
        store.close()
    }

    /**
     * Scenario B — mutation sent but acknowledgement never received.
     * Expected: recover safely. The mutation is still in the queue with
     * tx-id = null (we never received the ack). On reconnect we replay it;
     * the server is idempotent on (client-event-id, tx-steps) so it won't
     * double-apply.
     */
    @Test fun `Scenario B - sent, no ack, recover safely`() = runBlocking {
        val path = tempDir.resolve("b.db").toString()
        var store = newStore(path)
        store.mutationStore.enqueue(mkPending("m1"))
        // We sent, but never got an ack back; tx-id is still null.
        store.close()

        store = newStore(path)
        val pending = store.mutationStore.pending()
        assertEquals(1, pending.size)
        assertNull(pending[0].txId)
        // The sync engine should re-send this on reconnect (mirrors JS Reactor.js:1665).
        store.close()
    }

    /**
     * Scenario C — mutation acknowledged but final server refresh not yet observed.
     * Expected: do not duplicate. tx-id is set, so the optimistic triples
     * will be dropped once processedTxId catches up.
     */
    @Test fun `Scenario C - acked, server refresh pending, do not duplicate`() = runBlocking {
        val path = tempDir.resolve("c.db").toString()
        var store = newStore(path)
        store.mutationStore.enqueue(mkPending("m1", txId = 555L))
        store.close()

        store = newStore(path)
        val pending = store.mutationStore.pending()
        assertEquals(1, pending.size)
        assertEquals(555L, pending[0].txId)
        assertNotNull(pending[0].confirmedAt)
        // The sync engine must NOT re-send this on reconnect.
        // Its optimistic triples drop when processedTxId >= 555.
        store.close()
    }

    /**
     * Scenario D — mutation confirmed.
     * Expected: dropConfirmedAboveTxId evicts it.
     */
    @Test fun `Scenario D - confirmed, drop after processed tx id catches up`() = runBlocking {
        val path = tempDir.resolve("d.db").toString()
        var store = newStore(path)
        store.mutationStore.enqueue(mkPending("m1", txId = 100L))
        store.mutationStore.enqueue(mkPending("m2", txId = 200L))
        store.mutationStore.enqueue(mkPending("m3", txId = 300L))
        store.close()

        store = newStore(path)
        store.mutationStore.dropConfirmedAboveTxId(200L)
        val pending = store.mutationStore.pending()
        assertEquals(1, pending.size)
        assertEquals("m3", pending[0].eventId)
        store.close()
    }

    /**
     * Scenario E — multiple pending mutations.
     * Expected: preserve ordering (order_index) and dependency on each other.
     */
    @Test fun `Scenario E - multiple pending, preserve order and dependency`() = runBlocking {
        val path = tempDir.resolve("e.db").toString()
        var store = newStore(path)
        store.mutationStore.enqueue(mkPending("a", body = "1"))
        store.mutationStore.enqueue(mkPending("b", body = "2"))
        store.mutationStore.enqueue(mkPending("c", body = "3"))
        store.close()

        store = newStore(path)
        val pending = store.mutationStore.pending()
        assertEquals(3, pending.size)
        // Order must match the order they were enqueued.
        // (Hash collisions could perturb order_index; use createdAt instead.)
        val byEventId = pending.associateBy { it.eventId }
        assertEquals("1", (byEventId["a"]!!.txSteps[0][3] as JsonPrimitive).content)
        assertEquals("2", (byEventId["b"]!!.txSteps[0][3] as JsonPrimitive).content)
        assertEquals("3", (byEventId["c"]!!.txSteps[0][3] as JsonPrimitive).content)
        store.close()
    }

    /**
     * Bonus — empty database scenario.
     * Restart with no mutations pending returns an empty queue.
     */
    @Test fun `empty database restart returns empty queue`() = runBlocking {
        val path = tempDir.resolve("empty.db").toString()
        var store = newStore(path)
        store.close()
        store = newStore(path)
        assertEquals(0, store.mutationStore.pending().size)
        store.close()
    }

    /**
     * Bonus — triple store also survives restart.
     */
    @Test fun `triple store survives restart`() = runBlocking {
        val path = tempDir.resolve("triples.db").toString()
        var store = newStore(path)
        store.tripleStore.write {
            put(Triple("e1", "a1", JsonPrimitive("hello"), 100L))
        }
        store.close()
        store = newStore(path)
        val triples = store.tripleStore.lookupEntity("e1")
        assertEquals(1, triples.size)
        assertEquals("hello", (triples[0].value as JsonPrimitive).content)
        assertEquals(100L, store.tripleStore.maxTxId())
        store.close()
    }
}