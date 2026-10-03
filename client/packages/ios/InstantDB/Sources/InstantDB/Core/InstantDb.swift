import Foundation
import Combine

/// The main InstantDB client.
///
/// Create one instance per app and reuse it across views, screens, and view controllers.
///
/// ## Example
///
/// ```swift
/// let db = InstantDb(config: InstantDbConfig(
///     appId: "YOUR_APP_ID",
///     host: "https://apiinstant.fidscript.com"
/// ))
/// try await db.connect()
/// ```
public final class InstantDb: @unchecked Sendable {
    public let config: InstantDbConfig
    private let transport: Transport
    private let store: LocalStore
    private let session = URLSession.shared

    // Internal state
    private var receiveTask: Task<Void, Never>?
    private let stateLock = NSLock()
    private var _state: ConnectionState = .disconnected
    private var pendingWaits: [String: CheckedContinuation<TransportMessage, Error>] = [:]
    private var nextId: Int = 0
    private let nextIdLock = NSLock()
    private let messageStream: AsyncStream<TransportMessage>
    private let messageContinuation: AsyncStream<TransportMessage>.Continuation

    /// Combine publisher of connection state changes.
    public let connectionState = CurrentValueSubject<ConnectionState, Never>(.disconnected)

    public init(config: InstantDbConfig, store: LocalStore = (try? LocalStore()) ?? LocalStore.placeholder()) {
        self.config = config
        self.store = store
        if config.useSse {
            self.transport = SseTransport(url: URL(string: config.resolvedSseUri)!)
        } else {
            self.transport = WebSocketTransport(url: URL(string: config.resolvedWebsocketUri)!)
        }
        var continuation: AsyncStream<TransportMessage>.Continuation!
        self.messageStream = AsyncStream { c in continuation = c }
        self.messageContinuation = continuation
    }

    deinit {
        receiveTask?.cancel()
    }

    // MARK: - Connection

    public func connect() async throws {
        stateLock.lock()
        if _state.isConnected || _state == .connecting {
            stateLock.unlock()
            throw InstantDbError.alreadyConnected
        }
        _state = .connecting
        stateLock.unlock()
        connectionState.send(.connecting)

        do {
            try await transport.connect()
            startReceiveLoop()
            let init: [String: Any] = [
                "op": "init",
                "app-id": config.appId,
                "version": config.schemaVersion,
            ]
            try await transport.send(init)
            // The server responds with `init-ok`; we set state to .connected
            // after the first message arrives.
        } catch {
            stateLock.lock()
            _state = .error(error.localizedDescription)
            stateLock.unlock()
            connectionState.send(.error(error.localizedDescription))
            throw error
        }
    }

    public func close() async {
        receiveTask?.cancel()
        await transport.close()
        stateLock.lock()
        _state = .disconnected
        stateLock.unlock()
        connectionState.send(.disconnected)
    }

    // MARK: - Query (async/await)

    /// Execute a one-shot query. Returns the server response payload.
    public func queryOnce(_ query: String) async throws -> [String: Any] {
        let id = nextRequestId()
        let payload: [String: Any] = [
            "op": "add-query",
            "q": ["id": id, "query": query],
        ]
        let response = try await sendAndWait(payload, timeout: .now() + .seconds(15))
        return response
    }

