/**
 * FIDScript Self-Hosted InstantDB Configuration
 *
 * Canonical FIDScript Production Endpoints:
 *   API:      https://apiinstant.fidscript.com
 *   Runtime:   wss://apiinstant.fidscript.com/runtime/session
 *   Dashboard: https://instant.fidscript.com
 */

export const fidscriptDefaults = {
  apiURI: 'https://apiinstant.fidscript.com',
  websocketURI: 'wss://apiinstant.fidscript.com/runtime/session',
} as const;

export const fidscriptDashURI = 'https://instant.fidscript.com';
