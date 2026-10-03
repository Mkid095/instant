import Foundation
import GRDB

/// Local SQLite cache. Backed by GRDB.
///
/// Stores:
/// - `triples` — the materialized state of the app's data
/// - `attrs` — attribute metadata (id, type, indexed?, etc.)
/// - `pending_mutations` — mutations that haven't been ack'd by the server
///
/// On reconnect, pending mutations are replayed in order.
public final class LocalStore: @unchecked Sendable {
    private let dbQueue: DatabaseQueue

    public init(path: String) throws {
        let url = URL(fileURLWithPath: path)
        var config = Configuration()
        config.label = "instantdb"
        self.dbQueue = try DatabaseQueue(path: url.path, configuration: config)
        try migrate()
    }

    public convenience init() throws {
        let dir = try FileManager.default
            .url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
        let path = dir.appendingPathComponent("instantdb.sqlite").path
        try self.init(path: path)
    }

    private func migrate() throws {
        var migrator = DatabaseMigrator()

        migrator.registerMigration("v1") { db in
            try db.create(table: "triples") { t in
                t.column("id", .text).primaryKey()
                t.column("namespace", .text).notNull()
                t.column("data", .blob).notNull()
                t.column("updated_at", .datetime).notNull()
            }
            try db.create(table: "attrs") { t in
                t.column("id", .text).primaryKey()
                t.column("forward_identity", .text).notNull()
                t.column("value_type", .text).notNull()
                t.column("inferred_types", .text)
            }
            try db.create(table: "pending_mutations") { t in
                t.column("id", .text).primaryKey()
                t.column("payload", .blob).notNull()
                t.column("created_at", .datetime).notNull()
                t.column("attempts", .integer).notNull().defaults(to: 0)
            }
        }

        try migrator.migrate(dbQueue)
    }

    // MARK: - Triples

    public func upsertTriple(id: String, namespace: String, data: Data) throws {
        try dbQueue.write { db in
            try db.execute(sql: """
                INSERT INTO triples (id, namespace, data, updated_at) VALUES (?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET namespace = excluded.namespace, data = excluded.data, updated_at = excluded.updated_at
                """, arguments: [id, namespace, data, Date()])
        }
    }

    public func triples(in namespace: String) throws -> [(id: String, data: Data)] {
        try dbQueue.read { db in
            let rows = try Row.fetchAll(db, sql: "SELECT id, data FROM triples WHERE namespace = ?", arguments: [namespace])
            return rows.map { (id: $0["id"] as String, data: $0["data"] as Data) }
        }
    }

    // MARK: - Pending mutations

    public func enqueueMutation(id: String, payload: Data) throws {
        try dbQueue.write { db in
            try db.execute(sql: "INSERT INTO pending_mutations (id, payload, created_at, attempts) VALUES (?, ?, ?, 0)",
                           arguments: [id, payload, Date()])
        }
    }

    public func pendingMutations() throws -> [(id: String, payload: Data)] {
        try dbQueue.read { db in
            let rows = try Row.fetchAll(db, sql: "SELECT id, payload FROM pending_mutations ORDER BY created_at ASC")
            return rows.map { (id: $0["id"] as String, payload: $0["payload"] as Data) }
        }
    }

    public func removeMutation(id: String) throws {
        try dbQueue.write { db in
            try db.execute(sql: "DELETE FROM pending_mutations WHERE id = ?", arguments: [id])
        }
    }

    public func bumpAttempts(id: String) throws {
        try dbQueue.write { db in
            try db.execute(sql: "UPDATE pending_mutations SET attempts = attempts + 1 WHERE id = ?", arguments: [id])
        }
    }
}
