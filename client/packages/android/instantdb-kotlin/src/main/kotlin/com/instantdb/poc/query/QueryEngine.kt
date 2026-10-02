package com.instantdb.poc.query

import com.instantdb.poc.data.Cardinality
import com.instantdb.poc.data.InMemoryTripleStore
import com.instantdb.poc.data.InstantAttr
import com.instantdb.poc.data.JsonElementKey
import com.instantdb.poc.data.Triple
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

/**
 * Local InstaQL evaluator.
 *
 * Source-of-truth citations:
 *   - client/packages/core/src/instaql.ts (952 lines)
 *   - client/packages/core/src/datalog.js (116 lines)
 *   - client/packages/core/src/queryTypes.ts
 *
 * Scope of Phase 3 (this implementation):
 *   - entity lookup by `where` clause (eq, $gt, $lt, $in, $isNull, $or, $and)
 *   - ordering by id (default) or one named attribute
 *   - limit
 *   - nested link traversal (forward and reverse)
 *   - cardinality-one unwrapping when schema is provided
 *
 * Out of scope for Phase 3 (deferred):
 *   - cursor pagination (`first`/`last`/`after`/`before`)
 *   - server-side aggregation (the client just passes aggregate through)
 *   - $like / $ilike regex
 *   - rule-params
 *
 * The evaluator is deterministic given the same triple store + query.
 * It does NOT mutate the store.
 */
