#!/bin/bash
# CLI Setup Script for Self-Hosted InstantDB

set -e

echo "=== Next Mavens BaaS CLI Setup ==="
echo ""

# Check if instant-cli is installed
if ! command -v instant-cli &> /dev/null; then
    echo "Installing instant-cli..."
    npm install -g instant-cli
fi

# Create config file
CONFIG_FILE="./instant.config.ts"
if [ ! -f "$CONFIG_FILE" ]; then
    echo "Creating $CONFIG_FILE..."
    cat > "$CONFIG_FILE" << 'CONFIG'
export default {
  apiURI: 'https://api.instant.fidscript.com',
  dashURI: 'https://instant.fidscript.com',
};
CONFIG
fi

echo ""
echo "CLI configured!"
echo ""
echo "To login, run:"
echo "  instant-cli login"
echo ""
echo "Then open the URL in your browser and enter your email."
echo ""
echo "Available commands:"
echo "  instant-cli login          - Login to your account"
echo "  instant-cli logout         - Logout"
echo "  instant-cli apps list      - List your apps"
echo "  instant-cli schema pull    - Pull schema from app"
echo "  instant-cli schema push    - Push schema to app"
echo "  instant-cli perms pull     - Pull permissions"
echo "  instant-cli perms push     - Push permissions"
