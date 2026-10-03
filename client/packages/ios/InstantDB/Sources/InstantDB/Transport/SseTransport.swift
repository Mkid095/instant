import Foundation

/// Server-Sent Events transport. Used when `InstantDbConfig.useSse == true`,
/// or as automatic fallback when WebSocket is unavailable.
public final class SseTransport: NSObject, Transport, @unchecked Sendable {
    public let transportType: TransportType = .sse
    private let url: URL
    private let session: URLSession
    private var task: URLSessionDataTask?
    private var continuation: AsyncStream<TransportEvent>.Continuation?
    private var dataBuffer = Data()
    private let lock = NSLock()

    public init(url: URL) {
        self.url = url
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 30
        config.timeoutIntervalForResource = 60 * 60 * 24
        config.requestCachePolicy = .reloadIgnoringLocalCacheData
        self.session = URLSession(configuration: config)
        super.init()
    }

    deinit {
        task?.cancel()
    }

    public func connect() async throws {
        var request = URLRequest(url: url)
        request.setValue("text/event-stream", forHTTPHeaderField: "Accept")
        request.setValue("no-cache", forHTTPHeaderField: "Cache-Control")
        request.timeoutInterval = 60 * 60 * 24

        let (bytes, response) = try await session.bytes(for: request)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            throw InstantDbError.serverError("SSE handshake failed", traceId: nil)
        }
        continuation?.yield(.open)
        for try await line in bytes.lines {
            if line.isEmpty {
                // Dispatch event
                if let event = parseEvent(data: dataBuffer) {
                    continuation?.yield(event)
                }
                dataBuffer.removeAll()
            } else if line.hasPrefix("data:") {
                let payload = line.dropFirst("data:".count).trimmingCharacters(in: .whitespaces)
                if let d = payload.data(using: .utf8) {
                    dataBuffer.append(d)
                }
            }
            // Ignore "event:", "id:", "retry:" lines for now.
        }
    }

    public func send(_ message: TransportMessage) async throws {
        // SSE is one-way; for two-way communication, the client must POST
        // back to the server. The base InstantDB protocol uses POST for
        // this; we forward via URLSession.shared.
        let data = try JSONSerialization.data(withJSONObject: message, options: [])
        var request = URLRequest(url: url.appendingPathComponent("session"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = data
        _ = try await URLSession.shared.data(for: request)
    }

    public func close() async {
        task?.cancel()
        task = nil
        continuation?.finish()
        continuation = nil
    }

    public func events() -> AsyncStream<TransportEvent> {
        AsyncStream { continuation in
            self.continuation = continuation
            continuation.onTermination = { @Sendable _ in
                self.task?.cancel()
            }
        }
    }

    private func parseEvent(data: Data) -> TransportEvent? {
        guard !data.isEmpty,
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            return nil
        }
        return .message(json)
    }
}