    /// Reactive stream of query results. Emits the initial result, then
    /// emits again on every change relevant to the query.
    public func queryStream(_ query: String) -> AsyncStream<[String: Any]> {
        let id = nextRequestId()
        return AsyncStream { continuation in
            let task = Task { [weak self] in
                guard let self else { return }
                do {
                    let initial = try await self.queryOnce(query)
                    continuation.yield(initial)
                } catch {
                    continuation.finish()
                    return
                }
                // Subscribe for updates
                do {
                    try await self.subscribe(queryId: id, query: query)
                } catch {
                    continuation.finish()
                    return
                }
                for await msg in self.messageStream {
                    if let q = msg["q"] as? [String: Any],
                       let qid = q["id"] as? String,
                       qid == id {
                        continuation.yield(q)
                    }
                }
                continuation.finish()
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }

    // MARK: - Query (Combine)

    /// Reactive Combine publisher of query results.
    public func queryPublisher(_ query: String) -> AnyPublisher<[String: Any], Never> {
        let stream = queryStream(query)
        return StreamToPublisher(stream: stream)
            .receive(on: DispatchQueue.main)
            .eraseToAnyPublisher()
    }

    // MARK: - Transact

    /// Execute a transaction. Steps are arrays of `[op, namespace, ...args]`.
    public func transact(steps: [[Any]]) async throws {
        let id = nextRequestId()
        let payload: [String: Any] = [
            "op": "transact",
            "tx-id": id,
            "steps": steps,
        ]
        // Persist first so we can replay on disconnect
        if let data = try? JSONSerialization.data(withJSONObject: payload, options: []) {
            try? store.enqueueMutation(id: id, payload: data)
        }
        try await sendAndWait(payload, timeout: .now() + .seconds(15))
        try? store.removeMutation(id: id)
    }

    // MARK: - Replay

    /// Replay all pending mutations. Call after reconnect.
    public func replayPending() async throws {
        let pending = (try? store.pendingMutations()) ?? []
        for (id, payload) in pending {
            if let json = try? JSONSerialization.jsonObject(with: payload, options: []) as? [String: Any] {
                do {
                    _ = try await sendAndWait(json, timeout: .now() + .seconds(15))
                    try? store.removeMutation(id: id)
                } catch {
                    try? store.bumpAttempts(id: id)
                    throw error
                }
            }
        }
    }

    // MARK: - Internal

    private func nextRequestId() -> String {
        nextIdLock.lock()
        defer { nextIdLock.unlock() }
        nextId += 1
        return "ios-\(nextId)-\(UUID().uuidString.prefix(8))"
    }

    private func startReceiveLoop() {
        receiveTask?.cancel()
        receiveTask = Task { [weak self] in
            guard let self else { return }
            for await event in self.transport.events() {
                switch event {
                case .open:
                    self.stateLock.lock()
                    self._state = .connected(self.transport.transportType)
                    self.stateLock.unlock()
                    self.connectionState.send(.connected(self.transport.transportType))
                case .message(let msg):
                    if let op = msg["op"] as? String {
                        if op == "init-ok" {
                            self.stateLock.lock()
                            self._state = .connected(self.transport.transportType)
                            self.stateLock.unlock()
                            self.connectionState.send(.connected(self.transport.transportType))
                        } else if op == "error" {
                            let m = (msg["message"] as? String) ?? "unknown"
                            let t = msg["trace-id"] as? String
                            self.connectionState.send(.error(m))
                        }
                    }
                    // Forward to async stream consumers
                    self.messageContinuation.yield(msg)

                    // Resolve any pending waits
                    if let id = msg["tx-id"] as? String {
                        self.stateLock.lock()
                        let cont = self.pendingWaits.removeValue(forKey: id)
                        self.stateLock.unlock()
                        cont?.resume(returning: msg)
                    } else if let q = msg["q"] as? [String: Any],
                              let qid = q["id"] as? String {
                        // Query responses are routed via the message stream,
                        // not via pendingWaits, because the client may want
                        // continuous updates.
                    }
                case .closed(let reason):
                    self.stateLock.lock()
                    self._state = .offline
                    self.stateLock.unlock()
                    self.connectionState.send(.offline)
                    _ = reason // log if needed
                case .error(let msg):
                    self.stateLock.lock()
                    self._state = .error(msg)
                    self.stateLock.unlock()
                    self.connectionState.send(.error(msg))
                }
            }
        }
    }

    private func sendAndWait(_ payload: [String: Any], timeout: DispatchTime) async throws -> [String: Any] {
        try await transport.send(payload)
        let id: String
        if let txid = payload["tx-id"] as? String {
            id = txid
        } else if let q = payload["q"] as? [String: Any], let qid = q["id"] as? String {
            id = qid
        } else {
            // Fire-and-forget
            return [:]
        }
        return try await withCheckedThrowingContinuation { (cont: CheckedContinuation<[String: Any], Error>) in
            self.stateLock.lock()
            self.pendingWaits[id] = cont
            self.stateLock.unlock()
            // Timeout
            DispatchQueue.global().asyncAfter(deadline: .now() + 5) { [weak self] in
                guard let self else { return }
                self.stateLock.lock()
                if let c = self.pendingWaits.removeValue(forKey: id) {
                    self.stateLock.unlock()
                    c.resume(throwing: InstantDbError.timeout)
                } else {
                    self.stateLock.unlock()
                }
            }
        }
    }

    private func subscribe(queryId: String, query: String) async throws {
        let payload: [String: Any] = [
            "op": "subscribe",
            "q": ["id": queryId, "query": query],
        ]
        try await transport.send(payload)
    }
}

// MARK: - Stream → Combine

/// Bridges an AsyncStream to a Combine publisher.
struct StreamToPublisher<T>: Publisher {
    typealias Output = T
    typealias Failure = Never

    let stream: AsyncStream<T>

    func receive<S: Subscriber>(subscriber: S) where S.Input == T, S.Failure == Never {
        let subscription = StreamSubscription(stream: stream, subscriber: AnySubscriber(subscriber))
        subscriber.receive(subscription: subscription)
    }
}

private final class StreamSubscription<T, S: Subscriber>: Subscription, @unchecked Sendable
where S.Input == T, S.Failure == Never {
    private var subscriber: S?
    private var task: Task<Void, Never>?

    init(stream: AsyncStream<T>, subscriber: S) {
        self.subscriber = subscriber
        self.task = Task { [weak self] in
            for await value in stream {
                _ = self?.subscriber?.receive(value)
            }
            self?.subscriber?.receive(completion: .finished)
        }
    }

    func request(_ demand: Subscribers.Demand) {}
    func cancel() {
        task?.cancel()
        task = nil
    }
}

// MARK: - LocalStore placeholder for environments without a writable filesystem

extension LocalStore {
    static func placeholder() -> LocalStore {
        // Last-resort: a no-op store in /tmp
        // In practice, the convenience initializer should always succeed.
        return try! LocalStore(path: NSTemporaryDirectory() + "instantdb-placeholder.sqlite")
    }
}
