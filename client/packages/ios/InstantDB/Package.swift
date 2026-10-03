// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "InstantDB",
    platforms: [
        .iOS(.v15),
        .macOS(.v13),
        .tvOS(.v15),
        .watchOS(.v8),
    ],
    products: [
        .library(
            name: "InstantDB",
            targets: ["InstantDB"]),
    ],
    dependencies: [
        // SQLite-based persistence. GRDB is a lightweight, well-maintained
        // wrapper around SQLite. It provides migrations, observability,
        // and a Swift-native API.
        .package(url: "https://github.com/groue/GRDB.swift.git", from: "6.29.0"),
    ],
    targets: [
        .target(
            name: "InstantDB",
            dependencies: [
                .product(name: "GRDB", package: "GRDB.swift"),
            ],
            path: "Sources/InstantDB"
        ),
        .testTarget(
            name: "InstantDBTests",
            dependencies: ["InstantDB"],
            path: "Tests/InstantDBTests"
        ),
    ]
)
