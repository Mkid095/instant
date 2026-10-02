package com.instantdb.poc.query

import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

/**
 * Phase 7 — targeted query invalidation tests.
 *
 * Verifies that:
 *   - queries register their (etype, attr_id) dependencies
 *   - changes to one attr do not re-evaluate unrelated queries
 *   - changes to an etype re-evaluate all queries on that etype
 */
class QueryInvalidationIndexTest {
    private fun mkIndex() = QueryInvalidationIndex()

    private val qUsers = buildJsonObject {
        put("users", buildJsonObject {
            put("\$where", buildJsonObject {
                put("email", "x")
            })
        })
    }
    private val qPosts = buildJsonObject {
        put("posts", buildJsonObject {
            put("\$where", buildJsonObject {
                put("title", "x")
            })
        })
    }

    @Test fun `register extracts etype and attr dependencies`() {
        val index = mkIndex()
        val deps = index.extractFromQuery(qUsers)
        assertEquals(2, deps.size)
        assertTrue(deps.any { it is QueryInvalidationIndex.Dependency.Etype && it.etype == "users" })
        assertTrue(deps.any { it is QueryInvalidationIndex.Dependency.Attr && it.attrId == "email" })
    }

    @Test fun `attr change affects only matching query`() = runBlocking {
        val index = mkIndex()
        val hashUsers = qUsers.hashCode().toString()
        val hashPosts = qPosts.hashCode().toString()
        index.register(hashUsers, index.extractFromQuery(qUsers))
        index.register(hashPosts, index.extractFromQuery(qPosts))

        // Capture events.
        val events = mutableListOf<QueryInvalidationIndex.InvalidationEvent>()
        val job = kotlinx.coroutines.GlobalScope.launch(start = kotlinx.coroutines.CoroutineStart.UNDISPATCHED) {
            index.events.collect { events.add(it) }
        }

        // Notify users.email changed.
        index.notifyAttrChanged("users", "email")
        kotlinx.coroutines.delay(50)
        job.cancel()

        // Exactly one Affected event with users hash.
        val affectedEvents = events.filterIsInstance<QueryInvalidationIndex.InvalidationEvent.Affected>()
        assertEquals(1, affectedEvents.size)
        assertTrue(affectedEvents[0].queryHashes.contains(hashUsers))
        assertTrue(!affectedEvents[0].queryHashes.contains(hashPosts),
            "posts query must NOT be affected by users.email change")
    }

    @Test fun `etype change affects all queries on that etype`() = runBlocking {
        val index = mkIndex()
        val hashUsers = qUsers.hashCode().toString()
        val hashPosts = qPosts.hashCode().toString()
        index.register(hashUsers, index.extractFromQuery(qUsers))
        index.register(hashPosts, index.extractFromQuery(qPosts))

        val events = mutableListOf<QueryInvalidationIndex.InvalidationEvent>()
        val job = kotlinx.coroutines.GlobalScope.launch(start = kotlinx.coroutines.CoroutineStart.UNDISPATCHED) {
            index.events.collect { events.add(it) }
        }

        // Delete-entity on users → affects users query but not posts.
        index.notifyEtypeChanged("users")
        kotlinx.coroutines.delay(50)
        job.cancel()

        val affected = events.filterIsInstance<QueryInvalidationIndex.InvalidationEvent.Affected>()
        assertEquals(1, affected.size)
        assertTrue(affected[0].queryHashes.contains(hashUsers))
        assertTrue(!affected[0].queryHashes.contains(hashPosts))
    }

    @Test fun `unregister removes a query`() = runBlocking {
        val index = mkIndex()
        val hashUsers = qUsers.hashCode().toString()
        index.register(hashUsers, index.extractFromQuery(qUsers))
        index.unregister(hashUsers)

        val events = mutableListOf<QueryInvalidationIndex.InvalidationEvent>()
        val job = kotlinx.coroutines.GlobalScope.launch(start = kotlinx.coroutines.CoroutineStart.UNDISPATCHED) {
            index.events.collect { events.add(it) }
        }
        index.notifyAttrChanged("users", "email")
        kotlinx.coroutines.delay(50)
        job.cancel()

        // No Affected event because the only query was unregistered.
        val affected = events.filterIsInstance<QueryInvalidationIndex.InvalidationEvent.Affected>()
        assertEquals(0, affected.size)
    }

    @Test fun `unrelated etypes do not invalidate each other`() = runBlocking {
        val index = mkIndex()
        val hashUsers = qUsers.hashCode().toString()
        val hashPosts = qPosts.hashCode().toString()
        index.register(hashUsers, index.extractFromQuery(qUsers))
        index.register(hashPosts, index.extractFromQuery(qPosts))

        val events = mutableListOf<QueryInvalidationIndex.InvalidationEvent>()
        val job = kotlinx.coroutines.GlobalScope.launch(start = kotlinx.coroutines.CoroutineStart.UNDISPATCHED) {
            index.events.collect { events.add(it) }
        }

        // A change to a totally unrelated etype.
        index.notifyAttrChanged("comments", "body")
        index.notifyEtypeChanged("comments")
        kotlinx.coroutines.delay(50)
        job.cancel()

        val affected = events.filterIsInstance<QueryInvalidationIndex.InvalidationEvent.Affected>()
        assertEquals(0, affected.size,
            "comments changes must not invalidate users/posts queries")
    }
}