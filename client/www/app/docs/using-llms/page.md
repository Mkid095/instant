---
nextjs:
  metadata:
    title: 'Using Instant with LLMs'
    description: 'How to use Instant with LLMs'
---

You can supercharge your Instant experience by using it with LLMs. Just add our rules and you're off to the races!

## Which platform are you using?

**Using FIDScript (self-hosted InstantDB at instant.fidscript.com)?**
→ Install the FIDScript skill and MCP below.

**Using InstantDB Cloud (instantdb.com)?**
→ Install the Instant Cloud skill and SDK instead.

---

## Build with FIDScript + AI

Give your AI coding agent the FIDScript skill and MCP. It can create, configure, inspect, and develop your FIDScript applications directly from your editor — without needing to visit the dashboard.

### Step 1 — Install the FIDScript Skill

```text {% showCopy="true" %}
npx skills add Mkid095/agent-skills -s instant-self
```

### Step 2 — Connect the FIDScript MCP

The MCP gives your agent the ability to act on your FIDScript backend.

#### Claude Code

```text {% showCopy="true" %}
claude mcp add instant-self \
  -e INSTANT_ACCESS_TOKEN=<YOUR_PAT> \
  -e INSTANT_API_URI=https://apiinstant.fidscript.com \
  -e INSTANT_APP_ID=<YOUR_APP_ID> \
  -- npx -y @fidscript/instant-mcp@0.4.2
```

Verify it is connected:

```text {% showCopy="true" %}
claude mcp list
```

#### Cursor / Windsurf / Cline

```json {% showCopy="true" %}
{
  "mcpServers": {
    "instant-self": {
      "command": "npx",
      "args": ["-y", "@fidscript/instant-mcp@0.4.2"],
      "env": {
        "INSTANT_ACCESS_TOKEN": "<YOUR_PAT>",
        "INSTANT_API_URI": "https://apiinstant.fidscript.com",
        "INSTANT_APP_ID": "<YOUR_APP_ID>"
      }
    }
  }
}
```

#### Zed

```json {% showCopy="true" %}
{
  "context_servers": {
    "instant-self": {
      "command": {
        "path": "npx",
        "args": ["-y", "@fidscript/instant-mcp@0.4.2"],
        "env": {
          "INSTANT_ACCESS_TOKEN": "<YOUR_PAT>",
          "INSTANT_API_URI": "https://apiinstant.fidscript.com",
          "INSTANT_APP_ID": "<YOUR_APP_ID>"
        }
      },
      "settings": {}
    }
  }
}
```

#### Claude Desktop

```json {% showCopy="true" %}
{
  "mcpServers": {
    "instant-self": {
      "command": "npx",
      "args": ["-y", "@fidscript/instant-mcp@0.4.2"],
      "env": {
        "INSTANT_ACCESS_TOKEN": "<YOUR_PAT>",
        "INSTANT_API_URI": "https://apiinstant.fidscript.com",
        "INSTANT_APP_ID": "<YOUR_APP_ID>"
      }
    }
  }
}
```

#### Other Editors

For editors that support the MCP stdio protocol:

```text {% showCopy="true" %}
npx -y @fidscript/instant-mcp@0.4.2
```

With environment variables:

- `INSTANT_ACCESS_TOKEN` — your personal access token (required)
- `INSTANT_API_URI` — your self-hosted API URL (default: `https://apiinstant.fidscript.com`)
- `INSTANT_APP_ID` — your default app ID (optional; can be overridden per tool call)

### Step 3 — Start Building

In Claude Code, invoke FIDScript Self-Hosted Development Mode:

```
/instant-self
```

Then try commands like:

```
/instant-self start a new project
/instant-self continue this project
/instant-self use my existing FIDScript app
/instant-self inspect backend
/instant-self add customers and orders
```

### What the skill does

When `/instant-self` is invoked, the skill tells your agent to:

