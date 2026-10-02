package com.instantdb.poc

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.GlobalScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.slf4j.LoggerFactory
import java.util.UUID

/**
 * In-memory mutation queue with client-event-id correlation.
 *
 * Source of truth: client/packages/core/src/Reactor.js
 *   - pushOps               lines 1555-1577
 *   - _sendMutation         lines 1592-1629
 *   - transact-ok handler   lines 815-855
 *   - _handleMutationError  lines 963-982
 *   - _finishTransaction    lines 513-548
 *
 * Responsibilities:
 *   - Hold pending mutations keyed by client-event-id (UUID)
 *   - Mint the event-id and assign monotonic order
 *   - Send `transact` over the wire
 *   - Schedule the per-mutation ack timeout (6s + queue depth × 6s)
 *   - Resolve / reject the user's CompletableDeferred on transact-ok
 *     or timeout
 *   - Store the server tx-id on the mutation for refresh-handler use
 *
 * The queue is in-memory only. Persistence + crash recovery are Phase 3.
 */
class MutationQueue(
    private val connection: ConnectionManager,
) {
    private val log = LoggerFactory.getLogger(MutationQueue::class.java)
    private val mutex = Mutex()

    data class Pending(
        val eventId: String,
        val txSteps: List<List<JsonElement>>,
        val order: Long,
        val createdAt: Long = System.currentTimeMillis(),
        @Volatile var txId: Long? = null,
        @Volatile var confirmedAt: Long? = null,
        @Volatile var timeoutJob: kotlinx.coroutines.Job? = null,
    )

    /** Active pending mutations, ordered by insertion. */
    private val queue: MutableMap<String, Pending> = LinkedHashMap()
    /** Outgoing promise for the user. */
    private val deferreds: MutableMap<String, CompletableDeferred<MutationResult>> =
        mutableMapOf()

    /** Synchronous accessor (testing). */
    suspend fun snapshot(): List<Pending> = mutex.withLock { queue.values.toList() }
    suspend fun size(): Int = mutex.withLock { queue.size }
    suspend fun inFlightCount(): Int = mutex.withLock {
        queue.values.count { it.txId == null }
    }
    /** Non-suspend snapshot for use from non-coroutine call sites (timeout scheduler). */
    private fun sizeUnsafe(): Int = queue.size

    /**
     * Submit a transaction. Returns a deferred that resolves when the
     * server acks (status=synced) or rejects on error/timeout.
     */
    suspend fun submit(txSteps: List<List<JsonElement>>): CompletableDeferred<MutationResult> {
        val eventId = UUID.randomUUID().toString()
        val order = mutex.withLock {
            (queue.values.maxOfOrNull { it.order } ?: 0L) + 1
        }
        val pending = Pending(eventId = eventId, txSteps = txSteps, order = order)
        val dfd = CompletableDeferred<MutationResult>()
        mutex.withLock {
            queue[eventId] = pending
            deferreds[eventId] = dfd
        }
        log.info("submit: event-id={} order={} steps={}", eventId, order, txSteps.size)
        sendMutation(pending)
        return dfd
    }

    /**
     * Re-send all pending mutations that have no server tx-id yet.
     * Called by ConnectionManager after init-ok.
     */
    suspend fun replayPending() {
        val pending: List<Pending> = mutex.withLock {
            queue.values.filter { it.txId == null }
        }
        log.info("replayPending: {} mutations", pending.size)
        for (p in pending) sendMutation(p)
    }

    /**
     * Drop all in-flight tracking without rejecting deferreds (used on
     * reconnect — the deferreds stay pending until the server re-acks).
     */
    suspend fun onSocketLost() {
        mutex.withLock {
            for (p in queue.values) {
                p.timeoutJob?.cancel()
            }
        }
    }

    /**
     * Server sent transact-ok. Stamp the tx-id and resolve the deferred.
     */
    suspend fun handleTransactOk(eventId: String, txId: Long) {
        val dfd: CompletableDeferred<MutationResult>? = mutex.withLock {
            val p = queue[eventId] ?: return@withLock null
            p.txId = txId
            p.confirmedAt = System.currentTimeMillis()
            p.timeoutJob?.cancel()
            queue.remove(eventId)
            deferreds.remove(eventId)
        }
        if (dfd == null) return
        log.info("transact-ok: event-id={} tx-id={}", eventId, txId)
        dfd.complete(MutationResult(status = MutationStatus.Synced, eventId = eventId, txId = txId))
    }

    /**
     * Server sent an error op with `original-event.op === 'transact'`.
     * Reject the deferred and drop the mutation.
     */
    suspend fun handleMutationError(eventId: String, errorMsg: JsonObject) {
        val dfd = mutex.withLock {
            queue.remove(eventId)?.let { it.timeoutJob?.cancel() }
            deferreds.remove(eventId)
        }
        if (dfd != null) {
            val message = errorMsg["message"]?.toString()?.trim('"') ?: "server error"
            dfd.completeExceptionally(InstantDbException.ServerError(message, ErrorMessage(
                op = "error",
                message = message,
            )))
        }
        log.info("transact-error: event-id={} message={}", eventId, errorMsg["message"])
    }

    /**
     * Per-mutation ack timeout fired.
     */
    private suspend fun handleTimeout(eventId: String) {
        val dfd = mutex.withLock {
            val p = queue.remove(eventId) ?: return@withLock null
            // If the server has confirmed (tx-id set), the timeout was
            // racing the ack — ignore it.
            if (p.txId != null) return@withLock null
            deferreds.remove(eventId)
        } ?: return
        log.warn("transact-timeout: event-id={}", eventId)
        dfd.completeExceptionally(
            InstantDbException.ServerError("transaction timed out", ErrorMessage(
                op = "error",
                message = "transaction timed out",
                type = "timeout",
            )),
        )
    }

    private fun sendMutation(p: Pending) {
        val payload = buildJsonObject {
            put("op", "transact")
            put("tx-steps", kotlinx.serialization.json.JsonArray(p.txSteps.map { step ->
                kotlinx.serialization.json.JsonArray(step)
            }))
            put("client-event-id", p.eventId)
        }
        try {
            connection.send(payload)
        } catch (e: Exception) {
            log.warn("send failed for {} ({}); will retry on reconnect", p.eventId, e.message)
            return
        }
        scheduleTimeout(p)
    }

    private fun scheduleTimeout(p: Pending) {
        val scale = (sizeUnsafe() + 1).coerceAtLeast(1)
        val timeoutMs = (6_000L * scale).coerceAtLeast(6_000L)
        p.timeoutJob = GlobalScope.launch {
            delay(timeoutMs)
            runBlocking { handleTimeout(p.eventId) }
        }
    }
}

enum class MutationStatus { Synced, Enqueued, Error, Timeout }

data class MutationResult(
    val status: MutationStatus,
    val eventId: String,
    val txId: Long? = null,
)
