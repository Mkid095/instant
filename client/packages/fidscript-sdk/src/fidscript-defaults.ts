/**
 * FIDScript / Self-Hosted InstantDB default endpoints.
 *
 * All values come from the centralized domain config (../../lib/domain-config)
 * which reads from environment variables:
 *   - INSTANT_API_HOST   (default: https://apiinstant.fidscript.com)
 *   - INSTANT_DASH_HOST  (default: https://instant.fidscript.com)
 *
 * The defaults match the canonical self-hosted production deployment but
 * can be overridden via env vars without changing source.
 */

import { domainConfig } from '../../../lib/domain-config';

export const fidscriptDefaults = {
  apiURI: domainConfig.apiHost,
  websocketURI: domainConfig.websocketURI,
} as const;

export const fidscriptDashURI = domainConfig.dashHost;
