package com.instantdb.poc

import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable
import java.util.UUID

/**
 * Phase 9 — Multi-client causal convergence (3 clients).
 *
 * Three clients (A, B, C) connect to the same self-hosted InstantDB
 * app. Each performs an independent mutation. We verify that the
 * server assigns distinct tx-ids and that all three clients observe
 * a successful response. The deterministic convergence contract is:
 *   - each server transaction has a unique tx-id
 *   - each client receives its own ack
 *   - tx-id is monotonically increasing within a session (per JS convention)
 */
@EnabledIfEnvironmentVariable(named = "INSTANT_TEST_APP_ID", matches = ".+")
class MultiClientCausalTest {
    private val appId = System.getenv("INSTANT_TEST_APP_ID")!!
    private val adminToken = System.getenv("INSTANT_TEST_ADMIN_TOKEN")!!
    private val apiUri = System.getenv("INSTANT_TEST_API_URI") ?: "https://apiinstant.fidscript.com"
    private val wsUri = System.getenv("INSTANT_TEST_WS_URI") ?: "wss://apiinstant.fidscript.com"

    private fun config() = InstantDbConfig(appId, apiUri, wsUri, adminToken = adminToken)

    /**
     * Three clients each perform a mutation. Each must get a unique
     * tx-id back from the server. Tests the causal ordering the SDK
     * assigns to its own optimistic triples.
     */
    @Test fun `three clients - each mutation gets unique tx-id`() = runBlocking {
        val a = Reactor(config())
        val b = Reactor(config())
        val c = Reactor(config())
        a.connect(); b.connect(); c.connect()
        delay(1_000) // let init complete

        val aid = "96653230-13ff-ffff-a4b4-46010bffffff"  // users.email
        val mkStep = { value: String -> listOf(
            JsonPrimitive("add-triple"),
            JsonPrimitive(UUID.randomUUID().toString()),
            JsonPrimitive(aid),
            JsonPrimitive("causal-${value}-${System.nanoTime()}"),
            kotlinx.serialization.json.JsonNull,
        ) }

        val ackA = withTimeout(5_000) { a.transact(listOf(mkStep("a"))).await() }
        val ackB = withTimeout(5_000) { b.transact(listOf(mkStep("b"))).await() }
        val ackC = withTimeout(5_000) { c.transact(listOf(mkStep("c"))).await() }

        assertEquals(MutationStatus.Synced, ackA.status)
        assertEquals(MutationStatus.Synced, ackB.status)
        assertEquals(MutationStatus.Synced, ackC.status)

        assertNotNull(ackA.txId)
        assertNotNull(ackB.txId)
        assertNotNull(ackC.txId)

        // Distinct tx-ids.
        val s = setOf(ackA.txId, ackB.txId, ackC.txId)
        assertEquals(3, s.size, "expected 3 distinct tx-ids, got: $s")

        a.shutdown(); b.shutdown(); c.shutdown()
    }

    /**
     * A performs many mutations; all get distinct monotonic tx-ids
     * from the server. Verifies causal ordering within a single
     * client's session.
     */
    @Test fun `sequential mutations within one session get distinct tx-ids`() = runBlocking {
        val reactor = Reactor(config())
        reactor.connect()
        delay(500)

        val aid = "96653230-13ff-ffff-a4b4-46010bffffff"
        val mkStep = { value: String -> listOf(
            JsonPrimitive("add-triple"),
            JsonPrimitive(UUID.randomUUID().toString()),
            JsonPrimitive(aid),
            JsonPrimitive("seq-$value-${System.nanoTime()}"),
            kotlinx.serialization.json.JsonNull,
        ) }

        val ids = mutableListOf<Long>()
        for (i in 0 until 5) {
            val ack = withTimeout(5_000) {
                reactor.transact(listOf(mkStep("v$i"))).await()
            }
            assertEquals(MutationStatus.Synced, ack.status)
            ids.add(ack.txId!!)
        }
        // Distinct.
        assertEquals(ids.size, ids.toSet().size, "expected all tx-ids to be distinct: $ids")
        // Monotonic non-decreasing.
        for (i in 1 until ids.size) {
            assertTrue(ids[i] >= ids[i - 1],
                "tx-ids should be monotonic non-decreasing: $ids")
        }
        reactor.shutdown()
    }

    /**
     * Three clients each subscribe to \$users; verify all three
     * can subscribe independently.
     */
    @Test fun `three clients subscribe independently to the same query`() = runBlocking {
        val a = Reactor(config())
        val b = Reactor(config())
        val c = Reactor(config())
        a.connect(); b.connect(); c.connect()
        delay(500)

        val q = buildJsonObject {
            put("\$users", buildJsonObject {
                put("\$", buildJsonObject { put("limit", 50) })
            })
        }
        // All three should accept the subscription.
        a.subscribe(q)
        b.subscribe(q)
        c.subscribe(q)
        // No exception = the server is happy to multiplex subscriptions.

        a.shutdown(); b.shutdown(); c.shutdown()
    }
}