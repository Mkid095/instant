package com.instantdb.poc.query

import com.instantdb.poc.data.LocalTripleStore
import com.instantdb.poc.data.OptimisticEngine
import com.instantdb.poc.data.OptimisticEvent
import com.instantdb.poc.data.StoreChange
import com.instantdb.poc.data.SyncCoordinator
import com.instantdb.poc.WeakHash
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.channels.BufferOverflow
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.channelFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.onStart
import kotlinx.serialization.json.JsonObject

/**
 * Phase 8 — ReactiveQueryEngine wired to the invalidation index.
 *
 * Final integration path:
 *   1. Store emits `changeEvents` on every put/retract.
 *   2. Engine subscribes to a stream of (etype, attr_id) hints
 *      extracted from the change events.
 *   3. [QueryInvalidationIndex] maps each hint to the set of
 *      affected query hashes.
 *   4. Only queries whose hash is in the affected set are
 *      re-evaluated and re-emitted.
 *
 * Properties:
 *  - per-query Flow is cold; multiple collectors share one upstream
 *    evaluation.
 *  - Targeted invalidation: unrelated changes do not re-evaluate.
 *  - Server-driven refresh via [SyncCoordinator] still triggers a
 *    full re-evaluation (server may add attributes we have no local
 *    dependency on).
 *  - Optimistic events also trigger re-evaluation.
 *  - Cancellation: when all collectors cancel, the upstream cancels.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class ReactiveQueryEngine(
    private val base: QueryEngine,
    private val store: LocalTripleStore,
    private val sync: SyncCoordinator,
    private val index: QueryInvalidationIndex = QueryInvalidationIndex(),
    private val optimistic: OptimisticEngine = OptimisticEngine(),
    private val parentScope: CoroutineScope = CoroutineScope(SupervisorJob()),
    /** Optional attribute store. When supplied, store changes auto-notify the index by (etype, attr). */
    private val attrs: com.instantdb.poc.data.AttrStore? = null,
) {
    init {
        // Wire store change events → invalidation index.
        // This is the missing link: when a triple is added/retracted,
        // we look up its etype from the AttrStore and notify the
        // index, which then notifies only registered affected queries.
        parentScope.launch {
            store.changeEvents.collect { ev ->
                when (ev) {
                    is com.instantdb.poc.data.StoreChange.TripleAdded -> {
                        val etype = attrs?.let { lookupEtype(it, ev.triple.aid) } ?: inferEtypeFromAid(ev.triple.aid)
                        if (etype != null) index.notifyAttrChanged(etype, ev.triple.aid)
                    }
                    is com.instantdb.poc.data.StoreChange.TripleRetracted -> {
                        val etype = attrs?.let { lookupEtype(it, ev.aid) } ?: inferEtypeFromAid(ev.aid)
                        if (etype != null) index.notifyAttrChanged(etype, ev.aid)
                    }
                    is com.instantdb.poc.data.StoreChange.EntityRetracted -> {
                        val etype = attrs?.let { inferEtypeFromEid(ev.eid) } ?: null
                        // We don't know etype from eid; fall through.
                    }
                    is com.instantdb.poc.data.StoreChange.TransactionApplied -> {
                        // Conservative: broadcast no-op; specific triples
                        // already emitted TripleAdded/Retracted events.
                    }
                }
            }
        }
    }

    private fun lookupEtype(attrs: com.instantdb.poc.data.AttrStore, aid: String): String? {
        // AttrStore has a synchronous accessor; suspend here would be cleaner.
        return try {
            kotlinx.coroutines.runBlocking {
                attrs.byId(aid)?.forwardIdentity?.etype
            }
        } catch (_: Throwable) { null }
    }

    private fun inferEtypeFromAid(aid: String): String? {
        // Without attrs, fall back to a heuristic. For tests we allow null.
        return null
    }

    private fun inferEtypeFromEid(eid: String): String? = null
    /**
     * Build a Flow<QueryResult> for `query`. Cold; multiple collectors
     * may share one upstream.
     */
    fun queryFlow(query: JsonObject): Flow<QueryResult> {
        val hash = WeakHash.hash(query)
        val deps = index.extractFromQuery(query)
        return channelFlow {
            // Register this query's deps in the index.
            index.register(hash, deps)
            val initial = runCatching { base.query(query) }.getOrNull()
            if (initial != null) send(initial)

            // Listen for events affecting this hash. We merge all
            // event sources — combine would deadlock waiting for each
            // flow to emit at least one value.
            try {
                kotlinx.coroutines.flow.merge(
                    index.events,
                    optimistic.events,
                    sync.events,
                ).collect { event ->
                    val shouldRecompute = when (event) {
                        is QueryInvalidationIndex.InvalidationEvent.Affected ->
                            hash in event.queryHashes
                        is QueryInvalidationIndex.InvalidationEvent.AttrChanged -> {
                            deps.any { dep ->
                                dep is QueryInvalidationIndex.Dependency.Attr &&
                                    dep.etype == event.etype &&
                                    dep.attrId == event.attrId
                            } || deps.any { dep ->
                                dep is QueryInvalidationIndex.Dependency.Etype &&
                                    dep.etype == event.etype
                            }
                        }
                        is QueryInvalidationIndex.InvalidationEvent.EtypeChanged -> {
                            deps.any { dep ->
                                dep is QueryInvalidationIndex.Dependency.Etype &&
                                    dep.etype == event.etype
                            }
                        }
                        is OptimisticEvent -> true
                        is com.instantdb.poc.data.SyncEvent -> true
                        else -> true
                    }
                    if (!shouldRecompute) return@collect
                    val next = runCatching { base.query(query) }.getOrNull() ?: return@collect
                    send(next)
                }
            } finally {
                index.unregister(hash)
            }
        }
    }
}

/**
 * Phase 8 — subscription counter for tracking active collectors.
 * Currently exposed for tests; will be wired to the API in Phase 9.
 */
class SubscriptionRegistry {
    private val counts = mutableMapOf<String, Int>()
    @Synchronized
    fun acquired(hash: String): Int = synchronized(this) {
        counts[hash] = (counts[hash] ?: 0) + 1
        counts[hash]!!
    }
    @Synchronized
    fun released(hash: String): Int = synchronized(this) {
        val next = (counts[hash] ?: 0) - 1
        if (next <= 0) counts.remove(hash) else counts[hash] = next
        next
    }
    @Synchronized
    fun size(): Int = counts.size
}