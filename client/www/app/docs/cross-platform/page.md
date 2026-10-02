---
nextjs:
  metadata:
    title: 'Cross-platform data sharing'
    description: 'Share data between Android, web, iOS, React Native, and more.'
---

InstantDB is built for cross-platform data sharing. The same `appId` works across **Android, web, iOS, React Native, SolidJS, Svelte, Vue, Python, and Kotlin/JVM** — every client reads and writes to the same database, in real-time.

## How It Works

```
┌─────────────┐         ┌──────────────────┐         ┌─────────────┐
│ Android App │ ──────> │  InstantDB VPS   │ <────── │  Web App    │
│ (Kotlin)    │ <─────  │  (your appId)    │  ─────> │  (JS/TS)    │
└─────────────┘         └──────────────────┘         └─────────────┘
       │                          │                          │
       └───── same appId ─────────┴───── same appId ────────┘
                same database, real-time sync
```

Every client connects to the same backend using the same `appId`. The backend routes reads, writes, and real-time updates to every connected client.

## Example: Shared Todo List

### Android (Kotlin)

```kotlin {% showCopy=true %}
// app/build.gradle.kts
dependencies {
    implementation("com.instantdb:instantdb-android:0.8.0-phase10")
}

val db = InstantDb(
    context = this,
    config = InstantDbConfig(
        appId = "YOUR_APP_ID",   // ← same appId as the web app
        host = "https://api.instantdb.com",
        useSse = false
    )
)
db.connect()
db.transact(listOf(listOf(
    "add", "todos",
    mapOf("text" to "From Android", "done" to false)
)))
```

### Web (JavaScript / TypeScript)

```javascript {% showCopy=true %}
// Same appId
import { init, id } from '@fidscript/instant-sdk';

const db = init({ appId: 'YOUR_APP_ID' });

db.subscribeQuery({ todos: {} }, (resp) => {
    console.log(resp.data.todos);
    // Will show the todo created from the Android app
});

db.transact(
    db.tx.todos[id()].update({ text: 'From web', done: false })
);
// The Android app will receive this in real-time
```

## What is shared

| Feature | Cross-platform? | Notes |
|---------|----------------|-------|
| **Data** | ✅ Yes | Same `appId` = same database |
| **Auth** | ✅ Yes | Users created on any platform are visible everywhere |
| **Permissions** | ✅ Yes | `perms` are server-side and apply to all clients |
| **Schema** | ✅ Yes | Defined once on the server, used by all clients |
| **Storage** | ✅ Yes | Files uploaded from any client are downloadable by any client |
| **Real-time** | ✅ Yes | All clients see each other's changes within milliseconds |

## Verify it works

1. Open the web app in one browser tab.
2. Open the Android app on a connected device or emulator.
3. Add a todo in either — it appears in the other within milliseconds.

## Auth is also shared

A user who signs in via magic code on the web app can be queried from the Android app — the same auth, the same database. Storage tokens issued to one client are valid on all clients.

## Storage is also shared

Files uploaded from any client (web, Android, iOS) all live in the same storage provider (Cloudinary, R2, S3) and are served from the same URLs. A photo uploaded from the Android app is downloadable from the web app with the same URL.

## Next Steps

- [Getting started with Android](/docs/start-android)
- [Getting started with React Native](/docs/start-rn)
- [Storage](/docs/storage)
- [Auth](/docs/auth)
