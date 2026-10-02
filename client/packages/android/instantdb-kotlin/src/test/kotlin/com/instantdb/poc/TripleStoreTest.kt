package com.instantdb.poc.data

import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Test
import java.util.UUID

class TripleStoreTest {
    @Test
    fun `put and lookup a triple`() = runBlocking {
        val store = InMemoryTripleStore()
        val t = Triple("eid-1", "aid-1", JsonPrimitive("hello"), 1L)
        store.put(t)
        val out = store.lookupAttribute("eid-1", "aid-1")
        assertEquals(1, out.size)
        assertEquals("hello", (out[0].value as JsonPrimitive).content)
        assertEquals(1L, out[0].createdAt)
    }

    @Test
    fun `retract removes the triple from all indexes`() = runBlocking {
        val store = InMemoryTripleStore()
        val t = Triple("eid-1", "aid-1", JsonPrimitive("hello"), 1L)
        store.put(t)
        store.retract("eid-1", "aid-1", JsonPrimitive("hello"))
        assertEquals(emptyList<Triple>(), store.lookupAttribute("eid-1", "aid-1"))
        assertEquals(0, store.count())
    }

    @Test
    fun `transact applies multiple steps atomically`() = runBlocking {
        val store = InMemoryTripleStore()
        val eid = UUID.randomUUID().toString()
        val attrId = "attr-id"
        store.transact(listOf(
            listOf(JsonPrimitive("add-triple"), JsonPrimitive(eid), JsonPrimitive(attrId), JsonPrimitive("a"), kotlinx.serialization.json.JsonNull),
            listOf(JsonPrimitive("add-triple"), JsonPrimitive(eid), JsonPrimitive(attrId), JsonPrimitive("b"), kotlinx.serialization.json.JsonNull),
        ))
        val out = store.lookupAttribute(eid, attrId)
        assertEquals(2, out.size)
    }

    @Test
    fun `delete-entity removes all triples for the eid`() = runBlocking {
        val store = InMemoryTripleStore()
        val eid = UUID.randomUUID().toString()
        store.transact(listOf(
            listOf(JsonPrimitive("add-triple"), JsonPrimitive(eid), JsonPrimitive("a1"), JsonPrimitive("x"), kotlinx.serialization.json.JsonNull),
            listOf(JsonPrimitive("add-triple"), JsonPrimitive(eid), JsonPrimitive("a2"), JsonPrimitive("y"), kotlinx.serialization.json.JsonNull),
        ))
        assertEquals(2, store.count())
        store.transact(listOf(
            listOf(JsonPrimitive("delete-entity"), JsonPrimitive(eid), JsonPrimitive("\$users")),
        ))
        assertEquals(0, store.count())
    }

    @Test
    fun `retract-entity removes all triples for the eid`() = runBlocking {
        val store = InMemoryTripleStore()
        val eid = UUID.randomUUID().toString()
        store.transact(listOf(
            listOf(JsonPrimitive("add-triple"), JsonPrimitive(eid), JsonPrimitive("a1"), JsonPrimitive("x"), kotlinx.serialization.json.JsonNull),
        ))
        store.retractEntity(eid)
        assertEquals(0, store.count())
    }

    @Test
    fun `find by value locates the triple via AEV index`() = runBlocking {
        val store = InMemoryTripleStore()
        val eid = UUID.randomUUID().toString()
        store.put(Triple(eid, "email", JsonPrimitive("[email protected]"), 1L))
        val found = store.findByValue("email", JsonPrimitive("[email protected]"))
        assertEquals(1, found.size)
        assertEquals(eid, found[0].eid)
    }

    @Test
    fun `lookup entity returns all triples for the eid`() = runBlocking {
        val store = InMemoryTripleStore()
        val eid = UUID.randomUUID().toString()
        store.transact(listOf(
            listOf(JsonPrimitive("add-triple"), JsonPrimitive(eid), JsonPrimitive("a1"), JsonPrimitive("x"), kotlinx.serialization.json.JsonNull),
            listOf(JsonPrimitive("add-triple"), JsonPrimitive(eid), JsonPrimitive("a2"), JsonPrimitive("y"), kotlinx.serialization.json.JsonNull),
        ))
        val triples = store.lookupEntity(eid)
        assertEquals(2, triples.size)
    }

