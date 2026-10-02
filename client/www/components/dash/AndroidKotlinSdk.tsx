import { useState } from 'react';
import { SectionHeading } from '@/components/ui';
import { ClipboardIcon, CheckIcon } from '@heroicons/react/24/outline';

const copyToClipboard = (text: string) => {
  navigator.clipboard.writeText(text);
};

const CodeBlock = ({ code, label }: { code: string; label: string }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    copyToClipboard(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="mt-2 rounded-md bg-gray-900 p-4">
      <div className="flex items-center justify-between">
        <span className="text-xs text-gray-400">{label}</span>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1 rounded px-2 py-1 text-xs text-gray-400 hover:bg-gray-800 hover:text-white"
        >
          {copied ? (
            <>
              <CheckIcon className="h-3 w-3 text-green-400" />
              <span className="text-green-400">Copied!</span>
            </>
          ) : (
            <>
              <ClipboardIcon className="h-3 w-3" />
              <span>Copy</span>
            </>
          )}
        </button>
      </div>
      <pre className="mt-2 overflow-x-auto text-sm text-gray-100">
        <code>{code}</code>
      </pre>
    </div>
  );
};

const StepCard = ({
  step,
  title,
  description,
  code,
  label,
}: {
  step: number;
  title: string;
  description: string;
  code: string;
  label?: string;
}) => (
  <div className="rounded-lg border border-gray-200 p-4 dark:border-neutral-700">
    <div className="flex items-start gap-3">
      <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-blue-100 text-xs font-medium text-blue-700 dark:bg-blue-900 dark:text-blue-300">
        {step}
      </span>
      <div className="flex-1">
        <h4 className="font-semibold text-gray-900 dark:text-white">{title}</h4>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
          {description}
        </p>
        <CodeBlock code={code} label={label || 'gradle'} />
      </div>
    </div>
  </div>
);

const SDK_VERSION = '0.7.0-phase9';

const sdkInstallCode = `dependencies {
    implementation("com.instantdb:instantdb-kotlin:${SDK_VERSION}")
}`;

const sdkInitCode = `import com.instantdb.poc.InstantDb
import com.instantdb.poc.InstantDbConfig

val instant = InstantDb(
    InstantDbConfig(
        appId = "YOUR_APP_ID",
        apiUri = "https://api.example.com",
        websocketUri = "wss://api.example.com",
        adminToken = "YOUR_ADMIN_TOKEN" // optional; from /dash/personal_access_tokens
    )
)
instant.connect()`;

const sdkQueryCode = `// queryFlow is cold; emissions are immediate and on every change.
instant.queryFlow(query).collect { result ->
    // result.data is the InstaQL result
    // result.pageInfo is the pagination info
}`;

const sdkMutationCode = `val ack = instant.transact(listOf(
    listOf("add-triple", userId, "name", "Alice", null)
))
// Returns CompletableDeferred<MutationResult> with the server-assigned tx-id.`;

const sdkComposeCode = `// Compose integration (Phase 9+).
val state by instant
    .queryFlow(query)
    .collectAsStateWithLifecycle()

when (state) {
    is InstantQueryState.Data -> ...
    is InstantQueryState.Loading -> ...
    is InstantQueryState.Error -> ...
    is InstantQueryState.Offline -> ...
}`;

const sdkOfflineCode = `// Offline-first behavior is automatic:
//   - Local queries continue to work.
//   - Optimistic mutations persist to SQLite and replay on reconnect.
//   - Reconnect is automatic with linear backoff.
//   - WebSocket reconnects; SSE fallback for restricted networks.`;

