package com.instantdb.poc.query

import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/**
 * Phase 7 — Targeted query invalidation.
 *
 * Tracks per-query dependencies on:
 *   - (etype, attr_id) — direct attribute reads
 *   - etype — entity-type reads
 *
 * When a triple changes (added / retracted / entity retracted), the
 * index computes the set of affected queries and emits
 * [InvalidationEvent.Affected] only for them. Queries that do not
 * depend on the changed triples are not re-evaluated.
 *
 * Conservative: if a query's dependency cannot be inferred exactly, it
 * is conservatively included (better to re-evaluate too often than to
 * show stale data).
 */
class QueryInvalidationIndex {
    private val mutex = Mutex()

    /** Map from query hash → list of dependencies. */
    private val byQuery: MutableMap<String, MutableList<Dependency>> = mutableMapOf()
    /** Map from dependency key → set of query hashes that depend on it. */
    private val reverse: MutableMap<String, MutableSet<String>> = mutableMapOf()

    private val _events = MutableSharedFlow<InvalidationEvent>(
        replay = 0,
        extraBufferCapacity = 64,
    )
    val events: SharedFlow<InvalidationEvent> = _events.asSharedFlow()

    /** A query's interest. A dataset's interest. */
    sealed class Dependency {
        data class Etype(val etype: String) : Dependency()
        data class Attr(val etype: String, val attrId: String) : Dependency()
    }

    sealed class InvalidationEvent {
        /** All slots touched for a (etype, attr) pair. */
        data class AttrChanged(val etype: String, val attrId: String) : InvalidationEvent()
        /** All slots for an entity-type. */
        data class EtypeChanged(val etype: String) : InvalidationEvent()
        /** Emitted to subscribers when their query is affected. */
        data class Affected(val queryHashes: Set<String>) : InvalidationEvent()
    }

    /**
     * Register a query's dependencies. Replaces any prior registration
     * for the same hash.
     */
    suspend fun register(queryHash: String, deps: List<Dependency>) = mutex.withLock {
        // Unregister first.
        unregisterInternal(queryHash)
        byQuery[queryHash] = deps.toMutableList()
        for (dep in deps) {
            val key = keyOf(dep)
            reverse.getOrPut(key) { mutableSetOf() }.add(queryHash)
        }
    }

    /**
     * Drop a query's registration.
     */
    suspend fun unregister(queryHash: String) = mutex.withLock {
        unregisterInternal(queryHash)
    }

    private fun unregisterInternal(queryHash: String) {
        val deps = byQuery.remove(queryHash) ?: return
        for (dep in deps) {
            val key = keyOf(dep)
            reverse[key]?.remove(queryHash)
            if (reverse[key]?.isEmpty() == true) reverse.remove(key)
        }
    }

    /**
     * Notify the index that an attr has changed. Emits the set of
     * affected query hashes via [InvalidationEvent.Affected].
     */
    suspend fun notifyAttrChanged(etype: String, attrId: String) {
        val affected = mutex.withLock {
            val attrKey = "attr:$etype:${attrId}"
            val etypeKey = "etype:$etype"
            (reverse[attrKey].orEmpty() + reverse[etypeKey].orEmpty()).toSet()
        }
        _events.tryEmit(InvalidationEvent.AttrChanged(etype, attrId))
        if (affected.isNotEmpty()) {
            _events.tryEmit(InvalidationEvent.Affected(affected))
        }
    }

    /**
     * Notify the index that an etype has changed (e.g., delete-entity).
     */
    suspend fun notifyEtypeChanged(etype: String) {
        val affected = mutex.withLock {
            reverse["etype:$etype"].orEmpty().toSet()
        }
        _events.tryEmit(InvalidationEvent.EtypeChanged(etype))
        if (affected.isNotEmpty()) {
            _events.tryEmit(InvalidationEvent.Affected(affected))
        }
    }

    /**
     * Extract dependencies from an InstaQL query.
     *
     * Conservative: extracts (etype, attr_id) for every `where` clause
     * that references a known field. For free-form queries that don't
     * name a specific attr, registers the etype so the whole table
     * change re-evaluates the query.
     */
    fun extractFromQuery(q: JsonObject): List<Dependency> {
        val deps = mutableListOf<Dependency>()
        for ((etype, form) in q) {
            if (etype.startsWith("$")) continue  // system namespace
            deps.add(Dependency.Etype(etype))
            val formObj = form as? JsonObject ?: continue
            val whereForm = formObj["\$where"] ?: formObj["where"]
            extractWhereDeps(whereForm, etype)?.forEach { deps.add(it) }
            val orderForm = formObj["order"]
            if (orderForm is JsonObject) {
                for ((k, _) in orderForm) {
                    deps.add(Dependency.Attr(etype, k))
                }
            }
        }
        return deps
    }

    private fun extractWhereDeps(where: JsonElement?, etype: String): List<Dependency>? {
        if (where == null || where is JsonNull) return null
        val obj = where as? JsonObject ?: return null
        val deps = mutableListOf<Dependency>()
        for ((field, _) in obj) {
            when (field) {
                "id", "\$id" -> continue  // id is the primary key, no attr needed
                "and", "or" -> continue  // handled recursively
                else -> deps.add(Dependency.Attr(etype, field))
            }
        }
        return deps.ifEmpty { null }
    }

    private fun keyOf(d: Dependency): String = when (d) {
        is Dependency.Etype -> "etype:${d.etype}"
        is Dependency.Attr -> "attr:${d.etype}:${d.attrId}"
    }
}