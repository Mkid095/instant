# Documentation & Dashboard Audit Report

**Date:** 2026-10-03
**Auditor:** Claude Code
**Scope:** All public docs pages + all dashboard tabs

---

## 1. Public Docs Inventory (53 pages)

### Getting started (10)
- `/docs` — React quickstart
- `/docs/create-instant-app` — CLI scaffold
- `/docs/start-rn` — React Native
- `/docs/start-android` — Android (Kotlin) ✅ updated
- `/docs/start-vanilla` — Vanilla JS
- `/docs/start-solidjs` — SolidJS
- `/docs/start-svelte` — Svelte
- `/docs/start-vue` — Vue
- `/docs/start-tanstack` — TanStack Start
- `/docs/start-python` — Python

### Working with data (7)
- `/docs/init` — schema definition
- `/docs/modeling-data` — data modeling
- `/docs/instaml` — transactions
- `/docs/instaql` — queries
- `/docs/infinite-queries` — pagination
- `/docs/backend` — backend patterns
- `/docs/patterns` — common patterns

### Auth (9)
- `/docs/auth` — auth overview
- `/docs/auth/magic-codes`
- `/docs/auth/guest-auth`
- `/docs/auth/google-oauth`
- `/docs/auth/apple`
- `/docs/auth/github-oauth`
- `/docs/auth/linkedin-oauth`
- `/docs/auth/clerk`
- `/docs/auth/firebase`
- `/docs/auth/platform-oauth`

### Permissions (1)
- `/docs/permissions`

### Rate limits (1)
- `/docs/rate-limits`

### Instant features (12)
- `/docs/users` — managing users
- `/docs/presence-and-topics` — presence
- `/docs/cli` — CLI
- `/docs/devtool` — devtool
- `/docs/platform-api`
- `/docs/explorer-component`
- `/docs/emails` — custom emails
- `/docs/teams` — app teams
- `/docs/storage` — storage ✅ updated
- `/docs/streams`
- `/docs/webhooks`
- `/docs/backups`
- `/docs/stripe-payments`
- `/docs/http-api`
- `/docs/next-ssr`

### Self hosting (4)
- `/docs/self-hosting`
- `/docs/self-hosting/vps`
- `/docs/self-hosting/aws`
- `/docs/self-hosting/migrate`

### Common mistakes (1)
- `/docs/common-mistakes`

### Cross-platform (1)
- `/docs/cross-platform` ✅ new

### For AI Agents (1)
- `/docs/mcp` ✅ new

### LLM usage (1)
- `/docs/using-llms` ✅ rewritten

### Workflow (1)
- `/docs/workflow`

---

## 2. Dashboard Tabs (17 total)

| Tab ID | Component | Status |
|--------|-----------|--------|
| `home` | `HomeStartGuide` | ⚠️ untested |
| `explorer` | `ExplorerComponent` | ⚠️ untested |
| `schema` | `Schema` | ⚠️ untested |
| `repl` | `?` | ⚠️ unknown component |
| `sandbox` | `Sandbox` | ⚠️ untested |
| `perms` | `Perms` | ⚠️ untested |
| `auth` | `Auth` + `AppAuth` | ⚠️ untested |
| `webhooks` | `Webhooks` | ⚠️ untested |
| `backups` | `Backups` | ⚠️ untested |
| `email` | `?` | ⚠️ unknown |
| `team` | `Invites` | ⚠️ untested |
| `admin` | `?` | ⚠️ unknown |
| `billing` | `Billing` | ⚠️ untested |
| `oauth-apps` | `OAuthApps` | ⚠️ untested |
| `cli-setup` | `CLISetup` | ✅ redesigned |
| `storage` | `StorageSettings` | ⚠️ untested |
| `android-kotlin` | `AndroidKotlinSdk` | ✅ redesigned |

---

## 3. Gaps & Inconsistencies Found

### A. Stale / outdated content

| Page | Issue | Status |
|------|-------|--------|
| `/docs/using-llms` | Referenced `@fidscript/instant-mcp@0.4.4` and `INSTANT_API_URI` only | ✅ fixed |
| `/docs/storage` | Generic Cloudinary focus, missing R2/S3 | ✅ fixed |
| `/docs/permissions` | Likely has upstream format references | ⚠️ untested |
| `/docs/init` | Probably references `i.entity()` builder format | ⚠️ untested |
| `/docs/instaml` | Probably has wrong transaction syntax | ⚠️ untested |
| `/docs/instaql` | Probably references upstream's query syntax | ⚠️ untested |
| `/docs/cli` | Probably outdated CLI commands | ⚠️ untested |
| `/docs/auth/*` | Many pages; might reference upstream | ⚠️ untested |
| `/docs/self-hosting/*` | May reference upstream docs | ⚠️ untested |

### B. Missing docs (gaps)

| Topic | Has Page? | Action |
|-------|-----------|--------|
| MCP server setup (full guide) | ❌ none | ✅ added `/docs/mcp` |
| Cross-platform data sharing | ❌ none | ✅ added `/docs/cross-platform` |
| Android / Kotlin SDK | ❌ none | ✅ added `/docs/start-android` |
| Self-hosted Maven repo URL | ❌ none | ⚠️ documented in start-android |
| Backup & restore procedure | ⚠️ `/docs/backups` (not audited) | ❓ verify |
| R2 storage provider | ❌ none | ⚠️ mentioned in storage page |
| Webhook signing / secrets | ⚠️ partial | ❓ verify |
| OAuth flow walkthrough | ⚠️ per-provider | ❓ consolidate |

