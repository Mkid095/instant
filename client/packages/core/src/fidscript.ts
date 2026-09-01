/**
 * FIDScript Self-Hosted InstantDB Configuration
 *
 * This is the single source of truth for FIDScript production endpoints.
 * All SDK packages should import from here rather than hardcoding URLs.
 *
 * Canonical FIDScript Production Endpoints:
 *   API:      https://apiinstant.fidscript.com
 *   Storage:   https://filesinstant.fidscript.com
 *   Runtime:   wss://apiinstant.fidscript.com/runtime/session
 *   Dashboard: https://instant.fidscript.com
 */

// Environment variable override support
// Users can set INSTANT_API_URI, INSTANT_STORAGE_URI, INSTANT_DASH_URI
// to redirect to their own deployment

function getEnv(key: string, fallback: string): string {
  return (typeof process !== 'undefined' && process.env?.[key]) || fallback;
}

export const FIDScriptConfig = {
  apiURI:
    typeof process !== 'undefined' && process.env?.INSTANT_API_URI
      ? process.env.INSTANT_API_URI
      : 'https://apiinstant.fidscript.com',

  websocketURI:
    typeof process !== 'undefined' && process.env?.INSTANT_WS_URI
      ? process.env.INSTANT_WS_URI
      : 'wss://apiinstant.fidscript.com/runtime/session',

  storageURI:
    typeof process !== 'undefined' && process.env?.INSTANT_STORAGE_URI
      ? process.env.INSTANT_STORAGE_URI
      : 'https://filesinstant.fidscript.com',

  dashURI:
    typeof process !== 'undefined' && process.env?.INSTANT_DASH_URI
      ? process.env.INSTANT_DASH_URI
      : 'https://instant.fidscript.com',
} as const;

// Derived URLs (computed from base URIs)
export const FIDScriptURLs = {
  api: FIDScriptConfig.apiURI,
  ws: FIDScriptConfig.websocketURI,
  storage: FIDScriptConfig.storageURI,
  dashboard: FIDScriptConfig.dashURI,

  // Auth endpoints (derived from API URI)
  authSendMagicCode: `${FIDScriptConfig.apiURI}/runtime/auth/send_magic_code`,
  authVerifyMagicCode: `${FIDScriptConfig.apiURI}/runtime/auth/verify_magic_code`,
  authVerifyRefreshToken: `${FIDScriptConfig.apiURI}/runtime/auth/verify_refresh_token`,
  authSignInGuest: `${FIDScriptConfig.apiURI}/runtime/auth/sign_in_guest`,
  authOAuthStart: `${FIDScriptConfig.apiURI}/runtime/oauth/start`,
  authOAuthToken: `${FIDScriptConfig.apiURI}/runtime/oauth/token`,
  authSignOut: `${FIDScriptConfig.apiURI}/runtime/signout`,

  // Storage endpoints (derived from storage URI)
  storageUpload: `${FIDScriptConfig.storageURI}/upload`,
  storageFiles: `${FIDScriptConfig.storageURI}/files`,
  storageSignedDownload: `${FIDScriptConfig.storageURI}/signed-download-url`,
  storageSignedUpload: `${FIDScriptConfig.storageURI}/signed-upload-url`,

  // Admin endpoints (derived from API URI)
  adminQuery: `${FIDScriptConfig.apiURI}/admin/query`,
  adminTransact: `${FIDScriptConfig.apiURI}/admin/transact`,
  adminSSE: `${FIDScriptConfig.apiURI}/admin/sse`,
  adminSubscribeQuery: `${FIDScriptConfig.apiURI}/admin/subscribe-query`,
  adminRefreshTokens: `${FIDScriptConfig.apiURI}/admin/refresh_tokens`,
  adminVerifyMagicCode: `${FIDScriptConfig.apiURI}/admin/verify_magic_code`,
  adminSendMagicCode: `${FIDScriptConfig.apiURI}/admin/send_magic_code`,
  adminUsers: `${FIDScriptConfig.apiURI}/admin/users`,
  adminRoomsPresence: `${FIDScriptConfig.apiURI}/admin/rooms/presence`,
  adminStorageUpload: `${FIDScriptConfig.storageURI}/admin/storage/upload`,
  adminStorageFiles: `${FIDScriptConfig.storageURI}/admin/storage/files`,
  adminStorageSignedDownload: `${FIDScriptConfig.storageURI}/admin/storage/signed-download-url`,
  adminStorageSignedUpload: `${FIDScriptConfig.storageURI}/admin/storage/signed-upload-url`,
  adminQueryPermsCheck: `${FIDScriptConfig.apiURI}/admin/query_perms_check`,
  adminTransactPermsCheck: `${FIDScriptConfig.apiURI}/admin/transact_perms_check`,

  // Runtime SSE (derived from API URI)
  runtimeSSE: `${FIDScriptConfig.apiURI}/runtime/sse`,

  // Devtool (derived from dashboard URI)
  devtool: `${FIDScriptConfig.dashURI}/_devtool`,
} as const;
