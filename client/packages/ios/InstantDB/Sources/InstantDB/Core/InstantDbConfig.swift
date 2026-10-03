import Foundation

/// Configuration for an InstantDb instance.
///
/// Mirrors the Kotlin `InstantDbConfig` and the JS `init({ appId, ... })` options.
public struct InstantDbConfig: Sendable {
    /// Your InstantDB app id (UUID).
    public let appId: String

    /// API host (e.g. "https://apiinstant.fidscript.com"). Do NOT include a trailing slash.
    public let host: String

    /// When `true`, the SDK connects via Server-Sent Events instead of WebSocket.
    /// Default: `false` (WebSocket).
    public let useSse: Bool

    /// WebSocket URI override. If unset, derived from `host` as `wss://<host>/runtime/session`.
    public let websocketUri: String?

    /// SSE URI override. If unset, derived from `host` as `<host>/runtime/sse`.
    public let sseUri: String?

    /// Optional schema version. Default: "1.0.0".
    public let schemaVersion: String

    public init(
        appId: String,
        host: String,
        useSse: Bool = false,
        websocketUri: String? = nil,
        sseUri: String? = nil,
        schemaVersion: String = "1.0.0"
    ) {
        self.appId = appId
        self.host = host.hasSuffix("/") ? String(host.dropLast()) : host
        self.useSse = useSse
        self.websocketUri = websocketUri
        self.sseUri = sseUri
        self.schemaVersion = schemaVersion
    }

    /// Derived WebSocket URL: wss://<host>/runtime/session (or the override).
    public var resolvedWebsocketUri: String {
        if let override = websocketUri { return override }
        let ws = host
            .replacingOccurrences(of: "https://", with: "wss://")
            .replacingOccurrences(of: "http://", with: "ws://")
        return "\(ws)/runtime/session"
    }

    /// Derived SSE URL: <host>/runtime/sse (or the override).
    public var resolvedSseUri: String {
        if let override = sseUri { return override }
        return "\(host)/runtime/sse"
    }
}
