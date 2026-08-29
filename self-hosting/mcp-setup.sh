#!/bin/bash
# MCP Server Setup for Self-Hosted InstantDB

set -e

echo "=== Next Mavens BaaS MCP Setup ==="
echo ""

# Check if instant-mcp is installed
if ! command -v instant-mcp &> /dev/null; then
    echo "Installing instant-mcp..."
    npm install -g @instantdb/mcp
fi

echo ""
echo "MCP Server configured!"
echo ""
echo "To run MCP server in stdio mode:"
echo "  INSTANT_ACCESS_TOKEN=your-token instant-mcp"
echo ""
echo "To run MCP server in HTTP mode:"
echo "  INSTANT_ADMIN_TOKEN=your-admin-token INSTANT_APP_ID=your-app-id SERVER_ORIGIN=https://api.instant.fidscript.com instant-mcp"
echo ""
echo "For Claude Desktop integration, add to ~/.claude/settings.json:"
echo '{
  "mcpServers": {
    "instantdb": {
      "command": "npx",
      "args": ["-y", "@instantdb/mcp"],
      "env": {
        "INSTANT_ACCESS_TOKEN": "your-token-here",
        "INSTANT_API_URL": "https://api.instant.fidscript.com"
      }
    }
  }
}'
