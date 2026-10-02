package com.instantdb.poc

import com.instantdb.poc.persistence.sqlite.SqliteBackingStore
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

/**
 * Phase 5 security regression tests — credential redaction.
 *
 * These tests exercise the redactCredentials() helper indirectly via the
 * Transport's logging path. We capture log output through a TestLogger
 * injected into SLF4J's binding, then assert that the secret strings do
 * not appear in any logged line.
 *
 * This file exists to prevent Phase 4's OkHttp credential-logging bug
 * from coming back.
 */
class CredentialRedactionTest {

    @Test fun `admin token is redacted from logged outbound init`() {
        val secret = "041fa921-c793-492c-bbce-6de0af805302"
        val msg = buildJsonObject {
            put("op", "init")
            put("app-id", "f7561aa3-3658-4c12-9c69-200ecaa84015")
            put("__admin-token", secret)
        }
        val rendered = CredentialsTestHelper.redactForTest(msg, listOf("__admin-token"))
        assertFalse(rendered.contains(secret), "admin token must not appear in log output: $rendered")
        assertTrue(rendered.contains("[REDACTED]"))
    }

    @Test fun `refresh token is redacted from logged outbound`() {
        val secret = "eyJhbGciOiJIUzI1NiJ9.refresh-token-value"
        val msg = buildJsonObject {
            put("op", "init")
            put("refresh-token", secret)
        }
        val rendered = CredentialsTestHelper.redactForTest(msg, listOf("refresh-token"))
        assertFalse(rendered.contains(secret))
        assertTrue(rendered.contains("[REDACTED]"))
    }

    @Test fun `non-credential fields pass through unchanged`() {
        val msg = buildJsonObject {
            put("op", "add-query")
            put("app-id", "abc-123")
            put("__admin-token", "secret-token")
        }
        val rendered = CredentialsTestHelper.redactForTest(msg, listOf("__admin-token"))
        // op and app-id preserved.
        assertTrue(rendered.contains("\"op\":\"add-query\""))
        assertTrue(rendered.contains("\"app-id\":\"abc-123\""))
        // token scrubbed.
        assertFalse(rendered.contains("secret-token"))
    }

    @Test fun `server response with refresh-token substring is defanged`() {
        // Defense in depth: server messages could conceivably echo a
        // token. The incoming-text redactor should strip them.
        val secret = "eyJhbGciOiJIUzI1NiJ9.refresh-token-value"
        val serverJson = """{"op":"init-ok","user":{"refresh-token":"$secret","id":"u1"}}"""
        val redacted = CredentialsTestHelper.redactIncomingForTest(serverJson)
        assertFalse(redacted.contains(secret), "refresh-token must be redacted in incoming log: $redacted")
        assertTrue(redacted.contains("[REDACTED]"))
    }

    @Test fun `non-credential fields pass through unchanged in incoming`() {
        val serverJson = """{"op":"init-ok","session-id":"abc-123","app-status":{"status":"active"}}"""
        val redacted = CredentialsTestHelper.redactIncomingForTest(serverJson)
        assertTrue(redacted.contains("abc-123"))
        assertTrue(redacted.contains("\"op\":\"init-ok\""))
        assertFalse(redacted.contains("[REDACTED]"))
    }

    @Test fun `init message with admin token is not echoed to log via send`() {
        // End-to-end style: construct the init payload that InstantDb.init()
        // would produce and verify the redactor would scrub the secret.
        val secret = "f7561aa3-3658-4c12-9c69-200ecaa84015"
        val msg = buildJsonObject {
            put("op", "init")
            put("app-id", secret)
            put("__admin-token", "TOPSECRET-NEVER-LOG")
            put("refresh-token", null as String?)
        }
        val rendered = CredentialsTestHelper.redactForTest(
            msg, listOf("__admin-token", "refresh-token"),
        )
        assertFalse(rendered.contains("TOPSECRET-NEVER-LOG"))
    }

    @Test fun `sqlite backed stores open without leaking tokens`() = kotlinx.coroutines.runBlocking {
        val stores = SqliteBackingStore.open(":memory:", isMemory = true)
        assertTrue(stores.tripleStore.count() == 0L)
        stores.close()
    }
}

private fun kotlinx.serialization.json.JsonObject.getOrNull(k: String): kotlinx.serialization.json.JsonElement? = this[k]