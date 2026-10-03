---
nextjs:
  metadata:
    title: 'Using InstantDB with LLMs'
    description: 'How to use InstantDB with AI agents like Claude Code, Cursor, and ChatGPT.'
---

You can supercharge your InstantDB experience by connecting AI agents (Claude Code, Cursor, Windsurf, Zed, etc.) directly to your self-hosted backend via the **InstantDB MCP server**.

## What you get

The InstantDB MCP exposes 76 tools to your AI agent:

- **Schema & permissions** — `get-schema`, `push-schema`, `push-perms`, `push-schema-dry-run`
- **Data** — `query`, `transact`
- **Apps** — `list-apps`, `get-app`, `create-app`
- **Storage** — `list-files`, `get-upload-url`, `uploadFileDirect`
- **Webhooks, backups, OAuth, email, test users** — full backend control
- **Android/Kotlin SDK** — `android-sdk-version`, `android-installation`, `android-setup-guide`, `android-cross-platform`
- **`learn`** — topic-specific docs (schema, query, transact, perms, etc.) — **always self-hosted URLs**

The MCP enforces the **self-hosted deployment URL** (`instant.fidscript.com`) — your agent will never be redirected to upstream docs.

---

## Quick setup

### Step 1 — Get a Personal Access Token

1. Go to [Dashboard → User Settings → Personal Access Tokens](https://instant.fidscript.com/dash)
2. Click "Create New Token"
3. Copy the token — it starts with `per_`

### Step 2 — Set the required env vars

The MCP server **throws on startup** if any of these are missing. Set all four:

| Variable | Value |
|----------|-------|
| `INSTANT_API_HOST` | `https://apiinstant.fidscript.com` |
| `INSTANT_DASH_HOST` | `https://instant.fidscript.com` |
| `INSTANT_MAVEN_HOST` | `https://instant.fidscript.com/maven` |
| `INSTANT_ACCESS_TOKEN` | `per_xxxxx` (from Step 1) |

### Step 3 — Configure your editor

#### Claude Code

```text {% showCopy=true %}
claude mcp add instant-self \
  -e INSTANT_ACCESS_TOKEN=per_xxxxx \
  -e INSTANT_API_HOST=https://apiinstant.fidscript.com \
  -e INSTANT_DASH_HOST=https://instant.fidscript.com \
  -e INSTANT_MAVEN_HOST=https://instant.fidscript.com/maven \
  -e INSTANT_APP_ID=YOUR_APP_ID \
  -- npx -y @fidscript/instant-mcp@0.6.1
```

Verify it's connected:

```text {% showCopy=true %}
claude mcp list
```

#### Claude Desktop / Cursor / Windsurf / Cline

Edit your MCP config file:

- **macOS Claude Desktop:** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows Claude Desktop:** `%APPDATA%\Claude\claude_desktop_config.json`
- **Cursor:** Settings → Features → Model Context Protocol → Add new global MCP server

```json {% showCopy=true %}
{
  "mcpServers": {
    "instant-self": {
      "command": "npx",
      "args": ["-y", "@fidscript/instant-mcp@0.6.1"],
      "env": {
        "INSTANT_ACCESS_TOKEN": "per_xxxxx",
        "INSTANT_API_HOST": "https://apiinstant.fidscript.com",
        "INSTANT_DASH_HOST": "https://instant.fidscript.com",
        "INSTANT_MAVEN_HOST": "https://instant.fidscript.com/maven",
        "INSTANT_APP_ID": "YOUR_APP_ID"
      }
    }
  }
}
```

> ⚠️ **On Windows:** call `npx` directly — do **NOT** wrap in `cmd /c`. Wrapping causes the MCP process to exit and Claude Desktop to show `CONNECTION_CLOSED`.

#### Zed

```json {% showCopy=true %}
{
  "context_servers": {
    "instant-self": {
      "command": {
        "path": "npx",
        "args": ["-y", "@fidscript/instant-mcp@0.6.1"],
        "env": {
          "INSTANT_ACCESS_TOKEN": "per_xxxxx",
          "INSTANT_API_HOST": "https://apiinstant.fidscript.com",
          "INSTANT_DASH_HOST": "https://instant.fidscript.com",
          "INSTANT_MAVEN_HOST": "https://instant.fidscript.com/maven",
          "INSTANT_APP_ID": "YOUR_APP_ID"
        }
      },
      "settings": {}
    }
  }
}
```

#### Other Editors

For any editor that supports the MCP stdio protocol:

```text {% showCopy=true %}
npx -y @fidscript/instant-mcp@0.6.1
```

With the env vars from Step 2.

### Step 4 — Restart your editor

- **Claude Desktop:** Quit completely (Cmd+Q on macOS, right-click system tray → Quit on Windows) and reopen.
- **Cursor:** Reload window from the command palette.
- **Claude Code:** Run `claude mcp list` to confirm.

### Step 5 — Verify

In a new chat, ask: **"What InstantDB tools are available?"**

You should see 76 tools listed. If not, see [Troubleshooting](#troubleshooting) below.

---

## What your AI agent can do

Once connected, your agent can:

- **Inspect your schema** — `get-schema` for the current state of any app
- **Create new apps** — `create-app` returns the new app ID
- **Update schema** — `push-schema-dry-run` first to preview, then `push-schema` to apply
- **Set permissions** — `push-perms` with CEL expressions
- **Query and mutate data** — `query` and `transact` against any app
- **Manage storage** — `uploadFileDirect`, `listUploadedFiles`, `get-upload-url`
- **Configure webhooks, backups, OAuth, email** — full backend control
- **Build Android apps** — `android-setup-guide` returns the complete Gradle config
- **Learn anything** — `learn(topic="...")` for schema, query, transact, perms, auth, storage, cli, or android

The agent has **read access to your docs** via the `learn` tool — it gets the correct format and self-hosted URLs every time.

---

## Schema format — common pitfall

The `push-schema` tool expects a **specific format**:

```json {% showCopy=true %}
{
  "todos": {
    "attrs": {
      "text": "string",
      "done": "boolean"
    }
  }
}
```

**Common mistakes** (the tool will give a clear error if you make these):

❌ `{"entities": {"todos": {...}}}` — wrapping in `entities` is the **server** format, not the input
❌ `i.entity({text: i.string(), done: i.boolean()})` — this is the **JS SDK** builder, not the MCP input

When in doubt, call `learn(topic="schema")` for the correct format and a working example.

---

## Available tools (76 total)

### Learning
- `learn` — topic-specific guides

### Apps
- `list-apps`, `get-app`, `create-app`, `delete-app`

### Schema & Permissions
- `get-schema`, `push-schema`, `push-schema-dry-run`
- `get-perms`, `push-perms`

### Data
- `query` — execute InstaQL
- `transact` — execute transaction steps

### Storage
- `list-files`, `delete-file`, `get-upload-url`, `get-download-url`
- `get-storage-config`, `update-storage-config`, `delete-storage-config`
- `uploadFileDirect`, `listUploadedFiles`

### Webhooks
- `list-webhooks`, `create-webhook`, `update-webhook`, `delete-webhook`
- `enable-webhook`, `disable-webhook`, `get-webhook-events`, `resend-webhook-event`

### Backups
- `list-backups`, `create-backup`, `delete-backup`
- `list-backup-jobs`, `get-backup-job`, `cancel-backup-job`
- `list-backup-files`, `get-backup-file-url`

### Test Users
- `list-test-users`, `create-test-user`, `delete-test-user`

### Email
- `get-email-template`, `update-email-template`, `send-test-email`
- `get-sender-verification`, `send-sender-verification`, `verify-sender-code`

### OAuth
- `list-oauth-providers`, `create-oauth-provider`
- `list-oauth-clients`, `create-oauth-client`, `update-oauth-client`, `delete-oauth-client`, `get-oauth-client`

### Members & Orgs
- `list-orgs`, `get-org`, `list-org-apps`
- `invite-app-member`, `remove-app-member`, `update-app-member`

### Auth tokens
- `list-personal-access-tokens`, `create-personal-access-token`, `delete-personal-access-token`

### Android / Kotlin SDK
- `android-sdk-version`, `android-installation`, `android-configuration`
- `android-capabilities`, `android-documentation`, `android-schema`
- `android-sync-status`, `android-setup-guide`, `android-cross-platform`

---

## Troubleshooting

### `CONNECTION_CLOSED` in Claude Desktop

- Most often: missing one of the 4 `INSTANT_*_HOST` env vars. The MCP throws on startup.
- On Windows: the `cmd /c` wrapper kills the process. Use `"command": "npx"` directly.

### `Required environment variable INSTANT_DASH_HOST is not set`

- The MCP v0.6.0+ requires all 4 `INSTANT_*_HOST` vars. Add them to your config.

### `Schema format error: top-level 'entities' key`

- You passed `{ entities: { todos: {...} } }`. The MCP wants `{ todos: { attrs: {...} } }` at the top level.
- Call `learn(topic="schema")` for the correct format.

### Agent searches `instantdb.com` instead of `instant.fidscript.com`

- This is a self-hosted deployment — upstream docs may differ.
- The MCP `learn` tool returns self-hosted URLs only. Use it.

### Token is rejected

- The token must be a **Personal Access Token** (starts with `per_`), not a user session token.
- Create one at Dashboard → User Settings → Personal Access Tokens.

### Where to find MCP logs

- **Claude Desktop (macOS):** `~/Library/Logs/Claude/`
- **Claude Desktop (Windows):** `%APPDATA%\Claude\logs\`
- **Claude Code:** Run `claude mcp logs instant-self` (or check `~/.claude/logs/`)

---

## Security

- The MCP uses your PAT for authentication — never share it.
- The token is sent in the `Authorization: Bearer <token>` header on every request.
- The MCP tools that handle sensitive data (e.g. `delete-app`) still respect your PAT's permissions.
- The MCP does **not** expose admin tokens, refresh tokens, or storage secrets.

---

## Next steps

- [MCP for AI Agents](/docs/mcp) — full reference
- [Getting started with Android](/docs/start-android) — build a native app
- [Cross-platform data sharing](/docs/cross-platform) — share data with web/iOS
- [Schema](/docs/init), [Permissions](/docs/permissions), [Storage](/docs/storage)
