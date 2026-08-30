# Cloudflare DNS Configuration Guide

## Required DNS Records

All three domains MUST have Cloudflare proxy enabled (orange cloud ON).

### instant.fidscript.com
- Type: A
- Name: instant
- Content: 72.61.89.110
- Proxy status: **Proxied (Orange Cloud ON)**
- SSL: Full (strict)

### api.instant.fidscript.com
- Type: A
- Name: api
- Content: 72.61.89.110
- Proxy status: **Proxied (Orange Cloud ON)** ⚠️ CURRENTLY DISABLED
- SSL: Full (strict)

### files.instant.fidscript.com
- Type: A
- Name: files
- Content: 72.61.89.110
- Proxy status: **Proxied (Orange Cloud ON)**
- SSL: Full (strict)

## How to Fix

1. Log in to Cloudflare Dashboard
2. Select your domain: fidscript.com
3. Go to DNS → Records
4. Find the `api` A record
5. Click the proxy status toggle to enable (orange cloud)
6. Save

## Why This Matters

When Cloudflare proxy is disabled:
- Direct IP exposure (security risk)
- No CDN caching
- No DDoS protection
- Some ISPs/browsers may block direct access
- Third-party integrations may fail

## Verification

After enabling proxy, verify with:
```bash
# Should return Cloudflare IPs, not VPS IP
dig api.instant.fidscript.com +short

# Should show Cloudflare headers
curl -sI https://api.instant.fidscript.com | grep -i cloudflare
```

Expected output:
- DNS: 104.21.x.x or 172.67.x.x (Cloudflare IPs)
- Headers: server: cloudflare
