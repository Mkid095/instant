# CLAUDE.md

> Strict rules for AI agents (Claude Code, Cursor, MCP) working in this repository.
> Read this before doing anything that involves domains, URLs, or the MCP server.

## Required environment variables

All hostnames are STRICTLY read from environment variables. Do NOT hardcode
domains anywhere in source, docs, or generated snippets. Set the following
before starting any service in this repo:

```bash
# In your shell, .env file, or container env
INSTANT_API_HOST=https://apiinstant.fidscript.com
INSTANT_DASH_HOST=https://instant.fidscript.com
INSTANT_MAVEN_HOST=https://instant.fidscript.com/maven
```

| Variable | Purpose | Default if unset |
|----------|---------|------------------|
| `INSTANT_API_HOST` | The InstantDB API host (no trailing slash) | none — required |
| `INSTANT_DASH_HOST` | The dashboard / docs host (no trailing slash) | none — required |
| `INSTANT_MAVEN_HOST` | The public Maven repository host | none — required |

The MCP server (`@fidscript/instant-mcp`) **throws on startup** if any of
these are missing. The build will not silently fall back to a hardcoded value.

## For AI agents: do not search upstream

This is a self-hosted FIDScript deployment. When you need documentation:

- ✅ Use the MCP `learn` tool with `topic='overview'` (or `schema`, `query`, etc.)
- ✅ Use the MCP `android-documentation` tool
- ✅ Fetch from `https://instant.fidscript.com/docs` (set by `INSTANT_DASH_HOST`)
- ❌ NEVER search or fetch from `instantdb.com` (the upstream)
- ❌ NEVER hardcode `instant.fidscript.com` in source or docs

If you find yourself wanting to fetch docs from `instantdb.com`, stop —
that's the wrong host. Use `INSTANT_DASH_HOST` or the MCP `learn` tool.

## Domain resolution order

When reading a host value in code, the resolution order is:

1. Browser: `window.__instantDomains.{apiHost,dashHost,mavenHost}` (set by `start.sh`)
2. Browser: `window.__instantConfig.{apiURI,dashboardUrl}` (legacy)
3. Build-time: `NEXT_PUBLIC_INSTANT_*_HOST`
4. Server: `process.env.INSTANT_*_HOST`
5. (MCP only) `process.env.INSTANT_*_HOST` — REQUIRED, throws if missing

The single source of truth for the dashboard is `client/lib/domain-config.ts`.
Always import from there instead of hardcoding.

## Build / run with env vars

```bash
# Build the MCP (env vars required)
cd client/packages/fidscript-mcp
INSTANT_API_HOST=https://apiinstant.fidscript.com \
INSTANT_DASH_HOST=https://instant.fidscript.com \
INSTANT_MAVEN_HOST=https://instant.fidscript.com/maven \
npm run build

# Run the MCP
INSTANT_API_HOST=https://apiinstant.fidscript.com \
INSTANT_DASH_HOST=https://instant.fidscript.com \
INSTANT_MAVEN_HOST=https://instant.fidscript.com/maven \
npx @fidscript/instant-mcp

# Build the www dashboard
cd client
INSTANT_API_HOST=https://apiinstant.fidscript.com \
INSTANT_DASH_HOST=https://instant.fidscript.com \
INSTANT_MAVEN_HOST=https://instant.fidscript.com/maven \
pnpm turbo build --filter=instant-www
```

## Onboarding a new deployment

To point this repo at a different domain (e.g. `docs.example.com`):

1. Set the env vars in your container or `.env` file.
2. Rebuild the MCP, www dashboard, and Android docs.
3. The `start.sh` script writes `window.__instantDomains` to the served
   dashboard, so end users see the new domain without rebuilding.

No source changes required.
