# CLI & MCP Integration for Self-Hosted InstantDB

This guide explains how to use the InstantDB CLI and MCP server with your self-hosted Instant deployment.

## FIDScript Skill for Claude Code

For Claude Code, you can use the FIDScript Agent Skill for an automated development workflow:

```bash
npx skills add Mkid095/agent-skills -s instant-self
```

Then invoke FIDScript Self-Hosted Development Mode with:

```
/instant-self
```

This skill understands how to create projects, manage schema, and use the MCP tools automatically.

## Prerequisites

- Self-hosted Instant running at `https://apiinstant.fidscript.com`
- Dashboard accessible at `https://instant.fidscript.com`
- Admin access to create personal access tokens

---

## CLI Setup

### 1. Install the CLI

```bash
npm install -g instant-cli
```

### 2. Configure for Self-Hosted

Set environment variables to point the CLI at your self-hosted API:

```bash
export INSTANT_CLI_API_URI=https://apiinstant.fidscript.com
export INSTANT_CLI_DASH_URI=https://instant.fidscript.com
```

Or use an `instant.config.ts` file in your project root:

```ts
// instant.config.ts
export default {
  apiURI: 'https://apiinstant.fidscript.com',
  dashURI: 'https://instant.fidscript.com',
};
```

### 3. Login

```bash
instant-cli login
```

This opens a browser window for email + magic code authentication.

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

---

## MCP Server Setup

Your self-hosted deployment can use the **@fidscript/instant-mcp** package, which connects directly to your self-hosted API using a Personal Access Token.

### How It Works

```
Claude Code
    │
    │ stdio
    ▼
@fidscript/instant-mcp
    │
    │ HTTPS + Bearer PAT
    ▼
https://apiinstant.fidscript.com
    │
    ▼
Your Self-Hosted InstantDB
```

**No `mcp.instantdb.com`. No OAuth. No Instant Cloud.**

### Step 1: Get a Personal Access Token

1. Log into your dashboard: `https://instant.fidscript.com`
2. Go to **User Settings → Personal Access Tokens**
3. Create a new token

### Step 2: Choose Your Editor

#### Claude Code

The recommended way to install for Claude Code is with the `claude mcp add` command:

```bash
claude mcp add instant-self \
  -e INSTANT_ACCESS_TOKEN=<YOUR_PAT> \
  -e INSTANT_API_URI=https://apiinstant.fidscript.com \
  -e INSTANT_APP_ID=<YOUR_APP_ID> \
  -- npx -y @fidscript/instant-mcp@0.4.4
```

Verify it is registered:

```bash
claude mcp list
```

You should see `instant-self` listed.

To remove:

```bash
claude mcp remove instant-self
```

Alternatively, add to `~/.claude/settings.json` manually:

```json
{
  "mcpServers": {
    "instant-self": {
      "command": "npx",
      "args": ["-y", "@fidscript/instant-mcp@0.4.4"],
      "env": {
        "INSTANT_API_URI": "https://apiinstant.fidscript.com",
        "INSTANT_ACCESS_TOKEN": "<YOUR_PAT>",
        "INSTANT_APP_ID": "<YOUR_APP_ID>"
      }
    }
  }
}
```

#### Cursor / Windsurf / Cline

```json
{
  "mcpServers": {
    "instant-self": {
      "command": "npx",
      "args": ["-y", "@fidscript/instant-mcp@0.4.4"],
      "env": {
        "INSTANT_API_URI": "https://apiinstant.fidscript.com",
        "INSTANT_ACCESS_TOKEN": "<YOUR_PAT>",
        "INSTANT_APP_ID": "<YOUR_APP_ID>"
      }
    }
  }
}
```

#### Zed

```json
{
  "context_servers": {
    "instant-self": {
      "command": {
        "path": "npx",
        "args": ["-y", "@fidscript/instant-mcp@0.4.4"],
        "env": {
          "INSTANT_API_URI": "https://apiinstant.fidscript.com",
          "INSTANT_ACCESS_TOKEN": "<YOUR_PAT>",
          "INSTANT_APP_ID": "<YOUR_APP_ID>"
        }
      }
    }
  }
}
```

### MCP Tools Available

