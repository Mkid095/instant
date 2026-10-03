#!/usr/bin/env node
import { parseArgs } from "node:util";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

// Constants
// -----------
// All host values are read STRICTLY from environment variables. The MCP
// throws on startup if any required env var is missing. Set:
//   INSTANT_API_HOST     — the API host (e.g. "https://api.example.com")
//   INSTANT_DASH_HOST    — the dashboard / docs host (e.g. "https://docs.example.com")
//   INSTANT_MAVEN_HOST   — the public Maven repo host (e.g. "https://docs.example.com/maven")
function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    throw new Error(
      `Required environment variable ${name} is not set. ` +
      `Set it before starting the MCP server. See CLAUDE.md for the full list.`,
    );
  }
  return v;
}
const DEFAULT_API_URL = requireEnv("INSTANT_API_HOST");
const DEFAULT_DASH_URL = requireEnv("INSTANT_DASH_HOST");
const DEFAULT_MAVEN_URL = requireEnv("INSTANT_MAVEN_HOST");
const REQUEST_TIMEOUT_MS = 30_000;

function getVersion(): string {
  try {
    const pkg = JSON.parse(
      readFileSync(resolve(fileURLToPath(import.meta.url), "../../package.json"), "utf-8")
    );
    return pkg.version || "0.0.0";
  } catch {
    return "0.0.0";
  }
}

const VERSION = getVersion();

// Error handling utilities
// -----------

type ServerError = {
  type?: string;
  message?: string;
  hint?: {
    errors?: Array<{ message?: string }>;
    retry_after?: number;
    retry_at?: string;
    data_type?: string;
    input?: string;
    condition?: string;
    debug_uri?: string;
    args?: Record<string, any>[];
    record_type?: string;
  };
  trace_id?: string;
};

function formatServerError(body: ServerError | string, status: number): string {
  // Try to parse body if it's a string
  let err: ServerError = {};
  if (typeof body === "string") {
    try { err = JSON.parse(body); } catch { err.message = body; }
  } else {
    err = body;
  }

  const parts: string[] = [];
  const type = err.type?.toUpperCase().replace(/-/g, "_") || `HTTP_${status}`;
  parts.push(`[${type}]`);

  if (err.message) {
    parts.push(err.message);
  }

  // Add hints for specific error types
  if (err.hint) {
    if (err.hint.errors && err.hint.errors.length > 0) {
      const msgs = err.hint.errors.map(e => e.message).filter(Boolean);
      if (msgs.length > 0) parts.push(`Details: ${msgs.join("; ")}`);
    }
    if (err.hint.data_type && err.hint.input) {
      parts.push(`Parameter '${err.hint.data_type}' received: ${err.hint.input}`);
    }
    if (err.hint.retry_after) {
      parts.push(`Retry after ${err.hint.retry_after} seconds`);
    }
    if (err.hint.retry_at) {
      parts.push(`Retry at: ${err.hint.retry_at}`);
    }
    if (err.hint.condition === "unknown" && err.hint.debug_uri) {
      parts.push(`Debug: ${err.hint.debug_uri}`);
    }
    if (err.hint.record_type && err.hint.args) {
      const id = err.hint.args[0]?.id || err.hint.args[0]?.app_id || "unknown";
      parts.push(`Expected ${err.hint.record_type} with id: ${id}`);
    }
  }

  if (err.trace_id) {
    parts.push(`Trace: ${err.trace_id}`);
  }

  return parts.join(" | ");
}

function classifyHttpError(status: number, statusText: string, bodyStr: string): string {
  // First try to parse as structured server error
  try {
    const parsed = JSON.parse(bodyStr);
    if (parsed && typeof parsed === "object") {
      const formatted = formatServerError(parsed, status);
      if (formatted) return formatted;
    }
  } catch { /* fall through */ }

  // Fallback to status-based messages
  switch (status) {
    case 400: return `Bad request: ${statusText}`;
    case 401: return "Authentication failed — check your INSTANT_ACCESS_TOKEN";
    case 403: return "Permission denied — your PAT does not have access to this resource";
    case 404: return "Resource not found";
    case 422: return `Validation error: ${statusText}`;
    case 429: return "Rate limited — too many requests, please wait before retrying";
    case 500: return "InstantDB server error (500)";
    case 502: return "InstantDB gateway error (502)";
    case 503: return "InstantDB service unavailable (503)";
    default:
      if (status >= 500) {
        // Try to extract error details from body
        try {
          const parsed = JSON.parse(bodyStr);
          if (parsed?.message) {
            const msg = parsed.message;
            // Include more detail for SQL errors
            if (msg.includes("SQL Exception")) return `InstantDB server error (${status}): ${msg}`;
            return `InstantDB server error (${status}): ${msg}`;
          }
        } catch {}
        return `InstantDB server error (${status})`;
      }
      if (status >= 400) return `Request failed (${status})`;
      return `Unexpected response (${status}): ${statusText}`;
  }
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<Response> {
  const { timeoutMs = REQUEST_TIMEOUT_MS, ...fetchInit } = init;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...fetchInit,
      signal: controller.signal,
    });
    return response;
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(`Request timed out after ${timeoutMs / 1000} seconds`);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

// Generic API helpers
// -----------
async function apiGet(
  apiURI: string,
  token: string,
  path: string,
  params?: Record<string, string>,
  appId?: string,
): Promise<any> {
  let url = `${apiURI}${path}`;
  if (params) {
    const qs = new URLSearchParams(params).toString();
    url += `?${qs}`;
  }
  const res = await fetchWithTimeout(url, {
    method: "GET",
    headers: authHeaders(token, appId),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = classifyHttpError(res.status, res.statusText, JSON.stringify(data));
    throw new Error(msg);
  }
  return data;
}

async function apiPost(
  apiURI: string,
  token: string,
  path: string,
  body?: unknown,
  appId?: string,
): Promise<any> {
  const res = await fetchWithTimeout(`${apiURI}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(token, appId),
    },
    body: body ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = classifyHttpError(res.status, res.statusText, JSON.stringify(data));
    throw new Error(msg);
  }
  return data;
}

async function apiDelete(
  apiURI: string,
  token: string,
  path: string,
  params?: Record<string, string>,
  appId?: string,
  body?: unknown,
): Promise<any> {
  let url = `${apiURI}${path}`;
  if (params) {
    const qs = new URLSearchParams(params).toString();
    url += `?${qs}`;
  }
  const res = await fetchWithTimeout(url, {
    method: "DELETE",
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...authHeaders(token, appId),
    },
    body: body ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = classifyHttpError(res.status, res.statusText, JSON.stringify(data));
    throw new Error(msg);
  }
  return data;
}

function authHeaders(token: string, appId?: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    ...(appId ? { "app-id": appId } : {}),
  };
}

// Admin API helpers
// -----------
async function adminQuery(
  apiURI: string,
  token: string,
  appId: string,
  query: Record<string, any>,
): Promise<any> {
  // Use superadmin route for data-plane access — bypasses creator-level check
  return apiPost(apiURI, token, `/superadmin/apps/${appId}/data/query`, { query });
}

async function adminTransact(
  apiURI: string,
  token: string,
  appId: string,
  steps: any[][],
): Promise<any> {
  // Use superadmin route for data-plane access — bypasses creator-level check
  return apiPost(apiURI, token, `/superadmin/apps/${appId}/data/transact`, { steps });
}

async function getSchema(
  apiURI: string,
  token: string,
  appId: string,
): Promise<any> {
  return apiGet(apiURI, token, "/admin/schema", undefined, appId);
}

async function listFiles(
  apiURI: string,
  token: string,
  appId: string,
): Promise<any> {
  return apiGet(apiURI, token, "/admin/storage/files", undefined, appId);
}

async function deleteFile(
  apiURI: string,
  token: string,
  appId: string,
  filename: string,
): Promise<any> {
  return apiDelete(apiURI, token, `/admin/storage/files?filename=${encodeURIComponent(filename)}`, undefined, appId);
}

async function getStorageUploadUrl(
  apiURI: string,
  token: string,
  appId: string,
  filename: string,
): Promise<any> {
  return apiPost(apiURI, token, "/admin/storage/signed-upload-url", { filename }, appId);
}

async function getStorageDownloadUrl(
  apiURI: string,
  token: string,
  appId: string,
  filename: string,
): Promise<any> {
  return apiGet(apiURI, token, `/admin/storage/signed-download-url?filename=${encodeURIComponent(filename)}`, undefined, appId);
}

// Upload file directly - returns public URL
async function uploadFileDirect(
  apiURI: string,
  token: string,
  appId: string,
  filename: string,
  base64Content: string,
  contentType: string,
): Promise<any> {
  return apiPost(apiURI, token, "/storage/upload-direct", {
    "app-id": appId,
    path: filename,
    "content-type": contentType,
    body: base64Content,
  }, appId);
}

// List uploaded files with their public URLs
async function listUploadedFiles(
  apiURI: string,
  token: string,
  appId: string,
): Promise<any> {
  return apiGet(apiURI, token, "/storage/files", undefined, appId);
}

// Storage Config API helpers
async function getStorageConfig(
  apiURI: string,
  token: string,
  appId: string,
): Promise<any> {
  return apiGet(apiURI, token, `/dash/apps/${appId}/storage_config`);
}

async function updateStorageConfig(
  apiURI: string,
  token: string,
  appId: string,
  config: {
    providerType?: string;
    cloudName?: string;
    apiKey?: string;
    apiSecret?: string;
    uploadPreset?: string;
  },
): Promise<any> {
  return apiPut(apiURI, token, `/dash/apps/${appId}/storage_config`, config);
}

async function apiPut(
  apiURI: string,
  token: string,
  path: string,
  body?: unknown,
  appId?: string,
): Promise<any> {
  const res = await fetchWithTimeout(`${apiURI}${path}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(token, appId),
    },
    body: body ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = classifyHttpError(res.status, res.statusText, JSON.stringify(data));
    throw new Error(msg);
  }
  return data;
}

async function deleteStorageConfig(
  apiURI: string,
  token: string,
  appId: string,
): Promise<any> {
  return apiDelete(apiURI, token, `/dash/apps/${appId}/storage_config`);
}

// Superadmin API helpers
// -----------
async function getSchemaSuperadmin(
  apiURI: string,
  token: string,
  appId: string,
): Promise<any> {
  return apiGet(apiURI, token, `/admin/schema`, undefined, appId);
}

// Transform client-side schema format to server-side format
// Client format: { "todos": { "attrs": { "title": { "type": "string" } } } }
// Server format: { entities: { "todos": { "attrs": { "title": { "type": "string" } } } }, links: {} }
function transformSchemaToServerFormat(schema: any): { entities: any; links: any } {
  // Detect common mistakes and give clear errors
  if (!schema || typeof schema !== "object") {
    throw new Error(
      "Schema must be an object like { todos: { attrs: { text: 'string' } } }. " +
      "Call learn with topic='schema' for the correct format."
    );
  }
  if ("entities" in schema) {
    throw new Error(
      "Schema format error: top-level 'entities' key is the SERVER format, not the MCP input. " +
      "Pass namespaces at the top level instead: { todos: { attrs: {...} } } — not { entities: { todos: {...} } }. " +
      "Call learn with topic='schema' for examples."
    );
  }
  if ("links" in schema && Object.keys(schema).length === 1) {
    throw new Error(
      "Schema format error: only 'links' was provided, but namespaces are required at the top level. " +
      "Use: { todos: { attrs: {...} } } — not just { links: {...} }."
    );
  }
  // Auto-detect: if every value is an object with an 'attrs' or 'links' key directly,
  // it's already in server format and needs unwrapping
  const entries = Object.entries(schema);
  const looksLikeServerFormat = entries.length > 0 && entries.every(
    ([, v]) => v && typeof v === "object" && !("attrs" in v) && !("links" in v)
  );
  if (looksLikeServerFormat && entries.some(([k]) => k.includes(" "))) {
    throw new Error(
      "Schema format error: appears to be the server's link-key format. " +
      "Use the client format: { todos: { attrs: { name: 'string' } } }."
    );
  }

  const entities: any = {};
  const links: any = {};

  for (const [nsName, nsDef] of Object.entries(schema)) {
    if (nsName.startsWith("$")) continue; // skip system namespaces
    if (!nsDef || typeof nsDef !== "object") {
      throw new Error(
        `Schema format error: namespace '${nsName}' must be an object like { attrs: {...} }, got ${typeof nsDef}.`
      );
    }

    entities[nsName] = {};
    if ((nsDef as any).attrs) {
      entities[nsName].attrs = (nsDef as any).attrs;
    }
    if ((nsDef as any).links) {
      // Convert links to server format
      for (const [linkName, linkDef] of Object.entries((nsDef as any).links)) {
        const linkDefObj = linkDef as any;
        // Compute reverse label: for collection links, use the source namespace name (the namespace containing the link definition)
        // For non-collection links, use the target namespace name
        const reverseLabel = linkDefObj.is_collection ? nsName : linkDefObj.collection;
        links[`[${linkDefObj.collection} ${linkName} ${nsName} ${linkDefObj.is_collection ? linkDefObj.collection : nsName}]`] = {
          forward: {
            on: linkDefObj.collection,
            has: linkDefObj.is_collection ? "many" : "one",
            label: linkName,
          },
          reverse: {
            on: nsName,
            has: linkDefObj.is_collection ? "one" : "many",
            label: reverseLabel,
          },
        };
      }
    }
  }

  return { entities, links };
}