export const AndroidKotlinSdk = ({ appId: _appId }: { appId: string }) => {
  return (
    <div className="space-y-8">
      {/* SDK Overview */}
      <section>
        <SectionHeading>SDK Overview</SectionHeading>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
          The InstantDB Kotlin SDK provides:
        </p>
        <ul className="mt-4 ml-6 list-disc space-y-1 text-sm text-gray-600 dark:text-gray-400">
          <li>Persistent local SQLite cache — survives process death.</li>
          <li>Optimistic mutations with replay on reconnect.</li>
          <li>Reactive Kotlin Flow with targeted invalidation.</li>
          <li>WebSocket primary transport, optional SSE fallback.</li>
          <li>Compose integration via rememberInstantQuery.</li>
          <li>Secure credential storage (Android KeyStore-backed).</li>
        </ul>
      </section>

      {/* Installation */}
      <section>
        <SectionHeading>Installation</SectionHeading>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
          Add the SDK to your module's build.gradle.kts:
        </p>
        <CodeBlock code={sdkInstallCode} label="build.gradle.kts" />
        <p className="mt-3 text-xs text-gray-500 dark:text-gray-500">
          Minimum supported: Kotlin 2.0.21 · Gradle 8.10 · JVM 21 ·
          Android minSdk 24 · targetSdk 34 · compileSdk 34.
        </p>
      </section>

      {/* Initialization */}
      <section>
        <SectionHeading>Initialization</SectionHeading>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
          Configure with your app id and the API base URI. The SDK opens
          a WebSocket to the server and starts receiving updates.
        </p>
        <CodeBlock code={sdkInitCode} label="MainActivity.kt" />
      </section>

      {/* Queries */}
      <section>
        <SectionHeading>Queries (Reactive Flow)</SectionHeading>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
          <code>queryFlow</code> returns a cold Flow&lt;QueryResult&gt;.
          The SDK emits immediately and on every relevant local or server
          change. Targeted invalidation ensures unrelated queries are
          not re-evaluated.
        </p>
        <CodeBlock code={sdkQueryCode} label="Example.kt" />
      </section>

      {/* Mutations */}
      <section>
        <SectionHeading>Mutations</SectionHeading>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
          Mutations are optimistic. They apply locally, persist to SQLite,
          and replay on reconnect if the server ack was missed. The
          transact call returns a deferred that resolves with the
          server-assigned tx-id.
        </p>
        <CodeBlock code={sdkMutationCode} label="Example.kt" />
      </section>

      {/* Compose */}
      <section>
        <SectionHeading>Compose Integration</SectionHeading>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
          Lifecycle-aware reactive UI:
        </p>
        <CodeBlock code={sdkComposeCode} label="UserScreen.kt" />
      </section>

      {/* Offline */}
      <section>
        <SectionHeading>Offline Behavior</SectionHeading>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
          The SDK is offline-first by default:
        </p>
        <CodeBlock code={sdkOfflineCode} label="Example.kt" />
        <ul className="mt-4 ml-6 list-disc space-y-1 text-sm text-gray-600 dark:text-gray-400">
          <li>Local queries continue to work.</li>
          <li>Optimistic mutations persist and replay.</li>
          <li>Reconnect is automatic with linear backoff.</li>
          <li>WebSocket reconnects; SSE fallback for restricted networks.</li>
        </ul>
      </section>

      {/* Persistence */}
      <section>
        <SectionHeading>Persistence</SectionHeading>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
          SQLite is the authoritative source of truth. Migrations are
          managed by SQLDelight. Pending mutations survive process death
          and reconnect. Schema v2 added the <code>app_metadata</code>{' '}
          table for SDK diagnostics.
        </p>
      </section>

      {/* Current version */}
      <section>
        <SectionHeading>Current Version</SectionHeading>
        <div className="mt-4 rounded-lg border border-gray-200 p-4 dark:border-neutral-700">
          <div className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
            <div>
              <span className="text-gray-500 dark:text-gray-400">
                SDK version:
              </span>{' '}
              <span className="font-mono">{SDK_VERSION}</span>
            </div>
            <div>
              <span className="text-gray-500 dark:text-gray-400">
                Distribution:
              </span>{' '}
              <span>Local Maven dry-run only (not yet remote-published)</span>
            </div>
            <div>
              <span className="text-gray-500 dark:text-gray-400">
                Coordinates:
              </span>{' '}
              <span className="font-mono">
                com.instantdb:instantdb-kotlin
              </span>
            </div>
            <div>
              <span className="text-gray-500 dark:text-gray-400">
                Supports:
              </span>{' '}
              <span>Kotlin 2.0+, JVM, Android (AndroidSqliteDriver)</span>
            </div>
          </div>
        </div>
      </section>

      {/* Diagnostics */}
      <section>
        <SectionHeading>Diagnostics</SectionHeading>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
          Safe (non-credential) diagnostics exposed by the SDK:
        </p>
        <ul className="mt-4 ml-6 list-disc space-y-1 text-sm text-gray-600 dark:text-gray-400">
          <li>connection state (Disconnected / Connecting / Connected / Reconnecting)</li>
          <li>transport (websocket / sse)</li>
          <li>pending mutation count</li>
          <li>last processed tx-id</li>
          <li>last sync time</li>
          <li>subscription count</li>
          <li>persistence statistics (triples, attrs, pending mutations, query_cache)</li>
        </ul>
        <p className="mt-3 text-xs text-gray-500 dark:text-gray-500">
          Tokens, admin credentials, and authorization headers are never
          displayed in diagnostics or logs. The Transport layer redacts
          them via a fixed allow-list.
        </p>
      </section>

      {/* Troubleshooting */}
      <section>
        <SectionHeading>Troubleshooting</SectionHeading>
        <div className="mt-4 space-y-4">
          <div className="rounded-lg border border-gray-200 p-4 dark:border-neutral-700">
            <h4 className="font-semibold text-gray-900 dark:text-white">
              WebSocket cannot connect
            </h4>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
              Check that <code>apiUri</code> / <code>websocketUri</code>{' '}
              are correct and reachable. The SDK falls back to SSE
              automatically when WS is unavailable.
            </p>
          </div>
          <div className="rounded-lg border border-gray-200 p-4 dark:border-neutral-700">
            <h4 className="font-semibold text-gray-900 dark:text-white">
              Query results look stale
            </h4>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
              The SDK uses targeted invalidation. If your query depends
              on a different attr/etype than expected, results may not
              refresh until the relevant attr changes.
            </p>
          </div>
          <div className="rounded-lg border border-gray-200 p-4 dark:border-neutral-700">
            <h4 className="font-semibold text-gray-900 dark:text-white">
              Pending mutations don't reconcile
            </h4>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
              Pending mutations are persisted to SQLite. They are replayed
              automatically on reconnect. If they remain pending, the
              server likely rejected them; check the returned error.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
};