# FIDScript Svelte Example

A minimal FIDScript app demonstrating: Connect → Auth → Query → Mutate → Realtime.

## Stack
- Vite + Svelte 5 + TypeScript
- `@fidscript/instant-svelte`
- Connects to `https://apiinstant.fidscript.com`

## Setup

```bash
npm install
npm run dev
```

## What it does

1. **Connect** - Initializes FIDScript with the default FIDScript endpoint
2. **Auth** - Supports guest sign-in
3. **Query** - Displays a list of messages
4. **Mutate** - Add new messages
5. **Realtime** - Messages update in real-time across tabs