async function pushSchema(
  apiURI: string,
  token: string,
  appId: string,
  schema: any,
): Promise<any> {
  const serverSchema = transformSchemaToServerFormat(schema);

  // Step 1: plan
  const planData = await apiPost(apiURI, token, `/superadmin/apps/${appId}/schema/push/plan`, {
    schema: serverSchema,
    check_types: true,
    supports_background_updates: true,
  });

  // Step 2: apply
  const applyData = await apiPost(apiURI, token, `/superadmin/apps/${appId}/schema/push/apply`, {
    schema: serverSchema,
    check_types: true,
    supports_background_updates: true,
  });

  return { plan: planData, result: applyData };
}

async function pushSchemaDryRun(
  apiURI: string,
  token: string,
  appId: string,
  schema: any,
): Promise<any> {
  const serverSchema = transformSchemaToServerFormat(schema);

  return apiPost(apiURI, token, `/superadmin/apps/${appId}/schema/push/plan`, {
    schema: serverSchema,
    check_types: true,
    supports_background_updates: true,
  });
}

async function getPerms(
  apiURI: string,
  token: string,
  appId: string,
): Promise<any> {
  return apiGet(apiURI, token, `/superadmin/apps/${appId}/perms`);
}

async function pushPerms(
  apiURI: string,
  token: string,
  appId: string,
  perms: any,
): Promise<any> {
  return apiPost(apiURI, token, `/superadmin/apps/${appId}/perms`, { code: perms });
}

// OAuth Provider management
async function createOAuthProvider(
  apiURI: string,
  token: string,
  appId: string,
  providerName: string,
): Promise<any> {
  return apiPost(apiURI, token, `/dash/apps/${appId}/oauth_service_providers`, {
    provider_name: providerName,
  });
}

// OAuth Client management
async function createOAuthClient(
  apiURI: string,
  token: string,
  appId: string,
  providerId: string,
  clientName: string,
  redirectTo: string,
  options?: {
    clientId?: string;
    clientSecret?: string;
    discoveryEndpoint?: string;
    meta?: any;
    useSharedCredentials?: boolean;
  },
): Promise<any> {
  const body: any = {
    provider_id: providerId,
    client_name: clientName,
    redirect_to: redirectTo,
  };
  if (options?.clientId) body.client_id = options.clientId;
  if (options?.clientSecret) body.client_secret = options.clientSecret;
  if (options?.discoveryEndpoint) body.discovery_endpoint = options.discoveryEndpoint;
  if (options?.meta) body.meta = options.meta;
  if (options?.useSharedCredentials) body.use_shared_credentials = true;

  return apiPost(apiURI, token, `/dash/apps/${appId}/oauth_clients`, body);
}

async function updateOAuthClient(
  apiURI: string,
  token: string,
  appId: string,
  clientId: string,
  updates: {
    clientName?: string;
    redirectTo?: string;
    clientId?: string;
    clientSecret?: string;
    discoveryEndpoint?: string;
    meta?: any;
    useSharedCredentials?: boolean;
  },
): Promise<any> {
  const body: any = {};
  if (updates.clientName) body.client_name = updates.clientName;
  if (updates.redirectTo) body.redirect_to = updates.redirectTo;
  if (updates.clientId) body.client_id = updates.clientId;
  if (updates.clientSecret) body.client_secret = updates.clientSecret;
  if (updates.discoveryEndpoint) body.discovery_endpoint = updates.discoveryEndpoint;
  if (updates.meta) body.meta = updates.meta;
  if (updates.useSharedCredentials !== undefined) body.use_shared_credentials = updates.useSharedCredentials;

  return apiPost(apiURI, token, `/dash/apps/${appId}/oauth_clients/${clientId}`, body);
}

async function deleteOAuthClient(
  apiURI: string,
  token: string,
  appId: string,
  clientId: string,
): Promise<any> {
  return apiDelete(apiURI, token, `/dash/apps/${appId}/oauth_clients/${clientId}`);
}

async function listOAuthProviders(
  apiURI: string,
  token: string,
  appId: string,
): Promise<any> {
  return apiGet(apiURI, token, `/dash/apps/${appId}/oauth_service_providers`);
}

async function getOAuthClient(
  apiURI: string,
  token: string,
  appId: string,
  clientId: string,
): Promise<any> {
  return apiGet(apiURI, token, `/dash/apps/${appId}/oauth_clients/${clientId}`);
}

async function listOAuthClients(
  apiURI: string,
  token: string,
  appId: string,
): Promise<any> {
  return apiGet(apiURI, token, `/dash/apps/${appId}/oauth_clients`);
}

async function listRedirectOrigins(
  apiURI: string,
  token: string,
  appId: string,
): Promise<any> {
  return apiGet(apiURI, token, `/dash/apps/${appId}/authorized_redirect_origins`);
}

async function addRedirectOrigin(
  apiURI: string,
  token: string,
  appId: string,
  service: string,
  params: string[],
): Promise<any> {
  return apiPost(apiURI, token, `/dash/apps/${appId}/authorized_redirect_origins`, {
    service,
    params,
  });
}

async function deleteRedirectOrigin(
  apiURI: string,
  token: string,
  appId: string,
  originId: string,
): Promise<any> {
  return apiDelete(apiURI, token, `/dash/apps/${appId}/authorized_redirect_origins/${originId}`);
}

async function listApps(
  apiURI: string,
  token: string,
): Promise<any> {
  return apiGet(apiURI, token, "/superadmin/apps");
}

async function getApp(
  apiURI: string,
  token: string,
  appId: string,
): Promise<any> {
  return apiGet(apiURI, token, `/superadmin/apps/${appId}`);
}

async function createApp(
  apiURI: string,
  token: string,
  title: string,
): Promise<any> {
  return apiPost(apiURI, token, "/superadmin/apps", { title });
}

async function deleteApp(
  apiURI: string,
  token: string,
  appId: string,
): Promise<any> {
  return apiDelete(apiURI, token, `/superadmin/apps/${appId}`);
}

// Dash API helpers (app-level management)
// -----------
async function listWebhooks(
  apiURI: string,
  token: string,
  appId: string,
): Promise<any> {
  return apiGet(apiURI, token, `/dash/apps/${appId}/webhooks`);
}

async function createWebhook(
  apiURI: string,
  token: string,
  appId: string,
  url: string,
  namespaces: string[],
  actions: string[],
): Promise<any> {
  return apiPost(apiURI, token, `/dash/apps/${appId}/webhooks`, { url, namespaces, actions });
}

async function updateWebhook(
  apiURI: string,
  token: string,
  appId: string,
  webhookId: string,
  updates: { url?: string; namespaces?: string[]; actions?: string[] },
): Promise<any> {
  return apiPost(apiURI, token, `/dash/apps/${appId}/webhooks/${webhookId}`, updates);
}

async function deleteWebhook(
  apiURI: string,
  token: string,
  appId: string,
  webhookId: string,
): Promise<any> {
  return apiDelete(apiURI, token, `/dash/apps/${appId}/webhooks/${webhookId}`);
}

async function enableWebhook(
  apiURI: string,
  token: string,
  appId: string,
  webhookId: string,
): Promise<any> {
  return apiPost(apiURI, token, `/dash/apps/${appId}/webhooks/${webhookId}/enable`);
}

async function disableWebhook(
  apiURI: string,
  token: string,
  appId: string,
  webhookId: string,
  reason?: string,
): Promise<any> {
  return apiPost(apiURI, token, `/dash/apps/${appId}/webhooks/${webhookId}/disable`, reason ? { reason } : {});
}

async function getWebhookEvents(
  apiURI: string,
  token: string,
  appId: string,
  webhookId: string,
  after?: string,
): Promise<any> {
  return apiGet(apiURI, token, `/dash/apps/${appId}/webhooks/${webhookId}/events`, after ? { after } : undefined);
}

async function resendWebhookEvent(
  apiURI: string,
  token: string,
  appId: string,
  webhookId: string,
  eventIsn: string,
): Promise<any> {
  return apiPost(apiURI, token, `/dash/apps/${appId}/webhooks/${webhookId}/events/${eventIsn}`, undefined);
}

// Backups
async function listBackups(
  apiURI: string,
  token: string,
  appId: string,
): Promise<any> {
  return apiGet(apiURI, token, `/dash/apps/${appId}/backups`);
}

async function createBackup(
  apiURI: string,
  token: string,
  appId: string,
  description?: string,
): Promise<any> {
  return apiPost(apiURI, token, `/dash/apps/${appId}/backups`, description ? { description } : {});
}

async function deleteBackup(
  apiURI: string,
  token: string,
  appId: string,
  backupId: string,
): Promise<any> {
  return apiDelete(apiURI, token, `/dash/apps/${appId}/backups/${backupId}`);
}

async function listBackupJobs(
  apiURI: string,
  token: string,
  appId: string,
): Promise<any> {
  return apiGet(apiURI, token, `/dash/apps/${appId}/backup-jobs`);
}

async function getBackupJob(
  apiURI: string,
  token: string,
  appId: string,
  jobId: string,
): Promise<any> {
  return apiGet(apiURI, token, `/dash/apps/${appId}/backup-jobs/${jobId}`);
}

async function cancelBackupJob(
  apiURI: string,
  token: string,
  appId: string,
  jobId: string,
): Promise<any> {
  return apiDelete(apiURI, token, `/dash/apps/${appId}/backup-jobs/${jobId}`);
}

async function listBackupFiles(
  apiURI: string,
  token: string,
  appId: string,
  backupId: string,
): Promise<any> {
  return apiGet(apiURI, token, `/dash/apps/${appId}/backups/${backupId}/files`);
}

async function getBackupFileUrl(
  apiURI: string,
  token: string,
  appId: string,
  backupId: string,
  fileName: string,
): Promise<any> {
  return apiGet(apiURI, token, `/dash/apps/${appId}/backups/${backupId}/file-url`, { name: fileName });
}

// Test users
async function listTestUsers(
  apiURI: string,
  token: string,
  appId: string,
): Promise<any> {
  return apiGet(apiURI, token, `/dash/apps/${appId}/test_users`);
}

async function createTestUser(
  apiURI: string,
  token: string,
  appId: string,
  email: string,
  code: string,
): Promise<any> {
  return apiPost(apiURI, token, `/dash/apps/${appId}/test_users`, { email, code });
}

async function deleteTestUser(
  apiURI: string,
  token: string,
  appId: string,
  testUserId: string,
): Promise<any> {
  return apiDelete(apiURI, token, `/dash/apps/${appId}/test_users`, undefined, undefined, { id: testUserId });
}

// Org management
async function listOrgs(
  apiURI: string,
  token: string,
): Promise<any> {
  return apiGet(apiURI, token, "/superadmin/orgs");
}

async function getOrg(
  apiURI: string,
  token: string,
  orgId: string,
): Promise<any> {
  return apiGet(apiURI, token, `/superadmin/orgs/${orgId}`);
}

async function getOrgApps(
  apiURI: string,
  token: string,
  orgId: string,
  include?: string,
): Promise<any> {
  return apiGet(apiURI, token, `/superadmin/orgs/${orgId}/apps`, include ? { include } : undefined);
}

// App members
async function inviteAppMember(
  apiURI: string,
  token: string,
  appId: string,
  inviteeEmail: string,
  role: string,
): Promise<any> {
  return apiPost(apiURI, token, `/dash/apps/${appId}/invite/send`, { "invitee-email": inviteeEmail, role });
}

