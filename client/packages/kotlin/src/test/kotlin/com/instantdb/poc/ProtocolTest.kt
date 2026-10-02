package com.instantdb.poc

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.put
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Test

/**
 * Pure unit tests of the wire-format models. No network.
 */
class ProtocolTest {
    private val json = Json {
        ignoreUnknownKeys = true
        isLenient = true
        encodeDefaults = true
    }

    @Test
    fun `init serializes with op field`() {
        val msg = InitMessage(
            appId = "00000000-0000-0000-0000-000000000000",
            refreshToken = null,
            adminToken = "secret-admin-token",
        )
        val out = json.encodeToJsonElement(InitMessage.serializer(), msg).jsonObject
        assertEquals("init", out["op"]?.let { (it as JsonPrimitive).content })
        assertEquals("00000000-0000-0000-0000-000000000000", out["app-id"]?.let { (it as JsonPrimitive).content })
        assertEquals("secret-admin-token", out["__admin-token"]?.let { (it as JsonPrimitive).content })
    }

    @Test
    fun `init-ok parses session-id, app-status, attrs`() {
        val raw = """
            {
              "op": "init-ok",
              "session-id": "abc-123",
              "app-status": {"status": "active"},
              "attrs": [{"id": "x", "forward-identity": ["y","users","name"]}],
              "auth": {"user": null, "admin?": true}
            }
        """.trimIndent()
        val obj = json.parseToJsonElement(raw).jsonObject
        val parsed = json.decodeFromJsonElement(InitOkMessage.serializer(), obj)
        assertEquals("abc-123", parsed.sessionId)
        assertEquals("active", (parsed.appStatus["status"] as JsonPrimitive).content)
        assertEquals(1, parsed.attrs.size)
    }

    @Test
    fun `add-query-ok result is an array of idNodes`() {
        val raw = """
            {
              "op": "add-query-ok",
              "q": {"users": {"$": {"limit": 5}}},
              "result": [
                {"data": {"datalog-result": {"join-rows": [[]]}}, "child-nodes": []}
              ],
              "processed-tx-id": 1234,
              "client-event-id": "cid-1"
            }
        """.trimIndent()
        val parsed = json.decodeFromJsonElement(
            AddQueryOkMessage.serializer(),
            json.parseToJsonElement(raw).jsonObject,
        )
        assertEquals("add-query-ok", parsed.op)
        assertEquals(1234L, parsed.processedTxId)
        assertEquals(1, parsed.result.size)
        // Sanity: each idNode has data + child-nodes
        val first = parsed.result[0].jsonObject
        assertNotNull(first["data"])
        assertNotNull(first["child-nodes"])
    }

    @Test
    fun `transact-ok parses tx-id`() {
        val raw = """
            {"op": "transact-ok", "client-event-id": "cid-2", "tx-id": 9876}
        """.trimIndent()
        val parsed = json.decodeFromJsonElement(
            TransactOkMessage.serializer(),
            json.parseToJsonElement(raw).jsonObject,
        )
        assertEquals(9876L, parsed.txId)
        assertEquals("cid-2", parsed.clientEventId)
    }

    @Test
    fun `error message parses trace-id and hint`() {
        val raw = """
            {
              "op": "error",
              "status": 400,
              "type": "validation-failed",
              "message": "Invalid op",
              "hint": {"op": null},
              "trace-id": "abc-trace"
            }
        """.trimIndent()
        val parsed = json.decodeFromJsonElement(
            ErrorMessage.serializer(),
            json.parseToJsonElement(raw).jsonObject,
        )
        assertEquals("Invalid op", parsed.message)
        assertEquals("abc-trace", parsed.traceId)
        assertEquals(400, parsed.status)
    }

    @Test
    fun `transact serializes tx-steps as JSON arrays`() {
        val steps = listOf(
            listOf(
                JsonPrimitive("add-triple"),
                JsonPrimitive("eid-1"),
                JsonPrimitive("attr-id-1"),
                JsonPrimitive("hello"),
                kotlinx.serialization.json.JsonNull,
            ),
        )
        val msg = TransactMessage(op = "transact", txSteps = steps, clientEventId = "cid-x")
        val out = json.encodeToJsonElement(TransactMessage.serializer(), msg).jsonObject
        assertEquals("transact", (out["op"] as JsonPrimitive).content)
        val arr = out["tx-steps"] as kotlinx.serialization.json.JsonArray
        assertEquals(1, arr.size)
        // The serialized form of List<List<JsonElement>> is an array of arrays,
        // so step[0] is the first array (an inner JsonArray).
        val step = arr[0] as kotlinx.serialization.json.JsonArray
        assertEquals("add-triple", (step[0] as JsonPrimitive).content)
        assertEquals("eid-1", (step[1] as JsonPrimitive).content)
        assertEquals("hello", (step[3] as JsonPrimitive).content)
        // position 4 is null (no mode metadata for a fresh create)
        assertEquals(true, step[4] is kotlinx.serialization.json.JsonNull)
    }
}
