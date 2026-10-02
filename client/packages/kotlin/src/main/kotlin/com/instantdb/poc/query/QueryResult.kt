package com.instantdb.poc.query

import kotlinx.serialization.json.JsonElement

/**
 * Result of evaluating a query against the triple store.
 *
 * Mirrors the JS client output shape produced by `instaql.ts:913-952`:
 *
 * ```
 * { data: { [namespace]: Array<Object> }, pageInfo?: ..., aggregate?: ... }
 * ```
 *
 * For Phase 3 we don't model pageInfo/aggregate yet — they come from
 * the server envelope and are passed through unchanged.
 */
data class QueryResult(
    val data: Map<String, List<Map<String, JsonElement?>>>,
    val pageInfo: Map<String, PageInfo>? = null,
    val aggregate: Map<String, JsonElement>? = null,
) {
    companion object {
        val EMPTY = QueryResult(emptyMap())
    }
}

data class PageInfo(
    val startCursor: Cursor?,
    val endCursor: Cursor?,
    val hasNextPage: Boolean,
    val hasPreviousPage: Boolean,
)

/**
 * Opaque pagination cursor. Matches JS `Cursor = [eid, attrId, value, txId]`.
 */
data class Cursor(
    val entityId: String,
    val attrId: String,
    val value: JsonElement,
    val txId: Long,
)
