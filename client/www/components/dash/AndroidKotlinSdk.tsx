import { useState } from 'react';
import config from '@/lib/config';
import { domainConfig } from '@/lib/domain-config';
import { SectionHeading } from '@/components/ui';
import { ClipboardIcon, CheckIcon } from '@heroicons/react/24/outline';

const CodeBlock = ({
  code,
  label,
  language = 'kotlin',
}: {
  code: string;
  label: string;
  language?: string;
}) => {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <div className="mt-2 overflow-hidden rounded-md bg-gray-900">
      <div className="flex items-center justify-between border-b border-gray-800 px-4 py-2">
        <div className="flex items-center gap-2">
          <span className="rounded bg-gray-800 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-gray-400">
            {language}
          </span>
          <span className="text-xs text-gray-400">{label}</span>
        </div>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1 rounded px-2 py-1 text-xs text-gray-400 transition-colors hover:bg-gray-800 hover:text-white"
        >
          {copied ? (
            <>
              <CheckIcon className="h-3.5 w-3.5 text-green-400" />
              <span className="text-green-400">Copied!</span>
            </>
          ) : (
            <>
              <ClipboardIcon className="h-3.5 w-3.5" />
              <span>Copy</span>
            </>
          )}
        </button>
      </div>
      <pre className="overflow-x-auto p-4 text-sm leading-relaxed text-gray-100">
        <code>{code}</code>
      </pre>
    </div>
  );
};

const StepCard = ({
  step,
  title,
  description,
  children,
  badge,
}: {
  step: number;
  title: string;
  description: string;
  children: React.ReactNode;
  badge?: string;
}) => (
  <div className="rounded-lg border border-gray-200 bg-white p-5 dark:border-neutral-700 dark:bg-neutral-900">
    <div className="flex items-start gap-4">
      <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-blue-100 text-sm font-semibold text-blue-700 dark:bg-blue-900 dark:text-blue-300">
        {step}
      </span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <h4 className="font-semibold text-gray-900 dark:text-white">{title}</h4>
          {badge && (
            <span className="rounded bg-green-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-green-700 dark:bg-green-900 dark:text-green-300">
              {badge}
            </span>
          )}
        </div>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
          {description}
        </p>
        <div className="mt-3">{children}</div>
      </div>
    </div>
  </div>
);

