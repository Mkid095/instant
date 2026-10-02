package com.instantdb.poc

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.slf4j.LoggerFactory

/**
 * Reactor: ties ConnectionManager + SubscriptionManager + MutationQueue
 * together. Fans incoming server messages to the right component.
 *
 * This is the Phase 2 equivalent of the JS Reactor. It does not yet:
 *   - evaluate instaql (queries return raw results)
 *   - apply optimistic mutations
 *   - persist anything to disk
 *
 * Out of scope for Phase 2: instaql evaluation, persistence, typed DSL.
 */
class Reactor(
    val config: InstantDbConfig,
    val parentScope: CoroutineScope = CoroutineScope(SupervisorJob() + Dispatchers.Default),
) {
    private val log = LoggerFactory.getLogger(Reactor::class.java)

    val connection = ConnectionManager(config, parentScope)
    val subscriptions = SubscriptionManager(connection, parentScope)
    val mutations = MutationQueue(connection)

    private val eventsJob: kotlinx.coroutines.Job

    init {
        // Forward subscription-relevant events from the connection into
        // the SubscriptionManager.
        eventsJob = parentScope.launch {
            connection.incoming.collect { msg ->
                val op = msg["op"]?.jsonPrimitive?.content
                when (op) {
                    "add-query-ok",
                    "add-query-exists",
                    "refresh-ok",
                    "remove-query-ok" -> subscriptions.handleServerEvent(msg)
                    "transact-ok" -> {
                        val cid = msg["client-event-id"]?.jsonPrimitive?.content
                        val txId = msg["tx-id"]?.jsonPrimitive?.content?.toLongOrNull()
                        if (cid != null && txId != null) {
                            mutations.handleTransactOk(cid, txId)
                        }
                    }
                    "error" -> {
                        val orig = msg["original-event"] as? JsonObject
                        val cid = orig?.get("client-event-id")?.jsonPrimitive?.content
                        val origOp = orig?.get("op")?.jsonPrimitive?.content
                        if (cid != null && origOp == "transact") {
                            mutations.handleMutationError(cid, msg)
                        }
                    }
                }
            }
        }

        // When the connection transitions to Connected, replay pending
        // mutations and re-add all subscriptions.
        parentScope.launch {
            connection.state.collect { state ->
                if (state == ConnectionState.Connected) {
                    log.info("Reactor: connected — restoring subscriptions and pending mutations")
                    subscriptions.restoreAll()
                    mutations.replayPending()
                } else if (state == ConnectionState.Reconnecting ||
                           state == ConnectionState.Disconnected) {
                    log.info("Reactor: $state — clearing subscription send state")
                    subscriptions.clearAllOnDisconnect()
                }
            }
        }
    }

    suspend fun connect() {
        connection.connect()
    }

    suspend fun subscribe(q: JsonObject) {
        subscriptions.subscribe(q)
    }

    suspend fun unsubscribe(q: JsonObject) {
        subscriptions.unsubscribe(q)
    }

    suspend fun transact(txSteps: List<List<kotlinx.serialization.json.JsonElement>>) =
        mutations.submit(txSteps)

    suspend fun shutdown() {
        connection.shutdown()
        eventsJob.cancel()
    }
}
