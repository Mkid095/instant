/**
 * Centralized domain configuration for the entire InstantDB / FIDScript monorepo.
 *
 * Every package (MCP, dashboard, CLI, Android docs, etc.) reads from this file
 * instead of hardcoding domain strings. Domain values come from environment
 * variables at build/runtime with sensible defaults for the canonical
 * self-hosted deployment.
 *
 * # Environment variables
 *
 * All variables are optional; if unset, the canonical default is used.
 *
 *   INSTANT_API_HOST        — the API host (default: "https://apiinstant.fidscript.com")
 *   INSTANT_DASH_HOST       — the dashboard / docs host (default: "https://instant.fidscript.com")
 *   INSTANT_MAVEN_HOST      — the public Maven repository host
 *                             (default: "https://instant.fidscript.com/maven")
 *   INSTANT_WS_PATH         — the runtime WebSocket path
 *                             (default: "/runtime/session")
 *   INSTANT_SSE_PATH        — the runtime SSE path (default: "/runtime/sse")
 *   INSTANT_RUNTIME_API     — the runtime API base (alias for INSTANT_API_HOST)
 *
 * In the browser, these are read from window.__instantConfig first (set by
 * the dashboard's start.sh), then from NEXT_PUBLIC_* prefixed env vars.
 *
 * # Usage
 *
 *   import { domainConfig } from '@/lib/domain-config';
 *   const apiURL = domainConfig.apiHost + '/admin/...';
 *
 * # Examples
 *
 *   Local dev (with dev backend on port 8888):
 *     INSTANT_API_HOST=http://localhost:8888
 *     INSTANT_DASH_HOST=http://localhost:3000
 *     INSTANT_MAVEN_HOST=http://localhost:8081/maven
 *
 *   Different production domain:
 *     INSTANT_DASH_HOST=https://docs.example.com
 *     INSTANT_API_HOST=https://api.example.com
 */

type RuntimeDomainConfig = {
  apiHost: string;
  apiURI: string;
  websocketURI: string;
  sseURI: string;
  dashHost: string;
  docsHost: string;
  mavenHost: string;
  mavenPathPrefix: string;
};

declare global {
  interface Window {
    __instantDomains?: {
      apiHost?: string;
      dashHost?: string;
      mavenHost?: string;
    };
  }
}

const isBrowser = typeof window !== 'undefined';

function trimTrailingSlash(s: string): string {
  return s.endsWith('/') ? s.slice(0, -1) : s;
}

function envVar(name: string): string | undefined {
  if (isBrowser) {
    return undefined; // Server-side only; the public NEXT_PUBLIC_* are set at build time.
  }
  const v = process.env[name];
  return v && v.length > 0 ? v : undefined;
}

function getApiHost(): string {
  // 1. Browser runtime config (set by start.sh)
  if (isBrowser) {
    const fromWindow = window.__instantConfig?.apiURI;
    if (fromWindow) return trimTrailingSlash(fromWindow);
    const fromDomains = window.__instantDomains?.apiHost;
    if (fromDomains) return trimTrailingSlash(fromDomains);
    // 2. Build-time public env var
    const fromBuild = process.env.NEXT_PUBLIC_INSTANT_API_HOST;
    if (fromBuild) return trimTrailingSlash(fromBuild);
  }
  // 3. Server-side env
  return trimTrailingSlash(
    envVar('INSTANT_API_HOST') ||
      envVar('INSTANT_BACKEND_URL') ||
      envVar('INSTANT_RUNTIME_API') ||
      'https://apiinstant.fidscript.com',
  );
}

function getDashHost(): string {
  if (isBrowser) {
    const fromDomains = window.__instantDomains?.dashHost;
    if (fromDomains) return trimTrailingSlash(fromDomains);
    const fromConfig = window.__instantConfig?.dashboardUrl;
    if (fromConfig) return trimTrailingSlash(fromConfig);
    const fromBuild = process.env.NEXT_PUBLIC_INSTANT_DASH_HOST;
    if (fromBuild) return trimTrailingSlash(fromBuild);
  }
  return trimTrailingSlash(
    envVar('INSTANT_DASH_HOST') || 'https://instant.fidscript.com',
  );
}

function getMavenHost(): string {
  if (isBrowser) {
    const fromDomains = window.__instantDomains?.mavenHost;
    if (fromDomains) return trimTrailingSlash(fromDomains);
    const fromBuild = process.env.NEXT_PUBLIC_INSTANT_MAVEN_HOST;
    if (fromBuild) return trimTrailingSlash(fromBuild);
  }
  return trimTrailingSlash(
    envVar('INSTANT_MAVEN_HOST') || `${getDashHost()}/maven`,
  );
}

function getWebSocketPath(): string {
  return envVar('INSTANT_WS_PATH') || '/runtime/session';
}

function getSSEPath(): string {
  return envVar('INSTANT_SSE_PATH') || '/runtime/sse';
}

function buildWebSocketURI(apiHost: string): string {
  const url = new URL(apiHost);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.pathname = getWebSocketPath();
  url.search = '';
  url.hash = '';
  return url.toString();
}

let cached: RuntimeDomainConfig | null = null;

export function getDomainConfig(): RuntimeDomainConfig {
  if (cached) return cached;
  const apiHost = getApiHost();
  const dashHost = getDashHost();
  const mavenHost = getMavenHost();
  cached = {
    apiHost,
    apiURI: apiHost,
    websocketURI: buildWebSocketURI(apiHost),
    sseURI: `${apiHost}${getSSEPath()}`,
    dashHost,
    docsHost: `${dashHost}/docs`,
    mavenHost,
    mavenPathPrefix: '/maven',
  };
  return cached;
}

export const domainConfig = new Proxy({} as RuntimeDomainConfig, {
  get(_target, prop: string) {
    return getDomainConfig()[prop as keyof RuntimeDomainConfig];
  },
});

export default domainConfig;
