package com.instantdb.android

/**
 * Configuration for InstantDb Android SDK.
 *
 * @param appId The InstantDB application ID (from the InstantDB dashboard)
 * @param host The base URL of the InstantDB server (e.g., "https://api.example.com")
 * @param websocketUri Optional WebSocket URI. If null, derived from host.
 * @param useSse If true, use SSE transport instead of WebSocket.
 * @param schemaVersion Schema version string for the app.
 */
data class InstantDbConfig(
    val appId: String,
    val host: String,
    val websocketUri: String? = null,
    val useSse: Boolean = false,
    val schemaVersion: String = "1.0.0",
) {
    init {
        require(appId.isNotBlank()) { "appId cannot be blank" }
        require(host.isNotBlank()) { "host cannot be blank" }
    }
}
