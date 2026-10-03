---
nextjs:
  metadata:
    title: 'Getting started with iOS'
    description: 'How to use InstantDB with iOS (Swift).'
---

You can use InstantDB in your native iOS apps. Below is a complete guide for integrating the InstantDB Swift SDK.

## Requirements

- **iOS 15+** (also runs on macOS 13+, tvOS 15+, watchOS 8+)
- **Swift 5.9+**
- **Xcode 15+** for Swift Package Manager

## What you get

- ⚡ **Real-time sync** — WebSocket primary, automatic SSE fallback
- 💾 **Offline-first** — SQLite cache via GRDB, survives process death
- 🔄 **Optimistic mutations** — Apply locally, persist, replay on reconnect
- 🧩 **SwiftUI** — `@InstantQuery` property wrapper
- 📡 **Combine** — `queryPublisher` for reactive streams
- 🔐 **Keychain** — Secure credential storage
- 🌐 **Cross-platform** — Same `appId` works in web, Android, iOS, etc.

## Installation (Swift Package Manager)

In Xcode:
1. **File → Add Package Dependencies…**
2. Enter the URL: `https://github.com/instantdb/instantdb-ios`
3. Select **InstantDB** and add to your target

In `Package.swift`:
```swift {% showCopy=true %}
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

### 1. Initialize

```swift {% showCopy=true %}
import InstantDB

let config = InstantDbConfig(
    appId: "YOUR_APP_ID",
    host: "https://apiinstant.fidscript.com",
    useSse: false  // true = SSE, false = WebSocket
)

let db = InstantDb(config: config)
```

### 2. Connect

```swift {% showCopy=true %}
Task {
    do {
        try await db.connect()
        print("Connected!")
    } catch {
        print("Failed to connect: \(error)")
    }
}
```

### 3. Query (async/await)

```swift {% showCopy=true %}
let data = try await db.queryOnce("{ todos: { \$: { where: { done: false } } } }")
let todos = (data["todos"] as? [[String: Any]]) ?? []
for todo in todos {
    print(todo["text"] ?? "")
}
```

### 4. Query (Combine)

```swift {% showCopy=true %}
import Combine

let cancellable = db.queryPublisher("{ todos: {} }")
    .sink { data in
        print("Todos updated: \(data)")
    }
```

### 5. Write

```swift {% showCopy=true %}
try await db.transact(steps: [
    [
        "add",
        "todos",
        [
            "text": "Buy milk",
            "done": false,
        ],
    ],
])
```

## SwiftUI

```swift {% showCopy=true %}
import SwiftUI
import InstantDB

@main
struct MyApp: App {
    @StateObject private var appDb = AppDatabase()

    var body: some Scene {
        WindowGroup {
            ContentView().environmentObject(appDb)
        }
    }
}

final class AppDatabase: ObservableObject {
    let db: InstantDb
    init() {
        self.db = InstantDb(config: InstantDbConfig(
            appId: "YOUR_APP_ID",
            host: "https://apiinstant.fidscript.com"
        ))
        Task { try? await db.connect() }
    }
}

struct ContentView: View {
    @EnvironmentObject var appDb: AppDatabase
    @InstantQuery("{ todos: { \$: { where: { done: false } } } }")
    var todos: QueryResult

    var body: some View {
        switch todos {
        case .loading: ProgressView()
        case .data(let data):
            let items = (data["todos"] as? [[String: Any]]) ?? []
            List(items, id: \.["id"]) { todo in
                Text((todo["text"] as? String) ?? "")
            }
        case .error(let msg): Text("Error: \(msg)")
        case .offline: Text("Offline — showing cached data")
        }
    }
}
```

## API Reference

### InstantDbConfig

```swift
public struct InstantDbConfig: Sendable {
    public let appId: String
    public let host: String
    public let useSse: Bool = false
    public let websocketUri: String? = nil
    public let sseUri: String? = nil
    public let schemaVersion: String = "1.0.0"
}
```

### InstantDb

```swift
public init(config: InstantDbConfig, store: LocalStore? = nil)

public func connect() async throws
public func close() async

public func queryOnce(_ query: String) async throws -> [String: Any]
public func queryStream(_ query: String) -> AsyncStream<[String: Any]>
public func queryPublisher(_ query: String) -> AnyPublisher<[String: Any], Never>

public func transact(steps: [[Any]]) async throws

public func replayPending() async throws

public let connectionState: CurrentValueSubject<ConnectionState, Never>
```

### ConnectionState

```swift
public enum ConnectionState: Sendable, Equatable {
    case disconnected
    case connecting
    case connected(TransportType)
    case reconnecting
    case offline
    case error(String)
}
```

### InstantQuery (SwiftUI)

```swift
@propertyWrapper
public struct InstantQuery: DynamicProperty {
    public init(_ query: String)
    public var wrappedValue: QueryResult
}

public enum QueryResult {
    case loading
    case data([String: Any])
    case error(String)
    case offline
}
```

## Choosing a Transport

```swift
// WebSocket (default — fastest, lowest latency)
let config = InstantDbConfig(
    appId: "YOUR_APP_ID",
    host: "https://apiinstant.fidscript.com",
    useSse: false
)

// SSE (for restricted networks or proxies that block WebSockets)
let config = InstantDbConfig(
    appId: "YOUR_APP_ID",
    host: "https://apiinstant.fidscript.com",
    useSse: true
)
```

The SDK auto-reconnects with linear backoff. If WebSocket fails, it falls back to SSE transparently.

## Sharing data with other platforms

The same `appId` works across **iOS, web, Android, React Native, SolidJS, Svelte, Vue, Python, and Kotlin/JVM**. Todos created in the iOS app appear in the web app in real-time, and vice versa. No extra config needed — the backend routes by `appId`.

See [Cross-platform data sharing](/docs/cross-platform) for details.

## Next Steps

- [Cross-platform data sharing](/docs/cross-platform)
- [Getting started with Android](/docs/start-android)
- [Permissions](/docs/permissions)
- [Storage](/docs/storage)

## Troubleshooting

**WebSocket cannot connect** — Check that `host` is correct. Set `useSse = true` to force SSE if your network blocks WebSockets.

**Query results look stale** — The SDK uses targeted invalidation. If your query depends on a different attr than expected, results may not refresh until that attr changes.

**Pending mutations don't reconcile** — Pending mutations are persisted to SQLite and replayed on reconnect. If they remain pending, the server likely rejected them — check the returned error.

**Build error: "No such module 'GRDB'"** — Make sure your `Package.swift` lists `GRDB.swift` as a dependency.
