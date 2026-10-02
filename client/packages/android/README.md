# instantdb-android

Android SDK for InstantDB — the Modern Firebase.

## Installation

```kotlin
// settings.gradle.kts
dependencyResolutionManagement {
    repositories {
        google()
        mavenCentral()
    }
}

// app/build.gradle.kts
dependencies {
    implementation("com.instantdb:instantdb-android:0.8.0")
}
```

## Quick Start

```kotlin
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

## Features

- WebSocket and SSE transports
- Compose integration via `rememberInstantQuery`
- SQLDelight-based offline persistence
- Secure credential storage via Android Keystore
- Reactive queries with `queryFlow`

## Documentation

https://instantdb.com/docs/start-android

## Repository

https://github.com/instantdb/instantdb-android
