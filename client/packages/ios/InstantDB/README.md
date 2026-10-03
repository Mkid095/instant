# InstantDB for iOS / Swift

Native Swift SDK for [InstantDB](https://www.instantdb.com) — a reactive graph database with real-time sync, offline support, and the same `appId` shared across web, Android, iOS, React Native, and more.

## Requirements

- **iOS 15+** (also runs on macOS 13+, tvOS 15+, watchOS 8+)
- **Swift 5.9+**
- **Xcode 15+** for SPM

## Installation (Swift Package Manager)

In Xcode:
1. **File → Add Package Dependencies…**
2. Enter the repo URL: `https://github.com/instantdb/instantdb-ios`
3. Select **InstantDB** and add to your target

In `Package.swift`:
```swift
dependencies: [
    .package(url: "https://github.com/instantdb/instantdb-ios.git", from: "0.8.0"),
],
targets: [
    .target(
        name: "YourApp",
        dependencies: [
            .product(name: "InstantDB", package: "instantdb-ios"),
        ]),
]
```

## Quick Start

```swift
import InstantDB

// 1. Configure
let config = InstantDbConfig(
    appId: "YOUR_APP_ID",
    host: "https://apiinstant.fidscript.com",
    useSse: false  // true = SSE, false = WebSocket
)

// 2. Initialize
let db = InstantDb(config: config)

// 3. Connect
Task {
    try await db.connect()
}

// 4. Query (async/await)
let data = try await db.queryOnce("{ todos: { \$: { where: { done: false } } } }")

// 5. Subscribe (Combine)
let cancellable = db.queryPublisher("{ todos: {} }")
    .sink { data in
        print("Todos updated: \(data)")
    }

// 6. Write
try await db.transact(steps: [
    ["add", "todos", ["text": "Buy milk", "done": false]]
])
```

## SwiftUI

```swift
import InstantDB
import SwiftUI

struct TodoListView: View {
    @InstantQuery("{ todos: { \$: { where: { done: false } } } }")
    var todos: QueryResult

    var body: some View {
        switch todos {
        case .loading: ProgressView()
        case .data(let data): List(data.todos) { todo in Text(todo.text) }
        case .error(let msg): Text("Error: \(msg)")
        case .offline: Text("Offline")
        }
    }
}
```

## Features

- ⚡ **Real-time sync** — WebSocket primary, automatic SSE fallback
- 💾 **Offline-first** — SQLite cache via GRDB, survives process death
- 🔄 **Optimistic mutations** — Apply locally, persist, replay on reconnect
- 🧩 **SwiftUI** — `@InstantQuery` property wrapper
- 📡 **Combine** — `queryPublisher` for reactive streams
- 🔐 **Secure storage** — Keychain-backed credential storage
- 🌐 **Cross-platform** — Same `appId` works in web, Android, iOS, etc.

## Documentation

- **Public docs:** https://instant.fidscript.com/docs/start-ios
- **API reference:** https://instant.fidscript.com/docs
- **Cross-platform:** https://instant.fidscript.com/docs/cross-platform

## Repository

https://github.com/instantdb/instantdb-ios

## License

MIT
