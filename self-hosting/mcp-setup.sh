#!/bin/bash
# MCP Server Setup for Self-Hosted InstantDB

set -e

echo "=== Self-Hosted InstantDB MCP Setup ==="
echo ""
echo "The @fidscript/instant-mcp package connects directly to your self-hosted API."
echo "No installation required — use npx directly."
echo ""

echo "To run MCP server in stdio mode:"
echo "  npx -y @fidscript/instant-mcp --token <YOUR_PAT> --api-url https://apiinstant.fidscript.com"
echo ""
echo "For Claude Desktop integration, add to ~/.claude/settings.json:"
echo '{
  "mcpServers": {
    "instant-self": {
      "command": "npx",
      "args": ["-y", "@fidscript/instant-mcp@0.4.0"],
      "env": {
        "INSTANT_API_URI": "https://apiinstant.fidscript.com",
        "INSTANT_ACCESS_TOKEN": "<YOUR_PAT>",
        "INSTANT_APP_ID": "<YOUR_APP_ID>"
      }
    }
  }
}'
echo ""
echo "Required environment variables:"
echo "  INSTANT_ACCESS_TOKEN  - Personal Access Token from your dashboard"
echo "  INSTANT_API_URI      - Your self-hosted API (default: https://apiinstant.fidscript.com)"
echo "  INSTANT_APP_ID       - Your app ID (optional, can be passed per-tool)"
