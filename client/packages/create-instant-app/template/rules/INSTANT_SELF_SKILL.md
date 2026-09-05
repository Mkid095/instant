# FIDScript Self-Hosted Skill

**Invoke with:** `/instant-self`

When this skill is invoked, enter "FIDScript Self-Hosted Development Mode." Use the FIDScript MCP (`instant-self`) as the first-class interface for all backend operations.

---

## CORE IDENTITY

**Backend:** Self-hosted InstantDB via FIDScript
**API:** `https://apiinstant.fidscript.com`
**MCP Package:** `@fidscript/instant-mcp@0.4.2`
**MCP Name:** `instant-self` (configured in Claude Code via `claude mcp add`)

**Use these environment variables:**
- `INSTANT_API_URI=https://apiinstant.fidscript.com`
- `INSTANT_APP_ID=<APP_ID>`

**Do NOT use:**
- `INSTANT_MCP_API_URL` (obsolete)
- `instantdb.com` or Instant Cloud endpoints
- The production Instant Cloud MCP

---

## SAFETY RULES (CRITICAL — NEVER VIOLATE)

These rules are top-priority. Weaker models must follow them exactly.

```
RULE 1: NEVER delete an application during initialization.
        Creating a new project = make a NEW app. Do NOT delete existing apps.

RULE 2: "New project" always means create a NEW FIDScript application.
        Never reuse an existing app returned by list-apps unless it is
        explicitly confirmed as belonging to this project.

RULE 3: Existing INSTANT_APP_ID means use the existing application.
        If a project already has INSTANT_APP_ID in .env or .fidscript/project.json,
        use that app. Do NOT create a new one.

RULE 4: Never assume an application returned by list-apps belongs to this project.
        list-apps may return unrelated apps (e.g. Instant Config, soostori).
        Always verify App ID before taking action.

RULE 5: Before destructive operations (delete-app, delete-files, etc.),
        verify the App ID matches the target. Require explicit user intent.

RULE 6: Never expose secrets in output, source files, or commits.
        PATs, admin tokens, API secrets, database passwords, Cloudinary secrets
        must never appear in generated code, project files, or model output.

RULE 7: Inspect before modifying.
        Use get-schema, get-perms, get-app before changing anything.

RULE 8: Use dry-run/planning operations before schema changes.
        Use push-schema-dry-run before push-schema. Understand the plan.

RULE 9: Preserve unrelated environment variables.
        When updating .env, only touch FIDScript-related variables.

RULE 10: Never redirect to the dashboard when the MCP can perform the operation.
        If a tool exists in the MCP, use it. Do not ask the user to
        visit instant.fidscript.com for operations the MCP handles.
```

---

## MCP TOOL SELECTION GUIDE

Use these tools for the corresponding tasks:

```
Need to discover apps?
  → list-apps

Need to get app details?
  → get-app  (app-id required)

Need to create a new app?
  → create-app  (returns app-id + admin-token)

Need schema?
  → get-schema  (app-id required)

Need permissions?
  → get-perms  (app-id required)

Need to modify schema?
  → push-schema-dry-run  (preview plan)
  → push-schema  (apply — may require confirmation)

Need to manage files/storage?
  → list-files  (app-id required)
  → get-upload-url  (get pre-signed upload URL)
  → delete-file!  (app-id + location-id required)

Need to manage webhooks?
  → list-webhooks  (app-id required)
  → create-webhook  (app-id required)
  → delete-webhook  (app-id required)

Need email configuration?
  → get-email-template
  → update-email-template  (app-id required)

Need to manage orgs/apps?
  → list-orgs
  → list-apps
  → list-apps (for a specific org)

Need backups?
  → list-backups  (app-id required)
  → create-backup  (app-id required)
  → get-backup-job  (app-id + job-id required)

Need test users?
  → list-test-users  (app-id required) — NOTE: may have a pre-existing bug
  → create-test-user  (app-id required)
  → delete-test-user  (app-id required)

Need to verify MCP is working?
  → learn  (returns InstantDB concepts — good health check)
```

---

## FIDScript Self-Hosted Compatibility

FIDScript self-hosted maintains compatibility with the InstantDB programming model, but **server/API-level behavior can differ from hosted Cloud InstantDB**. When targeting FIDScript, use the syntax documented here — do not assume Cloud InstantDB documentation examples apply directly to server/API operations.

