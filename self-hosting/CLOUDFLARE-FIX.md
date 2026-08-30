# Cloudflare DNS Fix Required

## Current Status: ⚠️ ACTION REQUIRED

The following domains are pointing **DIRECTLY** to the VPS IP (72.61.89.110):
- instant.fidscript.com
- api.instant.fidscript.com

Only `files.instant.fidscript.com` is properly proxied through Cloudflare.

## Immediate Fix Required

1. Log in to [Cloudflare Dashboard](https://dash.cloudflare.com)
2. Select domain: `fidscript.com`
3. Go to **DNS** → **Records**
4. Find these records and enable the orange cloud (proxy):

   | Record | Name | Type | Content | Proxy Status |
   |--------|------|------|---------|--------------|
   | 1 | instant | A | 72.61.89.110 | **Enable (Orange)** |
   | 2 | api | A | 72.61.89.110 | **Enable (Orange)** |
   | 3 | files | A | 72.61.89.110 | Already enabled ✓ |

5. Click **Save**

## Verification

After enabling proxy, run:
```bash
dig instant.fidscript.com +short
dig api.instant.fidscript.com +short
```

Expected output (Cloudflare IPs):
```
104.21.62.68
172.67.221.14
```

NOT:
```
72.61.89.110  ← Direct VPS IP (WRONG)
```

## Why This Is Critical

When Cloudflare proxy is disabled:
- ❌ VPS IP is exposed publicly
- ❌ No DDoS protection
- ❌ No CDN caching
- ❌ Some ISPs may block direct access
- ❌ Third-party integrations may fail
- ❌ SSL certificates may not work correctly

## Current Infrastructure

```
Internet
    |
    v
[Cloudflare] ← Proxy must be ON
    |
    v
[Caddy on VPS] → Port 80/443
    |
    +-- instant.fidscript.com → localhost:3000 (www container)
    +-- api.instant.fidscript.com → localhost:8888 (server container)
    +-- files.instant.fidscript.com → localhost:9000 (minio container)
```

## Prevention

This monitoring script will check every 5 minutes:
```bash
/usr/local/bin/check-cloudflare-proxy.sh
```

If proxy is disabled, it will exit with error code 1.

## SSL Configuration

Cloudflare SSL/TLS mode should be: **Full (strict)**

This ensures:
- Cloudflare → Origin uses HTTPS
- Origin (Caddy) has valid SSL certificate
- End-to-end encryption
