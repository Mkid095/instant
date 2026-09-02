# FIDScript React Example

A minimal FIDScript app demonstrating: Connect → Auth → Query → Mutate → Realtime.

## Stack
- Vite + React + TypeScript
- `@fidscript/instant-react`
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

- Uses a temporary app ID for demo purposes. Replace `VITE_APP_ID` in `src/App.tsx` with your own app ID from your FIDScript dashboard.
- The schema is defined in `src/schema.ts` and should be pushed with the FIDScript CLI.
