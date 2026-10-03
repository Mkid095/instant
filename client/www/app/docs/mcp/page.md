---
nextjs:
  metadata:
    title: 'MCP for AI Agents'
    description: 'Configure the InstantDB MCP server for Claude Desktop, Cursor, and other AI editors.'
---

The InstantDB MCP (Model Context Protocol) server lets AI agents — Claude Code, Cursor, Claude Desktop, and others — interact with your self-hosted InstantDB deployment. It exposes 76 tools for managing apps, schema, permissions, storage, webhooks, and the Android/Kotlin SDK.

## What you get

- **App management** — create, list, get, delete apps
- **Schema** — `push-schema`, `push-schema-dry-run`, `get-schema`
- **Permissions** — `push-perms`, `get-perms`
- **Data** — `query`, `transact`, `learn` (with topic-specific guides)
- **Storage** — upload, list, download, delete files
- **Webhooks** — create, list, enable/disable, retry
- **OAuth** — providers and clients
- **Backups** — create, restore, list
- **Email templates** — get, update, send test
- **Android/Kotlin SDK** — `android-sdk-version`, `android-installation`, `android-configuration`, `android-capabilities`, `android-documentation`, `android-schema`, `android-sync-status`, `android-setup-guide`, `android-cross-platform`

## Required environment variables

The MCP server **throws on startup** if any of these are missing. Set all four before running:

| Variable | Example | Purpose |
|----------|---------|---------|
| `INSTANT_API_HOST` | `https://apiinstant.fidscript.com` | The API host |
| `INSTANT_DASH_HOST` | `https://instant.fidscript.com` | The dashboard / docs host |
| `INSTANT_MAVEN_HOST` | `https://instant.fidscript.com/maven` | The public Maven repository host |
| `INSTANT_ACCESS_TOKEN` | `per_xxxxx` | Your Personal Access Token (from User Settings) |

## Install (one-shot, npx)

```bash {% showCopy=true %}
INSTANT_ACCESS_TOKEN=per_xxxxx \
INSTANT_API_HOST=https://apiinstant.fidscript.com \
INSTANT_DASH_HOST=https://instant.fidscript.com \
INSTANT_MAVEN_HOST=https://instant.fidscript.com/maven \
npx -y @fidscript/instant-mcp@0.6.1
```

## Configure Claude Desktop

Edit `claude_desktop_config.json`:
- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

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

After saving the file, **fully quit and restart Claude Desktop** (Cmd+Q on macOS, right-click system tray → Quit on Windows).

## Configure Claude Code

Add to `~/.claude/settings.json` (or `.claude/settings.local.json` in your project):

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

## Configure Cursor

In Cursor's settings, go to **Features → Model Context Protocol → Add new global MCP server**, then paste the same JSON config.

## Verifying the connection

After restarting your editor, the MCP tools should appear:

1. Open a new chat.
2. Type: "What InstantDB tools are available?"
3. The agent should list 76 tools.

If the tools don't appear:

1. Check your editor's MCP logs (Claude Desktop: `~/Library/Logs/Claude/`, Windows: `%APPDATA%\Claude\logs\`).
2. Run the MCP directly in a terminal — if it prints an error, the env vars are wrong.
3. Confirm the `INSTANT_ACCESS_TOKEN` is a Personal Access Token, not a user session token.

## Available tools (76 total)

### Learning
- `learn` — topic-specific guides (`topic="schema"`, `query`, `transact`, `perms`, `auth`, `storage`, `cli`, `android`, or `overview`)

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
- `android-sdk-version` — current SDK version and coordinates
- `android-installation` — Gradle dependency snippet
- `android-configuration` — InstantDb init snippet
- `android-capabilities` — what the SDK can do
- `android-documentation` — pointers to self-hosted docs
- `android-schema` — schema introspection
- `android-sync-status` — informational
- `android-setup-guide` — complete setup walkthrough
- `android-cross-platform` — share data with web/iOS

## Common issues

### `CONNECTION_CLOSED` in Claude Desktop
- Most often: missing one of the 4 `INSTANT_*_HOST` env vars.
- On Windows: the `cmd /c` wrapper kills the process. Use `"command": "npx"` directly.

### `Schema format error: top-level 'entities' key`
- You passed `{ entities: { todos: {...} } }`. The MCP wants `{ todos: { attrs: {...} } }` at the top level.
- Call `learn(topic="schema")` for the correct format.

### Agent searches `instantdb.com` instead of `instant.fidscript.com`
- This is a self-hosted deployment — upstream docs may differ.
- The MCP `learn` tool returns self-hosted URLs only. Use it.

### `Required environment variable INSTANT_DASH_HOST is not set`
- The MCP v0.6.0+ requires all 4 `INSTANT_*_HOST` vars. Add them to your config.

## Security

The MCP server uses a Personal Access Token (PAT) — never share this token. The token is sent in the `Authorization: Bearer <token>` header on every request. The MCP tools that handle sensitive data (e.g. `delete-app`) still respect your PAT's permissions.

## Next steps

- [Getting started with Android](/docs/start-android)
- [Cross-platform data sharing](/docs/cross-platform)
- [Storage](/docs/storage)
- [Webhooks](/docs/webhooks)