### Client SDK vs. Server API Representation

The SDK/client schema representation and the server push schema representation are **different layers**. Do not send the client-side `i.schema({ entities, links })` representation directly to `push-schema`.

**Client SDK representation** (TypeScript):
```typescript
i.schema({
  entities: {
    customers: i.entity({
      name: i.string(),
    }),
  },
  links: {},
})
```

**Server/MCP API representation** (JSON — what `push-schema` expects):
```json
{
  "entities": {
    "customers": {
      "attrs": {
        "name": { "type": "string", "required": true }
      }
    }
  }
}
```

When generating schema for `push-schema`, always output the JSON server representation, not the TypeScript SDK representation.

### Schema Push API

The `push-schema` tool expects the **server schema format** (JSON). Always use `push-schema-dry-run` first to preview the plan before applying.

### Permissions DSL

The tested FIDScript self-hosted permissions DSL supports direct expressions. The following constructs have been **verified compatible**:

```
auth.id == data.owner.id
auth.uid != null
auth.id in data.ref('post.author.id')
'admin' in auth.ref('$user.role.type')
```

The following constructs have been **verified or reported as problematic** on the FIDScript self-hosted API path and should be avoided:

- `bind` — not currently supported in the tested permission path
- `!=` — not currently supported in the tested permission path
- `&&` — not currently supported in the tested permission path

**Safe practice:** Use simple direct expressions. Prefer `auth.id == data.field` over compound boolean expressions. Always use `push-schema-dry-run` before pushing permissions.

### Authentication Expression

For null/existence checks, the verified compatible syntax is:

```
auth.uid != null
```

(not `auth.id != null` which is Cloud InstantDB style).

### Troubleshooting Schema/Permissions Push Failures

If a `push-schema` or permissions push fails:

1. Inspect current schema/perms with `get-schema` / `get-perms`
2. Compare the generated payload against the FIDScript-compatible format described above
3. Correct the syntax — prefer server JSON format for schema, simple expressions for permissions
4. Use `push-schema-dry-run` to preview before re-applying
5. Never tell the developer to switch to Cloud InstantDB as a workaround

### Compatibility Rule

> When working against FIDScript self-hosted, prefer behavior **verified against the actual FIDScript MCP/API** over assumptions from upstream InstantDB documentation. Cloud InstantDB examples are not automatically applicable to server/API operations.

---

## WORKFLOWS

### Workflow A: NEW PROJECT

User says "start a new project" or `/instant-self` in an empty directory.

```
1. Detect the project directory is empty or has no FIDScript configuration.
2. Ask user for the application name (if not provided).
3. Create a new FIDScript app:
   → create-app { title: "<APP_NAME>" }
4. Capture the returned app-id and admin-token.
5. Store the app-id in the project's environment:
   - Create or update .env with INSTANT_APP_ID and INSTANT_API_URI
   - Store admin-token securely (NOT in source-controlled files)
6. Retrieve initial configuration:
   → get-schema { app-id }
   → get-perms { app-id }
7. Initialize the project files (schema, perms, SDK init) as appropriate.
8. Verify connectivity:
   → learn (confirms MCP is working)
9. Report success with app-id (not the admin-token).
```

### Workflow B: EXISTING PROJECT (Continue Development)

User says "continue this project" or `/instant-self` in a directory with existing FIDScript config.

```
1. Look for existing FIDScript configuration:
   - .env (INSTANT_APP_ID)
   - .fidscript/project.json (app-id)
   - instant.schema.ts / instant.perms.ts (indicates existing app)
2. If INSTANT_APP_ID exists, use it directly.
3. Verify the app exists:
   → get-app { app-id }
4. Inspect current state:
   → get-schema { app-id }
   → get-perms { app-id }
5. Do NOT create a new app. Do NOT delete anything.
6. Report the existing app details.
```

### Workflow C: EXPLICIT EXISTING APP

User says "use my existing FIDScript app" and provides an app-id.

```
1. Verify the app:
   → get-app { app-id }
2. If valid, configure the local project:
   - Update .env with INSTANT_APP_ID
   - Do NOT overwrite other .env variables
3. Inspect state:
   → get-schema { app-id }
   → get-perms { app-id }
4. Continue development.
```