const InfoCard = ({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) => (
  <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 dark:border-blue-800 dark:bg-blue-950">
    <h3 className="font-semibold text-blue-900 dark:text-blue-100">{title}</h3>
    <div className="mt-2 text-sm text-blue-800 dark:text-blue-200">
      {children}
    </div>
  </div>
);

const FeaturePill = ({ icon, text }: { icon: string; text: string }) => (
  <span className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-white px-3 py-1 text-xs text-gray-700 dark:border-neutral-700 dark:bg-neutral-800 dark:text-gray-300">
    <span>{icon}</span>
    {text}
  </span>
);

const SDK_VERSION = '0.8.0-phase10';
const MAVEN_REPO = domainConfig.mavenHost;
const APP_ID_FALLBACK = 'YOUR_APP_ID';

export const AndroidKotlinSdk = ({ appId }: { appId: string }) => {
  const aid = appId || APP_ID_FALLBACK;
  const apiURI = config.apiURI || domainConfig.apiHost;
  const gradleSettingsCode = `// settings.gradle.kts (project root)
dependencyResolutionManagement {
    repositories {
        maven { url = uri("${MAVEN_REPO}") }
        google()
        mavenCentral()
    }
}`;

  const gradleAppCode = `// app/build.gradle.kts
dependencies {
    implementation("com.instantdb:instantdb-android:${SDK_VERSION}")
    implementation("com.instantdb:instantdb-kotlin:${SDK_VERSION}")

    // Required for Compose + SQLDelight
    implementation(platform("androidx.compose:compose-bom:2024.10.01"))
    implementation("androidx.compose.ui:ui")
    implementation("androidx.activity:activity-compose:1.9.3")
    implementation("app.cash.sqldelight:android-driver:2.0.2")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("com.squareup.okhttp3:okhttp-sse:4.12.0")

    // Optional — secure credential storage via Android Keystore
    implementation("androidx.security:security-crypto:1.1.0-alpha06")
}`;

  const manifestCode = `<!-- app/src/main/AndroidManifest.xml -->
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
    <!-- Required for real-time sync -->
    <uses-permission android:name="android.permission.INTERNET" />
    <uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />

    <application
        android:name=".MyApplication"
        ...>
        ...
    </application>
</manifest>`;

  const applicationCode = `// app/src/main/kotlin/.../MyApplication.kt
package com.example.myapp

import android.app.Application
import com.instantdb.android.InstantDb
import com.instantdb.android.InstantDbConfig
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

class MyApplication : Application() {
    // One InstantDb instance per app. Reuse across activities.
    val db: InstantDb by lazy {
        InstantDb(
            context = this,
            config = InstantDbConfig(
                appId = "${aid}",
                host = "${apiURI}",
                useSse = false  // true = SSE, false = WebSocket
            )
        )
    }

    private val appScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    override fun onCreate() {
        super.onCreate()
        appScope.launch {
            db.connect()
        }
    }
}`;

  const composeQueryCode = `// app/src/main/kotlin/.../TodoListScreen.kt
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import com.instantdb.android.rememberInstantQuery

@Composable
fun TodoListScreen() {
    val state = rememberInstantQuery(
        query = "{ todos: { \$: { where: { done: false } } } }"
    )

    when (state) {
        is com.instantdb.android.InstantQueryState.Loading ->
            CircularProgressIndicator()
        is com.instantdb.android.InstantQueryState.Error ->
            Text("Error: \${state.message}")
        is com.instantdb.android.InstantQueryState.Data -> {
            val todos = state.data["todos"] as? List<Map<String, Any>> ?: emptyList()
            LazyColumn {
                items(todos) { todo ->
                    Text(todo["text"]?.toString() ?: "")
                }
            }
        }
        is com.instantdb.android.InstantQueryState.Offline ->
            Text("Offline — showing cached data")
    }
}`;

  const transactCode = `// app/src/main/kotlin/.../AddTodoButton.kt
import androidx.compose.material3.Button
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.rememberCoroutineScope
import com.instantdb.android.InstantDb
import kotlinx.coroutines.launch
import kotlinx.serialization.json.*

@Composable
fun AddTodoButton(db: InstantDb) {
    val scope = rememberCoroutineScope()
    Button(onClick = {
        scope.launch {
            db.transact(listOf(
                listOf(
                    JsonPrimitive("add"),
                    JsonPrimitive("todos"),
                    JsonObject(mapOf(
                        "text" to JsonPrimitive("Buy milk"),
                        "done" to JsonPrimitive(false)
                    ))
                )
            ))
        }
    }) { Text("Add todo") }
}`;

  const queryCode = `// Imperative query (non-Compose) — also available
import com.instantdb.android.InstantDb
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking

runBlocking {
    val data = db.queryFlow("{ todos: {} }").first()
    val todos = data["todos"] as? List<Map<String, Any>> ?: emptyList()
    todos.forEach { println(it["text"]) }
}`;

  const connectCode = `// Connect / disconnect lifecycle
db.connect()                  // suspend, opens WebSocket or SSE
db.connectionState.collect { state ->
    when (state) {
        is com.instantdb.android.ConnectionState.Connected ->
            println("Connected via \${state.transport}")
        is com.instantdb.android.ConnectionState.Connecting ->
            println("Connecting…")
        is com.instantdb.android.ConnectionState.Reconnecting ->
            println("Reconnecting…")
        is com.instantdb.android.ConnectionState.Disconnected ->
            println("Disconnected")
        is com.instantdb.android.ConnectionState.Error ->
            println("Error: \${state.message}")
        is com.instantdb.android.ConnectionState.Offline ->
            println("Offline — using local cache")
    }
}
// On app shutdown:
db.close()`;

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* Header */}
      <div>
        <h1 className="flex items-center gap-3 text-2xl font-bold text-gray-900 dark:text-white">
          <span>📱</span>
          Android / Kotlin SDK
        </h1>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
          Native Android client with persistent local cache, optimistic
          mutations, and the same <code className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-xs dark:bg-neutral-800">appId</code> as your web app.
        </p>
      </div>

      {/* Feature pills */}
      <div className="flex flex-wrap gap-2">
        <FeaturePill icon="⚡" text="Real-time sync" />
        <FeaturePill icon="💾" text="Offline-first SQLite" />
        <FeaturePill icon="🔄" text="Optimistic mutations" />
        <FeaturePill icon="🧩" text="Jetpack Compose" />
        <FeaturePill icon="🔐" text="Android Keystore" />
        <FeaturePill icon="🌐" text="WebSocket + SSE" />
      </div>

      {/* Instance config card */}
      <InfoCard title="Your Instance Configuration">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <div className="text-xs uppercase tracking-wide text-blue-700 dark:text-blue-300">
              App ID
            </div>
            <code className="mt-0.5 block break-all rounded bg-white px-2 py-1 font-mono text-xs dark:bg-neutral-700">
              {aid}
            </code>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-blue-700 dark:text-blue-300">
              API Host
            </div>
            <code className="mt-0.5 block break-all rounded bg-white px-2 py-1 font-mono text-xs dark:bg-neutral-700">
              {apiURI}
            </code>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-blue-700 dark:text-blue-300">
              SDK Version
            </div>
            <code className="mt-0.5 block break-all rounded bg-white px-2 py-1 font-mono text-xs dark:bg-neutral-700">
              {SDK_VERSION}
            </code>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-blue-700 dark:text-blue-300">
              Maven Repository
            </div>
            <code className="mt-0.5 block break-all rounded bg-white px-2 py-1 font-mono text-xs dark:bg-neutral-700">
              {MAVEN_REPO}
            </code>
          </div>
        </div>
      </InfoCard>

      {/* Quick start */}
      <div>
        <SectionHeading>Quick Start</SectionHeading>
        <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
          Six steps. Each step has copy-paste code with your{' '}
          <code className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-xs dark:bg-neutral-800">appId</code>{' '}
          pre-filled.
        </p>
        <div className="mt-4 flex flex-col gap-4">
          <StepCard
            step={1}
            title="Add the public Maven repository"
            description="Add InstantDB's public Maven repository to your project's settings.gradle.kts. The same repo serves the Android AAR and the Kotlin/JVM JAR."
          >
            <CodeBlock code={gradleSettingsCode} label="settings.gradle.kts" />
          </StepCard>

          <StepCard
            step={2}
            title="Add the SDK dependency"
            description="Add the InstantDB Android SDK to your app's build.gradle.kts. The SDK bundles Compose, SQLDelight, OkHttp, and optional Android Keystore integration."
          >
            <CodeBlock code={gradleAppCode} label="app/build.gradle.kts" />
          </StepCard>

          <StepCard
            step={3}
            title="Add permissions and register your Application class"
            description="The SDK needs INTERNET and ACCESS_NETWORK_STATE for real-time sync. Register your Application subclass so the SDK initializes on app start."
          >
            <CodeBlock code={manifestCode} label="AndroidManifest.xml" language="xml" />
          </StepCard>

          <StepCard
            step={4}
            title="Initialize InstantDb in your Application class"
            description="One InstantDb instance per app, reused across activities. Your appId is pre-filled below."
          >
            <CodeBlock code={applicationCode} label="MyApplication.kt" />
          </StepCard>

          <StepCard
            step={5}
            title="Query data with Compose"
            description="rememberInstantQuery is lifecycle-aware. It emits immediately and on every relevant change. Handles Loading, Data, Error, and Offline states."
          >
            <CodeBlock code={composeQueryCode} label="TodoListScreen.kt" />
          </StepCard>

          <StepCard
            step={6}
            title="Write data with transact"
            description="Mutations are optimistic — they apply locally and persist to SQLite, then replay on reconnect. Returns a deferred that resolves with the server tx-id."
            badge="Optimistic"
          >
            <CodeBlock code={transactCode} label="AddTodoButton.kt" />
          </StepCard>
        </div>
      </div>

      {/* Reference */}
      <div>
        <SectionHeading>Reference</SectionHeading>
        <div className="mt-4 flex flex-col gap-4">
          <StepCard
            step={1}
            title="Imperative query (non-Compose)"
            description="For non-UI contexts, use queryFlow directly. The flow emits immediately and on every change."
          >
            <CodeBlock code={queryCode} label="Example.kt" />
          </StepCard>

          <StepCard
            step={2}
            title="Connection lifecycle"
            description="Monitor connection state and the active transport. The SDK auto-reconnects with linear backoff and falls back from WebSocket to SSE if needed."
          >
            <CodeBlock code={connectCode} label="Example.kt" />
          </StepCard>
        </div>
      </div>

      {/* Architecture / what the SDK does */}
      <div>
        <SectionHeading>How It Works</SectionHeading>
        <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-neutral-700 dark:bg-neutral-900">
            <h4 className="font-semibold text-gray-900 dark:text-white">⚡ Real-time sync</h4>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
              WebSocket by default, with automatic SSE fallback for restricted
              networks. Targeted invalidation means only the queries that
              depend on a changed attr are re-evaluated.
            </p>
          </div>
          <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-neutral-700 dark:bg-neutral-900">
            <h4 className="font-semibold text-gray-900 dark:text-white">💾 Offline-first</h4>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
              SQLite is the source of truth. SQLDelight manages schema and
              migrations. Pending mutations persist to disk and replay on
              reconnect.
            </p>
          </div>
          <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-neutral-700 dark:bg-neutral-900">
            <h4 className="font-semibold text-gray-900 dark:text-white">🔐 Secure credentials</h4>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
              Refresh tokens and admin tokens are stored in
              EncryptedSharedPreferences (AES-256-GCM via Android Keystore).
              They never appear in logs or diagnostics.
            </p>
          </div>
          <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-neutral-700 dark:bg-neutral-900">
            <h4 className="font-semibold text-gray-900 dark:text-white">🌐 Cross-platform</h4>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
              The same <code className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-xs dark:bg-neutral-800">appId</code> works
              in your web app, iOS, React Native, and Python SDK. Todos created
              on Android appear in the web app in real-time.
            </p>
          </div>
        </div>
      </div>

      {/* Requirements */}
      <div>
        <SectionHeading>Requirements</SectionHeading>
        <div className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <div className="rounded-lg border border-gray-200 bg-white p-3 dark:border-neutral-700 dark:bg-neutral-900">
            <div className="text-xs text-gray-500 dark:text-gray-400">Kotlin</div>
            <div className="font-mono font-semibold">2.0+</div>
          </div>
          <div className="rounded-lg border border-gray-200 bg-white p-3 dark:border-neutral-700 dark:bg-neutral-900">
            <div className="text-xs text-gray-500 dark:text-gray-400">Gradle</div>
            <div className="font-mono font-semibold">8.0+</div>
          </div>
          <div className="rounded-lg border border-gray-200 bg-white p-3 dark:border-neutral-700 dark:bg-neutral-900">
            <div className="text-xs text-gray-500 dark:text-gray-400">minSdk</div>
            <div className="font-mono font-semibold">24</div>
          </div>
          <div className="rounded-lg border border-gray-200 bg-white p-3 dark:border-neutral-700 dark:bg-neutral-900">
            <div className="text-xs text-gray-500 dark:text-gray-400">compileSdk</div>
            <div className="font-mono font-semibold">34</div>
          </div>
        </div>
      </div>

      {/* Troubleshooting */}
      <div>
        <SectionHeading>Troubleshooting</SectionHeading>
        <div className="mt-4 flex flex-col gap-3">
          <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-neutral-700 dark:bg-neutral-900">
            <h4 className="font-semibold text-gray-900 dark:text-white">
              WebSocket cannot connect
            </h4>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
              Check that <code className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-xs dark:bg-neutral-800">host</code> in
              your InstantDbConfig is correct. The SDK falls back to SSE
              automatically when WS is unavailable. Set{' '}
              <code className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-xs dark:bg-neutral-800">useSse = true</code> to
              force SSE.
            </p>
          </div>
          <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-neutral-700 dark:bg-neutral-900">
            <h4 className="font-semibold text-gray-900 dark:text-white">
              Query results look stale
            </h4>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
              The SDK uses targeted invalidation. If your query depends on a
              different attr/etype than expected, results may not refresh
              until the relevant attr changes.
            </p>
          </div>
          <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-neutral-700 dark:bg-neutral-900">
            <h4 className="font-semibold text-gray-900 dark:text-white">
              Pending mutations don't reconcile
            </h4>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
              Pending mutations are persisted to SQLite and replayed on
              reconnect. If they remain pending, the server likely rejected
              them — check the returned error or your perms.
            </p>
          </div>
          <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-neutral-700 dark:bg-neutral-900">
            <h4 className="font-semibold text-gray-900 dark:text-white">
              Gradle can't find the artifact
            </h4>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
              Verify the Maven repository is in{' '}
              <code className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-xs dark:bg-neutral-800">dependencyResolutionManagement</code> and
              not in <code className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-xs dark:bg-neutral-800">allprojects { } repositories { }</code>.
              The repo must be in the settings file, not in module-level build files.
            </p>
          </div>
        </div>
      </div>

      {/* Public docs links */}
      <div>
        <SectionHeading>More Resources</SectionHeading>
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <a
            href="https://instant.fidscript.com/docs/start-android"
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-lg border border-gray-200 bg-white p-4 transition-colors hover:border-blue-300 hover:bg-blue-50 dark:border-neutral-700 dark:bg-neutral-900 dark:hover:border-blue-700 dark:hover:bg-blue-950"
          >
            <h4 className="font-semibold text-gray-900 dark:text-white">📖 Public docs</h4>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
              Full guide at instant.fidscript.com/docs/start-android
            </p>
          </a>
          <a
            href="https://instant.fidscript.com/docs/cross-platform"
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-lg border border-gray-200 bg-white p-4 transition-colors hover:border-blue-300 hover:bg-blue-50 dark:border-neutral-700 dark:bg-neutral-900 dark:hover:border-blue-700 dark:hover:bg-blue-950"
          >
            <h4 className="font-semibold text-gray-900 dark:text-white">🔄 Cross-platform</h4>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
              Share data with web, iOS, React Native using the same appId
            </p>
          </a>
        </div>
      </div>
    </div>
  );
};
