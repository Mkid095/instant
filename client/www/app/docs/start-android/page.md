---
nextjs:
  metadata:
    title: 'Getting started with Android'
    description: 'How to use InstantDB with Android (Kotlin).'
---

You can use InstantDB in your native Android apps. Below is a complete guide for integrating the InstantDB Android SDK into a Kotlin project.

## Requirements

- **Kotlin** 2.0+
- **Android SDK** 24+ (Android 7.0 Nougat)
- **Gradle** 8.0+
- **compileSdk** 34

## What you get

- ⚡ **Real-time sync** — WebSocket primary, automatic SSE fallback
- 💾 **Offline-first** — SQLite cache survives process death
- 🔄 **Optimistic mutations** — Apply locally, persist, replay on reconnect
- 🧩 **Jetpack Compose** — `rememberInstantQuery` composable
- 🔐 **Secure storage** — Refresh tokens in Android Keystore (AES-256-GCM)
- 🌐 **Cross-platform** — Same `appId` works in web, iOS, React Native, Python

## Installation

### 1. Add the public Maven repository

In your project's `settings.gradle.kts`:

```kotlin {% showCopy=true %}
dependencyResolutionManagement {
    repositories {
        maven { url = uri("https://instant.fidscript.com/maven") }
        google()
        mavenCentral()
    }
}
```

### 2. Add the SDK to your app module

In `app/build.gradle.kts`:

```kotlin {% showCopy=true %}
dependencies {
    implementation("com.instantdb:instantdb-android:0.8.0-phase10")
    implementation("com.instantdb:instantdb-kotlin:0.8.0-phase10")

    // Required for Compose
    implementation(platform("androidx.compose:compose-bom:2024.10.01"))
    implementation("androidx.compose.ui:ui")
    implementation("androidx.activity:activity-compose:1.9.3")

    // Required for SQLDelight (offline persistence)
    implementation("app.cash.sqldelight:android-driver:2.0.2")

    // Required for real-time sync
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("com.squareup.okhttp3:okhttp-sse:4.12.0")

    // Optional — secure credential storage
    implementation("androidx.security:security-crypto:1.1.0-alpha06")
}
```

## Quick Start

### 1. Add permissions to AndroidManifest.xml

```xml {% showCopy=true %}
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
    <uses-permission android:name="android.permission.INTERNET" />
    <uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />

    <application
        android:name=".MyApplication"
        ...>
    </application>
</manifest>
```

### 2. Initialize InstantDb in your Application class

```kotlin {% showCopy=true %}
// app/src/main/kotlin/.../MyApplication.kt
import android.app.Application
import com.instantdb.android.InstantDb
import com.instantdb.android.InstantDbConfig
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

class MyApplication : Application() {
    val db: InstantDb by lazy {
        InstantDb(
            context = this,
            config = InstantDbConfig(
                appId = "YOUR_APP_ID",
                host = "https://api.instantdb.com",
                useSse = false  // true = SSE, false = WebSocket
            )
        )
    }

    private val appScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    override fun onCreate() {
        super.onCreate()
        appScope.launch { db.connect() }
    }
}
```

### 3. Query data with Compose

```kotlin {% showCopy=true %}
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import com.instantdb.android.rememberInstantQuery

@Composable
fun TodoListScreen() {
    val state = rememberInstantQuery(
        query = "{ todos: { \$: { where: { done: false } } } }"
    )

    when (state) {
        is com.instantdb.android.InstantQueryState.Loading ->
            CircularProgressIndicator()
        is com.instantdb.android.InstantQueryState.Error ->
            Text("Error: ${'$'}{state.message}")
        is com.instantdb.android.InstantQueryState.Data -> {
            val todos = state.data["todos"] as? List<Map<String, Any>> ?: emptyList()
            LazyColumn {
                items(todos) { todo ->
                    Text(todo["text"]?.toString() ?: "")
                }
            }
        }
        is com.instantdb.android.InstantQueryState.Offline ->
            Text("Offline — showing cached data")
    }
}
```

### 4. Write data with transact

```kotlin {% showCopy=true %}
import androidx.compose.material3.Button
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.rememberCoroutineScope
import com.instantdb.android.InstantDb
import kotlinx.coroutines.launch
import kotlinx.serialization.json.*

@Composable
fun AddTodoButton(db: InstantDb) {
    val scope = rememberCoroutineScope()
    Button(onClick = {
        scope.launch {
            db.transact(listOf(
                listOf(
                    JsonPrimitive("add"),
                    JsonPrimitive("todos"),
                    JsonObject(mapOf(
                        "text" to JsonPrimitive("Buy milk"),
                        "done" to JsonPrimitive(false)
                    ))
                )
            ))
        }
    }) { Text("Add todo") }
}
```

## API Reference

### InstantDbConfig

```kotlin
data class InstantDbConfig(
    val appId: String,           // Your InstantDB app id
    val host: String,            // e.g. "https://api.instantdb.com"
    val websocketUri: String? = null,  // optional override
    val useSse: Boolean = false, // true = SSE, false = WebSocket
    val schemaVersion: String = "1.0.0",
)
```

### Connection

```kotlin
suspend fun connect()                            // Open the connection
val connectionState: StateFlow<ConnectionState>  // Connected / Connecting / Reconnecting / Disconnected / Offline / Error
val connectionStateDetail: StateFlow<ConnectionDetail?>
suspend fun close()                              // Clean shutdown
```

### Queries

```kotlin
suspend fun query(q: JsonObject): AddQueryOkMessage       // One-shot query
fun queryFlow(q: JsonObject): Flow<JsonObject>            // Reactive flow
```

### Mutations

```kotlin
suspend fun transact(txSteps: List<List<JsonElement>>): TransactOkMessage
```

### Compose

```kotlin
@Composable
fun rememberInstantQuery(query: String): InstantQueryState
// InstantQueryState: Loading | Data | Error | Offline
```

## Choosing a Transport

```kotlin
// WebSocket (default — fastest, lowest latency)
val config = InstantDbConfig(
    appId = "YOUR_APP_ID",
    host = "https://api.instantdb.com",
    useSse = false,
)

// SSE (for restricted networks or proxies that block WebSockets)
val config = InstantDbConfig(
    appId = "YOUR_APP_ID",
    host = "https://api.instantdb.com",
    useSse = true,
)
```

The SDK auto-reconnects with linear backoff. If WebSocket fails, it falls back to SSE transparently.

## Sharing data with other platforms

The same `appId` works across **Android, web, iOS, React Native, SolidJS, Svelte, Vue, Python, and Kotlin/JVM**. Todos created in the Android app appear in the web app in real-time, and vice versa. No extra config needed — the backend routes by `appId`.

See [Cross-platform data sharing](/docs/cross-platform) for details.

## Next Steps

- [Cross-platform data sharing](/docs/cross-platform)
- [Working with data](/docs/init)
- [Permissions](/docs/permissions)
- [Storage](/docs/storage)

## Troubleshooting

**Gradle can't find the artifact** — Make sure the Maven repo is in `dependencyResolutionManagement` in `settings.gradle.kts`, not in `allprojects { repositories { } }` in module-level build files.

**WebSocket cannot connect** — Check that `host` is correct. Set `useSse = true` to force SSE if your network blocks WebSockets.

**Query results look stale** — The SDK uses targeted invalidation. If your query depends on a different attr than expected, results may not refresh until that attr changes.

**Pending mutations don't reconcile** — Pending mutations are persisted to SQLite and replay on reconnect. If they remain pending, the server likely rejected them — check the returned error.
