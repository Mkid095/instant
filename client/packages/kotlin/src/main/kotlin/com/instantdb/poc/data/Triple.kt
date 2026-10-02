package com.instantdb.poc.data

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.util.UUID

/**
 * Triple representation — the canonical InstantDB data atom.
 *
 * Mirrors JS `type Triple = [string, string, any, number]` (store.ts:7).
 *
 * Field layout (positional, matching JS):
 * - [0] eid   — entity id (or a lookup-ref tuple for optimistic inserts)
 * - [1] aid   — attribute id
 * - [2] v     — value (any JSON; for refs, an eid)
 * - [3] t     — createdAt / sort-key (see [TripleStoreDocs])
 *
 * Source-of-truth citation:
 * - client/packages/core/src/store.ts:7, 410-446, 448-489
 */
data class Triple(
    val eid: String,
    val aid: String,
    val value: JsonElement,
    val createdAt: Long,
) {
    /** Serialize to JS-compatible 4-tuple array. */
    fun toJson(): JsonArray = kotlinx.serialization.json.JsonArray(
        listOf(
            JsonPrimitive(eid),
            JsonPrimitive(aid),
            value,
            JsonPrimitive(createdAt),
        )
    )

    companion object {
        fun fromJson(arr: JsonArray): Triple {
            require(arr.size == 4) { "triple must have 4 elements, got ${arr.size}" }
            return Triple(
                eid = (arr[0] as JsonPrimitive).content,
                aid = (arr[1] as JsonPrimitive).content,
                value = arr[2],
                createdAt = (arr[3] as JsonPrimitive).content.toLong(),
            )
        }
    }
}

/**
 * Attr metadata used by the local query engine.
 *
 * Mirrors JS `InstantDBAttr` (attrTypes.ts:13-29) but restricted to fields
 * the local evaluator actually reads.
 */
data class InstantAttr(
    val id: String,
    val forwardIdentity: TripleIdName,
    val reverseIdentity: TripleIdName?,
    val valueType: ValueType,
    val cardinality: Cardinality,
    val isUnique: Boolean,
    val isIndexed: Boolean,
    val isRequired: Boolean,
    val inferredTypes: List<InferredType>,
    val catalog: Catalog,
    val checkedDataType: String? = null,
) {
    val isRef: Boolean get() = valueType == ValueType.Ref
    val isBlob: Boolean get() = valueType == ValueType.Blob

    /** Is this attr the primary id attr for its etype? */
    fun isIdAttr(etype: String): Boolean =
        forwardIdentity.etype == etype && forwardIdentity.label == "id"

    /**
     * Lookup the canonical "id" attr for an etype.
     *
     * JS: `s.getPrimaryKeyAttr(attrsStore, etype)` (store.ts:860-866).
     */
    companion object {
        fun primaryIdAttr(attrs: List<InstantAttr>, etype: String): InstantAttr? =
            attrs.firstOrNull { it.forwardIdentity.etype == etype && it.forwardIdentity.label == "id" }

        /**
         * Match an attr by forward-identity (etype, label).
         */
        fun byForwardIdentity(attrs: List<InstantAttr>, etype: String, label: String): InstantAttr? =
            attrs.firstOrNull { it.forwardIdentity.etype == etype && it.forwardIdentity.label == label }

        /**
         * Find a link attr (ref-type) on `etype` with the given label.
         * Prefers forward-identity; falls back to reverse-identity.
         */
        fun linkOn(
            attrs: List<InstantAttr>,
            etype: String,
            label: String,
        ): InstantAttr? {
            // Try forward first
            attrs.firstOrNull {
                it.isRef && it.forwardIdentity.etype == etype && it.forwardIdentity.label == label
            }?.let { return it }
            // Then reverse
            return attrs.firstOrNull {
                it.isRef && it.reverseIdentity?.etype == etype && it.reverseIdentity.label == label
            }
        }
    }
}

data class TripleIdName(val id: String, val etype: String, val label: String) {
    companion object {
        fun fromJson(arr: JsonArray): TripleIdName {
            require(arr.size == 3) { "id-name triple must have 3 elements" }
            return TripleIdName(
                id = (arr[0] as JsonPrimitive).content,
                etype = (arr[1] as JsonPrimitive).content,
                label = (arr[2] as JsonPrimitive).content,
            )
        }
    }
}

enum class ValueType { Blob, Ref;
    companion object {
        fun parse(s: String): ValueType = when (s) {
            "blob" -> Blob
            "ref" -> Ref
            else -> error("unknown value-type: $s")
        }
    }
}

enum class Cardinality { One, Many;
    companion object {
        fun parse(s: String): Cardinality = when (s) {
            "one" -> One
            "many" -> Many
            else -> error("unknown cardinality: $s")
        }
    }
}

enum class Catalog { System, User;
    companion object {
        fun parse(s: String): Catalog = when (s) {
            "system" -> System
            "user" -> User
            else -> User // be lenient
        }
    }
}

enum class InferredType { Number, String, Boolean, Json;
    companion object {
        fun parse(s: String): InferredType? = when (s) {
            "number" -> Number
            "string" -> String
            "boolean" -> Boolean
            "json" -> Json
            else -> null
        }
    }
}

/**
 * Convert an `attrs[]` array from the wire (init-ok/refresh-ok) into
 * a list of [InstantAttr]. Unknown fields are tolerated.
 */
fun parseAttrs(jsonAttrs: JsonArray): List<InstantAttr> =
    jsonAttrs.mapNotNull { el ->
        val obj = el as? JsonObject ?: return@mapNotNull null
        val fwd = obj["forward-identity"] as? JsonArray
        val fwdIdName = fwd?.let { TripleIdName.fromJson(it) } ?: return@mapNotNull null
        val rev = (obj["reverse-identity"] as? JsonArray)
        InstantAttr(
            id = (obj["id"] as? JsonPrimitive)?.content ?: return@mapNotNull null,
            forwardIdentity = fwdIdName,
            reverseIdentity = rev?.let { TripleIdName.fromJson(it) },
            valueType = ValueType.parse((obj["value-type"] as? JsonPrimitive)?.content ?: "blob"),
            cardinality = Cardinality.parse((obj["cardinality"] as? JsonPrimitive)?.content ?: "one"),
            isUnique = (obj["unique?"] as? JsonPrimitive)?.content == "true",
            isIndexed = (obj["index?"] as? JsonPrimitive)?.content == "true",
            isRequired = (obj["required?"] as? JsonPrimitive)?.content == "true",
            inferredTypes = (obj["inferred-types"] as? JsonArray)
                ?.mapNotNull { (it as? JsonPrimitive)?.content?.let(InferredType::parse) }
                ?: emptyList(),
            catalog = (obj["catalog"] as? JsonPrimitive)?.content?.let(Catalog::parse) ?: Catalog.User,
            checkedDataType = (obj["checked-data-type"] as? JsonPrimitive)?.content,
        )
    }

/**
 * Convenience: generate a UUID for a temporary/optimistic entity id.
 */
fun newEid(): String = UUID.randomUUID().toString()
