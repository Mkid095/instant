#!/bin/bash
# Cloudflare Proxy Status Checker
# Run this script periodically to ensure proxy is enabled

DOMAINS=("instant.fidscript.com" "api.instant.fidscript.com" "files.instant.fidscript.com")
VPS_IP="72.61.89.110"
ALERT_EMAIL="kennedygithinjioffice@gmail.com"

echo "=== Cloudflare Proxy Status Check ==="
echo "Time: $(date)"
echo ""

ISSUES_FOUND=0

for DOMAIN in "${DOMAINS[@]}"; do
    DNS_IPS=$(dig +short $DOMAIN)
    
    if echo "$DNS_IPS" | grep -q "$VPS_IP"; then
        echo "⚠️  ALERT: $DOMAIN is pointing DIRECTLY to VPS IP"
        echo "   DNS: $DNS_IPS"
        echo "   Status: PROXY DISABLED"
        ISSUES_FOUND=$((ISSUES_FOUND + 1))
    elif echo "$DNS_IPS" | grep -qE "104\.21\.|172\.67\."; then
        echo "✓ $DOMAIN is through Cloudflare"
        echo "   DNS: $DNS_IPS"
    else
        echo "⚠️  $DOMAIN has unexpected DNS: $DNS_IPS"
        ISSUES_FOUND=$((ISSUES_FOUND + 1))
    fi
done

echo ""
if [ $ISSUES_FOUND -gt 0 ]; then
    echo "❌ $ISSUES_FOUND issue(s) found!"
    echo "Please check Cloudflare dashboard immediately."
    exit 1
else
    echo "✅ All domains are properly proxied through Cloudflare"
    exit 0
fi
