import Foundation

/// Which transport the SDK is currently using.
public enum TransportType: String, Sendable {
    case unknown
    case websocket
    case sse
}

/// The lifecycle state of the connection to the InstantDB backend.
public enum ConnectionState: Sendable, Equatable {
    case disconnected
    case connecting
    case connected(TransportType)
    case reconnecting
    case offline
    case error(String)

    public var isConnected: Bool {
        if case .connected = self { return true }
        return false
    }
}

/// A single (namespace, id, attrs) triple returned from a query.
public typealias Triple = [String: Any]

/// Decoded JSON value returned from a query.
public typealias JsonObject = [String: Any]

/// A single transaction step.
public typealias TransactionStep = [Any]
