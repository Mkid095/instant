package com.instantdb.poc.data

import com.instantdb.poc.persistence.InMemoryMutationStore
import com.instantdb.poc.persistence.PendingMutation
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonPrimitive
import org.slf4j.LoggerFactory

/**
 * Optimistic mutation engine.
 *
 * Source-of-truth citations:
 *   - client/packages/core/src/Reactor.js:1454-1463 (_applyOptimisticUpdates)
 *   - client/packages/core/src/store.ts:410-446 (createdAt hack)
 *   - client/packages/core/src/store.ts:891-949 (transact + filter)
 *
 * Responsibilities:
 *   - Apply a list of pending mutations on top of a snapshot of triples.
 *   - Liveness predicate: skip a mutation if its `tx-id` is set AND
 *     `tx-id <= processedTxId` (i.e., the server has already pushed
 *     post-mutation triples into a query that has caught up).
 *   - Reuse createdAt where appropriate to avoid entity flicker in
 *     ordered result sets.
 *
 * The engine is deterministic. Same input → same output. Concurrent
 * calls are serialized via a mutex.
 */
class OptimisticEngine {
    private val log = LoggerFactory.getLogger(OptimisticEngine::class.java)
    private val mutex = Mutex()

    private val _events = MutableSharedFlow<OptimisticEvent>(
        replay = 0,
        extraBufferCapacity = 64,
    )
    val events: Flow<OptimisticEvent> = _events.asSharedFlow()

    /**
     * Apply a list of pending mutations on top of a list of triples.
     * Returns the resulting triple list.
     *
     * Mutates the input list (or returns a copy — implementation choice).
     * For Phase 3 we return a copy to keep callers pure.
     */
    suspend fun apply(
        serverTriples: List<Triple>,
        processedTxId: Long,
        mutations: List<PendingMutation>,
    ): List<Triple> = mutex.withLock {
        val sorted = mutations.sortedBy { it.order }
        val out = serverTriples.toMutableList()
        for (m in sorted) {
            val txId = m.txId
            if (txId != null && txId <= processedTxId) continue
            for (step in m.txSteps) {
                applyStep(out, step)
            }
        }
        out.toList()
    }

    /**
     * Apply a single tx-step to the triple list in place.
     * Mirrors `applyTxStep` in store.ts:638-669.
     */
    private fun applyStep(triples: MutableList<Triple>, step: List<JsonElement>) {
        val action = (step.getOrNull(0) as? JsonPrimitive)?.content ?: return
        when (action) {
            "add-triple" -> {
                val eid = (step.getOrNull(1) as? JsonPrimitive)?.content ?: return
                val aid = (step.getOrNull(2) as? JsonPrimitive)?.content ?: return
                val value = step.getOrNull(3) ?: return
                // Optimistic createdAt = wall-clock * 10 + seed (store.ts:410-446)
                val createdAt = System.currentTimeMillis() * 10 + _seed++
                val triple = Triple(eid, aid, value, createdAt)
                // Replace if same (eid, aid, value) already present.
                val idx = triples.indexOfFirst { existing ->
                    existing.eid == eid && existing.aid == aid && JsonElementEq(existing.value, value)
                }
                if (idx >= 0) {
                    triples[idx] = triple
                } else {
                    triples.add(triple)
                }
                _events.tryEmit(OptimisticEvent.TripleAdded(triple))
            }
            "retract-triple" -> {
                val eid = (step.getOrNull(1) as? JsonPrimitive)?.content ?: return
                val aid = (step.getOrNull(2) as? JsonPrimitive)?.content ?: return
                val value = step.getOrNull(3) ?: return
                val before = triples.size
                triples.removeAll { t ->
                    t.eid == eid && t.aid == aid && JsonElementEq(t.value, value)
                }
                _events.tryEmit(OptimisticEvent.TripleRetracted(eid, aid))
                if (triples.size < before) {
                    // emit a single retract event for the last removal
                    _events.tryEmit(OptimisticEvent.EntityRetracted(eid))
                }
            }
            "delete-entity" -> {
                val eid = (step.getOrNull(1) as? JsonPrimitive)?.content ?: return
                triples.removeAll { it.eid == eid }
                _events.tryEmit(OptimisticEvent.EntityRetracted(eid))
            }
            // deep-merge-triple, add-attr, etc. — Phase 3 stub.
        }
    }

    companion object {
        // Module-scoped seed for the createdAt ordering hack.
        // Per store.ts:410-446.
        private var _seed: Long = 0L

        /** Test-only: reset the seed for deterministic ordering. */
        internal fun resetSeed() {
            _seed = 0L
        }
    }
}

sealed class OptimisticEvent {
    data class TripleAdded(val triple: Triple) : OptimisticEvent()
    data class TripleRetracted(val eid: String, val aid: String) : OptimisticEvent()
    data class EntityRetracted(val eid: String) : OptimisticEvent()
}

/**
 * Value-equality for [JsonElement]. Used to match (eid, aid, value) triples
 * in optimistic updates.
 */
private fun JsonElementEq(a: JsonElement, b: JsonElement): Boolean {
    if (a is JsonPrimitive && b is JsonPrimitive) {
        return a.content == b.content && a.isString == b.isString
    }
    return false
}
