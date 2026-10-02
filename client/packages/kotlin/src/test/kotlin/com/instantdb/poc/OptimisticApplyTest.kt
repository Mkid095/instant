package com.instantdb.poc

import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.util.UUID

/**
 * Unit tests for OptimisticStore — proves the liveness predicate and
 * apply-loop shape. Doesn't require the server.
 */
class OptimisticApplyTest {
    @Test
    fun `apply unconfirmed mutations on top of server triples`() {
        val serverTriples = emptyList<List<JsonElement>>()
        val pending = MutationQueue.Pending(
            eventId = UUID.randomUUID().toString(),
            txSteps = listOf(listOf(
                JsonPrimitive("add-triple"),
                JsonPrimitive("eid-1"),
                JsonPrimitive("attr-1"),
                JsonPrimitive("hello"),
                kotlinx.serialization.json.JsonNull,
            )),
            order = 1,
        )
        val result = OptimisticStore.apply(serverTriples, processedTxId = 0, mutations = listOf(pending))
        assertEquals(1, result.size)
        assertEquals("eid-1", (result[0][0] as JsonPrimitive).content)
    }

    @Test
    fun `skip mutations already processed by the server`() {
        val pending = MutationQueue.Pending(
            eventId = UUID.randomUUID().toString(),
            txSteps = listOf(listOf(
                JsonPrimitive("add-triple"),
                JsonPrimitive("eid-1"),
                JsonPrimitive("attr-1"),
                JsonPrimitive("hello"),
                kotlinx.serialization.json.JsonNull,
            )),
            order = 1,
            txId = 42, // server confirmed at tx 42
        )
        val result = OptimisticStore.apply(
            serverTriples = emptyList(),
            processedTxId = 50, // server is at tx 50
            mutations = listOf(pending),
        )
        assertTrue(result.isEmpty(), "mutation with tx-id 42 should not apply when processed-tx-id is 50")
    }

    @Test
    fun `apply mutations whose tx-id is greater than processedTxId`() {
        // Server hasn't caught up to our local mutation yet — we should
        // still see it in the optimistic view.
        val pending = MutationQueue.Pending(
            eventId = UUID.randomUUID().toString(),
            txSteps = listOf(listOf(
                JsonPrimitive("add-triple"),
                JsonPrimitive("eid-1"),
                JsonPrimitive("attr-1"),
                JsonPrimitive("optimistic"),
                kotlinx.serialization.json.JsonNull,
            )),
            order = 1,
            txId = 100,
        )
        val result = OptimisticStore.apply(
            serverTriples = emptyList(),
            processedTxId = 50,
            mutations = listOf(pending),
        )
        assertEquals(1, result.size)
    }

    @Test
    fun `apply ordered by order field`() {
        val m1 = MutationQueue.Pending(
            eventId = "a",
            txSteps = listOf(listOf(
                JsonPrimitive("add-triple"),
                JsonPrimitive("eid-a"),
                JsonPrimitive("attr"),
                JsonPrimitive("first"),
                kotlinx.serialization.json.JsonNull,
            )),
            order = 1,
        )
        val m2 = MutationQueue.Pending(
            eventId = "b",
            txSteps = listOf(listOf(
                JsonPrimitive("add-triple"),
                JsonPrimitive("eid-b"),
                JsonPrimitive("attr"),
                JsonPrimitive("second"),
                kotlinx.serialization.json.JsonNull,
            )),
            order = 2,
        )
        // Submit in reverse order; apply should still see [a, b].
        val result = OptimisticStore.apply(emptyList(), 0, listOf(m2, m1))
        assertEquals(2, result.size)
        assertEquals("eid-a", (result[0][0] as JsonPrimitive).content)
        assertEquals("eid-b", (result[1][0] as JsonPrimitive).content)
    }
}