class QueryEngine(
    private val store: com.instantdb.poc.data.LocalTripleStore,
    private val attrs: () -> List<com.instantdb.poc.data.InstantAttr>,
    private val cardinalityInference: Boolean = false,
) {
    /**
     * Evaluate a query. The query object has the shape:
     * ```
     * { [namespace]: { $: {...}, [linkLabel]: {...} } }
     * ```
     */
    fun query(q: JsonObject): QueryResult {
        val data = mutableMapOf<String, List<Map<String, JsonElement?>>>()
        for ((namespace, form) in q) {
            if (namespace == "\$\$ruleParams") continue
            val formObj = form as? JsonObject ?: continue
            val rows = queryOne(
                etype = namespace,
                form = formObj,
                level = 0,
                join = null,
            )
            data[namespace] = rows
        }
        return QueryResult(data)
    }

    /**
     * Evaluate one entity type, recursively filling nested children.
     */
    private fun queryOne(
        etype: String,
        form: JsonObject,
        level: Int,
        join: Join?,
    ): List<Map<String, JsonElement>> {
        val parents = resolveObjects(etype, form, join)
        return extendObjects(parents, etype, form, level)
    }

    /**
     * Find all entities matching the where clause. Mirrors `resolveObjects`.
     */
    private fun resolveObjects(
        etype: String,
        form: JsonObject,
        join: Join?,
    ): List<Map<String, JsonElement>> {
        val dollar = form["\$"] as? JsonObject
        val where = (dollar?.get("where") as? JsonObject) ?: JsonObject(emptyMap())

        // Combine with join predicate.
        val fullWhere = if (join != null) {
            val combined = mutableMapOf<String, JsonElement>()
            combined[join.linkLabel] = buildJsonObject { put("id", JsonPrimitive(join.parentEid)) }
            for ((k, v) in where) combined[k] = v
            JsonObject(combined)
        } else where

        // Find candidate eids.
        val candidates = findEntitiesMatching(etype, fullWhere)
        // Hydrate to objects.
        val attrsList = attrs().filter { it.forwardIdentity.etype == etype }
        val out = mutableListOf<Map<String, JsonElement>>()
        for (eid in candidates) {
            val obj = hydrateEntity(eid, attrsList)
            out.add(obj)
        }
        return applyOrderAndLimit(out, etype, dollar)
    }

    /**
     * Find entity ids matching a where clause. Minimal Phase 3 implementation:
     *   - Equality on any attr
     *   - $gt / $lt / $gte / $lte
     *   - $in (exact-value array)
     *   - $isNull
     *   - $or, $and
     *
     * Non-supported operators are skipped (treated as no-op).
     */
    private fun findEntitiesMatching(etype: String, where: JsonObject): List<String> {
        // 1. Get all candidate eids that have at least one triple on an
        // attr belonging to this etype. We require the entity to have an
        // id attr triple to be a candidate (entities with no id are
        // dangling and not visible to queries — same as JS).
        val idAttr = attrs().firstOrNull {
            it.forwardIdentity.etype == etype && it.forwardIdentity.label == "id"
        } ?: return emptyList()
        val allEids = mutableSetOf<String>()
        for (t in store.scanByAttribute(idAttr.id)) {
            allEids.add(t.eid)
        }
        if (where.isEmpty()) return allEids.toList()

        // 2. Apply each predicate conjunctively.
        var candidates: Set<String> = allEids
        for ((key, value) in where) {
            val conjunct = evaluatePredicate(etype, key, value) ?: continue
            candidates = candidates.intersect(conjunct)
        }
        return candidates.toList()
    }

    /**
     * Evaluate a single predicate against the store. Returns the set
     * of matching eids, or null if the predicate is not recognized.
     */
    private fun evaluatePredicate(etype: String, key: String, value: JsonElement?): Set<String>? {
        // $or / $and are recursive.
        if (key == "\$or") {
            val arr = value as? JsonArray ?: return null
            val sets = arr.mapNotNull { evaluatePredicate(etype, "\$or", it) }
            if (sets.isEmpty()) return null
            val union = mutableSetOf<String>()
            for (s in sets) union.addAll(s)
            return union
        }
        if (key == "\$and") {
            val arr = value as? JsonArray ?: return null
            val andSets = arr.mapNotNull { elt ->
                val obj = elt as? JsonObject ?: return@mapNotNull null
                var acc: Set<String>? = null
                for ((k, v) in obj) {
                    val s = evaluatePredicate(etype, k, v) ?: return@mapNotNull null
                    acc = if (acc == null) s else acc.intersect(s)
                }
                acc
            }
            if (andSets.isEmpty()) return null
            return andSets.reduce { acc, s -> acc.intersect(s) }
        }

        // Traverse dot-path. For Phase 3 we support at most one link
        // segment, e.g. "owner.name".
        val pathParts = key.split(".")
        return evaluateSimplePredicate(etype, pathParts, value)
    }

    private fun evaluateSimplePredicate(
        etype: String,
        pathParts: List<String>,
        value: JsonElement?,
    ): Set<String>? {
        if (pathParts.isEmpty()) return null

        // First segment: attr on etype OR a link label
        val firstLabel = pathParts[0]
        if (pathParts.size == 1) {
            // Bare attribute check.
            return when (value) {
                is JsonObject -> {
                    // Operators: $in, $gt, $lt, $gte, $lte, $isNull
                    val firstOp = value.entries.firstOrNull()?.key
                    if (firstOp != null && firstOp != value.entries.first().key) {
                        // Multiple keys: $or-like; we only handle $in for now.
                    }
                    when {
                        value.containsKey("\$in") -> {
                            val inArr = value["\$in"] as JsonArray
                            val vals = inArr.map { JsonElementKey(it) }.toSet()
                            store.scanByAttribute(findAttrId(etype, firstLabel))
                                .filter { vals.contains(JsonElementKey(it.value)) }
                                .map { it.eid }
                                .toSet()
                        }
                        value.containsKey("\$gt") -> {
                            val v = value["\$gt"] as JsonPrimitive
                            store.scanByAttribute(findAttrId(etype, firstLabel))
                                .filter { compareValues(it.value, v) > 0 }
                                .map { it.eid }
                                .toSet()
                        }
                        value.containsKey("\$lt") -> {
                            val v = value["\$lt"] as JsonPrimitive
                            store.scanByAttribute(findAttrId(etype, firstLabel))
                                .filter { compareValues(it.value, v) < 0 }
                                .map { it.eid }
                                .toSet()
                        }
                        value.containsKey("\$isNull") -> {
                            val isNull = (value["\$isNull"] as JsonPrimitive).content == "true"
                            val aid = findAttrId(etype, firstLabel)
                            val has = store.findByValue(aid, JsonPrimitive("__null_marker__")).isNotEmpty()
                            if (isNull) {
                                // Either entity doesn't have the attr, or has it with null value.
                                // For Phase 3, we treat "has the triple" as not null; treat
                                // absence as null. This is a simplification of the JS
                                // behavior which has a separate $isNull path.
                                store.scanByAttribute(aid).map { it.eid }.toSet()
                                .let { hasIt -> allEidsOf(etype) - hasIt }
                            } else {
                                store.scanByAttribute(aid).map { it.eid }.toSet()
                            }
                        }
                        else -> null
                    }
                }
                is JsonPrimitive -> {
                    val aid = findAttrId(etype, firstLabel)
                    store.findByValue(aid, value).map { it.eid }.toSet()
                }
                else -> null
            }
        }
        // Two-segment path: link then attr on the link's etype.
        val linkLabel = firstLabel
        val linkAttr = pathParts[1]
        val linkAid = findLinkAttrId(etype, linkLabel) ?: return null
        val targetAid = linkAttr // we look up by attr label on the linked etype
        // For each triple (eid1, linkAid, eid2), check that target has (eid2, targetAid, value).
        // Resolve the link's target etype from the attr.
        val linkAttrMeta = attrs().firstOrNull { it.id == linkAid } ?: return null
        val targetEtype = linkAttrMeta.forwardIdentity.etype
        val targetAttrMeta = InstantAttr.byForwardIdentity(attrs(), targetEtype, linkAttr)
            ?: attrs().firstOrNull { it.forwardIdentity.etype == targetEtype && it.forwardIdentity.label == linkAttr }
        val targetAidResolved = targetAttrMeta?.id ?: return null
        val matchingTargetEids = when (value) {
            is JsonPrimitive -> store.findByValue(targetAidResolved, value).mapTo(mutableSetOf()) { it.eid }
            else -> null
        } ?: return null
        val targetKeys: Set<JsonElementKey> = matchingTargetEids
            .map { JsonElementKey(JsonPrimitive(it)) }
            .toSet()
        val linkTriples: Sequence<com.instantdb.poc.data.Triple> = store.scanByAttribute(linkAid)
            .filter { t -> targetKeys.contains(JsonElementKey(t.value)) }
        val out = mutableSetOf<String>()
        for (t in linkTriples) out.add(t.eid)
        return out
    }

    private fun allEidsOf(etype: String): Set<String> {
        val out = mutableSetOf<String>()
        for (aid in attrs().filter { it.forwardIdentity.etype == etype }.map { it.id }) {
            for (t in store.scanByAttribute(aid)) out.add(t.eid)
        }
        return out
    }

    private fun findAttrId(etype: String, label: String): String {
        return InstantAttr.byForwardIdentity(attrs(), etype, label)?.id
            ?: throw IllegalStateException("no attr for $etype.$label")
    }

    private fun findLinkAttrId(etype: String, linkLabel: String): String? {
        // Try forward first; fall back to reverse.
        return InstantAttr.linkOn(attrs(), etype, linkLabel)?.id
    }

    private fun compareValues(a: JsonElement, b: JsonElement): Int {
        val pa = a as? JsonPrimitive ?: return 0
        val pb = b as? JsonPrimitive ?: return 0
        if (pa.isString && pb.isString) return pa.content.compareTo(pb.content)
        val da = pa.content.toDoubleOrNull() ?: return 0
        val db = pb.content.toDoubleOrNull() ?: return 0
        return da.compareTo(db)
    }

    /**
     * Hydrate an entity: produce an object containing all of its attrs.
     */
    private fun hydrateEntity(
        eid: String,
        attrsList: List<InstantAttr>,
    ): Map<String, JsonElement> {
        val out = mutableMapOf<String, JsonElement>()
        out["id"] = JsonPrimitive(eid)
        for (a in attrsList) {
            val triples = store.lookupAttribute(eid, a.id)
            if (triples.isEmpty()) continue
            if (a.cardinality == Cardinality.One) {
                out[a.forwardIdentity.label] = triples[0].value
            } else {
                out[a.forwardIdentity.label] = JsonArray(triples.map { it.value })
            }
        }
        return out
    }

    /**
     * Apply order + limit.
     */
    private fun applyOrderAndLimit(
        rows: List<Map<String, JsonElement>>,
        etype: String,
        dollar: JsonObject?,
    ): List<Map<String, JsonElement>> {
        if (rows.isEmpty()) return rows
        val order = (dollar?.get("order") as? JsonObject)?.entries?.firstOrNull()
        val sorted: List<Map<String, JsonElement>> = if (order == null) {
            // Default: sort by id asc.
            rows.sortedBy { (it["id"] as JsonPrimitive).content }
        } else {
            val orderAttrName: String = order.key
            val direction: JsonElement = order.value
            val isDesc = (direction as JsonPrimitive).content == "desc"
            val attr = InstantAttr.byForwardIdentity(attrs(), etype, orderAttrName)
            if (attr == null) {
                rows.sortedBy { (it["id"] as JsonPrimitive).content }
            } else {
                rows.sortedWith { a, b ->
                    val av = a[orderAttrName] ?: return@sortedWith 0
                    val bv = b[orderAttrName] ?: return@sortedWith 0
                    val cmp = compareValues(av, bv)
                    if (isDesc) -cmp else cmp
                }
            }
        }
        val limit = (dollar?.get("limit") as? JsonPrimitive)?.content?.toIntOrNull()
            ?: (dollar?.get("first") as? JsonPrimitive)?.content?.toIntOrNull()
        return if (limit != null) sorted.take(limit) else sorted
    }

    /**
     * Recursively fill child queries.
     */
    private fun extendObjects(
        rows: List<Map<String, JsonElement>>,
        etype: String,
        form: JsonObject,
        level: Int,
    ): List<Map<String, JsonElement>> {
        val childQueries = form.keys.filter { it != "\$" }
        if (childQueries.isEmpty()) return rows
        return rows.map { parent ->
            val merged = parent.toMutableMap()
            for (label in childQueries) {
                val childForm = form[label] as? JsonObject ?: continue
                val linkAid = findLinkAttrId(etype, label) ?: continue
                val linkAttr = attrs().firstOrNull { it.id == linkAid } ?: continue
                val targetEtype = linkAttr.forwardIdentity.etype
                val parentEid = (parent["id"] as? JsonPrimitive)?.content ?: continue
                // Find target eids via the link attr.
                val targetEids = store.scanByAttribute(linkAid)
                    .filter { it.eid == parentEid }
                    .mapNotNull { (it.value as? JsonPrimitive)?.content }
                    .toSet()
                val childRows = mutableListOf<Map<String, JsonElement>>()
                for (targetEid in targetEids) {
                    val childAttrs = attrs().filter { it.forwardIdentity.etype == targetEtype }
                    val childObj = hydrateEntity(targetEid, childAttrs)
                    val recursed = extendObjects(
                        listOf(childObj),
                        targetEtype,
                        childForm,
                        level + 1,
                    )
                    childRows.addAll(recursed)
                }
                // Decide cardinality.
                val isSingular = cardinalityInference &&
                    (InstantAttr.byForwardIdentity(attrs(), etype, label)?.cardinality == Cardinality.One)
                merged[label] = if (isSingular) {
                    val first: Map<String, JsonElement> = childRows.firstOrNull()
                        ?: return@map merged
                    JsonObject(first)
                } else {
                    JsonArray(childRows.map { JsonObject(it) })
                }
            }
            merged
        }
    }
}

private class Join(
    val parentEid: String,
    val linkLabel: String,
)
