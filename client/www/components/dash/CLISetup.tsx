import { useState } from 'react';
import config from '@/lib/config';
import { SectionHeading } from '@/components/ui';

const CodeBlock = ({ code, label }: { code: string; label: string }) => {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <div className="mt-2 rounded-md bg-gray-900 p-4">
      <div className="flex items-center justify-between">
        <span className="text-xs text-gray-400">{label}</span>
        <button onClick={handleCopy} className="text-xs text-blue-400 hover:text-blue-300">
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>
      <pre className="mt-2 overflow-x-auto text-sm text-gray-100"><code>{code}</code></pre>
    </div>
  );
};

export const CLISetup = ({ appId }: { appId: string }) => {
  const apiURI = config.apiURI;
  const dashURI = 'https://instant.fidscript.com';

  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">CLI & MCP Setup</h1>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
          Configure command-line tools and AI assistants for your self-hosted InstantDB instance.
        </p>
      </div>

      <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 dark:border-blue-800 dark:bg-blue-950">
        <h3 className="font-semibold text-blue-900 dark:text-blue-100">Your Instance Configuration</h3>
        <div className="mt-2 grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
          <div><span className="text-gray-600 dark:text-gray-400">API URL:</span><code className="ml-2 rounded bg-white px-2 py-1 font-mono text-xs dark:bg-neutral-700">{apiURI}</code></div>
          <div><span className="text-gray-600 dark:text-gray-400">Dashboard:</span><code className="ml-2 rounded bg-white px-2 py-1 font-mono text-xs dark:bg-neutral-700">{dashURI}</code></div>
        </div>
      </div>

      <div>
        <SectionHeading>CLI Setup</SectionHeading>
        <div className="mt-4 flex flex-col gap-4">
          <div className="rounded-lg border border-gray-200 p-4 dark:border-neutral-700">
            <h4 className="font-semibold">1. Install the CLI</h4>
            <CodeBlock code="npm install -g instant-cli" label="Command" />
          </div>
          <div className="rounded-lg border border-gray-200 p-4 dark:border-neutral-700">
            <h4 className="font-semibold">2. Configure Environment</h4>
            <CodeBlock code={`export INSTANT_CLI_API_URI=${apiURI}\nexport INSTANT_CLI_DASH_URI=${dashURI}`} label="Bash" />
          </div>
          <div className="rounded-lg border border-gray-200 p-4 dark:border-neutral-700">
            <h4 className="font-semibold">3. Login</h4>
            <CodeBlock code="instant-cli login --headless" label="Command" />
            <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">Open the URL in your browser and enter your email.</p>
          </div>
        </div>
      </div>

      <div>
        <SectionHeading>MCP Server Setup</SectionHeading>
        <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
          The MCP server uses a Personal Access Token (PAT) from your dashboard.
          Generate one at <strong>Dashboard → User Settings → Personal Access Tokens</strong>.
        </p>
        <div className="mt-4 flex flex-col gap-4">
          <div className="rounded-lg border border-gray-200 p-4 dark:border-neutral-700">
            <h4 className="font-semibold">1. Run MCP Server</h4>
            <CodeBlock code={`export INSTANT_ACCESS_TOKEN=<YOUR_PAT>\nexport INSTANT_API_URI=${apiURI}\nexport INSTANT_APP_ID=<YOUR_APP_ID>\nnpx -y @fidscript/instant-mcp@0.4.0`} label="Command" />
          </div>
          <div className="rounded-lg border border-gray-200 p-4 dark:border-neutral-700">
            <h4 className="font-semibold">2. Configure Claude Desktop</h4>
            <CodeBlock code={`{\n  "mcpServers": {\n    "instant-self": {\n      "command": "npx",\n      "args": ["-y", "@fidscript/instant-mcp@0.4.0"],\n      "env": {\n        "INSTANT_ACCESS_TOKEN": "<YOUR_PAT>",\n        "INSTANT_API_URI": "${apiURI}",\n        "INSTANT_APP_ID": "<YOUR_APP_ID>"\n      }\n    }\n  }\n}`} label="settings.json" />
          </div>
        </div>
      </div>
    </div>
  );
};
