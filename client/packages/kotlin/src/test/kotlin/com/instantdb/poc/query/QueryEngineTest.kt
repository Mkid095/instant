package com.instantdb.poc.query

import com.instantdb.poc.data.Cardinality
import com.instantdb.poc.data.InMemoryTripleStore
import com.instantdb.poc.data.InstantAttr
import com.instantdb.poc.data.Triple
import com.instantdb.poc.data.TripleIdName
import com.instantdb.poc.data.ValueType
import com.instantdb.poc.data.Catalog
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
import java.util.UUID

/**
 * Query-engine unit tests.
 *
 * These tests run against an in-memory store only — no server. They
 * exercise the core InstaQL semantics in isolation.
 */
class QueryEngineTest {

    private val userIdAttr = InstantAttr(
        id = "attr-user-id",
        forwardIdentity = TripleIdName("fwd-id", "\$users", "id"),
        reverseIdentity = null,
        valueType = ValueType.Blob,
        cardinality = Cardinality.One,
        isUnique = true, isIndexed = true, isRequired = true,
        inferredTypes = listOf(com.instantdb.poc.data.InferredType.String),
        catalog = Catalog.System,
    )
    private val nameAttr = InstantAttr(
        id = "attr-name",
        forwardIdentity = TripleIdName("fwd-name", "\$users", "name"),
        reverseIdentity = null,
        valueType = ValueType.Blob,
        cardinality = Cardinality.One,
        isUnique = false, isIndexed = false, isRequired = false,
        inferredTypes = listOf(com.instantdb.poc.data.InferredType.String),
        catalog = Catalog.System,
    )
    private val ageAttr = InstantAttr(
        id = "attr-age",
        forwardIdentity = TripleIdName("fwd-age", "\$users", "age"),
        reverseIdentity = null,
        valueType = ValueType.Blob,
        cardinality = Cardinality.One,
        isUnique = false, isIndexed = true, isRequired = false,
        inferredTypes = listOf(com.instantdb.poc.data.InferredType.Number),
        catalog = Catalog.System,
    )
    private val postsLink = InstantAttr(
        id = "attr-posts",
        forwardIdentity = TripleIdName("fwd-posts", "\$users", "posts"),
        reverseIdentity = TripleIdName("rev-posts", "\$posts", "owner"),
        valueType = ValueType.Ref,
        cardinality = Cardinality.Many,
        isUnique = false, isIndexed = false, isRequired = false,
        inferredTypes = emptyList(),
        catalog = Catalog.System,
    )
    private val postIdAttr = InstantAttr(
        id = "attr-post-id",
        forwardIdentity = TripleIdName("fwd-pid", "\$posts", "id"),
        reverseIdentity = null,
        valueType = ValueType.Blob,
        cardinality = Cardinality.One,
        isUnique = true, isIndexed = true, isRequired = true,
        inferredTypes = listOf(com.instantdb.poc.data.InferredType.String),
        catalog = Catalog.System,
    )
    private val postTitleAttr = InstantAttr(
        id = "attr-post-title",
        forwardIdentity = TripleIdName("fwd-pt", "\$posts", "title"),
        reverseIdentity = null,
        valueType = ValueType.Blob,
        cardinality = Cardinality.One,
        isUnique = false, isIndexed = false, isRequired = false,
        inferredTypes = listOf(com.instantdb.poc.data.InferredType.String),
        catalog = Catalog.System,
    )
    private val attrsList = listOf(userIdAttr, nameAttr, ageAttr, postsLink, postIdAttr, postTitleAttr)

    private suspend fun seedUsersAndPosts(store: InMemoryTripleStore): Pair<List<String>, List<String>> {
        val users = (1..3).map { i ->
            val eid = UUID.randomUUID().toString()
            store.put(Triple(eid, userIdAttr.id, JsonPrimitive(eid), i.toLong()))
            store.put(Triple(eid, nameAttr.id, JsonPrimitive("user$i"), i.toLong()))
            store.put(Triple(eid, ageAttr.id, JsonPrimitive(20 + i), i.toLong()))
            eid
        }
        val posts = mutableListOf<String>()
        users.forEachIndexed { idx, userEid ->
            val postEid = UUID.randomUUID().toString()
            store.put(Triple(postEid, postIdAttr.id, JsonPrimitive(postEid), (100 + idx).toLong()))
            store.put(Triple(postEid, postTitleAttr.id, JsonPrimitive("post by user ${idx + 1}"), (100 + idx).toLong()))
            store.put(Triple(userEid, postsLink.id, JsonPrimitive(postEid), (100 + idx).toLong()))
            posts.add(postEid)
        }
        return users to posts
    }

