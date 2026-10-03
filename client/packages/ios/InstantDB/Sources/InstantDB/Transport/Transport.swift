import Foundation

/// A message from the transport (decoded JSON object).
public typealias TransportMessage = [String: Any]

/// Events emitted by a Transport as a connection's lifecycle progresses.
public enum TransportEvent: Sendable {
    case open
    /// Server-pushed message (decoded).
    case message(TransportMessage)
    /// Transport closed (possibly with an error description).
    case closed(reason: String?)
    /// Transport-level error.
    case error(String)
}

/// Abstraction over the realtime transport.
///
/// The SDK supports two concrete transports: WebSocket (primary) and SSE (fallback).
/// They expose the same async stream of `TransportEvent`s so the higher-level
/// `InstantDb` does not need to know which one is in use.
public protocol Transport: AnyObject, Sendable {
    /// Open the connection. Throws if it cannot be opened.
    func connect() async throws

    /// Send a message to the server (decoded JSON object).
    func send(_ message: TransportMessage) async throws

    /// Close the connection cleanly.
    func close() async

    /// Async sequence of events for the lifetime of the transport.
    /// Cancelling the consuming Task closes the transport.
    func events() -> AsyncStream<TransportEvent>

    /// The transport type this implementation represents.
    var transportType: TransportType { get }
}
