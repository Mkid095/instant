package com.instantdb.poc.query

import com.instantdb.poc.data.AttrStore
import com.instantdb.poc.data.InMemoryTripleStore
import com.instantdb.poc.data.SyncCoordinator
import com.instantdb.poc.persistence.InMemoryMutationStore
import com.instantdb.poc.data.Triple as DataTriple
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.take
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

/**
 * Phase 5 — ReactiveQueryEngine tests.
 */
class ReactiveQueryEngineTest {
    private fun mkEngine(): Triple<ReactiveQueryEngine, InMemoryTripleStore, SyncCoordinator> {
        val store = InMemoryTripleStore()
        val attrs = AttrStore()
        val mutations = InMemoryMutationStore()
        val sync = SyncCoordinator(store, attrs, mutations)
        val base = QueryEngine(store, attrs = { emptyList() })
        return Triple(ReactiveQueryEngine(base, store, sync), store, sync)
    }

    @Test fun `cold flow emits an initial result even on empty store`() = runBlocking {
        val (engine, _, _) = mkEngine()
        val q = buildJsonObject {
            put("\$users", buildJsonObject {
                put("\$", buildJsonObject { put("limit", 10) })
            })
        }
        val emissions = withTimeout(2_000) {
            engine.queryFlow(q).take(1).toList()
        }
        // Empty store → empty QueryResult.data; the flow still emits
        // an initial result so consumers see "loaded" state immediately.
        assertEquals(1, emissions.size, "expected an initial emission even on empty store")
        val first = emissions[0]
        // The data is a JsonObject (possibly empty); presence is enough.
        assertNotNull(first)
    }

    @Test fun `flow collector cancels without throwing`() = runBlocking {
        val (engine, _, _) = mkEngine()
        val q = buildJsonObject {
            put("\$users", buildJsonObject {
                put("\$", buildJsonObject { put("limit", 10) })
            })
        }
        // Start a collector and cancel it; no exceptions.
        val job = launch {
            withTimeoutOrNull(500) {
                engine.queryFlow(q).collect { /* discard */ }
            }
        }
        job.join()
        // If we got here without an exception, the test passes.
    }

    @Test fun `reactive engine instantiates without error`() = runBlocking {
        // Construction itself is the assertion: ensures all
        // required types resolve.
        val (engine, _, _) = mkEngine()
        assertNotNull(engine)
    }
}