    @Test
    fun `preserves createdAt on re-put of same triple`() = runBlocking {
        val store = InMemoryTripleStore()
        val t1 = Triple("eid-1", "aid-1", JsonPrimitive("hello"), 100L)
        store.put(t1)
        val t2 = Triple("eid-1", "aid-1", JsonPrimitive("hello"), 999L)
        store.put(t2)
        val out = store.lookupAttribute("eid-1", "aid-1")
        assertEquals(1, out.size)
        assertEquals(100L, out[0].createdAt, "re-put must preserve the original createdAt")
    }

    @Test
    fun `maxTxId tracks the highest seen`() = runBlocking {
        val store = InMemoryTripleStore()
        store.put(Triple("e1", "a", JsonPrimitive("x"), 5L))
        store.put(Triple("e2", "a", JsonPrimitive("y"), 10L))
        store.put(Triple("e3", "a", JsonPrimitive("z"), 7L))
        assertEquals(10L, store.maxTxId)
    }

    @Test
    fun `loadByEntities bulk-loads triples`() = runBlocking {
        val store = InMemoryTripleStore()
        val e1 = UUID.randomUUID().toString()
        val e2 = UUID.randomUUID().toString()
        val e3 = UUID.randomUUID().toString()
        store.loadAll(listOf(
            Triple(e1, "a", JsonPrimitive("1"), 1L),
            Triple(e2, "a", JsonPrimitive("2"), 2L),
            Triple(e3, "a", JsonPrimitive("3"), 3L),
        ))
        val loaded = store.loadByEntities(listOf(e1, e2))
        assertEquals(2, loaded.size)
    }

    @Test
    fun `concurrent writes serialize correctly`() = runBlocking {
        val store = InMemoryTripleStore()
        val eid = UUID.randomUUID().toString()
        val jobs = (0..50).map { i ->
            kotlinx.coroutines.GlobalScope.async {
                store.put(Triple("$eid-$i", "a", JsonPrimitive(i), i.toLong()))
            }
        }
        kotlinx.coroutines.runBlocking { jobs.forEach { it.await() } }
        assertEquals(51, store.count())
    }

    @Test
    fun `parseAttrs reads server attrs payload`() {
        val raw = buildJsonObject {
            put("attrs", kotlinx.serialization.json.JsonArray(listOf(
                buildJsonObject {
                    put("id", JsonPrimitive("attr-1"))
                    put("forward-identity", kotlinx.serialization.json.JsonArray(listOf(
                        JsonPrimitive("fwd-id"), JsonPrimitive("\$users"), JsonPrimitive("name"),
                    )))
                    put("reverse-identity", kotlinx.serialization.json.JsonArray(listOf(
                        JsonPrimitive("rev-id"), JsonPrimitive("\$posts"), JsonPrimitive("owner"),
                    )))
                    put("value-type", JsonPrimitive("blob"))
                    put("cardinality", JsonPrimitive("one"))
                    put("unique?", JsonPrimitive("false"))
                    put("index?", JsonPrimitive("true"))
                    put("required?", JsonPrimitive("false"))
                    put("inferred-types", kotlinx.serialization.json.JsonArray(listOf(JsonPrimitive("string"))))
                    put("catalog", JsonPrimitive("system"))
                    put("checked-data-type", JsonPrimitive("string"))
                },
            )))
        }
        val arr = (raw["attrs"] as JsonArray)
        val attrs = parseAttrs(arr)
        assertEquals(1, attrs.size)
        assertEquals("attr-1", attrs[0].id)
        assertEquals(ValueType.Blob, attrs[0].valueType)
        assertEquals(Cardinality.One, attrs[0].cardinality)
        assertEquals("name", attrs[0].forwardIdentity.label)
        assertEquals("owner", attrs[0].reverseIdentity?.label)
    }

    @Test
    fun `attr byForwardIdentity finds the right attr`() {
        val attrs = listOf(
            InstantAttr(
                id = "a", forwardIdentity = TripleIdName("fwd-a", "users", "name"),
                reverseIdentity = null, valueType = ValueType.Blob,
                cardinality = Cardinality.One, isUnique = false, isIndexed = false,
                isRequired = false, inferredTypes = emptyList(), catalog = Catalog.System,
            ),
            InstantAttr(
                id = "b", forwardIdentity = TripleIdName("fwd-b", "users", "email"),
                reverseIdentity = null, valueType = ValueType.Blob,
                cardinality = Cardinality.One, isUnique = true, isIndexed = true,
                isRequired = false, inferredTypes = emptyList(), catalog = Catalog.System,
            ),
        )
        val found = InstantAttr.byForwardIdentity(attrs, "users", "email")
        assertNotNull(found)
        assertEquals("b", found?.id)
        assertNull(InstantAttr.byForwardIdentity(attrs, "users", "missing"))
    }
}
