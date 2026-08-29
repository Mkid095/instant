import { useState, useEffect } from 'react';
import Head from 'next/head';
import { MainDashLayout, useFetchedDash } from '@/components/dash/MainDashLayout';
import { useAuthToken } from '@/lib/auth';
import config from '@/lib/config';
import { Button, Content, SectionHeading } from '@/components/ui';
import { ClipboardIcon, CheckIcon } from '@heroicons/react/24/outline';
import { isSelfHosted } from '@/lib/config';

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
  code?: string;
  label?: string;
}) => (
  <div className="rounded-lg border border-gray-200 bg-white p-6 dark:border-neutral-700 dark:bg-neutral-800">
    <div className="flex items-start gap-4">
      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-600 text-sm font-semibold text-white">
        {step}
      </div>
      <div className="flex-1">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
          {title}
        </h3>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
          {description}
        </p>
        {code && (
          <CodeBlock code={code} label={label || `Step ${step}`} />
        )}
      </div>
    </div>
  </div>
);

export default function CliSetupPage() {
  const token = useAuthToken();
  const dash = useFetchedDash();
  const [adminToken, setAdminToken] = useState<string>('');
  const [generatedToken, setGeneratedToken] = useState<string>('');
  const [isLoading, setIsLoading] = useState(false);
  const [tokenError, setTokenError] = useState<string>('');

  const apiURI = config.apiURI;
  const dashURI = 'https://instant.fidscript.com';

  useEffect(() => {
    if (token) {
      setAdminToken(token);
    }
  }, [token]);

  const generateNewToken = async () => {
    if (!token) return;
    setIsLoading(true);
    setTokenError('');
    try {
      const res = await fetch(`${apiURI}/dash/admin/tokens`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          name: 'MCP Server Token',
          scopes: ['apps-read', 'apps-write', 'data-read', 'data-write'],
        }),
      });
      const data = await res.json();
      if (data.token) {
        setGeneratedToken(data.token);
      } else {
        setTokenError(data.error || 'Failed to generate token');
      }
    } catch (e) {
      setTokenError('Error generating token: ' + (e as Error).message);
    } finally {
      setIsLoading(false);
    }
  };

  const mcpCommands = {
    stdio: `INSTANT_ACCESS_TOKEN=${generatedToken || '<your-token>'} INSTANT_API_URL=${apiURI} instant-mcp`,
    http: `INSTANT_ADMIN_TOKEN=${generatedToken || '<your-admin-token>'} \\\n  INSTANT_APP_ID='<your-app-id>' \\\n  SERVER_ORIGIN=${apiURI} \\\n  instant-mcp`,
    claude: `{
  "mcpServers": {
    "instantdb": {
      "command": "npx",
      "args": ["-y", "@instantdb/mcp"],
      "env": {
        "INSTANT_ACCESS_TOKEN": "${generatedToken || '<your-token>'}",
        "INSTANT_API_URL": "${apiURI}"
      }
    }
  }
}`,
  };

  const cliCommands = {
    install: 'npm install -g instant-cli',
    login: `export INSTANT_CLI_API_URI=${apiURI}\nexport INSTANT_CLI_DASH_URI=${dashURI}\ninstant-cli login --headless`,
    verify: 'instant-cli apps list',
    pullSchema: `instant-cli schema pull --app <your-app-id>`,
    pushSchema: `instant-cli schema push --app <your-app-id>`,
  };

  return (
    <>
      <Head>
        <title>CLI & MCP Setup - Next Mavens BaaS</title>
      </Head>

      <div className="flex flex-col gap-6 p-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
            CLI & MCP Integration
          </h1>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
            Configure command-line tools and AI assistants to work with your
            Next Mavens BaaS instance.
          </p>
        </div>

        {/* API Configuration */}
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 dark:border-blue-800 dark:bg-blue-950">
          <h3 className="font-semibold text-blue-900 dark:text-blue-100">
            Your Instance Configuration
          </h3>
          <div className="mt-2 grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
            <div>
              <span className="text-gray-600 dark:text-gray-400">API URL:</span>
              <code className="ml-2 rounded bg-white px-2 py-1 font-mono text-xs dark:bg-neutral-700">
                {apiURI}
              </code>
            </div>
            <div>
              <span className="text-gray-600 dark:text-gray-400">Dashboard:</span>
              <code className="ml-2 rounded bg-white px-2 py-1 font-mono text-xs dark:bg-neutral-700">
                {dashURI}
              </code>
            </div>
          </div>
        </div>

        {/* Token Management */}
        <div className="rounded-lg border border-gray-200 bg-white p-6 dark:border-neutral-700 dark:bg-neutral-800">
          <SectionHeading>Access Tokens</SectionHeading>
          <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
            Generate tokens for CLI and MCP integration. Your current auth token
            is shown below.
          </p>

          <div className="mt-4 rounded-md bg-gray-100 p-3 dark:bg-neutral-700">
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-600 dark:text-gray-400">
                Current Token:
              </span>
              <button
                onClick={() => copyToClipboard(adminToken)}
                className="text-xs text-blue-600 hover:text-blue-700"
              >
                Copy
              </button>
            </div>
            <code className="mt-1 block break-all text-xs font-mono">
              {adminToken?.slice(0, 50)}...
            </code>
          </div>

          <button
            onClick={generateNewToken}
            disabled={isLoading}
            className="mt-4 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {isLoading ? 'Generating...' : 'Generate New Token'}
          </button>

          {tokenError && (
            <p className="mt-2 text-sm text-red-600">{tokenError}</p>
          )}

          {generatedToken && (
            <div className="mt-4 rounded-md bg-green-50 p-3 dark:bg-green-950">
              <span className="text-xs text-green-800 dark:text-green-200">
                New Token Generated:
              </span>
              <code className="mt-1 block break-all text-xs font-mono text-green-900 dark:text-green-100">
                {generatedToken}
              </code>
              <button
                onClick={() => copyToClipboard(generatedToken)}
                className="mt-2 text-xs text-green-700 hover:text-green-800"
              >
                Copy Token
              </button>
            </div>
          )}
        </div>

        {/* CLI Setup */}
        <div>
          <SectionHeading>CLI Setup</SectionHeading>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
            Install and configure the InstantDB CLI for your self-hosted
            instance.
          </p>

          <div className="mt-4 flex flex-col gap-4">
            <StepCard
              step={1}
              title="Install the CLI"
              description="Install instant-cli globally using npm."
              code={cliCommands.install}
            />
            <StepCard
              step={2}
              title="Configure Environment"
              description="Set the environment variables for your self-hosted instance."
              code={`export INSTANT_CLI_API_URI=${apiURI}\nexport INSTANT_CLI_DASH_URI=${dashURI}`}
            />
            <StepCard
              step={3}
              title="Login to Your Account"
              description="Run the login command and open the URL in your browser."
              code={cliCommands.login}
            />
            <StepCard
              step={4}
              title="Verify Installation"
              description="List your apps to confirm the CLI is working."
              code={cliCommands.verify}
            />
          </div>
        </div>

        {/* MCP Setup */}
        <div>
          <SectionHeading>MCP Server Setup</SectionHeading>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
            Configure the Model Context Protocol server for AI assistants like
            Claude.
          </p>

          <div className="mt-4 flex flex-col gap-4">
            <StepCard
              step={1}
              title="Install MCP Server"
              description="Install the @instantdb/mcp package globally."
              code="npm install -g @instantdb/mcp"
            />
            <StepCard
              step={2}
              title="Run MCP Server (Stdio Mode)"
              description="Start the MCP server in stdio mode for direct CLI integration."
              code={mcpCommands.stdio}
              label="Command"
            />
            <StepCard
              step={3}
              title="Run MCP Server (HTTP Mode)"
              description="Start the MCP server in HTTP mode for web-based integration."
              code={mcpCommands.http}
              label="Command"
            />
            <StepCard
              step={4}
              title="Configure for Claude Desktop"
              description="Add the MCP server configuration to your Claude Desktop settings."
              code={mcpCommands.claude}
              label="settings.json"
            />
          </div>
        </div>

        {/* Common Commands */}
        <div>
          <SectionHeading>Common CLI Commands</SectionHeading>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
            Useful commands for managing your InstantDB apps.
          </p>

          <div className="mt-4 flex flex-col gap-4">
            <StepCard
              step={1}
              title="Pull Schema"
              description="Download the current schema from your app."
              code={cliCommands.pullSchema}
            />
            <StepCard
              step={2}
              title="Push Schema"
              description="Upload schema changes to your app."
              code={cliCommands.pushSchema}
            />
            <StepCard
              step={3}
              title="Pull Permissions"
              description="Download the current permissions configuration."
              code={`instant-cli perms pull --app <your-app-id>`}
            />
            <StepCard
              step={4}
              title="Push Permissions"
              description="Upload permission changes to your app."
              code={`instant-cli perms push --app <your-app-id>`}
            />
          </div>
        </div>

        {/* Troubleshooting */}
        <div>
          <SectionHeading>Troubleshooting</SectionHeading>
          <div className="mt-4 space-y-4">
            <div className="rounded-lg border border-gray-200 p-4 dark:border-neutral-700">
              <h4 className="font-semibold text-gray-900 dark:text-white">
                CLI Login Redirects to Wrong URL
              </h4>
              <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
                If the login redirects to instantdb.com instead of your
                self-hosted instance, make sure you've set the environment
                variables:
              </p>
              <CodeBlock
                code={`export INSTANT_CLI_API_URI=${apiURI}
export INSTANT_CLI_DASH_URI=${dashURI}`}
                label="Solution"
              />
            </div>

            <div className="rounded-lg border border-gray-200 p-4 dark:border-neutral-700">
              <h4 className="font-semibold text-gray-900 dark:text-white">
                MCP Server Connection Failed
              </h4>
              <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
                Verify your API URL and token are correct:
              </p>
              <CodeBlock
                code={`# Test API connectivity
curl -H "Authorization: Bearer $INSTANT_ACCESS_TOKEN" \\
  ${apiURI}/health/system

# Should return: {"wal":"ok"}`}
                label="Test Connection"
              />
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

CliSetupPage.getLayout = function getLayout(page: JSX.Element) {
  return (
    <MainDashLayout className="bg-gray-100 dark:bg-neutral-800 dark:text-white">
      {page}
    </MainDashLayout>
  );
};
