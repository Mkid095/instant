# Phase 11 MCP Audit Report

**Date:** 2026-10-02
**Auditor:** Claude Code
**MCP Packages Audited:** `@fidscript/instant-mcp@0.5.3` (fidscript-mcp) and `@instantdb/mcp` (mcp)

---

## 1. MCP Audit

### 1.1 Tools Inspected

#### `fidscript-mcp` (`@fidscript/instant-mcp@0.5.3`)

| Tool | Status | Notes |
|------|--------|-------|
| `android-sdk-version` | **FIXED** | Version updated from `0.7.0-phase9` → `0.8.0-phase10`; artifact updated to `instantdb-android` |
| `android-installation` | **FIXED** | Default version updated; artifact updated to `instantdb-android` |
| `android-configuration` | **FIXED** | Completely rewritten to match actual `InstantDbConfig` API (removed `adminToken`, updated field names) |
| `android-documentation` | **FIXED** | Removed references to internal phase docs (PHASE_5.md etc.); now points to public InstantDB docs |
| `android-schema` | PASS | Unchanged; correctly returns safe subset of schema metadata |
| `android-capabilities` | **FIXED** | Removed `ReactiveQueryEngine.queryFlow(q)` (JVM API); now correctly describes `instant.queryFlow(q)` and Android-specific features |
| `android-sync-status` | PASS | Unchanged; informational only, no credential exposure |

#### `mcp` (`@instantdb/mcp`)

Same 7 Android tools, same fixes applied. However, this package has an **environmental OOM issue** — the TypeScript compiler crashes with "Aborted" due to insufficient memory. This is **not caused by the audit changes**; the package was never successfully built in this environment.

#### Other Tools Verified

| Tool | Status | Notes |
|------|--------|-------|
| Storage tools (`uploadFileDirect`, `listUploadedFiles`, `get-upload-url`, `get-download-url`, `delete-file`) | PASS | Use `apiPost`/`apiGet` helpers with token parameter; no hardcoded credentials |
| Storage config tools | PASS | Correctly use app-scoped API endpoints |
| Query/transact tools | PASS | No credential exposure |

### 1.2 Tools Tested

| Test | Package | Result |
|------|---------|--------|
| `npm run build && node tools_no_duplicates.test.mjs` | fidscript-mcp | **PASS** — 74 tools, no duplicates, no underscore aliases |

### 1.3 Stale Documentation Found

| Issue | Location | Fix Applied |
|-------|----------|-------------|
| Version `0.7.0-phase9` hardcoded | `android-sdk-version`, `android-installation` | Updated to `0.8.0-phase10` |
| Artifact `instantdb-kotlin` only | `android-sdk-version`, `android-installation` | Updated to `instantdb-android` (primary) + `instantdb-kotlin` (secondary) |
| `adminToken` in config snippet | `android-configuration` | Removed; actual SDK uses `useSse` flag, credentials stored via Android Keystore |
| `apiUri`/`websocketUri` field names | `android-configuration` | Fixed to `host` (matches actual `InstantDbConfig`) |
| `ReactiveQueryEngine.queryFlow(q)` | `android-capabilities` | Fixed to `instant.queryFlow(q)` with Android-specific APIs |
| Phase 5-9 internal doc references | `android-documentation` | Updated to public InstantDB docs URLs |
| `schema_version: 3`, migration list | `android-capabilities` | Updated to `schema_version: 2` (actual SQLite schema) |

### 1.4 Security Findings

| Check | Status | Notes |
|-------|--------|-------|
| No admin tokens in MCP responses | **PASS** | `android-configuration` no longer includes `adminToken` |
| No refresh tokens exposed | **PASS** | All tools are read-only or app-scoped |
| No VPS secrets in responses | **PASS** | No hardcoded API URLs or credentials |
| Storage tools use token parameter | **PASS** | `uploadFileDirect`, `listUploadedFiles` accept token as parameter |
| `android-schema` returns safe subset only | **PASS** | Returns attr metadata only, no values |
| No `.npmrc` or env secrets in source | **PASS** | No credential leakage found |

### 1.5 Build Results

| Package | Build | Test | Notes |
|---------|-------|------|-------|
| `fidscript-mcp` (@fidscript/instant-mcp) | ✅ SUCCESS | ✅ 74 tools pass | Ready to republish |
| `mcp` (@instantdb/mcp) | ❌ OOM | N/A | Pre-existing environmental issue; not caused by audit changes |

---

## 2. SDK Compatibility

### 2.1 Current SDK Version

**Version:** `0.8.0-phase10`

### 2.2 Maven Coordinates

| Artifact | Coordinate | Status |
|----------|------------|--------|
| Android SDK (AAR) | `com.instantdb:instantdb-android:0.8.0-phase10` | Published to local Maven |
| Kotlin/JVM SDK (JAR) | `com.instantdb:instantdb-kotlin:0.8.0-phase10` | Published to local Maven |

