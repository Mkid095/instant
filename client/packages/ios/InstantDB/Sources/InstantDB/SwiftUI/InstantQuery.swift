import Foundation
import SwiftUI

/// The result of a query, mirroring the Kotlin `InstantQueryState` sealed class.
public enum QueryResult {
    case loading
    case data([String: Any])
    case error(String)
    case offline
}

/// Property wrapper for SwiftUI. Mirrors the Kotlin `rememberInstantQuery` Composable.
///
/// Lifecycle-aware: cancels the subscription when the view disappears.
/// Auto-reconnects when the connection drops.
///
/// ## Example
///
/// ```swift
/// struct TodoListView: View {
///     @InstantQuery("{ todos: { $: { where: { done: false } } } }")
///     var todos: QueryResult
///
///     var body: some View {
///         switch todos {
///         case .loading: ProgressView()
///         case .data(let data):
///             let items = data["todos"] as? [[String: Any]] ?? []
///             List(items, id: \.["id"]) { todo in
///                 Text(todo["text"] as? String ?? "")
///             }
///         case .error(let msg): Text("Error: \(msg)")
///         case .offline: Text("Offline")
///         }
///     }
/// }
/// ```
@propertyWrapper
public struct InstantQuery: DynamicProperty {
    let query: String
    @StateObject private var holder: QueryHolder

    public init(_ query: String) {
        self.query = query
        self._holder = StateObject(wrappedValue: QueryHolder(query: query))
    }

    public var wrappedValue: QueryResult {
        holder.result
    }

    public var projectedValue: Binding<QueryResult> {
        Binding(get: { holder.result }, set: { holder.result = $0 })
    }
}

/// Holds the latest query result. Backs the `@InstantQuery` property wrapper.
@MainActor
final class QueryHolder: ObservableObject {
    @Published var result: QueryResult = .loading
    private let query: String
    private var task: Task<Void, Never>?

    init(query: String) {
        self.query = query
    }

    func start(db: InstantDb) {
        cancel()
        task = Task { [weak self] in
            guard let self else { return }
            for await data in db.queryStream(self.query) {
                if Task.isCancelled { return }
                if let err = data["error"] as? String {
                    self.result = .error(err)
                } else {
                    self.result = .data(data)
                }
            }
            // Stream ended
            if !Task.isCancelled {
                self.result = .offline
            }
        }
    }

    func cancel() {
        task?.cancel()
        task = nil
    }

    deinit {
        task?.cancel()
    }
}

/// A SwiftUI view modifier that wires up the query holder when the view appears.
public struct InstantQueryModifier: ViewModifier {
    let db: InstantDb
    @ObservedObject var holder: QueryHolder

    public func body(content: Content) -> some View {
        content
            .onAppear { holder.start(db: db) }
            .onDisappear { holder.cancel() }
    }
}

public extension View {
    /// Binds an `InstantQuery` to a specific `InstantDb` instance.
    ///
    /// Use this when the property wrapper alone doesn't have access to the
    /// db instance (e.g. when you have multiple `db` instances or want to
    /// reuse the same db across views).
    func instantQuery(_ query: String, db: InstantDb) -> some View {
        modifier(InstantQueryModifier(db: db, holder: QueryHolder(query: query)))
    }
}
