---
nextjs:
  metadata:
    title: 'Getting started with Android'
    description: 'How to use InstantDB with Android (Kotlin)'
---

You can use InstantDB in your Android apps too! Below is a guide for integrating InstantDB with a native Android project using Kotlin.

## Requirements

- Kotlin 2.0+
- Android SDK 24+ (Android 7.0)
- Gradle 8+

## Installation

Add the InstantDB Android SDK to your `build.gradle.kts`:

```kotlin {% showCopy=true %}
dependencies {
    implementation("com.instantdb:instantdb-android:0.8.0")
}
```

Add the Maven Local repository if it's not already configured:

```kotlin {% showCopy=true %}
repositories {
    mavenLocal()
    // Or publish to Maven Central for production
}
```

## Quick Start

Initialize InstantDB in your Application class:

```kotlin {% showCopy=true %}
import com.instantdb.android.InstantDb
import com.instantdb.android.InstantDbConfig

class MyApplication : Application() {
    val db = InstantDb(
        context = this,
        config = InstantDbConfig(
            appId = "YOUR_APP_ID",
            host = "https://api.instantdb.com"
        )
    )
}
```

## Connecting

Call `connect()` to establish a connection:

```kotlin {% showCopy=true %}
scope.launch {
    db.connect()
}
```

Monitor connection state:

```kotlin {% showCopy=true %}
scope.launch {
    db.connectionState.collect { state ->
        when (state) {
            is ConnectionState.Connected -> println("Connected via ${state.transport}")
            is ConnectionState.Connecting -> println("Connecting...")
            is ConnectionState.Disconnected -> println("Disconnected")
            is ConnectionState.Error -> println("Error: ${state.message}")
            else -> {}
        }
    }
}
```

## Choosing Transport

InstantDB supports two transports: **WebSocket** (default) and **SSE**.

```kotlin {% showCopy=true %}
// WebSocket (default)
val config = InstantDbConfig(
    appId = "YOUR_APP_ID",
    host = "https://api.instantdb.com",
    useSse = false  // WebSocket
)

// SSE
val config = InstantDbConfig(
    appId = "YOUR_APP_ID",
    host = "https://api.instantdb.com",
    useSse = true  // Server-Sent Events
)
```

## Querying Data

```kotlin {% showCopy=true %}
scope.launch {
    val result = db.query("{ todos: { $: { limit: 10 } } }")
    if (result is AddQueryOkMessage) {
        val todos = result.data.getJsonArray("todos")
        // Handle data
    }
}
```

Or use reactive queries with `queryFlow`:

```kotlin {% showCopy=true %}
db.queryFlow("{ todos: {} }").collect { data ->
    // Reactively receive updates
    println("Todos changed: $data")
}
```

## Writing Data

```kotlin {% showCopy=true %}
scope.launch {
    db.transact(listOf(
        listOf("add", "todos", mapOf(
            "text" to JsonPrimitive("Hello from Android!"),
            "done" to JsonPrimitive(false)
        ))
    ))
}
```

## Closing the Connection

```kotlin {% showCopy=true %}
scope.launch {
    db.close()
}
```

## Next Steps

Check out the [Working with data](/docs/init) section to learn more about InstantDB concepts!

For Android-specific features like offline persistence and secure credential storage, see the [Android SDK documentation](https://github.com/instantdb/instantdb).
