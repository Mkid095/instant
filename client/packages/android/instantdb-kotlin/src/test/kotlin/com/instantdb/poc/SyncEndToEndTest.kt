package com.instantdb.poc

import com.instantdb.poc.data.AttrStore
import com.instantdb.poc.data.InMemoryTripleStore
import com.instantdb.poc.data.SyncCoordinator
import com.instantdb.poc.data.Triple
import com.instantdb.poc.persistence.InMemoryMutationStore
import kotlinx.coroutines.GlobalScope
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
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
 * Phase 3 end-to-end sync test.
 *
 * Connects to the live self-hosted InstantDB server, performs a query,
 * and verifies that the local triple store receives the data.
 *
 * This is the canonical Phase 3 acceptance test:
 *   - connect → init → add-query → local store populated
 *   - local query evaluates from the local store
 *   - mutate via the server → refresh-ok → local store reflects it
 */
@EnabledIfEnvironmentVariable(named = "INSTANT_TEST_APP_ID", matches = ".+")
class SyncEndToEndTest {
    private val appId = System.getenv("INSTANT_TEST_APP_ID")!!
    private val adminToken = System.getenv("INSTANT_TEST_ADMIN_TOKEN")!!
    private val apiUri = System.getenv("INSTANT_TEST_API_URI") ?: "https://apiinstant.fidscript.com"
    private val wsUri = System.getenv("INSTANT_TEST_WS_URI") ?: "wss://apiinstant.fidscript.com"

    private fun config() = InstantDbConfig(
        appId = appId,
        apiUri = apiUri,
        websocketUri = wsUri,
        adminToken = adminToken,
    )

    @Test
    fun `server response populates local triple store`() = runBlocking {
        val reactor = Reactor(config())

        // Wire up the Phase 3 sync machinery.
        val store = InMemoryTripleStore()
        val attrs = AttrStore()
        val mutations = InMemoryMutationStore()
        val sync = SyncCoordinator(store, attrs, mutations)

        // Start collector BEFORE connect so we don't miss init-ok.
        // Use a separate coroutine so the test thread isn't blocked.
        val collectorJob = GlobalScope.launch {
            reactor.connection.incoming.collect { msg ->
                sync.applyMessage(msg)
            }
        }

        try {
            reactor.connect()
            // Build a real query for `$users` (system table that has data).
            val q = buildJsonObject {
                put("\$users", buildJsonObject {
                    put("\$", buildJsonObject { put("limit", 50) })
                })
            }
            reactor.subscribe(q)

            // Wait for the sync to populate the local store.
            val deadline = System.currentTimeMillis() + 10_000
            var hasTriples = false
            while (System.currentTimeMillis() < deadline && !hasTriples) {
                kotlinx.coroutines.delay(100)
                hasTriples = store.count() > 0
            }
            assertTrue(hasTriples, "expected at least one triple after add-query-ok (got ${store.count()})")

            // Verify attrs were persisted.
            assertTrue(attrs.count() > 0, "expected attrs to be persisted")

            // Verify we can evaluate a local query against the local store.
            val attrList = attrs.all()
            val userAttrs = attrList.filter { it.forwardIdentity.etype == "\$users" }
            assertTrue(userAttrs.isNotEmpty(), "expected \$users attrs")

            // Pick the first \$users attr that has triples (id always has triples
            // because the server emits id-self-refs).
            val userAttr = userAttrs.firstOrNull { attr ->
                store.scanByAttribute(attr.id).any()
            } ?: error("no \$users attr has triples")

            // The local store should contain triples matching users.
            val triples = store.scanByAttribute(userAttr.id).toList()
            assertTrue(triples.isNotEmpty(), "expected at least one user triple")
        } finally {
            collectorJob.cancel()
            reactor.shutdown()
        }
    }

    @Test
    fun `mutation on server propagates to local store via refresh-ok`() = runBlocking {
        val reactor = Reactor(config())

        val store = InMemoryTripleStore()
        val attrs = AttrStore()
        val mutations = InMemoryMutationStore()
        val sync = SyncCoordinator(store, attrs, mutations)

        val collectorJob = GlobalScope.launch {
            reactor.connection.incoming.collect { msg ->
                val op = msg["op"]?.let { (it as JsonPrimitive).content }
                when (op) {
                    "init-ok", "add-query-ok", "refresh-ok" -> sync.applyMessage(msg)
                }
            }
        }

        try {
            reactor.connect()
            // Wait for attrs to populate from init-ok.
            val attrDeadline = System.currentTimeMillis() + 5_000
            while (System.currentTimeMillis() < attrDeadline && attrs.count() == 0) {
                kotlinx.coroutines.delay(100)
            }

            // Subscribe to $users.
            val q = buildJsonObject {
                put("\$users", buildJsonObject {
                    put("\$", buildJsonObject { put("limit", 100) })
                })
            }
            reactor.subscribe(q)

            // Wait for the initial sync to populate the store.
            val initialDeadline = System.currentTimeMillis() + 10_000
            while (System.currentTimeMillis() < initialDeadline && store.count() == 0) {
                kotlinx.coroutines.delay(100)
            }
            val attrList = attrs.all()
            val userAttrId = attrList.firstNotNullOfOrNull { a ->
                if (a.forwardIdentity.etype == "\$users" && store.scanByAttribute(a.id).any()) a.id else null
            } ?: error("no \$users attr with triples")
            val initialCount = store.scanByAttribute(userAttrId).count()

            // Write a new user via the Reactor's transact pipeline.
            val eid = UUID.randomUUID().toString()
            val step: List<JsonElement> = listOf(
                JsonPrimitive("add-triple"),
                JsonPrimitive(eid),
                JsonPrimitive(userAttrId),
                JsonPrimitive("poc-${System.currentTimeMillis()}@kotlin-poc.test"),
                kotlinx.serialization.json.JsonNull,
            )
            val dfd = reactor.transact(listOf(step))
            val ack = kotlinx.coroutines.withTimeout(10_000) { dfd.await() }
            assertEquals(com.instantdb.poc.MutationStatus.Synced, ack.status)

            // Wait for the local store to see the new triple.
            val refreshDeadline = System.currentTimeMillis() + 10_000
            var seenNew = false
            while (System.currentTimeMillis() < refreshDeadline) {
                val newCount = store.scanByAttribute(userAttrId).count()
                if (newCount > initialCount) {
                    seenNew = true
                    break
                }
                kotlinx.coroutines.delay(100)
            }
            assertTrue(seenNew, "expected new triple in local store after server transact")
        } finally {
            collectorJob.cancel()
            reactor.shutdown()
        }
    }
}
