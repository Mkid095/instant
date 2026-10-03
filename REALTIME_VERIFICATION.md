# Realtime Verification Report

**Date:** 2026-10-03
**Scope:** Confirm realtime is enabled by default across the entire stack
**Status:** ✅ All realtime-enabled by default

---

## 1. Server (Clojure)

| Endpoint | File | Realtime? |
|----------|------|-----------|
| `GET /runtime/session` | `server/src/instant/runtime/routes.clj:772` | ✅ WebSocket |
| `GET /runtime/sse` | `server/src/instant/runtime/routes.clj:773` | ✅ Server-Sent Events |
| `POST /runtime/sse` | `server/src/instant/runtime/routes.clj:774` | ✅ SSE (transactional) |
| `query-sse` (admin) | `server/src/instant/admin/routes.clj:172` | ✅ SSE for admin queries |

**Realtime by default:** All four endpoints serve real-time updates without any opt-in configuration. New apps automatically have the `/runtime/session` WebSocket endpoint available.

## 2. Web SDK (JavaScript / TypeScript)

| File | Realtime primitive |
|------|---------------------|
| `client/packages/fidscript-sdk/src/fidscript.ts` | `subscribeQuery()` opens WebSocket by default |
| `client/packages/fidscript-instant-react/src/useQuery.ts` | `useQuery()` is built on `subscribeQuery` — real-time |
| `client/packages/fidscript-instant-react-common/src/InstantReactAbstractDatabase.tsx` | `useQuery()` and `subscribeQuery()` are realtime |

**Realtime by default:** All `useQuery` and `subscribeQuery` calls are real-time subscriptions. The WebSocket is opened on first query and reused. There is no "polling mode" or "manual realtime" flag.

**WebSocket URL default:** `wss://apiinstant.fidscript.com/runtime/session` (from `fidscript.ts:29`)

## 3. React Native SDK

| File | Realtime primitive |
|------|---------------------|
| `client/packages/fidscript-instant-react-native/src/index.ts` | Inherits from fidscript-instant-react-common |
| `EventSourceImpl.ts`, `EventSourceShim.ts` | Native event-source polyfill |
| `NetworkListener.js` | Network state detection for offline/online |
| `Storage.js` / `Storage.native.ts` | SQLite-backed persistence (offline) |

**Realtime by default:** Same as Web SDK. `useQuery` is real-time.

**Offline:** Auto-reconnect with network listener. Pending mutations queue and replay.

## 4. Android / Kotlin SDK

| File | Purpose |
|------|---------|
| `client/packages/android/instantdb-kotlin/src/main/kotlin/com/instantdb/poc/InstantDb.kt` | Transport layer (WS + SSE) |
| `client/packages/android/instantdb-kotlin/src/main/kotlin/com/instantdb/poc/SubscriptionManager.kt` | Query subscription + resync |
| `client/packages/android/instantdb-kotlin/src/main/kotlin/com/instantdb/poc/MutationQueue.kt` | Pending mutation queue |
| `client/packages/android/instantdb-kotlin/src/main/kotlin/com/instantdb/poc/OptimisticStore.kt` | Local optimistic state |
| `client/packages/android/instantdb-android/src/main/kotlin/com/instantdb/android/InstantDb.kt` | High-level API |
| `client/packages/android/instantdb-android/src/main/kotlin/com/instantdb/android/compose/InstantQuery.kt` | `rememberInstantQuery` Composable |
| `client/packages/android/instantdb-android/src/main/kotlin/com/instantdb/android/connectivity/AndroidConnectivityManager.kt` | Network state callback |
| `client/packages/android/instantdb-android/src/main/kotlin/com/instantdb/android/persistence/AndroidSqliteDriverFactory.kt` | SQLDelight-backed SQLite cache |
| `client/packages/android/instantdb-android/src/main/kotlin/com/instantdb/android/credentials/SecureCredentialStorage.kt` | Android Keystore credential storage |

