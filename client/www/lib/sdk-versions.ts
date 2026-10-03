/**
 * SDK Version Registry
 *
 * Single source of truth for SDK version numbers. To update SDK versions,
 * either edit the values below or run `./scripts/update-sdk-versions.sh`.
 *
 * Why this exists:
 *   - We don't want to grep 50+ doc files every release
 *   - We don't want to hardcode `@fidscript/instant-mcp@0.6.1` in
 *     markdown files, source code, AND dashboard components
 *   - The values below are read from the npm/Maven/GitHub registries
 */

export const MCP_VERSION = "0.6.3";
export const ANDROID_SDK_VERSION = "0.8.0-phase10";
export const KOTLIN_SDK_VERSION = "0.8.0-phase10";
export const IOS_SDK_VERSION = "0.8.0";
export const WEB_SDK_VERSION = "0.1.1";

export const SDK_MATRIX = {
  mcp:     { package: "@fidscript/instant-mcp",        version: MCP_VERSION,        distribution: "npm" },
  web:     { package: "@fidscript/instant-sdk",        version: WEB_SDK_VERSION,    distribution: "npm" },
  android: { package: "com.instantdb:instantdb-android", version: ANDROID_SDK_VERSION, distribution: "Maven" },
  kotlin:  { package: "com.instantdb:instantdb-kotlin",  version: KOTLIN_SDK_VERSION,  distribution: "Maven" },
  ios:     { package: "InstantDB",                     version: IOS_SDK_VERSION,    distribution: "Swift Package Manager" },
} as const;

export function pkgAtVersion(pkg: string, version: string): string {
  return `${pkg}@${version}`;
}
