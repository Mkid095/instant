# FIDScript Vue Example

A minimal FIDScript app demonstrating: Connect → Auth → Query → Mutate → Realtime.

## Stack
- Vite + Vue 3 + TypeScript
- `@fidscript/instant-vue`
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

## Notes

- Uses a temporary app ID for demo purposes. Replace `VITE_APP_ID` in `src/db.ts` with your own app ID.
- The schema is defined in `src/db.ts` and should be pushed with the FIDScript CLI.
