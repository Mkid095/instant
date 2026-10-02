package com.instantdb.poc

import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.put
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable

/**
 * Auth-flow integration tests against the live server.
 */
@EnabledIfEnvironmentVariable(named = "INSTANT_TEST_APP_ID", matches = ".+")
class AuthFlowTest {
    private val appId: String = System.getenv("INSTANT_TEST_APP_ID")!!
    private val adminToken: String = System.getenv("INSTANT_TEST_ADMIN_TOKEN")!!
    private val apiUri: String = System.getenv("INSTANT_TEST_API_URI") ?: "https://apiinstant.fidscript.com"
    private val wsUri: String = System.getenv("INSTANT_TEST_WS_URI") ?: "wss://apiinstant.fidscript.com"

    @Test
    fun `guest auth — signInAsGuest returns user with refresh_token`() = runBlocking {
        val auth = AuthAPI(apiUri)
        val guest = auth.signInAsGuest(appId)
        assertNotNull(guest.refreshToken)
        println("[test] guest user-id=${guest.id} refresh=${guest.refreshToken?.take(8)}...")
    }

    @Test
    fun `refresh token — verify returns a valid user`() = runBlocking {
        val auth = AuthAPI(apiUri)
        val guest = auth.signInAsGuest(appId)
        val originalRefresh = guest.refreshToken!!
        val result = withTimeout(5_000) {
            kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) {
                val client = OkHttpClient()
                val body = buildJsonObject {
                    put("app-id", appId)
                    put("refresh-token", originalRefresh)
                }
                val mediaJson = "application/json; charset=utf-8".toMediaType()
                val req = Request.Builder()
                    .url("$apiUri/runtime/auth/verify_refresh_token")
                    .post(body.toString().toRequestBody(mediaJson))
                    .build()
                client.newCall(req).execute().use { resp ->
                    (resp.body?.string() ?: "") to resp.code
                }
            }
        }
        assertEquals(200, result.second)
        val json = kotlinx.serialization.json.Json
            .parseToJsonElement(result.first).jsonObject
        val user = json["user"] as JsonObject
        val refresh = user["refresh_token"]?.toString()?.trim('"')
        assertNotNull(refresh)
        println("[test] verified refresh-token: ${refresh?.take(8)}...")
    }

    @Test
    fun `init with refresh-token — ws init succeeds`() = runBlocking {
        val auth = AuthAPI(apiUri)
        val guest = auth.signInAsGuest(appId)
        val config = InstantDbConfig(
            appId = appId,
            apiUri = apiUri,
            websocketUri = wsUri,
            refreshToken = guest.refreshToken,
        )
        val reactor = Reactor(config)
        try {
            reactor.connect()
            val sessionId = reactor.connection.sessionId!!
            assertTrue(sessionId.isNotEmpty())
            println("[test] ws init with refresh-token: session-id=${sessionId.take(8)}...")
        } finally {
            reactor.shutdown()
        }
    }
}