### Workflow D: SCHEMA CHANGES

User says "add customers and orders" or similar schema modification request.

```
1. Inspect current schema:
   → get-schema { app-id }
2. Understand the existing structure.
3. Design the required changes (incremental, not destructive).
4. Preview the plan:
   → push-schema-dry-run { app-id, schema: <proposed> }
5. Review the plan with the user if it looks destructive.
6. Apply only when appropriate:
   → push-schema { app-id, schema: <proposed> }
7. Never replace the entire schema. Prefer incremental changes.
```

### Workflow E: INSPECT ONLY

User says "inspect backend" or "check my FIDScript setup."

```
1. → list-apps
2. → get-app { app-id }
3. → get-schema { app-id }
4. → get-perms { app-id }
5. → list-files { app-id }
6. Report findings. Make NO changes.
```

---

## PROJECT IDENTITY

After creating or identifying a FIDScript application, persist the project identity.

### Option A: .env (Preferred if already used)

Update the project's `.env`:
```
INSTANT_APP_ID=<APP_ID>
INSTANT_API_URI=https://apiinstant.fidscript.com
```

Do NOT add `INSTANT_ACCESS_TOKEN` or `INSTANT_ADMIN_TOKEN` to `.env`. These are MCP credentials, not project credentials.

### Option B: .fidscript/project.json (For clean separation)

If the project has no `.env` convention, create `.fidscript/project.json`:
```json
{
  "provider": "fidscript",
  "apiUri": "https://apiinstant.fidscript.com",
  "appId": "<APP_ID>"
}
```

**Never include secrets in this file.** This file may be committed to source control.

### Detecting Existing Project

On every `/instant-self` invocation, check in this order:
1. `.env` → look for `INSTANT_APP_ID`
2. `.fidscript/project.json` → look for `appId`
3. `instant.schema.ts` or `instant.perms.ts` → implies existing FIDScript project

If none found, treat as **new project**.

---

## SLASH COMMAND NATURAL LANGUAGE

After invoking `/instant-self`, the following natural language patterns map to workflows:

```
"start a new project" / "create new app" / "new project"
  → Workflow A: NEW PROJECT

"continue this project" / "keep working" / "use existing app"
  → Workflow B: EXISTING PROJECT

"use my existing FIDScript app" / "connect to existing app"
  → Workflow C: EXPLICIT EXISTING APP

"inspect backend" / "check setup" / "show me the backend"
  → Workflow E: INSPECT ONLY

"add <entity>" / "add customers and orders" / "update schema"
  → Workflow D: SCHEMA CHANGES

"delete everything" / "reset" / "start fresh"
  → REFUSE. Ask for explicit confirmation. Explain the safety rule.
```

---

## CREDENTIALS AND SECRETS

**Never output these in any format:**
- Personal Access Tokens (start with `per_`)
- Admin tokens
- `INSTANT_ACCESS_TOKEN`
- `CLOUDINARY_API_SECRET`
- Database passwords
- Resend API keys

**Safe to output:**
- App ID (UUID format, e.g. `82708c5f-f19c-48f7-a13d-5c45806e74da`)
- API URI (`https://apiinstant.fidscript.com`)
- Schema definitions
- Permission rules
- File metadata (path, size, content-type)

**MCP authentication:** The `INSTANT_ACCESS_TOKEN` for the MCP is configured in Claude Code's MCP environment, not in project files. The MCP handles authentication automatically.

---

## COMPLETE DEVELOPMENT LIFECYCLE

```
User idea
    ↓
/instant-self
    ↓
Workflow A/B/C (identify or create app)
    ↓
Configure local environment
    ↓
get-schema + get-perms (understand current state)
    ↓
Design schema changes
    ↓
push-schema-dry-run (preview)
    ↓
push-schema (apply)
    ↓
Build application with FIDScript SDK
    ↓
Use MCP for backend operations
    ↓
Test and iterate
    ↓
Continue development via MCP
```

---

## WHAT THIS SKILL DOES NOT DO

This skill does NOT build:
- Authentication systems (handled by FIDScript's built-in auth)
- Deployment infrastructure (handled separately)
- Backup automation beyond what MCP provides
- Monitoring systems

The MCP (`instant-self`) is already operational. This skill is the operating procedure for using it correctly.
