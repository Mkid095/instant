package com.instantdb.poc

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody

/**
 * REST auth helpers. These are pure HTTP calls; no WebSocket needed.
 * Source of truth: client/packages/core/src/authAPI.ts and
 * server/src/instant/runtime/routes.clj:746-775.
 */
class AuthAPI(
    private val apiUri: String,
    private val httpClient: OkHttpClient = OkHttpClient(),
) {
    private val json = Json { ignoreUnknownKeys = true }
    private val mediaJson = "application/json; charset=utf-8".toMediaType()

    @Serializable
    data class User(
        val id: String,
        val email: String? = null,
        val type: String? = null,
        @kotlinx.serialization.SerialName("refresh_token") val refreshToken: String? = null,
    )

    @Serializable
    data class VerifyMagicCodeResponse(val user: User)

    suspend fun sendMagicCode(appId: String, email: String): JsonObject = withContext(Dispatchers.IO) {
        val body = buildJsonObject {
            put("app-id", appId)
            put("email", email)
        }
        val req = Request.Builder()
            .url("$apiUri/runtime/auth/send_magic_code")
            .post(body.toString().toRequestBody(mediaJson))
            .build()
        httpClient.newCall(req).execute().use { resp ->
            val text = resp.body?.string() ?: "{}"
            json.parseToJsonElement(text).let { (it as? JsonObject) ?: JsonObject(emptyMap()) }
        }
    }

    suspend fun verifyMagicCode(
        appId: String,
        email: String,
        code: String,
    ): User = withContext(Dispatchers.IO) {
        val body = buildJsonObject {
            put("app-id", appId)
            put("email", email)
            put("code", code)
        }
        val req = Request.Builder()
            .url("$apiUri/runtime/auth/verify_magic_code")
            .post(body.toString().toRequestBody(mediaJson))
            .build()
        httpClient.newCall(req).execute().use { resp ->
            val text = resp.body?.string() ?: error("empty response")
            val parsed = json.parseToJsonElement(text)
            val user = (parsed as JsonObject)["user"] ?: error("no user in response: $text")
            json.decodeFromJsonElement(User.serializer(), user)
        }
    }

    /**
     * Guest auth: POST /runtime/auth/sign_in_guest returns a user object
     * with a refresh_token. See authAPI.ts:111-125.
     */
    suspend fun signInAsGuest(appId: String): User = withContext(Dispatchers.IO) {
        val body = buildJsonObject { put("app-id", appId) }
        val req = Request.Builder()
            .url("$apiUri/runtime/auth/sign_in_guest")
            .post(body.toString().toRequestBody(mediaJson))
            .build()
        httpClient.newCall(req).execute().use { resp ->
            val text = resp.body?.string() ?: error("empty response")
            val parsed = json.parseToJsonElement(text)
            val user = (parsed as JsonObject)["user"] ?: error("no user in response: $text")
            json.decodeFromJsonElement(User.serializer(), user)
        }
    }
}
