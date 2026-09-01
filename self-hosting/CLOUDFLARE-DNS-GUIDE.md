# Cloudflare DNS Configuration Guide

## Required DNS Records

All required domains MUST have Cloudflare proxy enabled (orange cloud ON).

### instant.fidscript.com
- Type: A
- Name: instant
- Content: 72.61.89.110
- Proxy status: **Proxied (Orange Cloud ON)**
- SSL: Full (strict)

### apiinstant.fidscript.com
- Type: A
- Name: apiinstant
- Content: 72.61.89.110
- Proxy status: **Proxied (Orange Cloud ON)**
- SSL: Full (strict)

### filesinstant.fidscript.com
- Type: A
- Name: filesinstant
- Content: 72.61.89.110
- Proxy status: **Proxied (Orange Cloud ON)**
- SSL: Full (strict)

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
dig apiinstant.fidscript.com +short

# Should show Cloudflare headers
curl -sI https://apiinstant.fidscript.com | grep -i cloudflare
```

Expected output:
- DNS: 104.21.x.x or 172.67.x.x (Cloudflare IPs)
- Headers: server: cloudflare
