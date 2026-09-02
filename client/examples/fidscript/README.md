# FIDScript Examples

Minimal working applications demonstrating FIDScript SDK usage across different frameworks.

Each example implements the same workflow: **Connect → Auth → Query → Mutate → Realtime**

All connect to `https://apiinstant.fidscript.com` by default.

## Examples

| Framework | Location | Port | Status |
|-----------|----------|------|--------|
| React | `react/` | 3000 | ✅ Builds |
| Vue | `vue/` | 5173 | ✅ Builds |
| Svelte | `svelte/` | 5174 | ✅ Builds |
| Solid | `solid/` | 5175 | ✅ Builds |
| React Native | `rn/` | — | ✅ TypeScript compiles |

## Quick Start

```bash
# Pick a framework
cd react   # or vue, svelte, solid

# Install dependencies
npm install

# Start dev server
npm run dev

# Build for production
npm run build
```

## What Each Example Demonstrates

1. **Connect** - Initializes FIDScript with FIDScript's default API endpoint (`apiinstant.fidscript.com`)
2. **Auth** - Guest sign-in via `db.auth.signInAsGuest()`
3. **Query** - Realtime queries with `db.useQuery()`
4. **Mutate** - Write data with `db.transact()`
5. **Realtime** - Changes sync automatically across tabs

## Prerequisites

- Node.js 18+
- npm 9+

## App ID

Each example uses `demo-app` as a placeholder. For full functionality:

1. Deploy FIDScript server (or use `https://apiinstant.fidscript.com`)
2. Create an app in the dashboard
3. Replace `VITE_APP_ID` (or `APP_ID`) with your actual app ID
4. Push the schema defined in the example

## React Native

Requires Expo for development:

```bash
cd rn
npm install
npx expo start
```