| Tool | Description |
|------|-------------|
| `learn` | Learn about InstantDB concepts |
| `query` | Execute InstaQL queries against your app |
| `transact` | Execute transactions (create/update/delete) |
| `get-schema` | Get current schema for an app |
| `push-schema` | Push schema definition to an app |
| `push-schema-dry-run` | Preview schema push without applying |
| `get-perms` | Get current permissions rules for an app |
| `push-perms` | Push new permissions rules to an app |
| `list-apps` | List all apps |
| `get-app` | Get app details |
| `create-app` | Create a new app |
| `delete-app` | Delete an app |
| `list-files` | List files in app storage |
| `delete-file` | Delete a storage file |
| `get-upload-url` | Get pre-signed upload URL |
| `get-download-url` | Get pre-signed download URL |
| `upload-file` | Upload file directly and get public URL |
| `list-uploaded-files` | List all uploaded files with public URLs |
| `get-storage-config` | Get current storage configuration |
| `update-storage-config` | Update storage configuration |
| `delete-storage-config` | Remove custom storage config |
| `list-webhooks` | List all webhooks |
| `create-webhook` | Create a webhook |
| `update-webhook` | Update a webhook |
| `delete-webhook` | Delete a webhook |
| `enable-webhook` | Enable a webhook |
| `disable-webhook` | Disable a webhook |
| `get-webhook-events` | Get webhook delivery events |
| `resend-webhook-event` | Re-trigger a webhook event |
| `list-backups` | List all backups |
| `create-backup` | Trigger an on-demand backup |
| `delete-backup` | Delete a backup |
| `list-backup-jobs` | List in-progress backup jobs |
| `get-backup-job` | Get backup job status |
| `cancel-backup-job` | Cancel a backup job |
| `list-backup-files` | List files in a backup |
| `get-backup-file-url` | Get pre-signed URL for backup file |
| `list-test-users` | List test users |
| `create-test-user` | Create a test user |
| `delete-test-user` | Delete a test user |
| `get-email-template` | Get magic-code email template |
| `update-email-template` | Update email template |
| `send-test-email` | Send a test email |
| `get-sender-verification` | Get DKIM verification status |
| `send-sender-verification` | Send verification email |
| `verify-sender-code` | Complete domain verification |
| `list-orgs` | List all orgs |
| `get-org` | Get org details |
| `list-org-apps` | List apps in an org |
| `invite-app-member` | Invite user to an app |
| `remove-app-member` | Remove app member |
| `update-app-member` | Update member role |

---

## Storage Integration Guide

### Overview

InstantDB's storage system integrates with **Cloudinary** for file storage. When you upload a file:
1. The file is uploaded to Cloudinary
2. You receive a **direct public URL** back
3. You save that URL to your database as a reference

This makes it easy to store images, videos, documents, or any file type.

### Setting Up Cloudinary