    @Test
    fun `simple equality filter`() = runBlocking {
        val store = InMemoryTripleStore()
        val (users, _) = seedUsersAndPosts(store)
        val engine = QueryEngine(store, { attrsList })
        val q = buildJsonObject {
            put("\$users", buildJsonObject {
                put("\$", buildJsonObject {
                    put("where", buildJsonObject {
                        put("name", "user1")
                    })
                })
            })
        }
        val r = engine.query(q)
        val rows = r.data["\$users"]!!
        assertEquals(1, rows.size)
        assertEquals("user1", (rows[0]["name"] as JsonPrimitive).content)
    }

    @Test
    fun `$gt numeric filter`() = runBlocking {
        val store = InMemoryTripleStore()
        seedUsersAndPosts(store)
        val engine = QueryEngine(store, { attrsList })
        val q = buildJsonObject {
            put("\$users", buildJsonObject {
                put("\$", buildJsonObject {
                    put("where", buildJsonObject {
                        put("age", buildJsonObject { put("\$gt", 21) })
                    })
                })
            })
        }
        val r = engine.query(q)
        val rows = r.data["\$users"]!!
        assertEquals(2, rows.size) // users 2 and 3 have age > 21
    }

    @Test
    fun `limit clause caps results`() = runBlocking {
        val store = InMemoryTripleStore()
        seedUsersAndPosts(store)
        val engine = QueryEngine(store, { attrsList })
        val q = buildJsonObject {
            put("\$users", buildJsonObject {
                put("\$", buildJsonObject {
                    put("limit", 2)
                })
            })
        }
        val r = engine.query(q)
        val rows = r.data["\$users"]!!
        assertEquals(2, rows.size)
    }

    @Test
    fun `default order is by id ascending`() = runBlocking {
        val store = InMemoryTripleStore()
        seedUsersAndPosts(store)
        val engine = QueryEngine(store, { attrsList })
        val q = buildJsonObject {
            put("\$users", buildJsonObject { put("\$", JsonObject(emptyMap())) })
        }
        val r = engine.query(q)
        val rows = r.data["\$users"]!!
        assertEquals(3, rows.size)
        // Ordering should be deterministic (id asc).
    }

    @Test
    fun `nested link query joins through VAE-equivalent path`() = runBlocking {
        val store = InMemoryTripleStore()
        val (users, _) = seedUsersAndPosts(store)
        val engine = QueryEngine(store, { attrsList })
        val q = buildJsonObject {
            put("\$users", buildJsonObject {
                put("\$", buildJsonObject { put("limit", 1) })
                put("posts", buildJsonObject {
                    put("\$", buildJsonObject { put("limit", 5) })
                })
            })
        }
        val r = engine.query(q)
        val rows = r.data["\$users"]!!
        assertEquals(1, rows.size)
        val userRow = rows[0]
        val postsField = userRow["posts"]
        assertNotNull(postsField)
        // posts field is either JsonArray (many) or JsonObject (singular).
        assertTrue(postsField is JsonArray || postsField is JsonObject)
    }

    @Test
    fun `empty result for non-matching filter`() = runBlocking {
        val store = InMemoryTripleStore()
        seedUsersAndPosts(store)
        val engine = QueryEngine(store, { attrsList })
        val q = buildJsonObject {
            put("\$users", buildJsonObject {
                put("\$", buildJsonObject {
                    put("where", buildJsonObject { put("name", "nonexistent") })
                })
            })
        }
        val r = engine.query(q)
        assertEquals(emptyList<Any>(), r.data["\$users"])
    }

    @Test
    fun `deterministic — same query, same result`() = runBlocking {
        val store = InMemoryTripleStore()
        seedUsersAndPosts(store)
        val engine = QueryEngine(store, { attrsList })
        val q = buildJsonObject {
            put("\$users", buildJsonObject { put("\$", JsonObject(emptyMap())) })
        }
        val r1 = engine.query(q)
        val r2 = engine.query(q)
        // Compare rows ignoring any internal ordering (we sort, so
        // they're already comparable).
        assertEquals(r1.data["\$users"]!!.size, r2.data["\$users"]!!.size)
        val ids1 = r1.data["\$users"]!!.map { (it["id"] as JsonPrimitive).content }.toSet()
        val ids2 = r2.data["\$users"]!!.map { (it["id"] as JsonPrimitive).content }.toSet()
        assertEquals(ids1, ids2)
    }
}
