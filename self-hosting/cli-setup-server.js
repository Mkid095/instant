const http = require('http');
const fs = require('fs');
const path = require('path');

const apiURI = process.env.INSTANT_API_URI || 'https://api.instant.fidscript.com';
const dashURI = process.env.INSTANT_DASHBOARD_URI || 'https://instant.fidscript.com';

const server = http.createServer((req, res) => {
  if (req.url === '/' || req.url === '/cli-setup' || req.url === '/cli-setup/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>CLI & MCP Setup - Next Mavens BaaS</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f5f5f5; color: #333; }
    .container { max-width: 900px; margin: 0 auto; padding: 40px 20px; }
    h1 { font-size: 2rem; margin-bottom: 10px; color: #1a1a1a; }
    .subtitle { color: #666; margin-bottom: 30px; }
    .card { background: white; border-radius: 8px; padding: 24px; margin-bottom: 20px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    h2 { font-size: 1.25rem; margin-bottom: 16px; color: #1a1a1a; }
    h3 { font-size: 1rem; margin: 20px 0 12px; color: #444; }
    .step { border-left: 3px solid #606af4; padding-left: 16px; margin: 16px 0; }
    .step h4 { font-size: 0.9rem; color: #606af4; margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.5px; }
    code { background: #1e1e1e; color: #d4d4d4; padding: 16px; border-radius: 6px; display: block; font-family: 'Menlo', 'Monaco', monospace; font-size: 13px; line-height: 1.5; overflow-x: auto; margin: 8px 0; }
    .btn { background: #606af4; color: white; border: none; padding: 10px 20px; border-radius: 6px; cursor: pointer; font-size: 14px; margin-top: 8px; transition: background 0.2s; }
    .btn:hover { background: #4f59d4; }
    .config-box { background: #e0e7ff; padding: 16px; border-radius: 6px; margin: 12px 0; }
    .config-box code { background: transparent; color: #1e40af; padding: 0; margin: 0; }
    .alert { background: #fef3c7; border-left: 4px solid #f59e0b; padding: 12px 16px; border-radius: 4px; margin: 16px 0; }
    .alert code { background: transparent; color: #92400e; padding: 0; }
  </style>
</head>
<body>
  <div class="container">
    <h1>CLI & MCP Setup</h1>
    <p class="subtitle">Configure command-line tools and AI assistants for your Next Mavens BaaS instance.</p>
    
    <div class="card">
      <h2>Your Instance Configuration</h2>
      <div class="config-box">
        <p><strong>API URL:</strong> <code>${apiURI}</code></p>
        <p><strong>Dashboard:</strong> <code>${dashURI}</code></p>
      </div>
    </div>

    <div class="card">
      <h2>CLI Setup</h2>
      <div class="step">
        <h4>Step 1: Install the CLI</h4>
        <code>npm install -g instant-cli</code>
        <button class="btn" onclick="copyCode(this, 'npm install -g instant-cli')">Copy</button>
      </div>
      <div class="step">
        <h4>Step 2: Configure Environment</h4>
        <code>export INSTANT_CLI_API_URI=${apiURI}
export INSTANT_CLI_DASH_URI=${dashURI}</code>
        <button class="btn" onclick="copyCode(this, 'export INSTANT_CLI_API_URI=${apiURI}\\nexport INSTANT_CLI_DASH_URI=${dashURI}')">Copy</button>
      </div>
      <div class="step">
        <h4>Step 3: Login</h4>
        <code>instant-cli login --headless</code>
        <p style="margin-top: 8px; color: #666; font-size: 14px;">Open the URL in your browser and enter your email to authenticate.</p>
        <button class="btn" onclick="copyCode(this, 'instant-cli login --headless')">Copy</button>
      </div>
    </div>

    <div class="card">
      <h2>MCP Server Setup</h2>
      <div class="step">
        <h4>Step 1: Install MCP Server</h4>
        <code>npm install -g @instantdb/mcp</code>
        <button class="btn" onclick="copyCode(this, 'npm install -g @instantdb/mcp')">Copy</button>
      </div>
      <div class="step">
        <h4>Step 2: Run MCP Server (Stdio Mode)</h4>
        <code>INSTANT_ACCESS_TOKEN=your-token INSTANT_API_URL=${apiURI} instant-mcp</code>
        <button class="btn" onclick="copyCode(this, 'INSTANT_ACCESS_TOKEN=your-token INSTANT_API_URL=${apiURI} instant-mcp')">Copy</button>
      </div>
      <div class="step">
        <h4>Step 3: Configure Claude Desktop</h4>
        <p style="margin-bottom: 8px; color: #666;">Add this to <code>~/.claude/settings.json</code>:</p>
        <code>{
  "mcpServers": {
    "instantdb": {
      "command": "npx",
      "args": ["-y", "@instantdb/mcp"],
      "env": {
        "INSTANT_ACCESS_TOKEN": "your-token",
        "INSTANT_API_URL": "${apiURI}"
      }
    }
  }
}</code>
        <button class="btn" onclick="copyCode(this, '{\\n  \\"mcpServers\\": {\\n    \\"instantdb\\": {\\n      \\"command\\": \\"npx\\",\\n      \\"args\\": [\\"-y\\", \\"@instantdb/mcp\\"],\\n      \\"env\\": {\\n        \\"INSTANT_ACCESS_TOKEN\\": \\"your-token\\",\\n        \\"INSTANT_API_URL\\": \\"${apiURI}\\"\\n      }\\n    }\\n  }\\n}')">Copy</button>
      </div>
    </div>

    <div class="card">
      <h2>Common CLI Commands</h2>
      <div class="step">
        <h4>Pull Schema</h4>
        <code>instant-cli schema pull --app &lt;app-id&gt;</code>
      </div>
      <div class="step">
        <h4>Push Schema</h4>
        <code>instant-cli schema push --app &lt;app-id&gt;</code>
      </div>
      <div class="step">
        <h4>List Apps</h4>
        <code>instant-cli apps list</code>
      </div>
    </div>

    <div class="card">
      <h2>Troubleshooting</h2>
      <div class="alert">
        <strong>If login redirects to wrong URL:</strong><br>
        Make sure you've set the environment variables before running login:
        <code>export INSTANT_CLI_API_URI=${apiURI}</code>
        <code>export INSTANT_CLI_DASH_URI=${dashURI}</code>
      </div>
      <div class="alert">
        <strong>If MCP connection fails:</strong><br>
        Verify your API URL and token are correct by testing:
        <code>curl -H "Authorization: Bearer $INSTANT_ACCESS_TOKEN" ${apiURI}/health/system</code>
      </div>
    </div>
  </div>

  <script>
    function copyCode(btn, text) {
      navigator.clipboard.writeText(text).then(() => {
        const original = btn.textContent;
        btn.textContent = 'Copied!';
        btn.style.background = '#10b981';
        setTimeout(() => {
          btn.textContent = original;
          btn.style.background = '';
        }, 2000);
      });
    }
  </script>
</body>
</html>
    `);
  } else {
    res.writeHead(404);
    res.end('Not found');
  }
});

const port = process.env.PORT || 3100;
server.listen(port, () => {
  console.log(`CLI Setup server running on port ${port}`);
  console.log(`API URL: ${apiURI}`);
  console.log(`Dashboard URL: ${dashURI}`);
});
