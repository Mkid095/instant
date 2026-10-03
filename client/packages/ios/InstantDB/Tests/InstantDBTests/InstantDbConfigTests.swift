import XCTest
@testable import InstantDB

final class InstantDbConfigTests: XCTestCase {
    func testResolvedWebsocketUriHttps() {
        let config = InstantDbConfig(
            appId: "test",
            host: "https://apiinstant.fidscript.com"
        )
        XCTAssertEqual(
            config.resolvedWebsocketUri,
            "wss://apiinstant.fidscript.com/runtime/session"
        )
    }

    func testResolvedWebsocketUriHttp() {
        let config = InstantDbConfig(
            appId: "test",
            host: "http://localhost:8888"
        )
        XCTAssertEqual(
            config.resolvedWebsocketUri,
            "ws://localhost:8888/runtime/session"
        )
    }

    func testResolvedSseUri() {
        let config = InstantDbConfig(
            appId: "test",
            host: "https://apiinstant.fidscript.com"
        )
        XCTAssertEqual(
            config.resolvedSseUri,
            "https://apiinstant.fidscript.com/runtime/sse"
        )
    }

    func testTrailingSlashStripped() {
        let config = InstantDbConfig(
            appId: "test",
            host: "https://apiinstant.fidscript.com/"
        )
        XCTAssertEqual(config.host, "https://apiinstant.fidscript.com")
    }

    func testWebsocketOverride() {
        let config = InstantDbConfig(
            appId: "test",
            host: "https://apiinstant.fidscript.com",
            websocketUri: "wss://custom.example.com/ws"
        )
        XCTAssertEqual(
            config.resolvedWebsocketUri,
            "wss://custom.example.com/ws"
        )
    }
}

final class ConnectionStateTests: XCTestCase {
    func testIsConnectedTrueForConnected() {
        XCTAssertTrue(ConnectionState.connected(.websocket).isConnected)
        XCTAssertTrue(ConnectionState.connected(.sse).isConnected)
    }

    func testIsConnectedFalseForOtherStates() {
        XCTAssertFalse(ConnectionState.disconnected.isConnected)
        XCTAssertFalse(ConnectionState.connecting.isConnected)
        XCTAssertFalse(ConnectionState.reconnecting.isConnected)
        XCTAssertFalse(ConnectionState.offline.isConnected)
        XCTAssertFalse(ConnectionState.error("oops").isConnected)
    }
}
