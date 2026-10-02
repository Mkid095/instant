package com.instantdb.poc

import com.instantdb.poc.persistence.PendingMutation
import com.instantdb.poc.persistence.sqlite.BackedStores
import com.instantdb.poc.persistence.sqlite.SqliteBackingStore
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
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
 * Phase 9 — Optimistic mutation recovery lifecycle (Cases A–F).
 *
 * Phase 8 identified these as foundation-only. Phase 9 implements
 * the full cases.
 *
 * The model:
 *  - `pending_mutations` (SQLite SPI) is the authoritative store of
 *    optimistic work.
 *  - Mutations are categorized by `txId == null` (still pending)
 *    vs `txId != null` (acknowledged).
 *  - On restart, replay from this durable record.
 */
class OptimisticRecoveryAtoFTest {
    @TempDir lateinit var tempDir: Path
    private lateinit var backing: BackedStores

    @BeforeEach fun setUp() {
        backing = SqliteBackingStore.open(
            tempDir.resolve("optimistic.db").toString(),
            isMemory = false,
        )
    }

    @AfterEach fun tearDown() {
        backing.close()
    }

    private fun mkPending(
        eventId: String,
        txId: Long? = null,
        body: String = "v-$eventId",
        order: Long = eventId.hashCode().toLong(),
    ): PendingMutation {
        val step = listOf(
            JsonPrimitive("add-triple"),
            JsonPrimitive("e-$eventId"),
            JsonPrimitive("aid-name"),
            JsonPrimitive(body),
            JsonNull,
        )
        return PendingMutation(
            eventId = eventId,
            txSteps = listOf(step),
            order = order,
            createdAt = System.currentTimeMillis(),
            txId = txId,
            confirmedAt = txId?.let { System.currentTimeMillis() },
        )
    }

    /**
     * Case A — Persisted mutation never sent.
     * Expected: replay on restart.
     */
    @Test fun `Case A - persisted never sent - replay on restart`() = runBlocking {
        backing.mutationStore.enqueue(mkPending("m-a"))
        assertEquals(1, backing.mutationStore.pending().size)
        backing.close()

        backing = SqliteBackingStore.open(
            tempDir.resolve("optimistic.db").toString(),
            isMemory = false,
        )
        val pending = backing.mutationStore.pending()
        assertEquals(1, pending.size)
        assertEquals("m-a", pending[0].eventId)
        assertNull(pending[0].txId, "never-sent mutation must have null txId after restart")
    }

    /**
     * Case B — Mutation sent but no acknowledgement.
     * Expected: recover safely. txId is null. Safe to re-send.
     */
    @Test fun `Case B - sent no ack - recover safely`() = runBlocking {
        backing.mutationStore.enqueue(mkPending("m-b"))
        // We sent; we never received ack.
        backing.close()

        backing = SqliteBackingStore.open(
            tempDir.resolve("optimistic.db").toString(),
            isMemory = false,
        )
        val pending = backing.mutationStore.pending()
        assertEquals(1, pending.size)
        assertNull(pending[0].txId)
        // Safe to re-send on reconnect.
    }

    /**
     * Case C — Acknowledgement observed but final refresh not processed.
     * Expected: do not duplicate. txId is set.
     */
    @Test fun `Case C - acked no refresh - no duplicate`() = runBlocking {
        backing.mutationStore.enqueue(mkPending("m-c", txId = 555L))
        backing.close()

        backing = SqliteBackingStore.open(
            tempDir.resolve("optimistic.db").toString(),
            isMemory = false,
        )
        val pending = backing.mutationStore.pending()
        assertEquals(1, pending.size)
        assertEquals(555L, pending[0].txId)
        // Server has txId 555; the optimistic triples will be dropped
        // once processedTxId >= 555 via JS-Reactor equivalent.
    }

    /**
     * Case D — Confirmed mutation.
     * Expected: drop via dropConfirmedAboveTxId.
     */
    @Test fun `Case D - confirmed - drop after processed tx id catches up`() = runBlocking {
        backing.mutationStore.enqueue(mkPending("m-d1", txId = 100L))
        backing.mutationStore.enqueue(mkPending("m-d2", txId = 200L))
        backing.mutationStore.enqueue(mkPending("m-d3", txId = 300L))
        backing.mutationStore.dropConfirmedAboveTxId(200L)
        val pending = backing.mutationStore.pending()
        assertEquals(1, pending.size)
        assertEquals("m-d3", pending[0].eventId)
        assertEquals(300L, pending[0].txId)
    }

    /**
     * Case E — Multiple pending mutations preserve order.
     */
    @Test fun `Case E - multiple pending - preserve order`() = runBlocking {
        // Use unique orders to avoid hash collisions.
        backing.mutationStore.enqueue(mkPending("a", order = 100L))
        backing.mutationStore.enqueue(mkPending("b", order = 200L))
        backing.mutationStore.enqueue(mkPending("c", order = 300L))
        backing.close()

        backing = SqliteBackingStore.open(
            tempDir.resolve("optimistic.db").toString(),
            isMemory = false,
        )
        val pending = backing.mutationStore.pending()
        assertEquals(3, pending.size)
        val orders = pending.map { it.order }
        assertEquals(listOf(100L, 200L, 300L), orders,
            "ordering must be preserved across restart")
        val bodies = pending.map { (it.txSteps[0][3] as JsonPrimitive).content }
        assertEquals(listOf("v-a", "v-b", "v-c"), bodies)
    }

    /**
     * Case F — Mixed states survive restart.
     * Expected: pending / sent / confirmed / failed are correctly preserved.
     */
    @Test fun `Case F - mixed states - deterministic reconstruction`() = runBlocking {
        backing.mutationStore.enqueue(mkPending("pending-1", txId = null, order = 1L))
        backing.mutationStore.enqueue(mkPending("sent-1", txId = null, order = 2L))
        backing.mutationStore.enqueue(mkPending("acked-1", txId = 100L, order = 3L))
        backing.mutationStore.enqueue(mkPending("acked-2", txId = 200L, order = 4L))
        // "failed" is represented by drop(eventId) in the SPI.
        backing.mutationStore.enqueue(mkPending("to-fail", txId = null, order = 5L))
        backing.mutationStore.drop("to-fail")
        backing.close()

        backing = SqliteBackingStore.open(
            tempDir.resolve("optimistic.db").toString(),
            isMemory = false,
        )
        val pending = backing.mutationStore.pending()
        // Expected to survive: pending-1, sent-1, acked-1, acked-2.
        assertEquals(4, pending.size)
        val byId = pending.associateBy { it.eventId }
        assertNull(byId["pending-1"]?.txId)
        assertNull(byId["sent-1"]?.txId)
        assertEquals(100L, byId["acked-1"]?.txId)
        assertEquals(200L, byId["acked-2"]?.txId)
        assertNull(byId["to-fail"], "to-fail was dropped; must NOT be re-listed after restart")
    }
}