---
nextjs:
  metadata:
    title: 'Cross-platform data sharing'
    description: 'Share data between Android, web, iOS, and any other InstantDB client.'
---

InstantDB is built for cross-platform data sharing. The same `appId` works across **Android, web, iOS, React Native, SolidJS, Svelte, Vue, Python, and Kotlin/JVM** — they all read and write to the same database.

## How it works

Every InstantDB client (Android, web, iOS, etc.) connects to your InstantDB backend using the same `appId`. The backend routes reads, writes, and real-time updates to every connected client.

```
┌─────────────┐         ┌──────────────────┐         ┌─────────────┐
│ Android App │ ──────> │  InstantDB VPS   │ <────── │  Web App    │
│ (Kotlin)    │ <─────  │  (your appId)    │  ─────> │  (JS)       │
└─────────────┘         └──────────────────┘         └─────────────┘
       │                          │                          │
       └───── same appId ─────────┴───── same appId ────────┘
                same database, real-time sync
```

## Example: Shared todo list

### Android (Kotlin)

```kotlin
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

```javascript
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

## Verify it works

Run the verification:
1. Open the web app in one browser tab
2. Open the Android app on a connected device
3. Add a todo in either — it appears in the other within milliseconds

## Authentication

Users created on one platform are visible on all platforms because auth is also keyed by `appId`. A user who signs in via magic code on the web app can be queried from the Android app.

## Cross-platform storage

Files uploaded from any client (web, Android, iOS) all live in the same storage provider (Cloudinary, R2, S3) and are served from the same URLs. A photo uploaded from the Android app is downloadable by the web app.

## Live verification

This feature is verified in the live deployment at https://instantdb.com. Use the demo apps to see it in action.
