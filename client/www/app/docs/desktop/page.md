---
nextjs:
  metadata:
    title: 'Desktop apps'
    description: 'How to use InstantDB in desktop applications — macOS, Windows, and Linux.'
---

InstantDB supports desktop apps on all major operating systems: **macOS, Windows, and Linux**. You have two options:

## Option 1: macOS (native Swift) — recommended for Mac apps

The **InstantDB Swift package** targets macOS 13+ natively. It's the same package as the iOS SDK, with full offline support via SQLite (GRDB).

### Installation (SPM)

In Xcode: **File → Add Package Dependencies…** → URL: `https://github.com/instantdb/instantdb-ios`

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

### Quick Start (macOS native)

```swift {% showCopy=true %}
import InstantDB

let config = InstantDbConfig(
    appId: "YOUR_APP_ID",
    host: "https://apiinstant.fidscript.com",
    useSse: false
)
let db = InstantDb(config: config)
try await db.connect()

// Query
let data = try await db.queryOnce("{ todos: {} }")

// Write
try await db.transact(steps: [
    ["add", "todos", ["text": "Hello from macOS", "done": false]]
])
```

### SwiftUI on macOS

```swift {% showCopy=true %}
import SwiftUI
import InstantDB

struct TodoListView: View {
    @InstantQuery("{ todos: { $: { where: { done: false } } } }")
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
        case .offline: Text("Offline")
        }
    }
}
```

### Persistent cache

- macOS: `~/Library/Application Support/instantdb.sqlite`
- Persists across app launches
- Replay offline mutations on reconnect

## Option 2: Web-based (works on Windows, Linux, and macOS)

Any web SDK works on any desktop OS. Build your desktop app with any web framework:

- **Electron** — Node + Chromium, cross-platform
- **Tauri** — Rust + system webview, lighter weight
- **Neutralino** — Even lighter than Tauri
- **WebView2** (Windows) / **WKWebView** (macOS) / **WebKitGTK** (Linux) — system webviews

### Sample Setup (any web wrapper)

```bash {% showCopy=true %}
npm install @fidscript/instant-sdk
```

```typescript {% showCopy=true %}
// main.ts
import { init } from '@fidscript/instant-sdk';

const db = init({ appId: 'YOUR_APP_ID' });

// Subscribe to live data
db.subscribeQuery({ todos: {} }, (resp) => {
    if (resp.data) renderTodos(resp.data.todos);
});

// Write
db.transact([
    db.tx.todos[id()].update({ text: 'Hello from desktop', done: false })
]);
```

### React on desktop

```bash {% showCopy=true %}
npm install @fidscript/instant-react
```

```tsx {% showCopy=true %}
import { init, i, id, InstantReactDatabase } from '@fidscript/instant-react';

const db = init({ appId: 'YOUR_APP_ID' });

function TodoList() {
    const { isLoading, data } = db.useQuery({ todos: {} });
    if (isLoading) return <Spinner />;
    return <List items={data.todos} />;
}
```

## Cross-platform desktop

The same `appId` works across **all** desktop clients. A todo created on the macOS native app appears in real-time on the Windows web app and the Linux web app:

```
macOS native ────┐
                 │
Windows web ─────┤──> InstantDB VPS ──> All clients see the same data
                 │
Linux web ───────┘
```

## Realtime on desktop

All desktop clients get real-time updates over WebSocket (or SSE fallback):

| Platform | Transport |
|----------|-----------|
| macOS native | `URLSessionWebSocketTask` (Swift) |
| Windows / Linux / macOS web | Browser WebSocket API |
| Electron | Node `ws` library |
| Tauri | Rust `tungstenite` |

## Offline on desktop

| Client | Cache | Offline writes | Auto-resync |
|--------|-------|----------------|-------------|
| macOS native (GRDB) | ✅ SQLite | ✅ queued | ✅ |
| Web in browser (IndexedDB) | ✅ | ❌ | ✅ |
| Electron (with SQLite plugin) | ✅ | ✅ | ✅ |
| Tauri (with rusqlite) | ✅ | ✅ | ✅ |

## Next Steps

- [iOS setup](/docs/start-ios) — same Swift SDK, for mobile
- [Cross-platform data sharing](/docs/cross-platform)
- [Web SDKs](/docs/init) — start with the JS SDK
- [Permissions](/docs/permissions)
