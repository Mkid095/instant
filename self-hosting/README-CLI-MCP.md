# CLI & MCP Integration for Next Mavens BaaS

This guide explains how to integrate the InstantDB CLI and MCP server with your self-hosted instance.

## Prerequisites

- Docker containers running (server, www, postgres, minio)
- Access to the dashboard at https://instant.fidscript.com
- Admin access to create personal access tokens

## CLI Setup

### 1. Install the CLI

```bash
npm install -g instant-cli
```

### 2. Configure the CLI

Either:
- Copy `instant.config.ts` to your project root, OR
- Set environment variables:

```bash
export INSTANT_CLI_API_URI=https://api.instant.fidscript.com
export INSTANT_CLI_DASH_URI=https://instant.fidscript.com
```

### 3. Login

```bash
instant-cli login
```

This will open a browser window. Enter your email (`kennedygithinjioffice@gmail.com`) and verification code.

### 4. Verify Connection

```bash
instant-cli apps list
```

### 5. Common Commands

```bash
# List apps
instant-cli apps list

# Pull schema from an app
instant-cli schema pull --app <app-id>

# Push schema to an app
instant-cli schema push --app <app-id>

# Pull permissions
instant-cli perms pull --app <app-id>

# Push permissions
instant-cli perms push --app <app-id>
```

## MCP Server Setup

### 1. Install the MCP Server

```bash
npm install -g @instantdb/mcp
```

### 2. Get an Access Token

1. Log into the dashboard: https://instant.fidscript.com
2. Go to User Settings → Personal Access Tokens
3. Create a new token with appropriate scopes

### 3. Run MCP Server (Stdio Mode)

```bash
INSTANT_ACCESS_TOKEN=your-token instant-mcp
```

### 4. Run MCP Server (HTTP Mode)

```bash
INSTANT_ADMIN_TOKEN=your-admin-token \
INSTANT_APP_ID=your-app-id \
INSTANT_OAUTH_CLIENT_ID=your-client-id \
INSTANT_OAUTH_CLIENT_SECRET=your-client-secret \
SERVER_ORIGIN=https://api.instant.fidscript.com \
INSTANT_AES_KEY='{"key":"your-aes-key"}' \
instant-mcp
```

### 5. Configure for Claude Desktop

Add to `~/.claude/settings.json`:

```json
{
  "mcpServers": {
    "instantdb": {
      "command": "npx",
      "args": ["-y", "@instantdb/mcp"],
      "env": {
        "INSTANT_ACCESS_TOKEN": "your-token-here",
        "INSTANT_API_URL": "https://api.instant.fidscript.com"
      }
    }
  }
}
```

## MCP Tools Available

| Tool | Description |
|------|-------------|
| `query` | Execute InstaQL queries against your app |
| `transact` | Execute transactions (create/update/delete) |
| `get-schema` | Get schema instructions |
| `get-perms` | Get permissions instructions |
| `push-schema` | Push schema changes |
| `push-perms` | Push permission changes |
| `learn` | Learn about InstantDB |

## Troubleshooting

### CLI can't connect

1. Verify the API is accessible:
   ```bash
   curl -sk https://api.instant.fidscript.com/health/system
   ```

2. Check your config:
   ```bash
   instant-cli config get
   ```

### MCP authentication fails

1. Ensure your token is valid:
   ```bash
   curl -s -H "Authorization: Bearer $INSTANT_ACCESS_TOKEN" \
     https://api.instant.fidscript.com/dash/apps
   ```

2. Check token has correct scopes for the operations you're performing.

## Auto-Complete Setup

Add to your shell profile (`~/.bashrc`, `~/.zshrc`):

```bash
# Instant CLI
export INSTANT_CLI_API_URI=https://api.instant.fidscript.com
export INSTANT_CLI_DASH_URI=https://instant.fidscript.com

# MCP
export INSTANT_MCP_API_URL=https://api.instant.fidscript.com
```

Then run:
```bash
source ~/.bashrc  # or ~/.zshrc
```
