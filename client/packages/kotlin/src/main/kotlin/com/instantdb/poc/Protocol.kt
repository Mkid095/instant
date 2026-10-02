package com.instantdb.poc

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject

/**
 * Wire-protocol models for InstantDB.
 *
 * Field naming follows the kebab-case convention used by the actual server
 * (e.g. `app-id`, `client-event-id`, `tx-id`). Annotated with @SerialName
 * so kotlinx.serialization emits/accepts those names verbatim.
 *
 * Source of truth: server/src/instant/reactive/session.clj and
 * client/packages/core/src/Reactor.js.
 */

// ============================================================
// Client -> Server messages
// ============================================================

@Serializable
data class InitMessage(
    val op: String = "init",
    @SerialName("app-id") val appId: String,
    @SerialName("refresh-token") val refreshToken: String? = null,
    @SerialName("__admin-token") val adminToken: String? = null,
    val versions: Map<String, String>? = null,
)

@Serializable
data class AddQueryMessage(
    val op: String = "add-query",
    val q: JsonObject,
    @SerialName("client-event-id") val clientEventId: String,
)

@Serializable
data class RemoveQueryMessage(
    val op: String = "remove-query",
    val q: JsonObject,
    @SerialName("client-event-id") val clientEventId: String,
)

/**
 * A single tx-step in a transaction. Server accepts the following shapes
 * (from server/src/instant/reactive/session.clj:545-584 and
 * client/packages/core/src/instaml.ts:362-382):
 *
 *   ["add-triple",          eid, attrId, value, opts?]
 *   ["retract-triple",      eid, attrId, value, opts?]
 *   ["deep-merge-triple",   eid, attrId, value, opts?]
 *   ["delete-entity",       eid, etype]
 *   ["add-attr",            InstantDBAttr]
 *   ["update-attr",         partialAttr]
 *   ["delete-attr",         attrId]
 *   ["rule-params",         eid, etype, ruleParams]
 *
 * For the POC we only emit add-triple and add-attr (for new attrs).
 */
@Serializable
data class TransactMessage(
    val op: String = "transact",
    @SerialName("tx-steps") val txSteps: List<List<JsonElement>>,
    @SerialName("client-event-id") val clientEventId: String,
)

// ============================================================
// Server -> Client messages
// ============================================================

@Serializable
data class InitOkMessage(
    val op: String = "init-ok",
    @SerialName("session-id") val sessionId: String,
    /**
     * Server sends attrs as a JSON array of attribute descriptors (not
     * wrapped in {attrs: [...]}). See server/src/instant/reactive/session.clj:186.
     */
    val attrs: JsonArray,
    @SerialName("app-status") val appStatus: JsonObject,
    @SerialName("client-event-id") val clientEventId: String? = null,
    val auth: JsonObject? = null,
)

@Serializable
data class AddQueryOkMessage(
    val op: String = "add-query-ok",
    val q: JsonObject,
    /**
     * Result is a JSON array of `idNode` objects (one per top-level entity
     * in the query). See server/src/instant/reactive/session.clj:264.
     */
    val result: JsonArray,
    @SerialName("processed-tx-id") val processedTxId: Long,
    @SerialName("client-event-id") val clientEventId: String,
)

@Serializable
data class AddQueryExistsMessage(
    val op: String = "add-query-exists",
    val q: JsonObject,
    @SerialName("client-event-id") val clientEventId: String,
)

@Serializable
data class RefreshOkMessage(
    val op: String = "refresh-ok",
    val computations: List<JsonObject> = emptyList(),
    @SerialName("processed-tx-id") val processedTxId: Long,
    @SerialName("client-event-id") val clientEventId: String? = null,
    val attrs: JsonObject? = null,
)

/**
 * Server-pushed refresh request. Client must respond with a
 * refresh-ok. See server/src/instant/reactive/invalidator.clj:246.
 */
@Serializable
data class RefreshMessage(
    val op: String = "refresh",
    @SerialName("session-id") val sessionId: String,
    @SerialName("tx-id") val txId: Long,
    @SerialName("tx-created-at") val txCreatedAt: String? = null,
    val isn: JsonElement? = null,
)

@Serializable
data class TransactOkMessage(
    val op: String = "transact-ok",
    @SerialName("client-event-id") val clientEventId: String,
    @SerialName("tx-id") val txId: Long,
)

@Serializable
data class ErrorMessage(
    val op: String = "error",
    val message: String? = null,
    val hint: JsonObject? = null,
    val type: String? = null,
    val status: Int? = null,
    @SerialName("trace-id") val traceId: String? = null,
    @SerialName("client-event-id") val clientEventId: String? = null,
    @SerialName("original-event") val originalEvent: JsonObject? = null,
)

/**
 * Generic wrapper so we can dispatch on `op` without knowing the type ahead.
 */
@Serializable
data class Envelope(
    val op: String,
    // Allow any other fields to pass through
    val extras: JsonObject = JsonObject(emptyMap()),
)

/** Tiny shim so kotlinx.serialization can carry arbitrary JSON. */
typealias JsonElement = kotlinx.serialization.json.JsonElement
typealias JsonArray = kotlinx.serialization.json.JsonArray