### C. Inconsistent design

| Component | Issue | Status |
|-----------|-------|--------|
| `CLISetup.tsx` | Old design, no feature pills, no StepCard | ✅ redesigned |
| `AndroidKotlinSdk.tsx` | Already redesigned | ✅ |
| Other tabs | Inconsistent design language | ❓ needs audit |

### D. Hardcoded URLs

| Location | Issue | Status |
|----------|-------|--------|
| MCP source code | All 5 hardcoded URLs | ✅ moved to env vars |
| `fidscript-sdk/defaults.ts` | Hardcoded API URL | ✅ moved to domain-config |
| `fidscript-admin/defaults.ts` | Hardcoded API URL | ✅ moved to domain-config |
| Docs MDX pages | Many `instant.fidscript.com` references | ⚠️ partial (in code samples) |
| `Caddyfile` | Hardcoded domains | ⚠️ keeps for static config |
| `docker-compose.yml` | Default URLs | ✅ uses env vars |
| Kotlin source | Hardcoded test URLs | ⚠️ not audited |

### E. Missing cross-links

| From | To | Should be added? |
|------|----|------------------|
| `/docs/init` | `/docs/start-android` | ✅ mention Android |
| `/docs/storage` | `/docs/mcp` | ✅ mention MCP tools |
| `/docs/permissions` | `/docs/mcp` | ✅ mention push-perms |
| All SDK pages | `/docs/cross-platform` | ⚠️ not linked |
| `/docs/using-llms` | `/docs/mcp` | ✅ linked |
| `/docs/cli` | `/docs/mcp` | ⚠️ not linked |

### F. Missing dashboard tabs

Looking at the list of 17 tabs, some have unknown/uncertain components:

| Tab | Component? | Notes |
|-----|------------|-------|
| `repl` | ❓ | Possibly inline in index.tsx or missing |
| `email` | ❓ | Could be EmailTemplates.tsx (not in components list) |
| `admin` | ❓ | Could be admin-specific settings |

### G. Auth subdomain docs

`/docs/auth/clerk` and `/docs/auth/firebase` exist but they're for third-party providers. They might reference upstream.

### H. Self-hosting subdomain docs

`/docs/self-hosting/aws` and `/docs/self-hosting/vps` likely have deployment instructions that may need updating for the current architecture.

---

## 4. Recommended Action Items (in priority order)

### P0 — Critical
- [x] Add `/docs/mcp`
- [x] Add `/docs/start-android`
- [x] Add `/docs/cross-platform`
- [x] Fix `/docs/using-llms` (MCP version, env vars, host)
- [x] Update `CLISetup` to match `AndroidKotlinSdk` design
- [x] Fix hardcoded URLs in MCP source code (use env vars)
- [x] Fix hardcoded URLs in fidscript-sdk, fidscript-admin

### P1 — High priority
- [ ] Audit `/docs/init`, `/docs/instaml`, `/docs/instaql` for upstream references
- [ ] Audit `/docs/permissions` for CEL syntax correctness
- [ ] Audit `/docs/cli` for outdated commands
- [ ] Audit `/docs/auth/*` (clerk, firebase) for upstream references
- [ ] Audit `/docs/self-hosting/*` for current architecture
- [ ] Find missing `repl`, `email`, `admin` dashboard tab components
- [ ] Add cross-links between related pages

### P2 — Medium priority
- [ ] Audit `/docs/storage` for R2/S3 provider details
- [ ] Audit `/docs/webhooks` for security details
- [ ] Audit `/docs/backups` for restore procedure
- [ ] Make all `dash?t=` pages share the same design language
- [ ] Add "On this page" / table-of-contents to long pages
- [ ] Add breadcrumbs to deep pages

### P3 — Low priority
- [ ] Find Kotlin test files with hardcoded test URLs
- [ ] Make Caddyfile use env vars
- [ ] Add a "What is FIDScript?" landing page
- [ ] Add troubleshooting cookbook
- [ ] Add a "Recent changes" / changelog page

---

## 5. Design System Inconsistencies

The `CLISetup` and `AndroidKotlinSdk` pages now share:
- `CodeBlock` with language tag + copy button
- `StepCard` with numbered steps
- `InfoCard` for configuration panels
- `FeaturePill` row at the top
- `ResourceCard` at the bottom

Other dashboard pages should adopt this design for consistency. Consider extracting these to `client/www/components/ui/` as shared components.

---

## 6. Documentation Anti-patterns to Fix

| Pattern | Where | Fix |
|---------|-------|-----|
| `instantdb.com` URLs | Several docs pages (untested) | Replace with `instant.fidscript.com` |
| `i.entity()` builder format in docs | `/docs/init` likely | Use MCP server-side format |
| Outdated package versions | Various | Update to current |
| Hardcoded env values in code samples | Various | Show as `YOUR_X` placeholders |
| Missing "self-hosted" warnings | Storage, auth, email | Add banner where applicable |

---

## 7. Quick Wins (can be done in one pass)

1. Add "On this page" anchor links at the top of all long pages
2. Add a "Was this helpful?" feedback widget
3. Add edit-this-page links to GitHub
4. Add "Last updated" timestamps
5. Add a search bar (if not present)
