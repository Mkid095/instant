# FIDScript React Native Example

A minimal FIDScript React Native app demonstrating: Connect → Auth → Query → Mutate → Realtime.

## Stack
- Expo + React Native + TypeScript
- `@fidscript/instant-react-native`
- Connects to `https://apiinstant.fidscript.com`

## Setup

```bash
npm install
npx expo start
```

Then scan the QR code with Expo Go.

## What it does

1. **Connect** - Initializes FIDScript with the default FIDScript endpoint
2. **Auth** - Supports guest sign-in
3. **Query** - Displays a list of messages
4. **Mutate** - Add new messages
5. **Realtime** - Messages update in real-time across devices

## Notes

- Uses a temporary app ID for demo purposes. Replace `APP_ID` in `src/App.tsx` with your own app ID.
- The schema is defined in `src/App.tsx` and should be pushed with the FIDScript CLI.
