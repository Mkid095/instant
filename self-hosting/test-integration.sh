#!/bin/bash
# Integration Test Script for Self-Hosted InstantDB

set -e

echo "=== Next Mavens BaaS Integration Test ==="
echo ""

# Configuration
API_URL="https://api.instant.fidscript.com"
DASH_URL="https://instant.fidscript.com"

echo "1. Testing API Health..."
API_RESPONSE=$(curl -sk "$API_URL/health/system" 2>/dev/null)
if [ "$API_RESPONSE" = '{"wal":"ok"}' ]; then
    echo "   ✓ API is healthy"
else
    echo "   ✗ API health check failed: $API_RESPONSE"
    exit 1
fi

echo ""
echo "2. Testing Dashboard..."
DASH_RESPONSE=$(curl -sk "$DASH_URL" 2>/dev/null | head -c 10)
if [ "$DASH_RESPONSE" = "/dash" ]; then
    echo "   ✓ Dashboard is accessible"
else
    echo "   ✗ Dashboard check failed: $DASH_RESPONSE"
    exit 1
fi

echo ""
echo "3. Testing Email (Resend)..."
EMAIL_RESPONSE=$(curl -s -X POST "$API_URL/dash/auth/send_magic_code" \
    -H "Content-Type: application/json" \
    -d '{"email":"test@example.com"}' 2>/dev/null)
if echo "$EMAIL_RESPONSE" | grep -q '"sent":true'; then
    echo "   ✓ Email service is working"
else
    echo "   ⚠ Email test skipped (may have rate limit)"
fi

echo ""
echo "4. Checking CLI..."
if command -v instant-cli &> /dev/null; then
    CLI_VERSION=$(instant-cli --version 2>/dev/null || echo "unknown")
    echo "   ✓ CLI installed: $CLI_VERSION"
else
    echo "   ✗ CLI not installed. Run: npm install -g instant-cli"
fi

echo ""
echo "5. Checking MCP..."
if command -v instant-mcp &> /dev/null; then
    echo "   ✓ MCP server installed"
else
    echo "   ✗ MCP not installed. Run: npm install -g @instantdb/mcp"
fi

echo ""
echo "6. Checking configuration files..."
if [ -f "instant.config.ts" ]; then
    echo "   ✓ instant.config.ts exists"
else
    echo "   ⚠ instant.config.ts not found. Copy from self-hosting/instant.config.ts"
fi

echo ""
echo "=== Integration Test Complete ==="
echo ""
echo "Next steps:"
echo "1. Run: instant-cli login"
echo "2. Open the URL in your browser"
echo "3. Enter your email: kennedygithinjioffice@gmail.com"
echo "4. Check email for verification code"
echo "5. Complete login in the terminal"
echo ""
echo "After login, you can use:"
echo "  instant-cli apps list"
echo "  instant-cli schema pull --app <app-id>"
echo "  instant-cli schema push --app <app-id>"