- Inspect the local project for existing FIDScript configuration
- Create a new FIDScript app only when genuinely needed
- Never delete or modify unrelated applications
- Use `push-schema-dry-run` before applying schema changes
- Never expose secrets (PATs, admin tokens, API keys)
- Use the MCP for backend operations instead of redirecting to the dashboard

### Getting your PAT

1. Go to **Dashboard → User Settings → Personal Access Tokens**
2. Click "Create New Token"
3. Copy the token — it starts with `per_`

### MCP Tools Reference

The FIDScript MCP (`@fidscript/instant-mcp`) exposes these tools:

- `learn` — Learn about InstantDB concepts and syntax
- `query` — Execute an InstaQL query against an app
- `transact` — Execute a transaction (create/update/delete data)
- `get-schema` — Retrieve the current schema for an app
- `push-schema` — Push a new schema definition to an app
- `push-schema-dry-run` — Preview a schema push without applying it
- `get-perms` — Retrieve the current permissions rules for an app
- `push-perms` — Push new permissions rules to an app
- `list-apps` — List all apps associated with your account
- `get-app` — Get detailed info about a specific app
- `create-app` — Create a new InstantDB app
- `delete-app` — Permanently delete an app
- `list-files` — List all files in app storage
- `delete-file` — Delete a file from storage
- `get-upload-url` — Get a pre-signed URL for file uploads
- `get-download-url` — Get a pre-signed URL for file downloads
- `list-webhooks` — List all webhooks for an app
- `create-webhook` — Create a new webhook endpoint
- `update-webhook` — Update a webhook's URL, namespaces, or actions
- `delete-webhook` — Delete a webhook
- `enable-webhook` — Re-enable a disabled webhook
- `disable-webhook` — Temporarily disable a webhook
- `get-webhook-events` — Get webhook delivery events with retry history
- `resend-webhook-event` — Re-trigger a failed webhook delivery
- `list-backups` — List all backups for an app
- `create-backup` — Trigger an on-demand backup
- `delete-backup` — Delete a backup
- `list-backup-jobs` — List in-progress backup jobs
- `get-backup-job` — Get status of a specific backup job
- `cancel-backup-job` — Cancel an in-progress backup
- `list-backup-files` — List files in a backup
- `get-backup-file-url` — Get a pre-signed URL for a backup file
- `list-test-users` — List test users for an app
- `create-test-user` — Create a test user with a sign-in code
- `delete-test-user` — Delete a test user
- `get-email-template` — Get the magic-code email template
- `update-email-template` — Update the magic-code email template
- `send-test-email` — Send a test email to verify template config
- `get-sender-verification` — Get DKIM/Return-Path verification status
- `send-sender-verification` — Send a sender verification email
- `verify-sender-code` — Complete sender domain verification
- `list-orgs` — List all organizations
- `get-org` — Get org details including apps, members, invites
- `list-org-apps` — List all apps in an org
- `invite-app-member` — Invite a user to an app
- `remove-app-member` — Remove a member from an app
- `update-app-member` — Update a member's role on an app

---

## Instant Cloud (instantdb.com)

If you're using InstantDB Cloud instead of FIDScript, install the Instant Cloud skill:

```text {% showCopy="true" %}
npx skills add Mkid095/agent-skills
```

Then [install the Instant SDK](/docs/init) in your project.

### Manual rules installation

If you prefer to install rules manually instead of using the skill, save [AGENTS.md](/llm-rules/AGENTS.md) at the root of your project as:

- `CLAUDE.md` for Claude Code
- `GEMINI.md` for Gemini
- `AGENTS.md` for Codex, Cursor, Windsurf, Zed, and other tools

### Markdown Docs and llms.txt

You can attach `.md` to the end of any doc page URL to get raw Markdown. For example, here are the recommended docs for [adding auth](/docs/auth/magic-codes.md).

Get all our docs at once in markdown format via
[llms-full.txt](https://www.instantdb.com/llms-full.txt)