async function removeAppMember(
  apiURI: string,
  token: string,
  appId: string,
  memberId: string,
): Promise<any> {
  return apiDelete(apiURI, token, `/dash/apps/${appId}/members/remove`, undefined, undefined, { id: memberId });
}

async function updateAppMember(
  apiURI: string,
  token: string,
  appId: string,
  memberId: string,
  role: string,
): Promise<any> {
  return apiPost(apiURI, token, `/dash/apps/${appId}/members/update`, { id: memberId, role });
}

// Sender verification
async function getSenderVerification(
  apiURI: string,
  token: string,
  appId: string,
): Promise<any> {
  return apiGet(apiURI, token, `/dash/apps/${appId}/sender-verification`);
}

async function sendSenderVerificationCode(
  apiURI: string,
  token: string,
  appId: string,
): Promise<any> {
  return apiPost(apiURI, token, `/dash/apps/${appId}/sender-verification/send-magic-code`);
}

async function verifySenderCode(
  apiURI: string,
  token: string,
  appId: string,
  code: string,
): Promise<any> {
  return apiPost(apiURI, token, `/dash/apps/${appId}/sender-verification/verify-magic-code`, { code });
}

// Email templates
async function getEmailTemplate(
  apiURI: string,
  token: string,
): Promise<any> {
  return apiGet(apiURI, token, "/dash/default-email-template");
}

async function updateEmailTemplate(
  apiURI: string,
  token: string,
  appId: string,
  subject: string,
  body: string,
  senderEmail?: string,
  senderName?: string,
): Promise<any> {
  return apiPost(apiURI, token, `/dash/apps/${appId}/email_templates`, {
    "email-type": "magic-code",
    subject,
    body,
    ...(senderEmail ? { "sender-email": senderEmail } : {}),
    ...(senderName ? { "sender-name": senderName } : {}),
  });
}

async function sendTestEmail(
  apiURI: string,
  token: string,
  appId: string,
  to: string,
  subject: string,
  body: string,
  senderEmail?: string,
  senderName?: string,
): Promise<any> {
  return apiPost(apiURI, token, `/dash/apps/${appId}/send-test-email`, {
    to,
    subject,
    body,
    ...(senderEmail ? { "sender-email": senderEmail } : {}),
    ...(senderName ? { "sender-name": senderName } : {}),
  });
}

// Server factory
// -----------
function createMCPServer(): McpServer {
  return new McpServer({
    name: "@fidscript/instant-mcp",
    version: VERSION,
  });
}

// Auth API helpers (for user-level token management)
// -----------
async function sendMagicCode(
  apiURI: string,
  email: string,
): Promise<any> {
  return apiPost(apiURI, "", `/dash/auth/send_magic_code`, { email });
}

async function verifyMagicCode(
  apiURI: string,
  email: string,
  code: string,
): Promise<any> {
  return apiPost(apiURI, "", `/dash/auth/verify_magic_code`, { email, code });
}

async function listPersonalAccessTokens(
  apiURI: string,
  token: string,
): Promise<any> {
  return apiGet(apiURI, token, "/dash/personal_access_tokens");
}

async function createPersonalAccessToken(
  apiURI: string,
  token: string,
  name: string,
): Promise<any> {
  return apiPost(apiURI, token, "/dash/personal_access_tokens", { name });
}

async function deletePersonalAccessToken(
  apiURI: string,
  token: string,
  id: string,
): Promise<any> {
  return apiDelete(apiURI, token, `/dash/personal_access_tokens/${id}`);
}

// Tools
// -----------
// Registers a tool with its canonical (hyphenated) name only.
// Phase 1 of the MCP context-reduction work removes the previous
// underscore-alias double registration so each tool appears exactly
// once in `tools/list`.
function tool(
  server: McpServer,
  name: string,
  description: string,
  inputSchema: Record<string, any>,
  handler: (params: any) => Promise<any>,
) {
  server.tool(name, description, inputSchema, handler);
}

