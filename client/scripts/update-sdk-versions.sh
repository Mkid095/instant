#!/usr/bin/env bash
# Update SDK versions in client/lib/sdk-versions.ts from npm/Maven/GitHub.
#
# Usage:
#   ./scripts/update-sdk-versions.sh
#
# Sources (in order of preference):
#   - @fidscript/instant-mcp (npm)
#   - @fidscript/instant-sdk (npm)
#   - com.instantdb:instantdb-android (Maven, with local fallback)
#   - com.instantdb:instantdb-kotlin (Maven, with local fallback)
#   - InstantDB iOS SDK (GitHub releases, with Package.swift fallback)
#
# After running, rebuild the docs.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VERSIONS_FILE="$SCRIPT_DIR/../lib/sdk-versions.ts"
DASH_HOST="${INSTANT_DASH_HOST:-https://instant.fidscript.com}"
MAVEN_HOST="${INSTANT_MAVEN_HOST:-https://instant.fidscript.com/maven}"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

echo "Fetching latest versions..."

# npm packages
MCP_VERSION=$(npm view "@fidscript/instant-mcp" version 2>/dev/null || echo "0.0.0")
WEB_VERSION=$(npm view "@fidscript/instant-sdk" version 2>/dev/null || echo "0.0.0")

# Maven — try the public metadata first, fall back to the local
# published version in /home/ken/m2_test/repository and the build.gradle.kts
ANDROID_VERSION=$(curl -sf "$MAVEN_HOST/com/instantdb/instantdb-android/maven-metadata.xml" 2>/dev/null | grep -oP '<release>\K[^<]+' | head -1 || true)
if [ -z "$ANDROID_VERSION" ]; then
    ANDROID_VERSION=$(grep '^version' "$REPO_ROOT/packages/android/instantdb-android/build.gradle.kts" 2>/dev/null | head -1 | sed 's/.*"\(.*\)".*/\1/' || echo "0.0.0")
fi
if [ "$ANDROID_VERSION" = "0.0.0" ]; then
    ANDROID_VERSION=$(ls "$HOME/m2_test/repository/com/instantdb/instantdb-android/" 2>/dev/null | grep -v "\.xml" | head -1 || echo "0.0.0")
fi

KOTLIN_VERSION=$(curl -sf "$MAVEN_HOST/com/instantdb/instantdb-kotlin/maven-metadata.xml" 2>/dev/null | grep -oP '<release>\K[^<]+' | head -1 || true)
if [ -z "$KOTLIN_VERSION" ]; then
    KOTLIN_VERSION=$(grep '^version' "$REPO_ROOT/packages/android/instantdb-kotlin/build.gradle.kts" 2>/dev/null | head -1 | sed 's/.*"\(.*\)".*/\1/' || echo "0.0.0")
fi
if [ "$KOTLIN_VERSION" = "0.0.0" ]; then
    KOTLIN_VERSION=$(ls "$HOME/m2_test/repository/com/instantdb/instantdb-kotlin/" 2>/dev/null | grep -v "\.xml" | head -1 || echo "0.0.0")
fi

# iOS — try GitHub releases first, fall back to local Package.swift
IOS_VERSION=$(curl -sf "https://api.github.com/repos/instantdb/instantdb-ios/releases/latest" 2>/dev/null | grep -oP '"tag_name":\s*"\K[^"]+' | head -1 | sed 's/^v//' || true)
if [ -z "$IOS_VERSION" ]; then
    # Use the first version in the iOS CHANGELOG, if any
    IOS_VERSION=$(grep -oP '"0\.\d+\.\d+(-[a-z0-9]+)?' "$REPO_ROOT/packages/ios/InstantDB/CHANGELOG.md" 2>/dev/null | head -1 || true)
fi
IOS_VERSION="${IOS_VERSION:-0.8.0}"

echo "  MCP:        $MCP_VERSION"
echo "  Web SDK:    $WEB_VERSION"
echo "  Android:    $ANDROID_VERSION"
echo "  Kotlin:     $KOTLIN_VERSION"
echo "  iOS:        $IOS_VERSION"

cat > "$VERSIONS_FILE" << EOF
/**
 * SDK Version Registry
 *
 * Single source of truth for SDK version numbers. To update SDK versions,
 * either edit the values below or run \`./scripts/update-sdk-versions.sh\`.
 *
 * Why this exists:
 *   - We don't want to grep 50+ doc files every release
 *   - We don't want to hardcode \`@fidscript/instant-mcp@0.6.1\` in
 *     markdown files, source code, AND dashboard components
 *   - The values below are read from the npm/Maven/GitHub registries
 */

export const MCP_VERSION = "$MCP_VERSION";
export const ANDROID_SDK_VERSION = "$ANDROID_VERSION";
export const KOTLIN_SDK_VERSION = "$KOTLIN_VERSION";
export const IOS_SDK_VERSION = "${IOS_VERSION:-0.8.0}";
export const WEB_SDK_VERSION = "$WEB_VERSION";

export const SDK_MATRIX = {
  mcp:     { package: "@fidscript/instant-mcp",        version: MCP_VERSION,        distribution: "npm" },
  web:     { package: "@fidscript/instant-sdk",        version: WEB_SDK_VERSION,    distribution: "npm" },
  android: { package: "com.instantdb:instantdb-android", version: ANDROID_SDK_VERSION, distribution: "Maven" },
  kotlin:  { package: "com.instantdb:instantdb-kotlin",  version: KOTLIN_SDK_VERSION,  distribution: "Maven" },
  ios:     { package: "InstantDB",                     version: IOS_SDK_VERSION,    distribution: "Swift Package Manager" },
} as const;

export function pkgAtVersion(pkg: string, version: string): string {
  return \`\${pkg}@\${version}\`;
}
EOF

echo "✅ Wrote $VERSIONS_FILE"
