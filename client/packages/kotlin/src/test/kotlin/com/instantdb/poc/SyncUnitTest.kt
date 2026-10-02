package com.instantdb.poc

import com.instantdb.poc.data.AttrStore
import com.instantdb.poc.data.InMemoryTripleStore
import com.instantdb.poc.data.SyncCoordinator
import com.instantdb.poc.persistence.InMemoryMutationStore
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

/**
 * Unit tests for SyncCoordinator — no server required.
 *
 * Server join-rows shape (per model/instaqlResult.js):
 *   join-rows: Array<Array<Triple>>
 *   outer = rows
 *   inner = 4-tuples (eid, aid, value, txId)
 */
class SyncUnitTest {
    @Test
    fun `add-query-ok populates local store`() = runBlocking {
        val store = InMemoryTripleStore()
        val attrs = AttrStore()
        val mutations = InMemoryMutationStore()
        val sync = SyncCoordinator(store, attrs, mutations)

        val q = buildJsonObject {
            put("\$users", buildJsonObject {
                put("\$", buildJsonObject { put("limit", 10) })
            })
        }
        val userEid = "test-eid-1"
        val nameAid = "attr-name-1"
        val idAid = "attr-id-1"
        val msg = buildJsonObject {
            put("op", JsonPrimitive("add-query-ok"))
            put("q", q)
            put("processed-tx-id", JsonPrimitive(42))
            put("result", JsonArray(listOf(
                buildJsonObject {
                    put("data", buildJsonObject {
                        put("datalog-result", buildJsonObject {
                            // join-rows: outer = rows, inner = array of 4-tuples
                            put("join-rows", JsonArray(listOf(
                                JsonArray(listOf(
                                    JsonArray(listOf(
                                        JsonPrimitive(userEid),
                                        JsonPrimitive(nameAid),
                                        JsonPrimitive("alice"),
                                        JsonPrimitive(1),
                                    )),
                                    JsonArray(listOf(
                                        JsonPrimitive(userEid),
                                        JsonPrimitive(idAid),
                                        JsonPrimitive(userEid),
                                        JsonPrimitive(1),
                                    )),
                                )),
                            )))
                        })
                    })
                }
            )))
        }

        sync.applyMessage(msg)
        assertEquals(2, store.count())
        val triples = store.lookupAttribute(userEid, nameAid)
        assertEquals(1, triples.size)
        assertEquals("alice", (triples[0].value as JsonPrimitive).content)
    }

    @Test
    fun `refresh-ok with computations populates store`() = runBlocking {
        val store = InMemoryTripleStore()
        val attrs = AttrStore()
        val mutations = InMemoryMutationStore()
        val sync = SyncCoordinator(store, attrs, mutations)

        val q = buildJsonObject {
            put("\$users", buildJsonObject {
                put("\$", buildJsonObject { put("limit", 10) })
            })
        }
        val userEid = "test-eid-2"
        val msg = buildJsonObject {
            put("op", JsonPrimitive("refresh-ok"))
            put("processed-tx-id", JsonPrimitive(100))
            put("computations", JsonArray(listOf(
                buildJsonObject {
                    put("instaql-query", q)
                    put("instaql-result", JsonArray(listOf(
                        buildJsonObject {
                            put("data", buildJsonObject {
                                put("datalog-result", buildJsonObject {
                                    put("join-rows", JsonArray(listOf(
                                        JsonArray(listOf(
                                            JsonArray(listOf(
                                                JsonPrimitive(userEid),
                                                JsonPrimitive("name-aid"),
                                                JsonPrimitive("bob"),
                                                JsonPrimitive(50),
                                            )),
                                        )),
                                    )))
                                })
                            })
                        }
                    )))
                }
            )))
        }

        sync.applyMessage(msg)
        assertEquals(1, store.count())
        assertTrue(store.lookupAttribute(userEid, "name-aid").isNotEmpty())
    }
}