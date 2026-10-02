# instantdb-kotlin

Kotlin/JVM SDK for InstantDB — the Modern Firebase.

## Installation

```kotlin
dependencies {
    implementation("com.instantdb:instantdb-kotlin:0.8.0")
}
```

## Quick Start

```kotlin
import com.instantdb.InstantDb
import com.instantdb.InstantDbConfig

val db = InstantDb(
    config = InstantDbConfig(
        appId = "YOUR_APP_ID",
        host = "https://api.instantdb.com"
    )
)

db.connect()
```

## Features

- WebSocket and SSE transports
- Pure Kotlin/JVM (no Android dependencies)
- Coroutine-based async API
- Reactive query flows

## Documentation

https://instantdb.com/docs

## Repository

https://github.com/instantdb/instantdb-kotlin