function registerTools(
  server: McpServer,
  apiURI: string,
  token: string,
  _appId: string,
) {

  // ---- Auth ----
  tool(
    server,
    "send-magic-code",
    "Send a magic code to an email address for user authentication. Use this before verify-magic-code to log in.",
    {
      email: z.string().email().describe("Email address to send the magic code to"),
    },
    async ({ email }) => {
      try {
        const data = await sendMagicCode(apiURI, email);
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      } catch (e: any) {
        return { isError: true, content: [{ type: "text", text: `Error sending magic code: ${e.message}` }] };
      }
    },
  );

  tool(server,
    "verify-magic-code",
    "Verify a magic code sent to an email address and get a user token for authentication.",
    {
      email: z.string().email().describe("Email address that received the code"),
      code: z.string().describe("6-digit magic code"),
    },
    async ({ email, code }) => {
      try {
        const data = await verifyMagicCode(apiURI, email, code);
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      } catch (e: any) {
        return { isError: true, content: [{ type: "text", text: `Error verifying magic code: ${e.message}` }] };
      }
    },
  );

  tool(server,
    "list-personal-access-tokens",
    "List all Personal Access Tokens for the authenticated user.",
    {},
    async () => {
      try {
        const data = await listPersonalAccessTokens(apiURI, token);
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      } catch (e: any) {
        return { isError: true, content: [{ type: "text", text: `Error listing PATs: ${e.message}` }] };
      }
    },
  );

  tool(server,
    "create-personal-access-token",
    "Create a new Personal Access Token for API authentication.",
    {
      name: z.string().min(1).describe("Name/label for the token"),
    },
    async ({ name }) => {
      try {
        const data = await createPersonalAccessToken(apiURI, token, name);
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      } catch (e: any) {
        return { isError: true, content: [{ type: "text", text: `Error creating PAT: ${e.message}` }] };
      }
    },
  );

  tool(server,
    "delete-personal-access-token",
    "Revoke/delete a Personal Access Token.",
    {
      id: z.string().uuid().describe("UUID of the token to delete"),
    },
    async ({ id }) => {
      try {
        const data = await deletePersonalAccessToken(apiURI, token, id);
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      } catch (e: any) {
        return { isError: true, content: [{ type: "text", text: `Error deleting PAT: ${e.message}` }] };
      }
    },
  );

  // ---- Learning ----
  tool(server,
    "learn",
    "Get an overview of InstantDB concepts, data modeling, permissions, and CLI commands. " +
      "Returns topic-specific guides. ALL docs at the SELF-HOSTED URL — do NOT search instantdb.com. " +
      "Topics: 'overview' (default), 'schema', 'query', 'transact', 'perms', 'auth', 'storage', 'cli', 'android'.",
    {
      topic: z.enum([
        "overview", "schema", "query", "transact", "perms",
        "auth", "storage", "cli", "android"
      ]).optional().describe(
        "Topic. Default 'overview'. Use 'schema' for push-schema format, " +
        "'query' for InstaQL, 'transact' for transactions, 'perms' for permissions, " +
        "'auth' for authentication, 'storage' for files, 'cli' for CLI, " +
        "'android' for Android/Kotlin SDK."
      ),
    },
    async ({ topic }) => {
      const t = topic || "overview";
      const docs = `${DEFAULT_DASH_URL}/docs`;
      const content = {
        overview: `InstantDB is a reactive graph database. Key concepts:

SCHEMAS:
  Define your data model. Namespaces = entity types.
  Each entity has attributes (data fields) and links (relationships).

PERMISSIONS:
  Define who can read/write data.
  Use allow/deny rules based on auth, data checks, and world values.

QUERIES (InstaQL):
  {"goals": {"todos": {}}} — fetch all goals with their todos
  {"goals": {"$": {"where": {"status": "active"}}, "todos": {}}} — filtered query

TRANSACTIONS (Instaml):
  ["update", "namespace", "entity-id", {"attr": "value"}] — create/update
  ["link", "namespace", "entity-id", {"linkAttr": "target-id"}] — link entities
  ["delete", "namespace", "entity-id"] — delete entity

CLI COMMANDS:
  npx instant-cli init — create app and generate schema/perms files
  npx instant-cli push schema — push schema changes
  npx instant-cli push perms — push permission changes
  npx instant-cli pull — pull schema and perms from server

SELF-HOSTED DOCS: ${docs}

NOTE: This is a self-hosted FIDScript deployment. All docs and API are at:
  - Docs: ${docs}
  - API: ${DEFAULT_API_URL}
Do NOT use instantdb.com or upstream docs — they may differ from this deployment.`,

        schema: `SCHEMA FORMAT for push-schema tool — DO NOT use i.entity({...}) or upstream's format:

{
  "<namespace>": {
    "attrs": {
      "<attr_name>": "<type>"  // types: "string" | "number" | "boolean" | "date"
    },
    "links": {
      "<link_name>": {
        "collection": "<target_namespace>",
        "is_collection": <bool>  // true = many, false = one
      }
    }
  }
}

EXAMPLE — a simple todo app:
{
  "todos": {
    "attrs": {
      "text": "string",
      "done": "boolean",
      "createdAt": "date"
    }
  },
  "users": {
    "attrs": {
      "email": "string"
    }
  }
}

TO ADD A LINK between todos and users, define a third namespace with "links":
{
  "todos": { "attrs": { "text": "string" } },
  "users": { "attrs": { "email": "string" } },
  "todos.owner": {
    "links": {
      "owner": { "collection": "users", "is_collection": false }
    }
  }
}

CRITICAL:
  - Use "string"|"number"|"boolean"|"date" as attribute types (lowercase strings)
  - DO NOT use i.entity({...}) builder — that is for the JS SDK, not the MCP
  - DO NOT use the format from instantdb.com docs — that is the upstream
  - DO use push-schema-dry-run first to preview

SELF-HOSTED DOCS: ${docs}`,

        query: `QUERY SYNTAX (InstaQL):

BASIC:
  {"todos": {}}  — fetch all todos

FILTERED:
  {"todos": {"$": {"where": {"done": false}}}}

PAGINATION:
  {"todos": {"$": {"limit": 10, "offset": 0}}}

NESTED:
  {"users": {"$": {"where": {"email": "a@b.com"}}, "todos": {}}}

OR (wrap in "and"):
  {"todos": {"$": {"where": {"and": [{"or": [{"done": false}, {"text": "urgent"}]}]}}}}

CRITICAL: "where" MUST be nested inside "$":
  CORRECT: {"todos": {"$": {"where": {"field": "value"}}}}
  WRONG:   {"$where": {"field": "value"}}

SELF-HOSTED DOCS: ${docs}/instaql`,

        transact: `TRANSACTION STEPS (InstaML):

CREATE / UPDATE:
  ["update", "todos", "<id>", {"text": "hello", "done": false}]
  If "<id>" is new, the entity is created. If it exists, it's updated.

LINK:
  ["link", "todos", "<id>", {"owner": "<user_id>"}]

UNLINK:
  ["unlink", "todos", "<id>", {"owner": "<user_id>"}]

DELETE:
  ["delete", "todos", "<id>"]

Multiple steps in one transaction:
  [
    ["update", "todos", "id1", {"text": "hello"}],
    ["link", "todos", "id1", {"owner": "user-1"}]
  ]

SELF-HOSTED DOCS: ${docs}/instaml`,

        perms: `PERMISSIONS FORMAT for push-perms:

{
  "<namespace>": {
    "allow": {
      "view":   "<cel_expression>",
      "create": "<cel_expression>",
      "update": "<cel_expression>",
      "delete": "<cel_expression>"
    }
  }
}

SPECIAL VALUES for cel_expression:
  "true"               — always allow
  "false"              — never allow
  "auth.uid != null"   — any signed-in user

DATA CHECKS:
  "auth.uid == data.owner"   — only the owner

EXAMPLE — public read, owner-only write:
{
  "todos": {
    "allow": {
      "view":   "true",
      "create": "auth.uid != null",
      "update": "auth.uid == data.owner",
      "delete": "auth.uid == data.owner"
    }
  }
}

SELF-HOSTED DOCS: ${docs}/permissions`,

        auth: `AUTHENTICATION:

MAGIC CODES (default):
  1. send-magic-code with {email}
  2. Server emails a 6-digit code
  3. verify-magic-code with {email, code}
  4. Returns a user token

OAUTH (Google / GitHub / Apple):
  Use list-oauth-providers, then create-oauth-client.

GUEST AUTH (anonymous):
  POST /auth/sign_in_guest — returns a guest user token immediately.

STORAGE TOKENS:
  update-storage-config to set up Cloudinary/R2/S3.
  Files uploaded via /storage/upload-direct.

SELF-HOSTED DOCS: ${docs}/auth`,

        storage: `STORAGE:

PROVIDERS:
  - Cloudinary (default) — images, video, any file
  - R2 (Cloudflare) — S3-compatible, large files, no egress
  - S3 (AWS) — standard S3

CONFIGURE:
  update-storage-config with cloudName + uploadPreset (Cloudinary)
  or R2_* env vars (R2).

UPLOAD:
  1. get-upload-url — get presigned URL
  2. PUT file to the URL
  3. Save returned URL in a string attr on any entity

LIST: list-files returns all files with their URLs.

SELF-HOSTED DOCS: ${docs}/storage`,

        cli: `CLI COMMANDS:

INSTALL:
  npm install -g @fidscript/instant-cli

INIT (create app + scaffold):
  npx instant-cli init

PUSH (apply local files):
  npx instant-cli push schema
  npx instant-cli push perms

PULL (download):
  npx instant-cli pull

LOGIN (authenticate):
  npx instant-cli login --headless

SELF-HOSTED DOCS: ${docs}/cli`,

        android: `ANDROID / KOTLIN SDK:

INSTALL — add to settings.gradle.kts:
  dependencyResolutionManagement {
      repositories {
          maven { url = uri("${DEFAULT_MAVEN_URL}") }
          google()
          mavenCentral()
      }
  }

ADD to app/build.gradle.kts:
  implementation("com.instantdb:instantdb-android:0.8.0-phase10")
  implementation("com.instantdb:instantdb-kotlin:0.8.0-phase10")

INITIALIZE in your Application class:
  val db = InstantDb(
      context = this,
      config = InstantDbConfig(
          appId = "YOUR_APP_ID",
          host = "${DEFAULT_API_URL}",
          useSse = false  // true = SSE, false = WebSocket
      )
  )
  db.connect()

QUERY (Compose):
  val state = rememberInstantQuery("{ todos: {} }")
  when (state) {
      is InstantQueryState.Loading -> ...
      is InstantQueryState.Data -> { val todos = state.data["todos"] }
      is InstantQueryState.Error -> ...
      is InstantQueryState.Offline -> ...
  }

MUTATE:
  db.transact(listOf(listOf(
      "add", "todos",
      mapOf("text" to "hello", "done" to false)
  )))

SELF-HOSTED DOCS: ${docs}/start-android
SDK DASH: ${DEFAULT_DASH_URL}/dash?t=android-kotlin&app=YOUR_APP_ID
CROSS-PLATFORM: ${docs}/cross-platform`,
      };
      return {
        content: [{
          type: "text",
          text: (content as Record<string, string>)[t] || content.overview,
        }],
      };
    },
  );

  // ---- Data Operations ----

  tool(server,
    "query",
    "Execute an InstaQL query against an app. Returns query results as JSON. " +
      "Query structure: {namespace: {$: {where: {...}, limit: N}}}. " +
      "The 'where' clause MUST be nested inside '$' (use {$: {where: {...}}}, NOT {$where: {...}}). " +
      "For $or, wrap in 'and': {$: {where: {and: [{or: [...]}]}}}. " +
      "Format reference: call learn with topic='query'. " +
      "Docs: ${DEFAULT_DASH_URL}/docs/instaql (self-hosted).",
    {
      appId: z.string().uuid().describe("The InstantDB app ID (UUID)"),
      query: z.record(z.string(), z.any()).describe(
        "InstaQL query. Example: { todos: { $: { where: { done: false }, limit: 10 } } }"
      ),
    },
    async ({ appId, query }) => {
      try {
        const data = await adminQuery(apiURI, token, appId, query);
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      } catch (e: any) {
        return { isError: true, content: [{ type: "text", text: `Failed to query app ${appId}: ${e.message}` }] };
      }
    },
  );

  tool(server,
    "transact",
    "Execute a transaction to create/update/link/unlink/delete entities. " +
      "Step format: [op, namespace, ...args]. Ops: update (create or update), link, unlink, delete. " +
      "Examples: " +
      "['update', 'todos', 'new-id', {text: 'hello'}] — create/update; " +
      "['link', 'todos', 'id', {owner: 'user-id'}] — link; " +
      "['delete', 'todos', 'id'] — delete. " +
      "IMPORTANT: entity IDs in update/link/delete MUST be real UUIDs (use IDs returned from a previous query, or generate UUIDs for new entities). " +
      "Format reference: call learn with topic='transact'. " +
      "Docs: ${DEFAULT_DASH_URL}/docs/instaml (self-hosted).",
    {
      appId: z.string().uuid().describe("The InstantDB app ID (UUID)"),
      steps: z.array(z.array(z.any())).describe(
        "Array of step arrays. Each step: [op, namespace, ...args]. " +
        "Example: [['update', 'todos', 'id1', {text: 'hi'}], ['link', 'todos', 'id1', {owner: 'user-1'}]]"
      ),
    },
    async ({ appId, steps }) => {
      try {
        const data = await adminTransact(apiURI, token, appId, steps);
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      } catch (e: any) {
        return { isError: true, content: [{ type: "text", text: `Failed to transact on app ${appId}: ${e.message}` }] };
      }
    },
  );

  // ---- Schema ----

  tool(server,
    "get-schema",
    "Fetch the current schema (attribute definitions) for an app. Returns all namespaces, their attrs, refs, and blob fields.",
    {
      appId: z.string().uuid(),
    },
    async ({ appId }) => {
      try {
        const data = await getSchema(apiURI, token, appId);
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      } catch (e: any) {
        return { isError: true, content: [{ type: "text", text: `Failed to fetch schema for app ${appId}: ${e.message}` }] };
      }
    },
  );

  tool(server,
    "push-schema",
    "Push a schema definition. The schema parameter is a map of namespace names to " +
      "{attrs: {<name>: <type>}, links: {<name>: {collection, is_collection}}}. " +
      "Attribute types are lowercase strings: 'string' | 'number' | 'boolean' | 'date'. " +
      "Performs plan-then-apply. ALWAYS use push-schema-dry-run first to preview. " +
      "Format reference: call learn with topic='schema'. " +
      "Docs: ${DEFAULT_DASH_URL}/docs (self-hosted, NOT instantdb.com).",
    {
      appId: z.string().uuid().describe("The InstantDB app ID (UUID)"),
      schema: z.record(z.string(), z.any()).describe(
        "Schema object. Format: {namespace: {attrs: {name: type}, links: {name: {collection, is_collection}}}}." +
        " Example: { todos: { attrs: { text: 'string', done: 'boolean' } } }." +
        " DO NOT use the i.entity({...}) builder format — that is for the JS SDK, not this tool."
      ),
    },
    async ({ appId, schema }) => {
      try {
        const data = await pushSchema(apiURI, token, appId, schema);
        // Return a clean summary instead of the huge plan output
        const result = data.result || {};
        const stepCount = result['step-count'] || (result['steps'] ? result.steps.length : 0);
        const summary = {
          success: true,
          appId,
          stepsApplied: stepCount,
          newNamespaces: Object.keys(data.plan?.['new-schema']?.blobs || {}).filter(k => !k.startsWith('$')),
          message: `Schema pushed successfully with ${stepCount} steps`
        };
        return { content: [{ type: "text", text: JSON.stringify(summary, null, 2) }] };
      } catch (e: any) {
        return { isError: true, content: [{ type: "text", text: `Failed to push schema to app ${appId}: ${e.message}` }] };
      }
    },
  );

  tool(server,
    "push-schema-dry-run",
    "Preview what a schema push would do without applying it. Shows the diff between current and proposed schema. " +
      "Schema format: {namespace: {attrs: {name: type}, links: {name: {collection, is_collection}}}} " +
      "where types are 'string' | 'number' | 'boolean' | 'date'. " +
      "Format reference: call learn with topic='schema'.",
    {
      appId: z.string().uuid().describe("The InstantDB app ID (UUID)"),
      schema: z.record(z.string(), z.any()).describe(
        "Schema object. Example: { todos: { attrs: { text: 'string' } } }. " +
        "NOT the i.entity({...}) JS builder format."
      ),
    },
    async ({ appId, schema }) => {
      try {
        const data = await pushSchemaDryRun(apiURI, token, appId, schema);
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      } catch (e: any) {
        return { isError: true, content: [{ type: "text", text: `Failed to preview schema for app ${appId}: ${e.message}` }] };
      }
    },
  );

  // ---- Permissions ----

  tool(server,
    "get-perms",
    "Fetch the current permissions rules for an app. Returns the allow/deny rule definitions.",
    {
      appId: z.string().uuid(),
    },
    async ({ appId }) => {
      try {
        const data = await getPerms(apiURI, token, appId);
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      } catch (e: any) {
        return { isError: true, content: [{ type: "text", text: `Failed to fetch permissions for app ${appId}: ${e.message}` }] };
      }
    },
  );

  tool(server,
    "push-perms",
    "Push permission rules. CEL expressions. " +
      "Format: {namespace: {allow: {view: <cel>, create: <cel>, update: <cel>, delete: <cel>}}}. " +
      "Special values: 'true' (always), 'false' (never), 'auth.uid != null' (any signed-in user). " +
      "Data checks: 'auth.uid == data.field_name'. " +
      "Format reference: call learn with topic='perms'. " +
      "Docs: ${DEFAULT_DASH_URL}/docs/permissions (self-hosted).",
    {
      appId: z.string().uuid().describe("The InstantDB app ID (UUID)"),
      perms: z.record(z.string(), z.any()).describe(
        "Perms object. Example: { todos: { allow: { view: 'true', create: 'auth.uid != null' } } }"
      ),
    },
    async ({ appId, perms }) => {
      try {
        const data = await pushPerms(apiURI, token, appId, perms);
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      } catch (e: any) {
        return { isError: true, content: [{ type: "text", text: `Failed to push permissions to app ${appId}: ${e.message}` }] };
      }
    },
  );

  // ---- OAuth Provider Management ----

  tool(server,
    "create-oauth-provider",
    `Create an OAuth provider for social login. Supported: "google", "github".
Use list-oauth-providers first to see existing providers. Full setup: instant_learn with topic="oauth".`,
    {
      appId: z.string().uuid(),
      providerName: z.string().describe("Provider name (e.g., 'google' or 'github')"),
    },
    async ({ appId, providerName }) => {
      try {
        const data = await createOAuthProvider(apiURI, token, appId, providerName);
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      } catch (e: any) {
        return { isError: true, content: [{ type: "text", text: `Failed to create OAuth provider: ${e.message}` }] };
      }
    },
  );

  // ---- OAuth Client Management ----

  tool(server,
    "create-oauth-client",
    `Create an OAuth client for social login (Google/GitHub/Apple).
Use useSharedCredentials:true for development; provide clientId/clientSecret for production.
redirectTo must match exactly what you configure in your OAuth provider's authorized redirect URIs.
Full setup: instant_learn with topic="oauth".`,
    {
      appId: z.string().uuid(),
      providerId: z.string().uuid().describe("UUID of the OAuth provider"),
      clientName: z.string().describe("Name for this OAuth client (e.g., 'Google Login')"),
      redirectTo: z.string().url().describe("URL where Google redirects after auth"),
      clientId: z.string().optional().describe("Your OAuth client ID (if not using shared credentials)"),
      clientSecret: z.string().optional().describe("Your OAuth client secret (if not using shared credentials)"),
      discoveryEndpoint: z.string().optional().describe("OIDC discovery endpoint (for Google, etc.)"),
      meta: z.record(z.string(), z.any()).optional().describe("Additional metadata"),
      useSharedCredentials: z.boolean().optional().describe("Use InstantDB's shared OAuth credentials"),
    },
    async ({ appId, providerId, clientName, redirectTo, clientId, clientSecret, discoveryEndpoint, meta, useSharedCredentials }) => {
      try {
        const data = await createOAuthClient(apiURI, token, appId, providerId, clientName, redirectTo, {
          clientId,
          clientSecret,
          discoveryEndpoint,
          meta,
          useSharedCredentials,
        });
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      } catch (e: any) {
        return { isError: true, content: [{ type: "text", text: `Failed to create OAuth client: ${e.message}` }] };
      }
    },
  );

  tool(server,
    "update-oauth-client",
    `Update an existing OAuth client's settings (name, redirectTo, credentials, metadata).
IMPORTANT: When changing redirectTo, also update the redirect URI in your OAuth provider to match.`,
    {
      appId: z.string().uuid(),
      clientId: z.string().uuid().describe("UUID of the OAuth client to update"),
      clientName: z.string().optional().describe("Updated name"),
      redirectTo: z.string().optional().describe("Updated redirect URL"),
      oauthClientId: z.string().optional().describe("Updated OAuth client ID"),
      clientSecret: z.string().optional().describe("Updated OAuth client secret"),
      discoveryEndpoint: z.string().optional().describe("Updated OIDC discovery endpoint"),
      meta: z.record(z.string(), z.any()).optional().describe("Updated metadata"),
      useSharedCredentials: z.boolean().optional().describe("Toggle shared credentials"),
    },
    async ({ appId, clientId, clientName, redirectTo, oauthClientId, clientSecret, discoveryEndpoint, meta, useSharedCredentials }) => {
      try {
        const data = await updateOAuthClient(apiURI, token, appId, clientId, {
          clientName,
          redirectTo,
          clientId: oauthClientId,
          clientSecret,
          discoveryEndpoint,
          meta,
          useSharedCredentials,
        });
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      } catch (e: any) {
        return { isError: true, content: [{ type: "text", text: `Failed to update OAuth client: ${e.message}` }] };
      }
    },
  );

  tool(server,
    "delete-oauth-client",
    "Delete an OAuth client from an app.",
    {
      appId: z.string().uuid(),
      clientId: z.string().uuid().describe("UUID of the OAuth client to delete"),
    },
    async ({ appId, clientId }) => {
      try {
        const data = await deleteOAuthClient(apiURI, token, appId, clientId);
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      } catch (e: any) {
        return { isError: true, content: [{ type: "text", text: `Failed to delete OAuth client: ${e.message}` }] };
      }
    },
  );

  tool(server,
    "list-oauth-providers",
    `List all OAuth service providers configured for an app.

Use this to find provider IDs needed for creating OAuth clients.`,
    {
      appId: z.string().uuid(),
    },
    async ({ appId }) => {
      try {
        const data = await listOAuthProviders(apiURI, token, appId);
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      } catch (e: any) {
        return { isError: true, content: [{ type: "text", text: `Failed to list OAuth providers: ${e.message}` }] };
      }
    },
  );

  tool(server,
    "list-oauth-clients",
    `List all OAuth clients configured for an app.

Returns client IDs, names, redirect URIs, and provider info.`,
    {
      appId: z.string().uuid(),
    },
    async ({ appId }) => {
      try {
        const data = await listOAuthClients(apiURI, token, appId);
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      } catch (e: any) {
        return { isError: true, content: [{ type: "text", text: `Failed to list OAuth clients: ${e.message}` }] };
      }
    },
  );

  tool(server,
    "get-oauth-client",
    `Get detailed information about a specific OAuth client including:
- Client ID and secret (if configured)
- Redirect URIs
- Provider info
- Creation and update timestamps
- Meta data

Use this to review your OAuth client configuration before going live.`,
    {
      appId: z.string().uuid(),
      clientId: z.string().uuid().describe("UUID of the OAuth client"),
    },
    async ({ appId, clientId }) => {
      try {
        const data = await getOAuthClient(apiURI, token, appId, clientId);
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      } catch (e: any) {
        return { isError: true, content: [{ type: "text", text: `Failed to get OAuth client: ${e.message}` }] };
      }
    },
  );

  // ---- Redirect Origin Management ----

  tool(server,
    "list-redirect-origins",
    `List OAuth redirect origins. Service types: "generic" (exact host), "netlify" (site name), "vercel" (deployment + project), "custom-scheme" (mobile).`,
    {
      appId: z.string().uuid(),
    },
    async ({ appId }) => {
      try {
        const data = await listRedirectOrigins(apiURI, token, appId);
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      } catch (e: any) {
        return { isError: true, content: [{ type: "text", text: `Failed to list redirect origins: ${e.message}` }] };
      }
    },
  );

  tool(server,
    "add-redirect-origin",
    `Add OAuth redirect origin. service="generic" for exact host (params=["host"]),
"netlify" for site name, "vercel" for deployment+project, "custom-scheme" for mobile.`,
    {
      appId: z.string().uuid(),
      service: z.string().describe('Service type: "generic", "netlify", "vercel", or "custom-scheme"'),
      params: z.array(z.string()).describe("Service parameters (see description for format)"),
    },
    async ({ appId, service, params }) => {
      try {
        const data = await addRedirectOrigin(apiURI, token, appId, service, params);
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      } catch (e: any) {
        return { isError: true, content: [{ type: "text", text: `Failed to add redirect origin: ${e.message}` }] };
      }
    },
  );

  tool(server,
    "delete-redirect-origin",
    `Delete an authorized redirect origin.

Use list-redirect-origins to get the ID of the origin to delete.`,
    {
      appId: z.string().uuid(),
      originId: z.string().uuid().describe("UUID of the redirect origin to delete"),
    },
    async ({ appId, originId }) => {
      try {
        const data = await deleteRedirectOrigin(apiURI, token, appId, originId);
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      } catch (e: any) {
        return { isError: true, content: [{ type: "text", text: `Failed to delete redirect origin: ${e.message}` }] };
      }
    },
  );

  // ---- App Management ----

  tool(server,
    "list-apps",
    "List all apps associated with your account. Returns app IDs, titles, creation dates, and storage usage.",
    {},
    async () => {
      try {
        const data = await listApps(apiURI, token);
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      } catch (e: any) {
        return { isError: true, content: [{ type: "text", text: `Failed to list apps: ${e.message}` }] };
      }
    },
  );

  tool(server,
    "get-app",
    "Get detailed information about a specific app including title, created date, and storage stats.",
    {
      appId: z.string().uuid(),
    },
    async ({ appId }) => {
      try {
        const data = await getApp(apiURI, token, appId);
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      } catch (e: any) {
        return { isError: true, content: [{ type: "text", text: `Failed to fetch app ${appId}: ${e.message}` }] };
      }
    },
  );

  tool(server,
    "create-app",
    "Create a new InstantDB app. Returns the new app ID and details. After creating, use push-schema to define the data model.",
    {
      title: z.string().min(1).describe("Human-readable title for the new app"),
    },
    async ({ title }) => {
      try {
        const data = await createApp(apiURI, token, title);
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      } catch (e: any) {
        return { isError: true, content: [{ type: "text", text: `Failed to create app '${title}': ${e.message}` }] };
      }
    },
  );

  tool(server,
    "delete-app",
    "Permanently delete an app and all its data. This cannot be undone. Use with extreme caution.",
    {
      appId: z.string().uuid().describe("UUID of the app to delete"),
    },
    async ({ appId }) => {
      try {
        const data = await deleteApp(apiURI, token, appId);
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      } catch (e: any) {
        return { isError: true, content: [{ type: "text", text: `Failed to delete app ${appId}: ${e.message}` }] };
      }
    },
  );

  // ---- Storage ----

  tool(server,
    "list-files",
    "List all files uploaded to the app's storage. Returns filenames, sizes, and metadata.",
    {
      appId: z.string().uuid(),
    },
    async ({ appId }) => {
      try {
        const data = await listFiles(apiURI, token, appId);
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      } catch (e: any) {
        return { isError: true, content: [{ type: "text", text: `Failed to list storage files for app ${appId}: ${e.message}` }] };
      }
    },
  );

  tool(server,
    "delete-file",
    "Delete a file from the app's storage by its filename.",
    {
      appId: z.string().uuid(),
      filename: z.string().min(1).describe("Name/path of the file to delete"),
    },
    async ({ appId, filename }) => {
      try {
        const data = await deleteFile(apiURI, token, appId, filename);
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      } catch (e: any) {
        return { isError: true, content: [{ type: "text", text: `Failed to delete file '${filename}' from app ${appId}: ${e.message}` }] };
      }
    },
  );

  tool(server,
    "get-upload-url",
    "Get a pre-signed URL for uploading a file directly to storage. Upload the file to the returned URL using HTTP PUT.",
    {
      appId: z.string().uuid(),
      filename: z.string().min(1).describe("Desired filename/path for the upload (e.g. 'images/photo.jpg')"),
    },
    async ({ appId, filename }) => {
      try {
        const data = await getStorageUploadUrl(apiURI, token, appId, filename);
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      } catch (e: any) {
        return { isError: true, content: [{ type: "text", text: `Failed to get upload URL for '${filename}' on app ${appId}: ${e.message}` }] };
      }
    },
  );

  tool(server,
    "get-download-url",
    "Get a time-limited pre-signed URL for downloading a file from storage.",
    {
      appId: z.string().uuid(),
      filename: z.string().min(1).describe("Filename/path of the file to download"),
    },
    async ({ appId, filename }) => {
      try {
        const data = await getStorageDownloadUrl(apiURI, token, appId, filename);
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      } catch (e: any) {
        return { isError: true, content: [{ type: "text", text: `Failed to get download URL for '${filename}' on app ${appId}: ${e.message}` }] };
      }
    },
  );

  tool(server,
    "upload-file",
    `Upload a file directly to cloud storage and get back the public URL.
This is the simplest way to upload files - the file is uploaded to Cloudinary and you receive the direct public URL in response.
Use this to upload images, videos, documents, or any file type.

Response includes:
- url: The direct public Cloudinary URL you can use immediately
- id: File ID for reference
- path: The filename/path you provided
- size: File size in bytes
- contentType: The MIME type

After receiving the URL, save it to your database as a reference.`,
    {
      appId: z.string().uuid(),
      filename: z.string().min(1).describe("Path/name for the file (e.g. 'images/photo.jpg' or 'videos/intro.mp4')"),
      content: z.string().describe("Base64-encoded file content"),
      contentType: z.string().describe("MIME type (e.g. 'image/jpeg', 'video/mp4', 'application/pdf')"),
    },
    async ({ appId, filename, content, contentType }) => {
      try {
        const data = await uploadFileDirect(apiURI, token, appId, filename, content, contentType);
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      } catch (e: any) {
        return { isError: true, content: [{ type: "text", text: `Failed to upload file '${filename}' to app ${appId}: ${e.message}` }] };
      }
    },
  );

  tool(server,
    "list-uploaded-files",
    `List all files that have been uploaded to the app's storage.
Returns the public URL, filename, size, and upload timestamp for each file.
Use this to see the history of uploaded files and their public URLs for referencing in your database.`,
    {
      appId: z.string().uuid(),
    },
    async ({ appId }) => {
      try {
        const data = await listUploadedFiles(apiURI, token, appId);
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      } catch (e: any) {
        return { isError: true, content: [{ type: "text", text: `Failed to list uploaded files for app ${appId}: ${e.message}` }] };
      }
    },
  );

  // ---- Storage Config ----

  tool(server,
    "get-storage-config",
    "Get the current storage configuration for an app (Cloudinary or S3). Returns the provider type, cloud name, and whether secrets are configured.",
    {
      appId: z.string().uuid(),
    },
    async ({ appId }) => {
      try {
        const data = await getStorageConfig(apiURI, token, appId);
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      } catch (e: any) {
        return { isError: true, content: [{ type: "text", text: `Failed to get storage config for app ${appId}: ${e.message}` }] };
      }
    },
  );

  tool(server,
    "update-storage-config",
    `Update the storage configuration for an app to use custom Cloudinary credentials.

Required for Cloudinary:
- cloudName: Your Cloudinary cloud name
- uploadPreset: The unsigned upload preset name

Optional:
- apiKey: Cloudinary API key (for server-side operations)
- apiSecret: Cloudinary API secret (for server-side operations)

Example - configure custom Cloudinary:
{
  "cloudName": "my-cloud",
  "uploadPreset": "my_unsigned_preset"
}`,
    {
      appId: z.string().uuid(),
      cloudName: z.string().optional().describe("Cloudinary cloud name"),
      apiKey: z.string().optional().describe("Cloudinary API key"),
      apiSecret: z.string().optional().describe("Cloudinary API secret"),
      uploadPreset: z.string().optional().describe("Cloudinary unsigned upload preset"),
    },
    async ({ appId, cloudName, apiKey, apiSecret, uploadPreset }) => {
      try {
        const data = await updateStorageConfig(apiURI, token, appId, {
          cloudName,
          apiKey,
          apiSecret,
          uploadPreset,
        });
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      } catch (e: any) {
        return { isError: true, content: [{ type: "text", text: `Failed to update storage config for app ${appId}: ${e.message}` }] };
      }
    },
  );

  tool(server,
    "delete-storage-config",
    "Remove custom storage configuration and revert to using the default storage provider.",
    {
      appId: z.string().uuid(),
    },
    async ({ appId }) => {
      try {
        const data = await deleteStorageConfig(apiURI, token, appId);
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      } catch (e: any) {
        return { isError: true, content: [{ type: "text", text: `Failed to delete storage config for app ${appId}: ${e.message}` }] };
      }
    },
  );

  // ---- Webhooks ----

  tool(server,
    "list-webhooks",
    "List all webhooks configured for an app. Returns webhook IDs, URLs, namespaces, actions, and status.",
    {
      appId: z.string().uuid(),
    },
    async ({ appId }) => {
      try {
        const data = await listWebhooks(apiURI, token, appId);
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      } catch (e: any) {
        return { isError: true, content: [{ type: "text", text: `Failed to list webhooks for app ${appId}: ${e.message}` }] };
      }
    },
  );

  tool(server,
    "create-webhook",
    `Create a new webhook to receive notifications when data changes.

namespaces: which entity types to watch (e.g. ["todos", "posts"])
actions: which operations to notify on (e.g. ["create", "update", "delete"])
url: the HTTPS endpoint to send webhook payloads to`,
    {
      appId: z.string().uuid(),
      url: z.string().url().describe("HTTPS URL to receive webhook payloads"),
      namespaces: z.array(z.string()).describe("List of namespace names to watch (e.g. ['todos', 'posts'])"),
      actions: z.array(z.string()).describe("List of actions to trigger on (e.g. ['create', 'update', 'delete'])"),
    },
    async ({ appId, url, namespaces, actions }) => {
      try {
        const data = await createWebhook(apiURI, token, appId, url, namespaces, actions);
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      } catch (e: any) {
        return { isError: true, content: [{ type: "text", text: `Failed to create webhook on app ${appId}: ${e.message}` }] };
      }
    },
  );

  tool(server,
    "update-webhook",
    "Update an existing webhook's URL, watched namespaces, or actions.",
    {
      appId: z.string().uuid(),
      webhookId: z.string().uuid().describe("UUID of the webhook to update"),
      url: z.string().url().optional().describe("New HTTPS URL for the webhook"),
      namespaces: z.array(z.string()).optional().describe("Updated list of namespaces to watch"),
      actions: z.array(z.string()).optional().describe("Updated list of actions to trigger on"),
    },
    async ({ appId, webhookId, ...updates }) => {
      try {
        const data = await updateWebhook(apiURI, token, appId, webhookId, updates);
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      } catch (e: any) {
        return { isError: true, content: [{ type: "text", text: `Failed to update webhook ${webhookId} on app ${appId}: ${e.message}` }] };
      }
    },
  );

  tool(server,
    "delete-webhook",
    "Delete a webhook. The endpoint will no longer receive notifications.",
    {
      appId: z.string().uuid(),
      webhookId: z.string().uuid().describe("UUID of the webhook to delete"),
    },
    async ({ appId, webhookId }) => {
      try {
        const data = await deleteWebhook(apiURI, token, appId, webhookId);
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      } catch (e: any) {
        return { isError: true, content: [{ type: "text", text: `Failed to delete webhook ${webhookId} from app ${appId}: ${e.message}` }] };
      }
    },
  );

  tool(server,
    "enable-webhook",
    "Re-enable a previously disabled webhook.",
    {
      appId: z.string().uuid(),
      webhookId: z.string().uuid().describe("UUID of the webhook to enable"),
    },
    async ({ appId, webhookId }) => {
      try {
        const data = await enableWebhook(apiURI, token, appId, webhookId);
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      } catch (e: any) {
        return { isError: true, content: [{ type: "text", text: `Failed to enable webhook ${webhookId} on app ${appId}: ${e.message}` }] };
      }
    },
  );

  tool(server,
    "disable-webhook",
    "Temporarily disable a webhook. It can be re-enabled later.",
    {
      appId: z.string().uuid(),
      webhookId: z.string().uuid().describe("UUID of the webhook to disable"),
      reason: z.string().optional().describe("Optional reason for disabling"),
    },
    async ({ appId, webhookId, reason }) => {
      try {
        const data = await disableWebhook(apiURI, token, appId, webhookId, reason);
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      } catch (e: any) {
        return { isError: true, content: [{ type: "text", text: `Failed to disable webhook ${webhookId} on app ${appId}: ${e.message}` }] };
      }
    },
  );

  tool(server,
    "get-webhook-events",
    "Get recent webhook delivery events (successes and failures) with attempt history.",
    {
      appId: z.string().uuid(),
      webhookId: z.string().uuid().describe("UUID of the webhook"),
      after: z.string().optional().describe("Pagination cursor from previous response"),
    },
    async ({ appId, webhookId, after }) => {
      try {
        const data = await getWebhookEvents(apiURI, token, appId, webhookId, after);
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      } catch (e: any) {
        return { isError: true, content: [{ type: "text", text: `Failed to fetch events for webhook ${webhookId} on app ${appId}: ${e.message}` }] };
      }
    },
  );

  tool(server,
    "resend-webhook-event",
    "Re-trigger delivery of a specific webhook event (for retrying failed deliveries).",
    {
      appId: z.string().uuid(),
      webhookId: z.string().uuid().describe("UUID of the webhook"),
      eventId: z.string().describe("The event ISN identifier from get-webhook-events"),
    },
    async ({ appId, webhookId, eventId }) => {
      try {
        const data = await resendWebhookEvent(apiURI, token, appId, webhookId, eventId);
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      } catch (e: any) {
        return { isError: true, content: [{ type: "text", text: `Failed to resend event ${eventId} for webhook ${webhookId} on app ${appId}: ${e.message}` }] };
      }
    },
  );

  // ---- Backups ----

  tool(server,
    "list-backups",
    "List all backups for an app. Returns backup IDs, creation dates, descriptions, and status.",
    {
      appId: z.string().uuid(),
    },
    async ({ appId }) => {
      try {
        const data = await listBackups(apiURI, token, appId);
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      } catch (e: any) {
        return { isError: true, content: [{ type: "text", text: `Failed to list backups for app ${appId}: ${e.message}` }] };
      }
    },
  );

  tool(server,
    "create-backup",
    "Create an on-demand backup of the app. Returns a job object you can poll with get-backup-job.",
    {
      appId: z.string().uuid(),
      description: z.string().optional().describe("Optional description for the backup"),
    },
    async ({ appId, description }) => {
      try {
        const data = await createBackup(apiURI, token, appId, description);
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      } catch (e: any) {
        return { isError: true, content: [{ type: "text", text: `Failed to create backup for app ${appId}: ${e.message}` }] };
      }
    },
  );

  tool(server,
    "delete-backup",
    "Delete a backup. The backup's storage is freed (S3 objects expire automatically).",
    {
      appId: z.string().uuid(),
      backupId: z.string().uuid().describe("UUID of the backup to delete"),
    },
    async ({ appId, backupId }) => {
      try {
        const data = await deleteBackup(apiURI, token, appId, backupId);
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      } catch (e: any) {
        return { isError: true, content: [{ type: "text", text: `Failed to delete backup ${backupId} from app ${appId}: ${e.message}` }] };
      }
    },
  );

  tool(server,
    "list-backup-jobs",
    "List in-progress backup jobs for an app. Use this to check status of recently started backups.",
    {
      appId: z.string().uuid(),
    },
    async ({ appId }) => {
      try {
        const data = await listBackupJobs(apiURI, token, appId);
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      } catch (e: any) {
        return { isError: true, content: [{ type: "text", text: `Failed to list backup jobs for app ${appId}: ${e.message}` }] };
      }
    },
  );

  tool(server,
    "get-backup-job",
    "Get the status of a specific backup job including progress percentage.",
    {
      appId: z.string().uuid(),
      jobId: z.string().uuid().describe("UUID of the backup job"),
    },
    async ({ appId, jobId }) => {
      try {
        const data = await getBackupJob(apiURI, token, appId, jobId);
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      } catch (e: any) {
        return { isError: true, content: [{ type: "text", text: `Failed to get backup job ${jobId} for app ${appId}: ${e.message}` }] };
      }
    },
  );

  tool(server,
    "cancel-backup-job",
    "Cancel an in-progress backup job. A processing job will abort at its next checkpoint.",
    {
      appId: z.string().uuid(),
      jobId: z.string().uuid().describe("UUID of the backup job to cancel"),
    },
    async ({ appId, jobId }) => {
      try {
        const data = await cancelBackupJob(apiURI, token, appId, jobId);
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      } catch (e: any) {
        return { isError: true, content: [{ type: "text", text: `Failed to cancel backup job ${jobId} for app ${appId}: ${e.message}` }] };
      }
    },
  );

  tool(server,
    "list-backup-files",
    "List the data files included in a specific backup (for inspection before restore).",
    {
      appId: z.string().uuid(),
      backupId: z.string().uuid().describe("UUID of the backup"),
    },
    async ({ appId, backupId }) => {
      try {
        const data = await listBackupFiles(apiURI, token, appId, backupId);
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      } catch (e: any) {
        return { isError: true, content: [{ type: "text", text: `Error listing backup files: ${e.message}` }] };
      }
    },
  );

  tool(server,
    "get-backup-file-url",
    "Get a pre-signed URL to download a specific file from a backup (for inspection).",
    {
      appId: z.string().uuid(),
      backupId: z.string().uuid().describe("UUID of the backup"),
      filename: z.string().min(1).describe("Name of the file to download (from list-backup-files)"),
    },
    async ({ appId, backupId, filename }) => {
      try {
        const data = await getBackupFileUrl(apiURI, token, appId, backupId, filename);
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      } catch (e: any) {
        return { isError: true, content: [{ type: "text", text: `Error getting backup file URL: ${e.message}` }] };
      }
    },
  );

  // ---- Test Users ----

  tool(server,
    "list-test-users",
    "List all test users for an app. Test users are guest accounts for development testing.",
    {
      appId: z.string().uuid(),
    },
    async ({ appId }) => {
      try {
        const data = await listTestUsers(apiURI, token, appId);
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      } catch (e: any) {
        return { isError: true, content: [{ type: "text", text: `Error listing test users: ${e.message}` }] };
      }
    },
  );

  tool(server,
    "create-test-user",
    `Create a test user for development testing. The test user can be signed in as without email verification.

The 6-digit code is the magic code the test user enters to sign in. You can share this code with your team for testing.`,
    {
      appId: z.string().uuid(),
      email: z.string().email().describe("Email address for the test user"),
      code: z.string().regex(/^\d{6}$/, "Must be exactly 6 digits").describe("6-digit sign-in code (e.g. '123456')"),
    },
    async ({ appId, email, code }) => {
      try {
        const data = await createTestUser(apiURI, token, appId, email, code);
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      } catch (e: any) {
        return { isError: true, content: [{ type: "text", text: `Error creating test user: ${e.message}` }] };
      }
    },
  );

  tool(server,
    "delete-test-user",
    "Delete a test user from an app.",
    {
      appId: z.string().uuid(),
      testUserId: z.string().uuid().describe("UUID of the test user to delete"),
    },
    async ({ appId, testUserId }) => {
      try {
        const data = await deleteTestUser(apiURI, token, appId, testUserId);
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      } catch (e: any) {
        return { isError: true, content: [{ type: "text", text: `Error deleting test user: ${e.message}` }] };
      }
    },
  );

  // ---- Email Templates ----

  tool(server,
    "get-email-template",
    "Get the current email template used for magic code authentication. Returns subject, body, and sender info.",
    {},
    async () => {
      try {
        const data = await getEmailTemplate(apiURI, token);
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      } catch (e: any) {
        return { isError: true, content: [{ type: "text", text: `Error fetching email template: ${e.message}` }] };
      }
    },
  );

  tool(server,
    "update-email-template",
    `Update email template. Both subject and body MUST include {code}.
Available vars: {code}, {app_title}, {user_email}, {expiration}.`,
    {
      appId: z.string().uuid(),
      subject: z.string().describe("Email subject line (must include {code})"),
      body: z.string().describe("Email body HTML (must include {code})"),
      senderEmail: z.string().email().optional().describe("Custom sender email address"),
      senderName: z.string().optional().describe("Custom sender display name"),
    },
    async ({ appId, subject, body, senderEmail, senderName }) => {
      try {
        const data = await updateEmailTemplate(apiURI, token, appId, subject, body, senderEmail, senderName);
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      } catch (e: any) {
        return { isError: true, content: [{ type: "text", text: `Error updating email template: ${e.message}` }] };
      }
    },
  );

  tool(server,
    "send-test-email",
    "Send a test email to verify your email template configuration. The recipient must be an authorized app member.",
    {
      appId: z.string().uuid(),
      to: z.string().email().describe("Recipient email address (must be an app member)"),
      subject: z.string().describe("Email subject"),
      body: z.string().describe("Email body HTML"),
      senderEmail: z.string().email().optional().describe("Sender email (uses app default if not provided)"),
      senderName: z.string().optional().describe("Sender display name"),
    },
    async ({ appId, to, subject, body, senderEmail, senderName }) => {
      try {
        const data = await sendTestEmail(apiURI, token, appId, to, subject, body, senderEmail, senderName);
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      } catch (e: any) {
        return { isError: true, content: [{ type: "text", text: `Error sending test email: ${e.message}` }] };
      }
    },
  );

  // ---- Org Management ----

  tool(server,
    "list-orgs",
    "List all organizations (workspaces) associated with your account. Returns org IDs, titles, and creation dates.",
    {},
    async () => {
      try {
        const data = await listOrgs(apiURI, token);
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      } catch (e: any) {
        return { isError: true, content: [{ type: "text", text: `Error listing orgs: ${e.message}` }] };
      }
    },
  );

  tool(server,
    "get-org",
    "Get detailed information about a specific org/workspace including apps, members, and invites.",
    {
      orgId: z.string().uuid().describe("UUID of the organization"),
    },
    async ({ orgId }) => {
      try {
        const data = await getOrg(apiURI, token, orgId);
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      } catch (e: any) {
        return { isError: true, content: [{ type: "text", text: `Error fetching org: ${e.message}` }] };
      }
    },
  );

  tool(server,
    "list-org-apps",
    "List all apps in an org. Optionally includes schema and perms in the response.",
    {
      orgId: z.string().uuid().describe("UUID of the organization"),
      include: z.string().optional().describe("Comma-separated include list: 'schema,perms'"),
    },
    async ({ orgId, include }) => {
      try {
        const data = await getOrgApps(apiURI, token, orgId, include);
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      } catch (e: any) {
        return { isError: true, content: [{ type: "text", text: `Error listing org apps: ${e.message}` }] };
      }
    },
  );

  // ---- App Members ----

  tool(server,
    "invite-app-member",
    "Invite a user to an app with a specific role. They will receive an email invitation.",
    {
      appId: z.string().uuid(),
      email: z.string().email().describe("Email address of the user to invite"),
      role: z.enum(["collaborator", "admin", "owner"]).describe("Role to assign: collaborator, admin, or owner"),
    },
    async ({ appId, email, role }) => {
      try {
        const data = await inviteAppMember(apiURI, token, appId, email, role);
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      } catch (e: any) {
        return { isError: true, content: [{ type: "text", text: `Error inviting member: ${e.message}` }] };
      }
    },
  );

  tool(server,
    "remove-app-member",
    "Remove a member from an app.",
    {
      appId: z.string().uuid(),
      memberId: z.string().uuid().describe("UUID of the member to remove"),
    },
    async ({ appId, memberId }) => {
      try {
        const data = await removeAppMember(apiURI, token, appId, memberId);
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      } catch (e: any) {
        return { isError: true, content: [{ type: "text", text: `Error removing member: ${e.message}` }] };
      }
    },
  );

  tool(server,
    "update-app-member",
    "Update a member's role on an app.",
    {
      appId: z.string().uuid(),
      memberId: z.string().uuid().describe("UUID of the member to update"),
      role: z.enum(["collaborator", "admin", "owner"]).describe("New role: collaborator, admin, or owner"),
    },
    async ({ appId, memberId, role }) => {
      try {
        const data = await updateAppMember(apiURI, token, appId, memberId, role);
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      } catch (e: any) {
        return { isError: true, content: [{ type: "text", text: `Error updating member: ${e.message}` }] };
      }
    },
  );

  // ---- Sender Verification ----

  tool(server,
    "get-sender-verification",
    "Get sender verification status for an app. Shows whether sending domain is verified via Postmark DKIM/Return-Path.",
    {
      appId: z.string().uuid(),
    },
    async ({ appId }) => {
      try {
        const data = await getSenderVerification(apiURI, token, appId);
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      } catch (e: any) {
        return { isError: true, content: [{ type: "text", text: `Error fetching sender verification: ${e.message}` }] };
      }
    },
  );

  tool(server,
    "send-sender-verification",
    "Send a sender verification email to your sending domain. Complete verification by calling verify-sender-code with the 6-digit code from the email.",
    {
      appId: z.string().uuid(),
    },
    async ({ appId }) => {
      try {
        const data = await sendSenderVerificationCode(apiURI, token, appId);
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      } catch (e: any) {
        return { isError: true, content: [{ type: "text", text: `Error sending verification code: ${e.message}` }] };
      }
    },
  );

  tool(server,
    "verify-sender-code",
    "Complete sender domain verification by providing the 6-digit code from the verification email.",
    {
      appId: z.string().uuid(),
      code: z.string().regex(/^\d{6}$/, "Must be exactly 6 digits").describe("6-digit verification code from the email"),
    },
    async ({ appId, code }) => {
      try {
        const data = await verifySenderCode(apiURI, token, appId, code);
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      } catch (e: any) {
        return { isError: true, content: [{ type: "text", text: `Error verifying sender: ${e.message}` }] };
      }
    },
  );

  // ---- Android / Kotlin SDK ----
  //
  // Safe, read-only tools for the native Android SDK. These do NOT
  // expose credentials. They provide version information, configuration
  // templates, schema introspection, and documentation pointers.
  //
  // Per security policy:
  //   - no admin tokens are read or returned
  //   - no refresh tokens are read or returned
  //   - no private database credentials are exposed
  //   - schema data is limited to non-sensitive attribute metadata

  tool(server,
    "android-sdk-version",
    "Return the current Android / Kotlin SDK version and artifact coordinates. " +
      "Safe; returns only public version metadata. No credentials.",
    {},
    async () => {
      const info = {
        sdk: "instantdb-android",
        version: "0.8.0-phase10",
        artifacts: {
          android: "com.instantdb:instantdb-android:0.8.0-phase10",
          kotlin: "com.instantdb:instantdb-kotlin:0.8.0-phase10",
        },
        supports: ["Kotlin 2.0+", "JVM", "Android (AndroidSqliteDriver)"],
        transports: ["websocket", "sse"],
        min_android_sdk: 24,
        target_android_sdk: 34,
        transport_polymorphism: true,
      };
      return { content: [{ type: "text", text: JSON.stringify(info, null, 2) }] };
    },
  );

  tool(server,
    "android-installation",
    "Return the Gradle dependency snippet for the Android / Kotlin SDK. " +
      "No credentials are returned.",
    {
      version: z.string().optional().describe(
        "Optional SDK version (default: 0.8.0-phase10). " +
        "Must be a published Maven artifact."
      ),
    },
    async ({ version }) => {
      const v = version || "0.8.0-phase10";
      const snippet = `// settings.gradle.kts\n` +
        `dependencyResolutionManagement {\n` +
        `    repositories {\n` +
        `        maven { url = uri("${DEFAULT_MAVEN_URL}") }\n` +
        `        google()\n` +
        `        mavenCentral()\n` +
        `    }\n` +
        `}\n` +
        `\n` +
        `// app/build.gradle.kts\n` +
        `dependencies {\n` +
        `    implementation("com.instantdb:instantdb-android:${v}")\n` +
        `    implementation("com.instantdb:instantdb-kotlin:${v}")\n` +
        `}`;
      return {
        content: [{
          type: "text",
          text: JSON.stringify({ version: v, gradle_snippet: snippet }, null, 2),
        }],
      };
    },
  );

  tool(server,
    "android-configuration",
    "Return the SDK initialization snippet for Android. " +
      "Use this to bootstrap an Android application with the Kotlin SDK. " +
      "No credentials are embedded in the snippet.",
    {},
    async () => {
      // Corrected to match com.instantdb.android.InstantDbConfig
      const snippet = `// Android application
val instant = InstantDb(
    context = applicationContext,
    config = InstantDbConfig(
        appId = "YOUR_APP_ID",       // From InstantDB dashboard
        host = "https://api.example.com",  // Your server origin
        useSse = false,            // true = SSE, false = WebSocket (default)
    )
)

// Connect (uses secure credential storage on Android)
instant.connect()

// Query reactive data
instant.queryFlow("{ todos: { $: { $: {} } } }")

// Execute transactions
instant.transact(listOf(listOf("add", "todos", mapOf("title" to "Hello"))))

// Connection state
instant.connectionState.value  // ConnectionState.Connected / Disconnected / Error

// Clean shutdown
instant.close()`;
      return {
        content: [{
          type: "text",
          text: JSON.stringify({ kotlin_snippet: snippet }, null, 2),
        }],
      };
    },
  );

  tool(server,
    "android-documentation",
    "Return pointers to the SELF-HOSTED InstantDB docs (${DEFAULT_DASH_URL}). " +
      "DO NOT use the upstream instantdb.com docs — this is a self-hosted " +
      "deployment and the docs may differ.",
    {},
    async () => {
      const docs = {
        overview: `${DEFAULT_DASH_URL}/docs`,
        android_sdk: `${DEFAULT_DASH_URL}/docs/start-android`,
        android_dash: `${DEFAULT_DASH_URL}/dash?t=android-kotlin&app=YOUR_APP_ID`,
        auth: `${DEFAULT_DASH_URL}/docs/auth`,
        schema: `${DEFAULT_DASH_URL}/docs/init`,
        permissions: `${DEFAULT_DASH_URL}/docs/permissions`,
        query: `${DEFAULT_DASH_URL}/docs/instaql`,
        react_native: `${DEFAULT_DASH_URL}/docs/start-rn`,
        storage: `${DEFAULT_DASH_URL}/docs/storage`,
        cross_platform: `${DEFAULT_DASH_URL}/docs/cross-platform`,
        mcp_learn: "Use the MCP 'learn' tool with topic='overview' for full docs context.",
      };
      return { content: [{ type: "text", text: JSON.stringify(docs, null, 2) }] };
    },
  );

  tool(server,
    "android-schema",
    "Return non-credential schema metadata for the configured app: " +
      "namespace names, attribute forward IDs, forward etypes, and forward " +
      "labels. Does NOT return values or auth tokens.",
    {
      appId: z.string().optional().describe(
        "Optional app id. Defaults to the configured default app id."
      ),
    },
    async ({ appId }: { appId?: string }) => {
      try {
        const target = appId || _appId;
        const data = await getSchema(apiURI, token, target);
        // Reduce to a safe, non-credential subset.
        const safe = (data as any).attrs?.map((a: any) => ({
          id: a.id,
          forward_etype: a["forward-identity"]?.[1],
          forward_label: a["forward-identity"]?.[2],
          is_unique: a["unique?"],
          is_indexed: a["index?"],
          is_required: a["required?"],
        })) ?? [];
        return {
          content: [{
            type: "text",
            text: JSON.stringify({ app_id: target, attrs: safe }, null, 2),
          }],
        };
      } catch (e: any) {
        return { isError: true, content: [{ type: "text", text: `Error: ${e.message}` }] };
      }
    },
  );

  tool(server,
    "android-capabilities",
    "Return a list of supported Android / Kotlin SDK capabilities. " +
      "Read-only; no credentials.",
    {},
    async () => {
      const capabilities = {
        persistence: {
          store: "SQLite (SQLDelight)",
          driver: "AndroidSqliteDriver",
          schema_version: 2,
        },
        transport: {
          websocket: "InstantTransport",
          sse: "SseTransport",
          polymorphism: true,
        },
        android_specific: {
          credential_storage: "EncryptedSharedPreferences (Android Keystore)",
          connectivity_monitoring: "ConnectivityManager + NetworkCallback",
          compose_integration: "rememberInstantQuery() composable",
        },
        reactive: {
          api: "instant.queryFlow(q) returns Flow<JsonObject>",
          subscription: "lifecycle-aware via rememberInstantQuery()",
        },
        mutations: {
          api: "instant.transact(steps)",
          optimistic: true,
          persistent_queue: true,
        },
        security: {
          credential_redaction: true,
          secure_storage: "Android Keystore AES-256-GCM",
        },
      };
      return { content: [{ type: "text", text: JSON.stringify(capabilities, null, 2) }] };
    },
  );

  tool(server,
    "android-sync-status",
    "Return safe, non-credential sync state for the configured app. " +
      "Does NOT expose credentials or auth tokens. " +
      "Note: real-time per-client state lives inside the SDK; this is " +
      "informational only.",
    {},
    async () => {
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            note: "Real-time sync state lives inside the client SDK. " +
                  "Read it at runtime via the SDK diagnostics API; " +
                  "MCP cannot expose per-client state.",
          }, null, 2),
        }],
      };
    },
  );

  tool(server,
    "android-setup-guide",
    "Step-by-step setup guide for an Android app with the InstantDB SDK. " +
      "Returns a complete walkthrough: Gradle config, manifest permissions, " +
      "Application class, Compose UI, queries, transacts, and how to " +
      "share the same data with web. No credentials.",
    {
      app_id: z.string().optional().describe(
        "Your InstantDB app id (UUID). Returned in snippets if provided."
      ),
      host: z.string().optional().describe(
        "API host. Defaults to INSTANT_API_HOST env var."
      ),
      transport: z.enum(["websocket", "sse"]).optional().describe(
        "Transport to use. Default: websocket."
      ),
    },
    async ({ app_id, host, transport }) => {
      const aid = app_id || "YOUR_APP_ID";
      const h = host || DEFAULT_API_URL;
      const t = transport || "websocket";
      const useSse = t === "sse";

      const guide = {
        overview: "Five steps to add InstantDB to a native Android app. " +
                  "Same app_id shares data with web/iOS/etc.",
        step_1_dependencies: {
          file: "settings.gradle.kts",
          snippet:
`dependencyResolutionManagement {
    repositories {
        maven { url = uri("${DEFAULT_MAVEN_URL}") }
        google()
        mavenCentral()
    }
}`,
        },
        step_1b_app_gradle: {
          file: "app/build.gradle.kts",
          snippet:
`dependencies {
    implementation("com.instantdb:instantdb-android:0.8.0-phase10")
    implementation("com.instantdb:instantdb-kotlin:0.8.0-phase10")
}`,
        },
        step_2_manifest: {
          file: "app/src/main/AndroidManifest.xml",
          snippet:
`<!-- Required for real-time sync -->
<uses-permission android:name="android.permission.INTERNET" />
<uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />`,
        },
        step_3_application: {
          file: "app/src/main/kotlin/.../MyApplication.kt",
          snippet:
`import android.app.Application
import com.instantdb.android.InstantDb
import com.instantdb.android.InstantDbConfig

class MyApplication : Application() {
    // One InstantDb instance per app. Use the same appId across
    // platforms (web/iOS/Android) to share data.
    val db: InstantDb by lazy {
        InstantDb(
            context = this,
            config = InstantDbConfig(
                appId = "${aid}",
                host = "${h}",
                useSse = ${useSse},
            )
        )
    }

    override fun onCreate() {
        super.onCreate()
        // connect() is suspend; launch in a coroutine scope
        kotlinx.coroutines.GlobalScope.launch(kotlinx.coroutines.Dispatchers.IO) {
            db.connect()
        }
    }
}`,
        },
        step_4_compose_query: {
          file: "app/src/main/kotlin/.../MainActivity.kt",
          snippet:
`import androidx.compose.runtime.*
import com.instantdb.android.rememberInstantQuery

@Composable
fun TodoList() {
    val state = rememberInstantQuery("{ todos: { \\$: { where: { done: false } } } }")
    when (state) {
        is com.instantdb.android.InstantQueryState.Loading -> Text("Loading...")
        is com.instantdb.android.InstantQueryState.Error -> Text("Error: ${'$'}{state.message}")
        is com.instantdb.android.InstantQueryState.Data -> {
            val todos = state.data["todos"] as? List<Map<String, Any>> ?: emptyList()
            LazyColumn {
                items(todos) { todo ->
                    Text(todo["text"]?.toString() ?: "")
                }
            }
        }
        else -> {}
    }
}`,
        },
        step_5_transact: {
          file: "app/src/main/kotlin/.../AddTodo.kt",
          snippet:
`import kotlinx.serialization.json.*
import kotlinx.coroutines.launch
import androidx.compose.runtime.rememberCoroutineScope

@Composable
fun AddTodoButton() {
    val scope = rememberCoroutineScope()
    Button(onClick = {
        scope.launch {
            (applicationContext as MyApplication).db.transact(
                listOf(listOf(
                    JsonPrimitive("add"),
                    JsonPrimitive("todos"),
                    JsonObject(mapOf(
                        "text" to JsonPrimitive("Buy milk"),
                        "done" to JsonPrimitive(false)
                    ))
                ))
            )
        }
    }) { Text("Add") }
}`,
        },
        cross_platform_note: {
          summary: "Same appId across all clients shares the same database.",
          details: "Use the same appId in your web app's @fidscript/instant-sdk " +
                   "init() call. Todos created on Android appear in the web app " +
                   "in real-time, and vice versa. No extra config needed — the " +
                   "VPS routes by appId.",
        },
        verify_local: {
          step_1: `Run a Kotlin test against the public Maven repo: ${DEFAULT_MAVEN_URL}/com/instantdb/instantdb-kotlin/0.8.0-phase10/`,
          step_2: "Use the docker sample at /home/ken/projects/kotlin-poc/sample-android",
          step_3: `Public docs: ${DEFAULT_DASH_URL}/docs/start-android`,
        },
      };

      return {
        content: [{
          type: "text",
          text: JSON.stringify(guide, null, 2),
        }],
      };
    },
  );

  tool(server,
    "android-cross-platform",
    "Explain how to share data between the Android app and other InstantDB " +
      "clients (web, iOS, React Native, etc.). Returns a working code sample " +
      "for both sides and the URL to the public docs.",
    {
      app_id: z.string().optional().describe(
        "Your InstantDB app id (UUID). Returned in snippets if provided."
      ),
    },
    async ({ app_id }) => {
      const aid = app_id || "YOUR_APP_ID";

      const guide = {
        overview: "InstantDB shares data across all clients with the same " +
                  "appId. The same `appId` works in Android, web, iOS, React " +
                  "Native, SolidJS, Svelte, Vue, Python, and Kotlin/JVM.",
        architecture: {
          description: "All clients connect to the same backend and read/write " +
                       "to the same database, keyed by appId.",
          diagram: "Android --\\\n" +
                   "         \\\n" +
                   "          > [ InstantDB VPS ] -- same DB\n" +
                   "         /\n" +
                   "  Web --/",
        },
        android_side: {
          description: "Run InstantDb with the same appId as the web app.",
          snippet:
`val db = InstantDb(
    context = this,
    config = InstantDbConfig(
        appId = "${aid}",
        host = "${DEFAULT_API_URL}",
        useSse = false,
    )
)
db.connect()

// Add a todo from Android
db.transact(listOf(listOf(
    "add", "todos",
    mapOf("text" to "Hello from Android", "done" to false)
)))`,
        },
        web_side: {
          description: "Use the same appId in the JS SDK.",
          snippet:
`import { init, id } from "@fidscript/instant-sdk";

const db = init({ appId: "${aid}" });

// Subscribe — the Android-side todo will appear here in real-time
db.subscribeQuery({ todos: {} }, (resp) => {
    console.log("Todos:", resp.data.todos);
});

// Add a todo from web — Android will receive it
db.transact(
    db.tx.todos[id()].update({ text: "Hello from web", done: false })
);`,
        },
        verification: {
          step_1: "Open the web app in a browser tab.",
          step_2: "Open the Android app on a connected device.",
          step_3: "Add a todo in either — it appears in the other within " +
                  "milliseconds (real-time sync over SSE or WebSocket).",
          step_4: "Same applies to iOS, React Native, SolidJS, Svelte, " +
                  "Vue, Python, and Kotlin/JVM.",
        },
        auth: "Users created on any platform are visible on all platforms. " +
              "Sign in via magic code on web, then query that user from " +
              "the Android app — same auth, same database.",
        storage: "Files uploaded from any client (web, Android, iOS) live in " +
                 "the same storage provider. A photo uploaded from Android is " +
                 "downloadable from web with the same URL.",
        public_docs: "https://instant.fidscript.com/docs/cross-platform",
      };

      return {
        content: [{
          type: "text",
          text: JSON.stringify(guide, null, 2),
        }],
      };
    },
  );
}

