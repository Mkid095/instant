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

function classifyHttpError(status: number, statusText: string, bodyStr: string): string {
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
      if (status >= 500) return `InstantDB server error (${status})`;
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
    body: body ? JSON.stringify(body) : undefined,
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
): Promise<any> {
  let url = `${apiURI}${path}`;
  if (params) {
    const qs = new URLSearchParams(params).toString();
    url += `?${qs}`;
  }
  const res = await fetchWithTimeout(url, {
    method: "DELETE",
    headers: authHeaders(token, appId),
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
    ...(appId ? { "App-Id": appId } : {}),
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
  return apiPost(apiURI, token, "/admin/query", { query });
}

async function adminTransact(
  apiURI: string,
  token: string,
  appId: string,
  steps: any[][],
): Promise<any> {
  return apiPost(apiURI, token, "/admin/transact", { steps });
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

async function pushSchema(
  apiURI: string,
  token: string,
  appId: string,
  schema: any,
): Promise<any> {
  // Step 1: plan
  const planData = await apiPost(apiURI, token, `/superadmin/apps/${appId}/schema/push/plan`, {
    schema,
    check_types: true,
    supports_background_updates: true,
  });

  // Step 2: apply
  const applyData = await apiPost(apiURI, token, `/superadmin/apps/${appId}/schema/push/apply`, {
    schema,
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
  return apiPost(apiURI, token, `/superadmin/apps/${appId}/schema/push/plan`, {
    schema,
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
  return apiPost(apiURI, token, `/dash/apps/${appId}/webhooks/${webhookId}/events/${eventIsn}`);
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
  return apiDelete(apiURI, token, `/dash/apps/${appId}/test_users`, { id: testUserId });
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
  return apiPost(apiURI, token, `/dash/apps/${appId}/invite/send`, { inviteeEmail, role });
}

async function removeAppMember(
  apiURI: string,
  token: string,
  appId: string,
  memberId: string,
): Promise<any> {
  return apiDelete(apiURI, token, `/dash/apps/${appId}/members/remove`, { id: memberId });
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

// Tools
// -----------
function registerTools(
  server: McpServer,
  apiURI: string,
  token: string,
  _appId: string,
) {

  // ---- Learning ----
  server.tool(
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

  server.tool(
    "query",
    `Execute an InstaQL query against an app. Returns query results as JSON.

Example:
{"goals": {"todos": {}}}
{"goals": {"$": {"where": {"status": "active"}}, "todos": {}}}
{"users": {"$": {"where": {"email": {"$includes": "@example.com"}}}}}

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
        return { isError: true, content: [{ type: "text", text: `Error querying app: ${e.message}` }] };
      }
    },
  );

  server.tool(
    "transact",
    `Execute a transaction to create, update, link, or delete data.

Steps:
  ["update", "namespace", "entity-id", {"field": "value"}] — create or update entity
  ["link", "namespace", "entity-id", {"linkAttr": "target-id"}] — create a link
  ["unlink", "namespace", "entity-id", {"linkAttr": "target-id"}] — remove a link
  ["delete", "namespace", "entity-id"] — delete an entity

Example — create a todo linked to a user:
[["update", "todos", "UUID-HERE", {"title": "Hello", "done": false, "user_link": "USER-UUID-HERE"}]]

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
        return { isError: true, content: [{ type: "text", text: `Error transacting: ${e.message}` }] };
      }
    },
  );

  // ---- Schema ----

  server.tool(
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
        return { isError: true, content: [{ type: "text", text: `Error fetching schema: ${e.message}` }] };
      }
    },
  );

  server.tool(
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
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      } catch (e: any) {
        return { isError: true, content: [{ type: "text", text: `Error pushing schema: ${e.message}` }] };
      }
    },
  );

  server.tool(
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
        return { isError: true, content: [{ type: "text", text: `Error planning schema: ${e.message}` }] };
      }
    },
  );

  // ---- Permissions ----

  server.tool(
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
        return { isError: true, content: [{ type: "text", text: `Error fetching permissions: ${e.message}` }] };
      }
    },
  );

  server.tool(
    "push-perms",
    `Push new permissions rules to an app. Permissions use a simple DSL.

Example:
{
  "todos": {
    "allow": {
      "view": "always",
      "create": "always",
      "update": "auth.uid != null",
      "delete": "auth.uid = data.user"
    }
  },
  "$default": {
    "allow": {
      "view": "always",
      "create": "false",
      "update": "false",
      "delete": "false"
    }
  }
}

Special values: "always", "never", "auth" (checks auth.uid != null).
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
        return { isError: true, content: [{ type: "text", text: `Error pushing permissions: ${e.message}` }] };
      }
    },
  );

  // ---- App Management ----

  server.tool(
    "list-apps",
    "List all apps associated with your account. Returns app IDs, titles, creation dates, and storage usage.",
    {},
    async () => {
      try {
        const data = await listApps(apiURI, token);
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      } catch (e: any) {
        return { isError: true, content: [{ type: "text", text: `Error listing apps: ${e.message}` }] };
      }
    },
  );

  server.tool(
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
        return { isError: true, content: [{ type: "text", text: `Error fetching app: ${e.message}` }] };
      }
    },
  );

  server.tool(
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
        return { isError: true, content: [{ type: "text", text: `Error creating app: ${e.message}` }] };
      }
    },
  );

  server.tool(
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
        return { isError: true, content: [{ type: "text", text: `Error deleting app: ${e.message}` }] };
      }
    },
  );

  // ---- Storage ----

  server.tool(
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
        return { isError: true, content: [{ type: "text", text: `Error listing files: ${e.message}` }] };
      }
    },
  );

  server.tool(
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
        return { isError: true, content: [{ type: "text", text: `Error deleting file: ${e.message}` }] };
      }
    },
  );

  server.tool(
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
        return { isError: true, content: [{ type: "text", text: `Error getting upload URL: ${e.message}` }] };
      }
    },
  );

  server.tool(
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
        return { isError: true, content: [{ type: "text", text: `Error getting download URL: ${e.message}` }] };
      }
    },
  );

  // ---- Webhooks ----

  server.tool(
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
        return { isError: true, content: [{ type: "text", text: `Error listing webhooks: ${e.message}` }] };
      }
    },
  );

  server.tool(
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
        return { isError: true, content: [{ type: "text", text: `Error creating webhook: ${e.message}` }] };
      }
    },
  );

  server.tool(
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
        return { isError: true, content: [{ type: "text", text: `Error updating webhook: ${e.message}` }] };
      }
    },
  );

  server.tool(
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
        return { isError: true, content: [{ type: "text", text: `Error deleting webhook: ${e.message}` }] };
      }
    },
  );

  server.tool(
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
        return { isError: true, content: [{ type: "text", text: `Error enabling webhook: ${e.message}` }] };
      }
    },
  );

  server.tool(
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
        return { isError: true, content: [{ type: "text", text: `Error disabling webhook: ${e.message}` }] };
      }
    },
  );

  server.tool(
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
        return { isError: true, content: [{ type: "text", text: `Error fetching webhook events: ${e.message}` }] };
      }
    },
  );

  server.tool(
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
        return { isError: true, content: [{ type: "text", text: `Error resending webhook event: ${e.message}` }] };
      }
    },
  );

  // ---- Backups ----

  server.tool(
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
        return { isError: true, content: [{ type: "text", text: `Error listing backups: ${e.message}` }] };
      }
    },
  );

  server.tool(
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
        return { isError: true, content: [{ type: "text", text: `Error creating backup: ${e.message}` }] };
      }
    },
  );

  server.tool(
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
        return { isError: true, content: [{ type: "text", text: `Error deleting backup: ${e.message}` }] };
      }
    },
  );

  server.tool(
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
        return { isError: true, content: [{ type: "text", text: `Error listing backup jobs: ${e.message}` }] };
      }
    },
  );

  server.tool(
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
        return { isError: true, content: [{ type: "text", text: `Error getting backup job: ${e.message}` }] };
      }
    },
  );

  server.tool(
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
        return { isError: true, content: [{ type: "text", text: `Error canceling backup job: ${e.message}` }] };
      }
    },
  );

  server.tool(
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

  server.tool(
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

  server.tool(
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

  server.tool(
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

  server.tool(
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

  server.tool(
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

  server.tool(
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

  server.tool(
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

  server.tool(
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

  server.tool(
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

  server.tool(
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

  server.tool(
    "invite-app-member",
    "Invite a user to an app with a specific role. They will receive an email invitation.",
    {
      appId: z.string().uuid().describe("UUID of the app"),
      email: z.string().email().describe("Email address of the user to invite"),
      role: z.enum(["creator", "admin", "collaborator", "editor", "viewer"]).describe("Role to assign: creator, admin, collaborator, editor, or viewer"),
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

  server.tool(
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

  server.tool(
    "update-app-member",
    "Update a member's role on an app.",
    {
      appId: z.string().uuid().describe("UUID of the app"),
      memberId: z.string().uuid().describe("UUID of the member to update"),
      role: z.enum(["creator", "admin", "collaborator", "editor", "viewer"]).describe("New role: creator, admin, collaborator, editor, or viewer"),
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

  server.tool(
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

  server.tool(
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

  server.tool(
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
