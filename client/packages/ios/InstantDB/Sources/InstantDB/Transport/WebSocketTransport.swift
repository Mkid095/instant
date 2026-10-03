import Foundation

/// WebSocket transport. Used when `InstantDbConfig.useSse == false` (the default).
public final class WebSocketTransport: NSObject, Transport, @unchecked Sendable {
    public let transportType: TransportType = .websocket
    private let url: URL
    private let session: URLSession
    private var task: URLSessionWebSocketTask?
    private var continuation: AsyncStream<TransportEvent>.Continuation?
    private let lock = NSLock()
    private let decoder = JSONDecoder()

    public init(url: URL) {
        self.url = url
        let config = URLSessionConfiguration.default
        config.waitsForConnectivity = true
        config.timeoutIntervalForRequest = 30
        config.timeoutIntervalForResource = 60 * 60 * 24 // 24h long-lived WS
        self.session = URLSession(configuration: config)
        super.init()
    }

    deinit {
        // Synchronous best-effort cleanup.
        task?.cancel(with: .goingAway, reason: nil)
    }

    public func connect() async throws {
        try await withCheckedThrowingContinuation { (cont: CheckedContinuation<Void, Error>) in
            let task = session.webSocketTask(with: url)
            self.task = task
            task.resume()

            // URLSessionWebSocketTask does not expose a connect callback, so we
            // rely on the first receive call to surface failures.
            // We do however receive the .open event in the events() stream.
            cont.resume()
        }
    }

    public func send(_ message: TransportMessage) async throws {
        guard let task = self.task else {
            throw InstantDbError.notConnected
        }
        let data = try JSONSerialization.data(withJSONObject: message, options: [])
        guard let str = String(data: data, encoding: .utf8) else {
            throw InstantDbError.encoding
        }
        try await task.send(.string(str))
    }

    public func close() async {
        task?.cancel(with: .normalClosure, reason: nil)
        task = nil
        continuation?.finish()
        continuation = nil
    }

    public func events() -> AsyncStream<TransportEvent> {
        AsyncStream { continuation in
            self.continuation = continuation
            continuation.onTermination = { @Sendable _ in
                self.task?.cancel(with: .goingAway, reason: nil)
            }
            self.startReceiveLoop()
            self.startPingLoop()
        }
    }

    private func startReceiveLoop() {
        guard let task = self.task else { return }
        Task { [weak self] in
            while !Task.isCancelled {
                do {
                    let msg = try await task.receive()
                    let event: TransportEvent
                    switch msg {
                    case .string(let str):
                        if let data = str.data(using: .utf8),
                           let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
                            event = .message(json)
                        } else {
                            continue
                        }
                    case .data(let data):
                        if let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
                            event = .message(json)
                        } else {
                            continue
                        }
                    @unknown default:
                        continue
                    }
                    self?.continuation?.yield(event)
                } catch {
                    self?.continuation?.yield(.closed(reason: error.localizedDescription))
                    self?.continuation?.finish()
                    return
                }
            }
        }
    }

    private func startPingLoop() {
        // URLSessionWebSocketTask handles pings internally; nothing to do.
    }
}

/// Errors thrown by the SDK.
public enum InstantDbError: Error, LocalizedError {
    case notConnected
    case alreadyConnected
    case encoding
    case decoding(String)
    case serverError(String, traceId: String?)
    case timeout
    case invalidQuery(String)

    public var errorDescription: String? {
        switch self {
        case .notConnected: return "The SDK is not connected. Call connect() first."
        case .alreadyConnected: return "The SDK is already connected."
        case .encoding: return "Failed to encode JSON message."
        case .decoding(let m): return "Failed to decode server message: \(m)"
        case .serverError(let m, let t): return "Server error: \(m)\(t.map { " (trace: \($0))" } ?? "")"
        case .timeout: return "Operation timed out."
        case .invalidQuery(let m): return "Invalid query: \(m)"
        }
    }
}