**Note:** These are phase-versioned artifacts. For Maven Central release, a final version (e.g., `0.8.0`) would be used.

### 2.3 Transport API

```
Transport (interface)
├── InstantTransport (WebSocket)
└── SseTransport (SSE)

InstantDb(config, transport: Transport)  ← polymorphic
```

Both transports implement the `Transport` interface. `InstantDb` accepts either.

### 2.4 Android API

```kotlin
class InstantDb(context: Context, config: InstantDbConfig)

data class InstantDbConfig(
    val appId: String,
    val host: String,           // "https://api.example.com"
    val websocketUri: String? = null,  // optional override
    val useSse: Boolean = false,      // true = SSE, false = WebSocket
    val schemaVersion: String = "1.0.0",
)

// Connection
suspend fun connect()
val connectionState: StateFlow<ConnectionState>
val connectionStateDetail: StateFlow<ConnectionDetail?>

// Queries
suspend fun query(q: JsonObject): AddQueryOkMessage
fun queryFlow(q: JsonObject): Flow<JsonObject>  // reactive

// Mutations
suspend fun transact(txSteps: List<List<JsonElement>>): TransactOkMessage

// Lifecycle
suspend fun close()
val syncStatus: SyncStatus
```

### 2.5 Compose API

```kotlin
@Composable
fun rememberInstantQuery(query: String): InstantQueryState
// InstantQueryState: Loading, Data, Error, Offline
```

### 2.6 Persistence API

```kotlin
class AndroidSqliteDriverFactory(context: Context)
fun createAndroidDriver(): AndroidSqliteDriver
// Schema version 2, tables: triples, attrs, pending_mutations, query_cache, app_metadata
```

### 2.7 Authentication API

```
Credentials stored via SecureCredentialStorage:
- refreshToken: EncryptedSharedPreferences (AES-256-GCM, Android Keystore)
- adminToken: EncryptedSharedPreferences (AES-256-GCM, Android Keystore)
```

### 2.8 Multi-Tenant Configuration

```
App A → InstantDb(appId = "tenant-a-id", host = "https://api.instantdb.com") → VPS
App B → InstantDb(appId = "tenant-b-id", host = "https://api.instantdb.com") → VPS
```

Each app uses its own `appId`. The VPS routes based on `appId`. No cross-tenant data leakage.

---

## 3. Sample App Consistency

**Sample app location:** `/home/ken/projects/kotlin-poc/sample-android/`

The sample app demonstrates:
- Two simultaneous `InstantDb` instances with different `appId`s ("app-a-tenant", "app-b-tenant")
- WebSocket and SSE transport selection via `useSse` flag
- Connection state monitoring via `connectionState`
- Transaction execution via `transact()`
- Clean shutdown via `close()`

The MCP `android-configuration` snippet is now consistent with this actual usage.

---

## 4. Release Recommendation

### Items Classified

| Item | Classification | Notes |
|------|---------------|-------|
| SDK version `0.8.0-phase10` | PASS | Correct |
| Maven coordinates accurate | PASS | Both `instantdb-android` and `instantdb-kotlin` available |
| Transport polymorphism documented | PASS | Both WS and SSE documented |
| `android-configuration` snippet | FIXED | Now matches actual API |
| `android-capabilities` accuracy | FIXED | Now describes actual Android SDK |
| `android-documentation` URLs | FIXED | Now points to public docs |
| Security (no credential exposure) | PASS | All checks pass |
| `fidscript-mcp` builds and tests | PASS | 74 tools, ready to republish |
| `mcp` build | BLOCKED | Pre-existing OOM environmental issue |
| Runtime emulator test | BLOCKED | No KVM hardware available |
| Maven Central release | BLOCKED | Phase version requires finalization |

### Recommendation

**`@fidscript/instant-mcp@0.5.3` is ready to republish** with the audit fixes. The MCP accurately represents the Phase 11 Android SDK.

**`@instantdb/mcp`** has a pre-existing environmental build failure (OOM) that is unrelated to the audit changes.

**SDK (`0.8.0-phase10`)** is ready for Maven Central publication once:
1. Phase version is replaced with final version (e.g., `0.8.0`)
2. Credentials/signing are configured
3. Runtime emulator test is completed (hardware permitting)

### Changes Made

**Files modified:**
- `client/packages/fidscript-mcp/src/index.ts` (Android tools section, ~50 lines changed)
- `client/packages/mcp/src/index.ts` (same changes, ~50 lines)

**No changes to:**
- `@fidscript/instant-sdk` (explicitly out of scope)
- `@instantdb/core` or other TypeScript packages
- Published npm artifacts

### Exact Versions

| Package | Current Published Version | Post-Audit Version |
|---------|--------------------------|-------------------|
| `@fidscript/instant-mcp` | 0.5.3 (npm) | 0.5.3 (source fixed, needs republish) |
| `instantdb-kotlin` | local Maven | 0.8.0-phase10 |
| `instantdb-android` | local Maven | 0.8.0-phase10 |
