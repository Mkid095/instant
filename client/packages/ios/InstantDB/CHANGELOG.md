# Changelog

All notable changes to the InstantDB iOS SDK are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.8.0] - 2026-10-03

### Added
- Initial public release
- Swift Package Manager support (iOS 15+)
- `InstantDb` class with `connect()` / `close()` / `queryOnce()` / `queryStream()` / `queryPublisher()` / `transact()` / `replayPending()`
- `InstantDbConfig` with `appId`, `host`, `useSse`, `websocketUri`, `sseUri`, `schemaVersion`
- `WebSocketTransport` and `SseTransport` (transport polymorphism)
- `LocalStore` backed by GRDB (SQLite) for offline persistence
- `ConnectionState` enum with `connected(TransportType)`, `offline`, `error(String)`, etc.
- `@InstantQuery` SwiftUI property wrapper
- Combine integration via `queryPublisher` → `AnyPublisher`
- Async/await support throughout
- Example SwiftUI app in `Examples/InstantDBExample/`
- XCTest unit tests
- CI workflow (`.github/workflows/ci.yml`)

### Notes
- Same `appId` works across web, Android, iOS, React Native, SolidJS, Svelte, Vue, Python
- Public Maven / docs: `https://instant.fidscript.com`
- Backend API: `https://apiinstant.fidscript.com`
