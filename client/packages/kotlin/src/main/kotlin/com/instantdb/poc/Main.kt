package com.instantdb.poc

import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import org.slf4j.LoggerFactory
import java.util.UUID

private val log = LoggerFactory.getLogger("com.instantdb.poc.Main")

fun main(args: Array<String>) {
    val appId = System.getenv("INSTANT_APP_ID")
        ?: error("INSTANT_APP_ID env var required")
    val apiUri = System.getenv("INSTANT_API_URI")
        ?: "https://apiinstant.fidscript.com"
    val wsUri = System.getenv("INSTANT_WS_URI")
        ?: "wss://apiinstant.fidscript.com"
    val adminToken = System.getenv("INSTANT_ADMIN_TOKEN")

    log.info("POC target: api={} ws={}", apiUri, wsUri)

    val config = InstantDbConfig(
        appId = appId,
        apiUri = apiUri,
        websocketUri = wsUri,
        adminToken = adminToken,
    )

    val transport = InstantTransport(config.wsUrl)
    val db = InstantDb(config, transport)

    runBlocking {
        try {
            runFullDemo(db)
        } catch (e: Exception) {
            log.error("POC failed: ${e.message}", e)
            throw e
        } finally {
            db.close()
        }
    }
}

private suspend fun runFullDemo(db: InstantDb) {
    println("\n=== STEP 0: guest auth ===")
    val auth = AuthAPI(db.config.apiUri)
    val guest = auth.signInAsGuest(db.config.appId)
    println("  guest user-id: ${guest.id}")
    println("  refresh-token: ${guest.refreshToken?.take(8)}...  (redacted)")
    // Note: the POC uses admin-token for the WS init, but the guest
    // refresh-token would work too if we replaced adminToken in config.
    // For the protocol proof, admin-token is sufficient.

    println("\n=== STEP 1: connect + init ===")
    db.init()
    val sessionInfo = db.sessionInfo ?: error("init-ok missing session info")
    println("  session-id: ${sessionInfo.sessionId}")
    println("  app-status: ${sessionInfo.appStatus}")
    val attrsCount = sessionInfo.attrs.size
    println("  attrs count: $attrsCount")

    val firstAttr = sessionInfo.attrs.firstOrNull()?.jsonObject
        ?: error("no attrs in init-ok payload")
    val forwardIdent = firstAttr["forward-identity"]?.jsonArray
    val etype = forwardIdent?.getOrNull(1)?.jsonPrimitive?.content
    val label = forwardIdent?.getOrNull(2)?.jsonPrimitive?.content
    val attrId = firstAttr["id"]?.jsonPrimitive?.content
    println("  picked entity: $etype / $label (attr-id=$attrId)")

    println("\n=== STEP 2: add-query (initial state) ===")
    val initialQuery = buildJsonObject {
        put("\$$etype", buildJsonObject {
            put("\$", buildJsonObject {
                put("limit", 5)
            })
        })
    }
    val initial = db.queryOnce(initialQuery)
    println("  processed-tx-id: ${initial.processedTxId}")
    println("  result count: ${initial.result.size}")
    println("  raw result: ${initial.result}")

    println("\n=== STEP 3: transact (create one entity) ===")
    val entityId = UUID.randomUUID().toString()
    // For a fresh add-triple on a new entity, tx-step[4] should be null
    // (no mode metadata). The JS SDK sets mode:'create' only when the
    // entity already exists on the server.
    val createStep: List<JsonElement> = listOf(
        JsonPrimitive("add-triple"),
        JsonPrimitive(entityId),
        JsonPrimitive(attrId!!),
        JsonPrimitive("poc-${System.currentTimeMillis()}"),
        kotlinx.serialization.json.JsonNull,
    )
    val ack = db.transact(listOf(createStep))
    println("  transact-ok: tx-id=${ack.txId} created eid=$entityId")

    println("\n=== STEP 4: add-query (verify mutation) ===")
    // Server caches the query by hash; sending the same q yields
    // `add-query-exists` instead of a fresh result. Use a slightly
    // different q to force a re-evaluation, OR rely on the refresh-ok
    // that the server pushes automatically after our transact.
    val afterQuery = db.queryOnce(
        buildJsonObject {
            put("\$$etype", buildJsonObject {
                put("\$", buildJsonObject {
                    put("limit", 5)
                    put("order", buildJsonObject { put("serverCreatedAt", "desc") })
                })
            })
        }
    )
    println("  processed-tx-id: ${afterQuery.processedTxId}")
    println("  result count: ${afterQuery.result.size}")
    println("  result: ${afterQuery.result}")

    println("\n=== STEP 5: waiting for refresh-ok ===")
    println("  Open a second client and mutate this entity to trigger a")
    println("  server push to us. (Press Ctrl+C to exit.)")
    db.events.collect { msg ->
        val op = msg["op"]?.jsonPrimitive?.content
        if (op != null) {
            println("  [event] op=$op")
        }
    }
}
