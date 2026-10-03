import { useState } from 'react';
import config from '@/lib/config';
import { domainConfig } from '@/lib/domain-config';
import { MCP_VERSION } from '@/lib/sdk-versions';
import { SectionHeading } from '@/components/ui';
import { ClipboardIcon, CheckIcon } from '@heroicons/react/24/outline';

const CodeBlock = ({
  code,
  label,
  language = 'bash',
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
  description?: string;
  children?: React.ReactNode;
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
        {description && (
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
            {description}
          </p>
        )}
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

export const CLISetup = ({ appId }: { appId: string }) => {
  const apiURI = config.apiURI || domainConfig.apiHost;
  const dashURI = domainConfig.dashHost;
  const mavenURI = domainConfig.mavenHost;

  const mcpEnvCode = `export INSTANT_ACCESS_TOKEN=per_xxxxx
export INSTANT_API_HOST=${apiURI}
export INSTANT_DASH_HOST=${dashURI}
export INSTANT_MAVEN_HOST=${mavenURI}
export INSTANT_APP_ID=${appId || '<YOUR_APP_ID>'}
npx -y @fidscript/instant-mcp@${MCP_VERSION}`;

  const claudeDesktopJson = `{
  "mcpServers": {
    "instant-self": {
      "command": "npx",
      "args": ["-y", "@fidscript/instant-mcp@${MCP_VERSION}"],
      "env": {
        "INSTANT_ACCESS_TOKEN": "per_xxxxx",
        "INSTANT_API_HOST": "${apiURI}",
        "INSTANT_DASH_HOST": "${dashURI}",
        "INSTANT_MAVEN_HOST": "${mavenURI}",
        "INSTANT_APP_ID": "${appId || '<YOUR_APP_ID>'}"
      }
    }
  }
}`;

  const claudeCodeCommand = `claude mcp add instant-self \\
  -e INSTANT_ACCESS_TOKEN=per_xxxxx \\
  -e INSTANT_API_HOST=${apiURI} \\
  -e INSTANT_DASH_HOST=${dashURI} \\
  -e INSTANT_MAVEN_HOST=${mavenURI} \\
  -e INSTANT_APP_ID=${appId || '<YOUR_APP_ID>'} \\
  -- npx -y @fidscript/instant-mcp@${MCP_VERSION}`;

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* Header */}
      <div>
        <h1 className="flex items-center gap-3 text-2xl font-bold text-gray-900 dark:text-white">
          <span>🛠️</span>
          CLI & MCP Setup
        </h1>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
          Configure command-line tools and AI assistants for your self-hosted InstantDB instance.
        </p>
      </div>

      {/* Feature pills */}
      <div className="flex flex-wrap gap-2">
        <FeaturePill icon="⚡" text="CLI" />
        <FeaturePill icon="🤖" text="MCP for AI" />
        <FeaturePill icon="🔑" text="Personal Access Tokens" />
        <FeaturePill icon="🪟" text="Windows + macOS" />
        <FeaturePill icon="🛡️" text="Self-hosted URLs only" />
      </div>

      {/* Instance config card */}
      <InfoCard title="Your Instance Configuration">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
              Dashboard / Docs
            </div>
            <code className="mt-0.5 block break-all rounded bg-white px-2 py-1 font-mono text-xs dark:bg-neutral-700">
              {dashURI}
            </code>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-blue-700 dark:text-blue-300">
              Maven Repository
            </div>
            <code className="mt-0.5 block break-all rounded bg-white px-2 py-1 font-mono text-xs dark:bg-neutral-700">
              {mavenURI}
            </code>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-blue-700 dark:text-blue-300">
              MCP Version
            </div>
            <code className="mt-0.5 block break-all rounded bg-white px-2 py-1 font-mono text-xs dark:bg-neutral-700">
              {MCP_VERSION}
            </code>
          </div>
        </div>
      </InfoCard>

      {/* MCP Quick Start */}
      <div>
        <SectionHeading>MCP Quick Start (recommended)</SectionHeading>
        <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
          The MCP server exposes 76 tools to AI agents. Requires 4 env vars.
        </p>
        <div className="mt-4 flex flex-col gap-4">
          <StepCard
            step={1}
            title="Get a Personal Access Token"
            description="Generate one at Dashboard → User Settings → Personal Access Tokens. The token starts with per_."
          />

          <StepCard
            step={2}
            title="Set the required environment variables"
            description="All four are required. The MCP throws on startup without them."
          >
            <CodeBlock code={mcpEnvCode} label="Bash" />
          </StepCard>

          <StepCard
            step={3}
            title="Configure your editor"
            description="Pick your editor and paste the JSON config. All four env vars are pre-filled below."
            badge="Self-hosted"
          >
            <h5 className="mt-2 mb-1 text-sm font-medium text-gray-700 dark:text-gray-300">
              Claude Code
            </h5>
            <CodeBlock code={claudeCodeCommand} label="Bash" language="shell" />

            <h5 className="mt-4 mb-1 text-sm font-medium text-gray-700 dark:text-gray-300">
              Claude Desktop / Cursor / Windsurf / Cline
            </h5>
            <CodeBlock code={claudeDesktopJson} label="settings.json" language="json" />
            <p className="mt-2 text-xs text-gray-500 dark:text-gray-500">
              <strong>On Windows:</strong> call <code className="rounded bg-gray-100 px-1 py-0.5 font-mono text-[10px] dark:bg-neutral-800">npx</code> directly — do NOT wrap in <code className="rounded bg-gray-100 px-1 py-0.5 font-mono text-[10px] dark:bg-neutral-800">cmd /c</code>.
            </p>
          </StepCard>

          <StepCard
            step={4}
            title="Restart your editor fully"
            description="Claude Desktop: Cmd+Q on macOS, right-click system tray → Quit on Windows. Then reopen."
          />
        </div>
      </div>

      {/* CLI Quick Start */}
      <div>
        <SectionHeading>CLI Quick Start</SectionHeading>
        <div className="mt-4 flex flex-col gap-4">
          <StepCard
            step={1}
            title="Install the CLI"
            description="Global install for repeated use."
          >
            <CodeBlock code="npm install -g @fidscript/instant-cli" label="Bash" />
          </StepCard>

          <StepCard
            step={2}
            title="Configure environment"
            description="The CLI reads INSTANT_CLI_API_URI and INSTANT_CLI_DASH_URI for its endpoints."
          >
            <CodeBlock code={`export INSTANT_CLI_API_URI=${apiURI}\nexport INSTANT_CLI_DASH_URI=${dashURI}`} label="Bash" />
          </StepCard>

          <StepCard
            step={3}
            title="Login"
            description="Open the URL in your browser and enter your email to authenticate."
          >
            <CodeBlock code="npx @fidscript/instant-cli login --headless" label="Bash" />
          </StepCard>
        </div>
      </div>

      {/* Troubleshooting */}
      <div>
        <SectionHeading>Troubleshooting</SectionHeading>
        <div className="mt-4 flex flex-col gap-3">
          <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-neutral-700 dark:bg-neutral-900">
            <h4 className="font-semibold text-gray-900 dark:text-white">
              CONNECTION_CLOSED in Claude Desktop
            </h4>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
              Most often caused by missing env vars or the <code className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-xs dark:bg-neutral-800">cmd /c</code> wrapper on Windows. Check Claude Desktop logs at <code className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-xs dark:bg-neutral-800">~/Library/Logs/Claude/</code> (macOS) or <code className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-xs dark:bg-neutral-800">%APPDATA%\Claude\logs\</code> (Windows).
            </p>
          </div>
          <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-neutral-700 dark:bg-neutral-900">
            <h4 className="font-semibold text-gray-900 dark:text-white">
              Schema format error
            </h4>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
              The <code className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-xs dark:bg-neutral-800">push-schema</code> tool expects <code className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-xs dark:bg-neutral-800">{"{ todos: { attrs: {...} } }"}</code> — not the JS SDK's <code className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-xs dark:bg-neutral-800">i.entity()</code> format. Call the <code className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-xs dark:bg-neutral-800">learn</code> tool with <code className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-xs dark:bg-neutral-800">topic="schema"</code> for the correct format.
            </p>
          </div>
          <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-neutral-700 dark:bg-neutral-900">
            <h4 className="font-semibold text-gray-900 dark:text-white">
              Agent uses instantdb.com instead of instant.fidscript.com
            </h4>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
              This is a self-hosted deployment — upstream docs may differ. The MCP <code className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-xs dark:bg-neutral-800">learn</code> tool returns self-hosted URLs only. Use it.
            </p>
          </div>
        </div>
      </div>

      {/* More resources */}
      <div>
        <SectionHeading>More Resources</SectionHeading>
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <a
            href="https://instant.fidscript.com/docs/mcp"
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-lg border border-gray-200 bg-white p-4 transition-colors hover:border-blue-300 hover:bg-blue-50 dark:border-neutral-700 dark:bg-neutral-900 dark:hover:border-blue-700 dark:hover:bg-blue-950"
          >
            <h4 className="font-semibold text-gray-900 dark:text-white">🤖 Full MCP docs</h4>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
              All 76 tools, troubleshooting, and editor configs
            </p>
          </a>
          <a
            href="https://instant.fidscript.com/docs/using-llms"
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-lg border border-gray-200 bg-white p-4 transition-colors hover:border-blue-300 hover:bg-blue-50 dark:border-neutral-700 dark:bg-neutral-900 dark:hover:border-blue-700 dark:hover:bg-blue-950"
          >
            <h4 className="font-semibold text-gray-900 dark:text-white">📖 Using LLMs guide</h4>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
              Quick reference for setting up AI agents
            </p>
          </a>
        </div>
      </div>
    </div>
  );
};
