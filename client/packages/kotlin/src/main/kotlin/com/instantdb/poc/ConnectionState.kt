package com.instantdb.poc

/**
 * Connection lifecycle states.
 *
 * Source of truth: client/packages/core/src/Reactor.js:47-53
 *
 *   STATUS = {
 *     CONNECTING: 'connecting',
 *     OPENED:     'opened',
 *     AUTHENTICATED: 'authenticated',
 *     CLOSED:     'closed',
 *     ERRORED:    'errored',
 *   }
 *
 * We extend the JS set with two additional states that the JS code
 * tracks via flags rather than enum values:
 *
 *   RECONNECTING — between DISCONNECTED and the next CONNECTING;
 *                  `_scheduleReconnect` is armed and waiting.
 *   CLOSED       — terminal, after user called shutdown(). Distinct
 *                  from CLOSED-by-network which is recoverable.
 */
enum class ConnectionState {
    Disconnected,    // No socket; cold start or post-network-failure
    Connecting,      // TCP/WS handshake in progress
    Initializing,    // WebSocket open; awaiting init-ok
    Connected,       // init-ok received; subscriptions active
    Reconnecting,    // Network failed; waiting to retry
    Closed,          // Terminal — user invoked shutdown()
    Errored,         // Fatal error (e.g., protocol violation)
}

/**
 * Reason for a state transition. The JS Reactor does not explicitly
 * carry this — it just sets the new state. We add it for testability
 * and for diagnostics.
 */
enum class ConnectionEvent {
    StartConnect,        // user-driven connect()
    SocketOpen,          // WS handshake completed
    InitOk,              // init-ok received
    SocketClose,         // WS closed (network or server-initiated)
    SocketError,         // WS transport error
    NetworkOnline,       // NetworkListener reports online
    NetworkOffline,      // NetworkListener reports offline
    ScheduleReconnect,   // backoff timer started
    Shutdown,            // user invoked shutdown()
    FatalProtocolError,  // unrecoverable (e.g., server version mismatch)
}
