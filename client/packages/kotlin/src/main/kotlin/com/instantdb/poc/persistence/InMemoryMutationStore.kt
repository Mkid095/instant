package com.instantdb.poc.persistence

import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject

/**
 * In-memory mutation store.
 *
 * Source of truth for `pendingMutations` in the JS Reactor
 * (Reactor.js:557-576, PersistedObject.ts). The disk-backed variant
 * (SQLDelight or similar) implements the same contract.
 *
 * Phase 3 ships in-memory; Phase 4 will add a real persistence backend.
 *
 * Concurrency: all read/write operations are protected by a Mutex.
 */
class InMemoryMutationStore : MutationStore {
    private val mutex = Mutex()
    private val pending = LinkedHashMap<String, PendingMutation>()

    override suspend fun enqueue(mutation: PendingMutation) = mutex.withLock {
        pending[mutation.eventId] = mutation
    }

    override suspend fun confirm(eventId: String, txId: Long, confirmedAt: Long) = mutex.withLock {
        val existing = pending[eventId] ?: return@withLock
        pending[eventId] = existing.copy(txId = txId, confirmedAt = confirmedAt)
    }

    override suspend fun drop(eventId: String): Unit = mutex.withLock {
        pending.remove(eventId)
        Unit
    }

    override suspend fun pending(): List<PendingMutation> = mutex.withLock {
        pending.values.toList()
    }

    override suspend fun byEventId(eventId: String): PendingMutation? = mutex.withLock {
        pending[eventId]
    }

    override suspend fun dropConfirmedAboveTxId(maxConfirmedTxId: Long) = mutex.withLock {
        val it = pending.entries.iterator()
        while (it.hasNext()) {
            val (_, mut) = it.next()
            if (mut.txId != null && mut.txId <= maxConfirmedTxId) it.remove()
        }
    }

    /** Atomic snapshot for tests / crash recovery. */
    suspend fun snapshot(): Map<String, PendingMutation> = mutex.withLock {
        pending.toMap()
    }
}