1. Create a Cloudinary account at [cloudinary.com](https://cloudinary.com)
2. Copy your cloud name, API key, and API secret
3. Update your storage configuration:

```bash
# Using MCP tool
update-storage-config --app-id <YOUR_APP_ID> \
  --cloud-name your-cloud-name \
  --api-key your-api-key \
  --api-secret your-api-secret \
  --upload-preset your-unsigned-preset
```

Or via the dashboard at `https://instant.fidscript.com` → App Settings → Storage.

### Uploading Files

#### Option 1: Direct Upload (Recommended)

Use `upload-file` to upload a file and get the public URL directly:

```bash
upload-file --app-id <APP_ID> \
  --filename "products/image.jpg" \
  --content-type "image/jpeg" \
  --content "<BASE64_ENCODED_FILE>"
```

Response:
```json
{
  "data": {
    "id": "file-uuid",
    "locationId": "cloudinary-location-id",
    "path": "products/image.jpg",
    "size": 12345,
    "contentType": "image/jpeg",
    "url": "https://res.cloudinary.com/your-cloud/image/upload/v1234567890/products/image.jpg"
  }
}
```

**Save the `url` to your database!**

#### Option 2: Get Pre-signed URL

Use `get-upload-url` to get a pre-signed URL, then upload directly:

```bash
get-upload-url --app-id <APP_ID> --filename "videos/intro.mp4"
```

Response contains a URL where you PUT your file directly.

### Using Uploaded Files

After uploading, save the public URL to your InstantDB entity:

```javascript
// Example: Save video URL to a product
transact --app-id <APP_ID> --steps '[
  ["create", "products", "<PRODUCT_ID>", {
    "name": "My Product",
    "videoUrl": "https://res.cloudinary.com/your-cloud/video/upload/v123/video.mp4"
  }]
]'
```

### Listing Uploaded Files

```bash
# Get all uploaded files for an app
list-uploaded-files --app-id <APP_ID>
```

This returns all files with their public URLs, sizes, and upload timestamps.

### Example: Complete Product Media Flow

1. **Create schema** with media fields:
```javascript
push-schema --app-id <APP_ID> --schema '{
  "products": {
    "attrs": {
      "name": {"type": "string"},
      "imageUrl": {"type": "string"},
      "videoUrl": {"type": "string"}
    }
  }
}'
```

2. **Upload images and videos** using `upload-file`

3. **Save URLs to database** using `transact`

4. **Query and render** the URLs in your app

### Storage Configuration

By default, InstantDB uses **Cloudinary** for storage. You can configure:

| Provider | Setting |
|----------|---------|
| Cloudinary | `cloud_name`, `api_key`, `api_secret`, `upload_preset` |
| R2 (Cloudflare) | `account_id`, `access_key_id`, `secret_access_key`, `bucket`, `endpoint` |
| S3 | `bucket`, `region`, `access_key_id`, `secret_access_key` |

---

## Configuration Reference

### Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `INSTANT_ACCESS_TOKEN` | Personal Access Token from your dashboard | Yes |
| `INSTANT_API_URI` | Your self-hosted API URL (default: `https://apiinstant.fidscript.com`) | No |
| `INSTANT_APP_ID` | Default app ID for query/transact tools | Recommended |

### CLI Arguments

```
npx @fidscript/instant-mcp [OPTIONS]

OPTIONS:
  -t, --token <token>    Personal access token (or set INSTANT_ACCESS_TOKEN)
  -u, --api-url <url>   API URL (default: https://apiinstant.fidscript.com)
  -a, --app-id <id>     Default app ID (or set INSTANT_APP_ID)
  -h, --help            Show help
  -v, --version         Show version
```

### All Three Configuration Methods

**Environment variables:**
```bash
export INSTANT_ACCESS_TOKEN=per_xxxxx
export INSTANT_API_URI=https://apiinstant.fidscript.com
export INSTANT_APP_ID=your-app-id
npx -y @fidscript/instant-mcp
```

**CLI arguments:**
```bash
npx -y @fidscript/instant-mcp \
  --token per_xxxxx \
  --api-url https://apiinstant.fidscript.com \
  --app-id your-app-id
```

**Mixed (env for secrets, CLI for overrides):**
```bash
export INSTANT_ACCESS_TOKEN=per_xxxxx
npx -y @fidscript/instant-mcp --app-id your-app-id
```

---

## Troubleshooting

### CLI can't connect

1. Verify the API is accessible:
   ```bash
   curl -fsS https://apiinstant.fidscript.com/health/system
   ```

2. Check your config:
   ```bash
   instant-cli config get
   ```

### MCP server fails to start

1. Verify the token works directly against the API:
   ```bash
   curl -s -H "Authorization: Bearer $INSTANT_ACCESS_TOKEN" \
     https://apiinstant.fidscript.com/dash/apps
   ```

2. Test the MCP package directly:
   ```bash
   INSTANT_ACCESS_TOKEN=<TOKEN> INSTANT_API_URI=https://apiinstant.fidscript.com \
     npx -y @fidscript/instant-mcp --version
   ```

3. Check that `INSTANT_ACCESS_TOKEN` is set and valid

### Authentication errors

- Ensure the token was created in your self-hosted dashboard, not Instant Cloud
- Ensure the token has appropriate scopes for the operations you're performing
- Tokens are tied to your self-hosted Instant account

---

## Shell Profile Setup

Add to `~/.bashrc` or `~/.zshrc`:

```bash
# Instant CLI
export INSTANT_CLI_API_URI=https://apiinstant.fidscript.com
export INSTANT_CLI_DASH_URI=https://instant.fidscript.com
```

Then run `source ~/.bashrc` (or open a new terminal).
