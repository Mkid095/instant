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
const DEFAULT_API_URL = "https://apiinstant.fidscript.com";
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
  const entities: any = {};
  const links: any = {};

  for (const [nsName, nsDef] of Object.entries(schema)) {
    if (nsName.startsWith("$")) continue; // skip system namespaces

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
// Registers a tool with both hyphenated and underscore names
function tool(
  server: McpServer,
  name: string,
  description: string,
  inputSchema: Record<string, any>,
  handler: (params: any) => Promise<any>,
) {
  const hyphen = name;
  const underscore = name.replace(/-/g, "_");
  server.tool(hyphen, description, inputSchema, handler);
  if (underscore !== hyphen) {
    server.tool(underscore, description, inputSchema, handler);
  }
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
    "Get an overview of InstantDB concepts, data modeling, permissions, and CLI commands.",
    {},
    async () => {
      return {
        content: [{
          type: "text",
          text: `InstantDB is a reactive graph database. Key concepts:

SCHEMAS:
  Define your data model in 'instant.schema.ts'. Namespaces = entity types.
  Each entity has attributes (data fields) and links (relationships).

PERMISSIONS:
  Define who can read/write data in 'instant.perms.ts'.
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

DOCUMENTATION: https://www.instantdb.com/docs`,
        }],
      };
    },
  );

  // ---- Data Operations ----

  tool(server,
    "query",
    `Execute an InstaQL query against an app. Returns query results as JSON.

Query structure: {"namespace": {"$": {"where": {...}, "limit": N}}}

Examples:
- Simple query: {"todos": {}}
- With where: {"todos": {"$": {"where": {"done": false}}}}
- With where+limit: {"todos": {"$": {"where": {"done": false}, "limit": 10}}}
- With $or (wrapped in "and"): {"todos": {"$": {"where": {"and": [{"or": [{"status": "active"}, {"status": "pending"}]}]}}}}
- Nested: {"authors": {"books": {"$": {"where": {"title": "The Count"}}}}}

CRITICAL: The "where" clause MUST be nested inside "$". Correct: {"$": {"where": {"field": "value"}}}
WRONG: {"$where": {"field": "value"}} -- this will fail!

For $or queries, wrap in "and": {"$": {"where": {"and": [{"or": [{"field": "a"}, {"field": "b"}]}]}}}

Full docs: https://instantdb.com/docs/instaql`,
    {
      appId: z.string().uuid().describe("UUID of the app"),
      query: z.record(z.string(), z.any()).describe("InstaQL query object"),
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
    `Execute a transaction to create, update, link, or delete data.

Steps:
  ["create", "namespace", {"field": "value"}] — create a new entity. ID is auto-generated UUID (do NOT provide an ID manually).
  ["update", "namespace", "entity-id", {"field": "value"}] — update an existing entity. entity-id must be a UUID.
  ["link", "namespace", "entity-id", {"linkAttr": "target-id"}] — link entity to another. Both IDs must be UUIDs.
  ["unlink", "namespace", "entity-id", {"linkAttr": "target-id"}] — remove a link
  ["delete", "namespace", "entity-id"] — delete an entity. entity-id must be a UUID.

IMPORTANT — entity IDs in update/link/delete must be UUIDs. Do NOT use string literals like "AUTO_GENERATED_ID" or "USER_ID" — in a multi-step transaction, use the actual UUID returned by a preceding create step.

Example — create a todo (no ID in create step):
[["create", "todos", {"title": "Hello", "done": false}]]

Example — create a product:
[["create", "products", {"name": "New Product"}]]

Full docs: https://instantdb.com/docs/instaml`,
    {
      appId: z.string().uuid().describe("UUID of the app"),
      steps: z.array(z.array(z.any())).describe("Transaction steps"),
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
      appId: z.string().uuid().describe("UUID of the app"),
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
    `Push a schema definition to an app. The schema is a map of namespace names to namespace definitions.

Example schema:
{
  "todos": {
    "attrs": {
      "title": { "type": "string" },
      "done": { "type": "boolean" }
    }
  },
  "users": {
    "attrs": {
      "name": { "type": "string" },
      "email": { "type": "string" }
    },
    "links": {
      "todos": { "collection": "todos", "is_collection": true }
    }
  }
}

This performs a plan-then-apply. Use push-schema-dry-run first to preview changes.`,
    {
      appId: z.string().uuid().describe("UUID of the app"),
      schema: z.record(z.string(), z.any()).describe("InstantDB schema definition object"),
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
    "Preview what a schema push would do without applying it. Shows the diff between current and proposed schema.",
    {
      appId: z.string().uuid().describe("UUID of the app"),
      schema: z.record(z.string(), z.any()).describe("InstantDB schema definition object"),
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
      appId: z.string().uuid().describe("UUID of the app"),
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
    `Push new permissions rules to an app. Permissions use CEL expressions.

Example:
{
  "todos": {
    "allow": {
      "view": "true",
      "create": "auth.uid != null",
      "update": "auth.uid != null && auth.uid = data.user",
      "delete": "auth.uid = data.user"
    }
  },
  "$default": {
    "allow": {
      "view": "true",
      "create": "false",
      "update": "false",
      "delete": "false"
    }
  }
}

Special values: "true" (allow all), "false" (deny all), "auth.uid != null" (require login).
Data checks: "auth.uid = data.field_name", "auth.email = data.email", etc.`,
    {
      appId: z.string().uuid().describe("UUID of the app"),
      perms: z.record(z.string(), z.any()).describe("InstantDB permissions definition object"),
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
    `Create an OAuth service provider to enable social login for your app.

Supported providers:
- "google" - Google OAuth (use shared credentials for testing/development)
- "github" - GitHub OAuth

STEPS TO SET UP SOCIAL LOGIN:
1. Create provider: create-oauth-provider with provider_name (e.g., "google")
2. List providers: list-oauth-providers to get the provider_id
3. Create OAuth client: create-oauth-client with provider_id
4. Configure redirect: Add your app's callback URL to allowed origins
5. Integrate: Use the OAuth flow in your frontend

For Google OAuth, after creating the provider and client:
- In Google Cloud Console, add your redirect URI to Authorized redirect URIs
- The redirect must exactly match what you pass to create-oauth-client`,
    {
      appId: z.string().uuid().describe("UUID of the app"),
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
    `Create an OAuth client to enable social login (Google, GitHub, Apple, etc.) for your app.

SOCIAL LOGIN FLOW:
1. Create OAuth provider: use create-oauth-provider (e.g., "google" or "github")
2. List providers: use list-oauth-providers to get the provider_id
3. Create client: use create-oauth-client with provider_id and your redirect URL
4. Configure redirect: Add your site's URL to allowed redirect origins
5. Test: Initiate OAuth flow from your frontend

SHARED CREDENTIALS: For testing/development, use useSharedCredentials:true to skip configuring your own OAuth app credentials. For production, provide your own clientId/clientSecret.

REDIRECT URI: This must match exactly what you configure in your OAuth provider. For Google, add it in Google Cloud Console > APIs & Services > Credentials > Authorized redirect URIs.

Example - Google OAuth (shared credentials for testing):
{
  "providerId": "uuid-of-google-provider",
  "clientName": "Google Login",
  "redirectTo": "https://yourapp.com/auth/callback",
  "useSharedCredentials": true
}

Example - Google OAuth (your own credentials for production):
{
  "providerId": "uuid-of-google-provider",
  "clientName": "Google Login",
  "redirectTo": "https://yourapp.com/auth/callback",
  "clientId": "your-google-client-id",
  "clientSecret": "your-google-client-secret"
}`,
    {
      appId: z.string().uuid().describe("UUID of the app"),
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
    `Update an existing OAuth client's settings.

Use this to:
- Change the client name
- Update the redirect URI (must match your OAuth provider config)
- Switch between shared credentials and your own credentials
- Update metadata

IMPORTANT: When changing redirectTo, also update the redirect URI in your OAuth provider (Google Cloud Console, etc.) to match.`,
    {
      appId: z.string().uuid().describe("UUID of the app"),
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
      appId: z.string().uuid().describe("UUID of the app"),
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
      appId: z.string().uuid().describe("UUID of the app"),
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
      appId: z.string().uuid().describe("UUID of the app"),
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
      appId: z.string().uuid().describe("UUID of the app"),
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
    `List all authorized redirect origins for an app.

Redirect origins are URLs allowed as OAuth callback targets. When using shared credentials, localhost URLs are automatically allowed. For production, you must add your domain.

Service types:
- "generic" - Exact host match (e.g., "yourapp.com")
- "netlify" - Netlify sites (provide site name)
- "vercel" - Vercel deployments (provide deployment suffix and project name)
- "custom-scheme" - Mobile app schemes (e.g., "expo-app://")`,
    {
      appId: z.string().uuid().describe("UUID of the app"),
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
    `Add an authorized redirect origin for OAuth callbacks.

This is required for OAuth to work in production. When users authenticate with Google/GitHub/etc., the redirect URL must be authorized.

Service types:
- "generic" - Exact host match. Params: ["yourdomain.com"]
- "netlify" - Netlify site. Params: ["site-name"]
- "vercel" - Vercel deployment. Params: ["vercel.app", "project-name"]
- "custom-scheme" - Mobile deep link. Params: ["expo-scheme"]

Examples:
- generic for localhost: service="generic", params=["localhost"]
- generic for production: service="generic", params=["yourapp.com"]
- netlify preview: service="netlify", params=["your-site"]
- custom scheme (Expo): service="custom-scheme", params=["expo-app"]`,
    {
      appId: z.string().uuid().describe("UUID of the app"),
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
      appId: z.string().uuid().describe("UUID of the app"),
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
      appId: z.string().uuid().describe("UUID of the app"),
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
      appId: z.string().uuid().describe("UUID of the app"),
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
      appId: z.string().uuid().describe("UUID of the app"),
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
      appId: z.string().uuid().describe("UUID of the app"),
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
      appId: z.string().uuid().describe("UUID of the app"),
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

  // ---- Webhooks ----

  tool(server,
    "list-webhooks",
    "List all webhooks configured for an app. Returns webhook IDs, URLs, namespaces, actions, and status.",
    {
      appId: z.string().uuid().describe("UUID of the app"),
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
      appId: z.string().uuid().describe("UUID of the app"),
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
      appId: z.string().uuid().describe("UUID of the app"),
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
      appId: z.string().uuid().describe("UUID of the app"),
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
      appId: z.string().uuid().describe("UUID of the app"),
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
      appId: z.string().uuid().describe("UUID of the app"),
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
      appId: z.string().uuid().describe("UUID of the app"),
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
      appId: z.string().uuid().describe("UUID of the app"),
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
      appId: z.string().uuid().describe("UUID of the app"),
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
      appId: z.string().uuid().describe("UUID of the app"),
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
      appId: z.string().uuid().describe("UUID of the app"),
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
      appId: z.string().uuid().describe("UUID of the app"),
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
      appId: z.string().uuid().describe("UUID of the app"),
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
      appId: z.string().uuid().describe("UUID of the app"),
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
      appId: z.string().uuid().describe("UUID of the app"),
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
      appId: z.string().uuid().describe("UUID of the app"),
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
      appId: z.string().uuid().describe("UUID of the app"),
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
      appId: z.string().uuid().describe("UUID of the app"),
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
      appId: z.string().uuid().describe("UUID of the app"),
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
    `Update the magic code email template. The template must include {code} in both subject and body.

Available template variables:
  {code} — the 6-digit verification code
  {app_title} — the app's title
  {user_email} — the recipient's email
  {expiration} — code expiration time (e.g. "10 minutes")

Example:
  subject: "{code} is your verification code for {app_title}"
  body: "<p>Your code is: {code}</p>"`,
    {
      appId: z.string().uuid().describe("UUID of the app"),
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
      appId: z.string().uuid().describe("UUID of the app"),
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
      appId: z.string().uuid().describe("UUID of the app"),
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
      appId: z.string().uuid().describe("UUID of the app"),
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
      appId: z.string().uuid().describe("UUID of the app"),
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
      appId: z.string().uuid().describe("UUID of the app"),
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
      appId: z.string().uuid().describe("UUID of the app"),
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
      appId: z.string().uuid().describe("UUID of the app"),
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
  INSTANT_ACCESS_TOKEN    Same as --token
  INSTANT_API_URI        Same as --api-url
  INSTANT_APP_ID         Same as --app-id

DATA TOOLS:        learn, query, transact
SCHEMA TOOLS:      get-schema, push-schema, push-schema-dry-run
PERMS TOOLS:      get-perms, push-perms
APP TOOLS:        list-apps, get-app, create-app, delete-app
STORAGE TOOLS:    list-files, delete-file, get-upload-url, get-download-url
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

  const apiUrl = (values["api-url"] as string) || process.env.INSTANT_API_URI || DEFAULT_API_URL;
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
