package com.instantdb.poc

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject

/**
 * Minimal optimistic-apply prototype.
 *
 * Source of truth: client/packages/core/src/Reactor.js:1454-1463 +
 * client/packages/core/src/store.ts:891-949
 *
 * We do not yet implement the full triple store. This file exists to
 * prove the *shape* of the optimistic-apply algorithm — the actual
 * Phase 3 work replaces it with a real Store + AttrsStore.
 */
object OptimisticStore {
    /**
     * Apply a list of pending mutations on top of a snapshot of triples.
     * Returns the resulting list of triples (server + optimistic).
     *
     * Liveness predicate (per Reactor.js:1456):
     *   apply iff `mut['tx-id'] == null || mut['tx-id'] > processedTxId`
     */
    fun apply(
        serverTriples: List<List<JsonElement>>,
        processedTxId: Long,
        mutations: List<MutationQueue.Pending>,
    ): List<List<JsonElement>> {
        val sorted = mutations.sortedBy { it.order }
        val out = serverTriples.toMutableList()
        for (m in sorted) {
            val txId = m.txId
            if (txId != null && txId <= processedTxId) continue
            for (step in m.txSteps) {
                applyStep(out, step)
            }
        }
        return out
    }

    /**
     * Apply a single tx-step. Phase 3 will route through `Store.transact`
     * (port of store.ts:891-949). For the prototype we only implement
     * add-triple and retract-triple.
     */
    private fun applyStep(triples: MutableList<List<JsonElement>>, step: List<JsonElement>) {
        val action = step.getOrNull(0)?.toString()?.trim('"') ?: return
        when (action) {
            "add-triple" -> {
                val newTriple = listOf(step[1], step[2], step[3], JsonPrimitive(System.currentTimeMillis() * 10))
                triples.add(newTriple)
            }
            "retract-triple" -> {
                val eid = step[1]
                val attrId = step[2]
                val value = step[3]
                triples.removeAll { t -> t.size >= 4 && t[0] == eid && t[1] == attrId && t[2] == value }
            }
            // delete-entity / add-attr / etc. — Phase 3.
        }
    }
}

// Helper for prototype: create a JsonPrimitive from raw value (mirrors JS literals)
private fun JsonPrimitive(value: Long): JsonElement =
    kotlinx.serialization.json.JsonPrimitive(value)

private fun JsonPrimitive(value: String): JsonElement =
    kotlinx.serialization.json.JsonPrimitive(value)
