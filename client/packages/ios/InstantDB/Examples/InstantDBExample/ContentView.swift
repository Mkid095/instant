import SwiftUI
import InstantDB

@main
struct InstantDBExampleApp: App {
    @StateObject private var db = AppDatabase.shared

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(db)
        }
    }
}

final class AppDatabase: ObservableObject {
    static let shared = AppDatabase()
    let db: InstantDb

    private init() {
        // Replace with your own app id before running.
        let config = InstantDbConfig(
            appId: "YOUR_APP_ID",
            host: "https://apiinstant.fidscript.com",
            useSse: false
        )
        self.db = InstantDb(config: config)
        Task { try? await db.connect() }
    }
}

struct ContentView: View {
    @EnvironmentObject var appDb: AppDatabase

    @InstantQuery("{ todos: { $: { where: { done: false } } } }")
    var todos: QueryResult

    var body: some View {
        NavigationStack {
            Group {
                switch todos {
                case .loading:
                    ProgressView()
                case .data(let data):
                    let items = (data["todos"] as? [[String: Any]]) ?? []
                    List(items, id: \.["id"]) { todo in
                        Text((todo["text"] as? String) ?? "")
                    }
                case .error(let msg):
                    Text("Error: \(msg)")
                case .offline:
                    Text("Offline — showing cached data")
                }
            }
            .navigationTitle("Todos")
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    Button("Add") {
                        Task {
                            try? await appDb.db.transact(steps: [
                                [
                                    "add",
                                    "todos",
                                    [
                                        "text": "Hello from iOS at \(Date())",
                                        "done": false,
                                    ],
                                ],
                            ])
                        }
                    }
                }
            }
        }
    }
}