**Realtime by default:** `InstantDbConfig(useSse = false)` defaults to WebSocket. The transport connects on `connect()` and stays open.

**Offline-first:**
- Local SQLite cache (via SQLDelight) survives process death
- Pending mutations persist to disk and replay on reconnect
- Auto-reconnect with linear backoff
- WebSocket → SSE fallback when WS is blocked
- Connectivity manager triggers reconnect on network change

## 5. Next.js SSR

| File | Realtime support |
|------|------------------|
| `client/www/app/docs/next-ssr/page.md` | `@fidscript/instant-react/nextjs` library |
| `client/packages/fidscript-instant-react/nextjs` | Server-side queryOnce + shared cache with client |

**Realtime behavior in SSR:** `queryOnce()` runs on the server, result is hydrated to the client. The client then opens the WebSocket and subscribes for live updates.

**No "SSR-mode disables realtime"** — both modes coexist via the shared cache.

## 6. Cross-platform realtime

When the same `appId` is used across clients (Android, web, iOS, React Native, Python), the VPS routes updates:

```
App A writes todo "X" on Android
  → VPS receives transact
  → VPS broadcasts to all subscribed clients
  → Web app receives update in real-time (SSE/WS)
  → iOS app receives update in real-time (SSE/WS)
  → React Native app receives update in real-time (SSE/WS)
```

This is **automatic** — no extra configuration. The same `appId` means the same database and the same subscription group.

## 7. Offline behavior (all clients)

| Client | Offline read | Offline write | Resync on reconnect |
|--------|--------------|---------------|---------------------|
| Web (with IndexedDB) | ✅ | ⚠️ no queue (online-only) | ✅ on reconnect |
| React Native (SQLite) | ✅ | ✅ queued | ✅ replayed |
| Android (SQLDelight SQLite) | ✅ | ✅ queued | ✅ replayed |
| SSR | ❌ n/a | ❌ n/a | ❌ n/a |

**Android / RN are the only clients with full offline-first write capability.** Web requires connectivity to write.

## 8. Configuration knobs (not opt-in, but available)

These can be tuned but realtime is the default in all cases:

| Knob | Default | Effect |
|------|---------|--------|
| `useSse` (Android) | `false` (WebSocket) | `true` = SSE |
| `websocketURI` (web) | `wss://apiinstant.fidscript.com/runtime/session` | Custom WS endpoint |
| `queryCacheLimit` (web) | `10` | Max offline-cached queries |
| `verbose` (web) | `false` | Console debug logging |

## 9. Summary

| Surface | Realtime? | Offline read? | Offline write? | Auto-resync? |
|---------|-----------|---------------|---------------|-------------|
| Web SDK (JS) | ✅ | ✅ (IndexedDB) | ❌ | ✅ |
| React (useQuery) | ✅ | ✅ | ❌ | ✅ |
| React Native | ✅ | ✅ (SQLite) | ✅ | ✅ |
| Android (Kotlin) | ✅ | ✅ (SQLDelight) | ✅ | ✅ |
| Next.js SSR | ✅ (after hydrate) | n/a | n/a | n/a |
| Python SDK | ✅ | ❌ | ❌ | n/a |

**Realtime is on by default everywhere.** No client needs to enable it.

## 10. How to verify

1. **Web:** Open two browser tabs to your app. Add a todo in one — it appears in the other within milliseconds.
2. **Android:** Open the sample app (`/home/ken/projects/kotlin-poc/sample-android/`). Add a todo. Open the web app with the same `appId` — the todo appears immediately.
3. **Server:** `curl -N https://apiinstant.fidscript.com/runtime/sse?app_id=YOUR_APP_ID` — should not return immediately (long-lived connection).
4. **MCP:** Call the `connectionState` and `connectionStateDetail` fields to confirm `Connected` with `transport: websocket` or `sse`.
