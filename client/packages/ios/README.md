# iOS SDK

This directory contains the source for the **InstantDB Swift SDK for iOS, macOS, tvOS, and watchOS**.

The SDK is published as a Swift Package: **`https://github.com/instantdb/instantdb-ios`**

## Source layout

```
ios/
└── InstantDB/
    ├── Package.swift          # SPM manifest
    ├── README.md
    ├── Sources/InstantDB/
    │   ├── Core/              # InstantDb, InstantDbConfig, ConnectionState
    │   ├── Transport/         # WebSocket + SSE transports
    │   ├── Persistence/       # SQLite (GRDB) local store
    │   ├── SwiftUI/           # @InstantQuery property wrapper
    │   └── Core/InstantDbError.swift
    ├── Tests/InstantDBTests/  # XCTest unit tests
    └── Examples/InstantDBExample/  # Sample SwiftUI app
```

## Local development

```bash
cd InstantDB
swift build
swift test
open Examples/InstantDBExample/InstantDBExample.xcodeproj
```

## Publishing a new release

1. Bump the version in `Sources/InstantDB/Core/InstantDbConfig.swift` and in `Package.swift` tag references in docs.
2. Tag and push: `git tag 0.8.1 && git push origin 0.8.1`
3. The CI workflow builds, tests, and creates a GitHub release.

## Monorepo

The iOS SDK is developed in the InstantDB monorepo at `client/packages/ios/`. It's published as a standalone SPM package for clean installation. The Android SDK lives at `client/packages/android/` and is published via Maven.

## Documentation

- **Public docs:** https://instant.fidscript.com/docs/start-ios
- **MCP setup guide:** `ios-setup-guide` tool in `@fidscript/instant-mcp@0.6.2+`