// CLI
// -----------
async function run() {
  const { values } = parseArgs({
    options: {
      token: { type: "string", short: "t" },
      "api-url": { type: "string", short: "u" },
      "app-id": { type: "string", short: "a" },
      help: { type: "boolean", short: "h" },
      version: { type: "boolean", short: "v" },
    },
    allowPositionals: false,
  });

  if (values.help) {
    console.log(`
@fidscript/instant-mcp v${VERSION}
MCP server for self-hosted InstantDB deployments.

USAGE:
  npx @fidscript/instant-mcp [OPTIONS]

OPTIONS:
  -t, --token <token>    InstantDB personal access token (required)
  -u, --api-url <url>    InstantDB API URL (default: ${DEFAULT_API_URL})
  -a, --app-id <id>      Default app ID for tools that need one
  -h, --help             Show this help
  -v, --version          Show version

ENVIRONMENT VARIABLES:
  INSTANT_ACCESS_TOKEN    Same as --token (required)
  INSTANT_API_HOST        Same as --api-url (canonical — required)
  INSTANT_API_URI         Alias for INSTANT_API_HOST
  INSTANT_DASH_HOST       Dashboard / docs host (required)
  INSTANT_MAVEN_HOST      Public Maven host (required)
  INSTANT_APP_ID          Same as --app-id

DATA TOOLS:        learn, query, transact
SCHEMA TOOLS:      get-schema, push-schema, push-schema-dry-run
PERMS TOOLS:      get-perms, push-perms
APP TOOLS:        list-apps, get-app, create-app, delete-app
STORAGE TOOLS:    list-files, delete-file, get-upload-url, get-download-url,
                  get-storage-config, update-storage-config, delete-storage-config
WEBHOOK TOOLS:    list-webhooks, create-webhook, update-webhook, delete-webhook,
                  enable-webhook, disable-webhook, get-webhook-events, resend-webhook-event
BACKUP TOOLS:     list-backups, create-backup, delete-backup, list-backup-jobs,
                  get-backup-job, cancel-backup-job, list-backup-files, get-backup-file-url
TEST USER TOOLS:  list-test-users, create-test-user, delete-test-user
EMAIL TOOLS:      get-email-template, update-email-template, send-test-email,
                  get-sender-verification, send-sender-verification, verify-sender-code
ORG TOOLS:        list-orgs, get-org, list-org-apps
MEMBER TOOLS:     invite-app-member, remove-app-member, update-app-member

EXAMPLES:
  INSTANT_ACCESS_TOKEN=per_xxx npx @fidscript/instant-mcp
  npx @fidscript/instant-mcp --token per_xxx --api-url https://apiinstant.fidscript.com

DOCS: https://instantdb.com/docs/using-llms
`);
    process.exit(0);
  }

  if (values.version) {
    console.log(`@fidscript/instant-mcp v${VERSION}`);
    process.exit(0);
  }

  const token = (values.token as string) || process.env.INSTANT_ACCESS_TOKEN;
  if (!token) {
    console.error("Error: Missing --token or INSTANT_ACCESS_TOKEN");
    process.exit(1);
  }

  const apiUrl = (values["api-url"] as string) || process.env.INSTANT_API_URI || process.env.INSTANT_API_HOST || DEFAULT_API_URL;
  const defaultAppId = (values["app-id"] as string) || process.env.INSTANT_APP_ID || "";

  try {
    new URL(apiUrl);
  } catch {
    console.error(`Error: Invalid API URL '${apiUrl}'`);
    process.exit(1);
  }

  const server = createMCPServer();
  registerTools(server, apiUrl, token, defaultAppId);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`@fidscript/instant-mcp v${VERSION} running on stdio (api: ${apiUrl})`);
}

run().catch((error) => {
  const msg = error instanceof Error ? error.message : String(error);
  console.error(`Fatal error: ${msg}`);
  process.exit(1);
});
