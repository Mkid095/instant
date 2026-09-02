---
nextjs:
  metadata:
    title: 'Using Instant with LLMs'
    description: 'How to use Instant with LLMs'
---

You can supercharge your Instant experience by using it with LLMs. Just add our Instant rules and you're off to the races!

## Instant Skill

The fastest way to add rules to your LLM tool is to add the Instant skill.

```text {% showCopy="true" %}
npx skills add instantdb/skills
```

This will give your agent the context it needs to work with InstantDB.

You can verify you set up the rules correctly by asking your LLM "How do you
make queries and transactions in InstantDB?" If everything is set up correctly,
you should see a response with information about `db.useQuery` and `db.transact`.

If you'd prefer to manually install the rules instead, see the section below.

## Instant Rules

We've created a set of rules to help LLMs understand how Instant works. If you
start a new project with `create-instant-app` you'll get these rules
automatically. If you have an existing project you can add the rules manually.

[Save these rules](/llm-rules/AGENTS.md) at the root of your project as:

- `CLAUDE.md` for Claude Code
- `GEMINI.md` for Gemini
- `AGENTS.md` for Codex, Cursor, Windsurf, Zed, and other tools

You may need to restart your editor for the rules to take effect.

### Markdown Docs and llms.txt

You can attach `.md` to the end of any doc page URL to get raw Markdown. This can be helpful to paste into your LLM if you're stuck on
particular functionality. For example, here are the recommended docs for [adding auth](/docs/auth/magic-codes.md).

We recommend starting with the rules files above and adding more docs as needed.
If you want though you can get all our docs at once in markdown format via
[llms-full.txt](https://www.apiinstant.fidscript.com/llms-full.txt)

## Instant MCP Server

We built `@fidscript/instant-mcp` to enable creating, managing, and updating your self-hosted Instant apps directly from your editor. Combine the MCP with our rules file to build full-stack apps in your editor.

This MCP server uses a **stdio transport** — it runs as a local subprocess, communicating over stdin/stdout. It authenticates with a **Personal Access Token (PAT)**.

### Get your Personal Access Token

Generate a PAT from your dashboard:

1. Go to **Dashboard → User Settings → Personal Access Tokens**
2. Click "Create New Token"
3. Copy the token — it starts with `per_`

### Quick Start

Test that the MCP server works:

```text {% showCopy="true" %}
npx -y @fidscript/instant-mcp@0.4.0 --help
```

### Cursor / Windsurf / Cline

Add the following to your MCP settings:

**macOS/Linux**

```json {% showCopy="true" %}
{
  "mcpServers": {
    "instant-self": {
      "command": "npx",
      "args": ["-y", "@fidscript/instant-mcp@0.4.0"],
      "env": {
        "INSTANT_ACCESS_TOKEN": "<YOUR_PAT>",
        "INSTANT_API_URI": "https://apiinstant.fidscript.com",
        "INSTANT_APP_ID": "<YOUR_APP_ID>"
      }
    }
  }
}
```

**Windows**

```json {% showCopy="true" %}
{
  "mcpServers": {
    "instant-self": {
      "command": "cmd",
      "args": ["/c", "npx", "-y", "@fidscript/instant-mcp@0.4.0"],
      "env": {
        "INSTANT_ACCESS_TOKEN": "<YOUR_PAT>",
        "INSTANT_API_URI": "https://apiinstant.fidscript.com",
        "INSTANT_APP_ID": "<YOUR_APP_ID>"
      }
    }
  }
}
```

**Windows WSL**

```json {% showCopy="true" %}
{
  "mcpServers": {
    "instant-self": {
      "command": "wsl",
      "args": ["npx", "-y", "@fidscript/instant-mcp@0.4.0"],
      "env": {
        "INSTANT_ACCESS_TOKEN": "<YOUR_PAT>",
        "INSTANT_API_URI": "https://apiinstant.fidscript.com",
        "INSTANT_APP_ID": "<YOUR_APP_ID>"
      }
    }
  }
}
```

Replace `<YOUR_PAT>` with your personal access token and `<YOUR_APP_ID>` with your app ID. Save the file and reload the editor!

### Zed

Open your Zed settings and add the following:

```json {% showCopy="true" %}
{
  "context_servers": {
    "instant-self": {
      "command": {
        "path": "npx",
        "args": ["-y", "@fidscript/instant-mcp@0.4.0"],
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

Replace `<YOUR_PAT>` with your personal access token and `<YOUR_APP_ID>` with your app ID. Save the file and reload the editor!

### Claude Desktop

1. Open `~/Library/Application Support/Claude/claude_desktop_config.json`
2. Add the following configuration:

```json {% showCopy="true" %}
{
  "mcpServers": {
    "instant-self": {
      "command": "npx",
      "args": ["-y", "@fidscript/instant-mcp@0.4.0"],
      "env": {
        "INSTANT_ACCESS_TOKEN": "<YOUR_PAT>",
        "INSTANT_API_URI": "https://apiinstant.fidscript.com",
        "INSTANT_APP_ID": "<YOUR_APP_ID>"
      }
    }
  }
}
```

Replace `<YOUR_PAT>` with your personal access token and `<YOUR_APP_ID>` with your app ID. Save the file and restart Claude Desktop!

### Other MCP-Compatible Editors

For editors that support the MCP stdio protocol, use:

```text
npx -y @fidscript/instant-mcp@0.4.0
```

With environment variables:

- `INSTANT_ACCESS_TOKEN` — your personal access token (required)
- `INSTANT_API_URI` — your self-hosted API URL (default: `https://apiinstant.fidscript.com`)
- `INSTANT_APP_ID` — your default app ID (optional; can be overridden per tool call)

## MCP Tools

Below is a list of the tools exposed by `@fidscript/instant-mcp`:

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
