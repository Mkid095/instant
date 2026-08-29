const http = require('http');
const fs = require('fs');
const path = require('path');

const apiURI = process.env.INSTANT_API_URI || 'https://api.instant.fidscript.com';
const dashURI = process.env.INSTANT_DASHBOARD_URI || 'https://instant.fidscript.com';

const server = http.createServer((req, res) => {
  if (req.url === '/' || req.url === '/cli-setup') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>CLI & MCP Setup - Next Mavens BaaS</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 800px; margin: 40px auto; padding: 20px; background: #f5f5f5; }
    h1 { color: #333; }
    .card { background: white; padding: 20px; border-radius: 8px; margin: 20px 0; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
    .code { background: #1e1e1e; color: #d4d4d4; padding: 15px; border-radius: 4px; overflow-x: auto; font-family: monospace; }
    .copy-btn { background: #606af4; color: white; border: none; padding: 8px 16px; border-radius: 4px; cursor: pointer; margin-top: 10px; }
    .copy-btn:hover { background: #4f59d4; }
    .step { border-left: 3px solid #606af4; padding-left: 15px; margin: 15px 0; }
    .config { background: #e0e7ff; padding: 15px; border-radius: 4px; margin: 10px 0; }
  </style>
</head>
<body>
  <h1>CLI & MCP Setup</h1>
  <p>Configure command-line tools and AI assistants for your Next Mavens BaaS instance.</p>
  
  <div class="card">
    <h3>Your Instance Configuration</h3>
    <div class="config">
      <p><strong>API URL:</strong> <code>${apiURI}</code></p>
      <p><strong>Dashboard:</strong> <code>${dashURI}</code></p>
    </div>
  </div>

  <div class="card">
    <h3>CLI Setup</h3>
    <div class="step">
      <h4>Step 1: Install the CLI</h4>
      <div class="code">npm install -g instant-cli</div>
      <button class="copy-btn" onclick="copyToClipboard('npm install -g instant-cli')">Copy</button>
    </div>
    <div class="step">
      <h4>Step 2: Configure Environment</h4>
      <div class="code">export INSTANT_CLI_API_URI=${apiURI}
export INSTANT_CLI_DASH_URI=${dashURI}</div>
      <button class="copy-btn" onclick="copyToClipboard('export INSTANT_CLI_API_URI=${apiURI}\nexport INSTANT_CLI_DASH_URI=${dashURI}')">Copy</button>
    </div>
    <div class="step">
      <h4>Step 3: Login</h4>
      <div class="code">instant-cli login --headless</div>
      <p>Open the URL in your browser and enter your email.</p>
      <button class="copy-btn" onclick="copyToClipboard('instant-cli login --headless')">Copy</button>
    </div>
  </div>

  <div class="card">
    <h3>MCP Server Setup</h3>
    <div class="step">
      <h4>Step 1: Install MCP Server</h4>
      <div class="code">npm install -g @instantdb/mcp</div>
      <button class="copy-btn" onclick="copyToClipboard('npm install -g @instantdb/mcp')">Copy</button>
    </div>
    <div class="step">
      <h4>Step 2: Run MCP Server</h4>
      <div class="code">INSTANT_ACCESS_TOKEN=your-token INSTANT_API_URL=${apiURI} instant-mcp</div>
      <button class="copy-btn" onclick="copyToClipboard('INSTANT_ACCESS_TOKEN=your-token INSTANT_API_URL=${apiURI} instant-mcp')">Copy</button>
    </div>
    <div class="step">
      <h4>Step 3: Configure Claude Desktop</h4>
      <div class="code">{
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
}</div>
      <button class="copy-btn" onclick="copyToClipboard('{\\n  \\"mcpServers\\": {\\n    \\"instantdb\\": {\\n      \\"command\\": \\"npx\\",\\n      \\"args\\": [\\"-y\\", \\"@instantdb/mcp\\"],\\n      \\"env\\": {\\n        \\"INSTANT_ACCESS_TOKEN\\": \\"your-token\\",\\n        \\"INSTANT_API_URL\\": \\"${apiURI}\\"\\n      }\\n    }\\n  }\\n}')" />Copy</button>
    </div>
  </div>

  <div class="card">
    <h3>Common Commands</h3>
    <div class="step">
      <h4>Pull Schema</h4>
      <div class="code">instant-cli schema pull --app &lt;app-id&gt;</div>
    </div>
    <div class="step">
      <h4>Push Schema</h4>
      <div class="code">instant-cli schema push --app &lt;app-id&gt;</div>
    </div>
  </div>

  <script>
    function copyToClipboard(text) {
      navigator.clipboard.writeText(text).then(() => {
        alert('Copied to clipboard!');
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
});
