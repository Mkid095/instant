# Cloudflare DNS Configuration

## Current Status: ✅ CONFIGURED

All Instant DNS records are properly proxied through Cloudflare:

| Record | Name | Type | Content | Proxy Status |
|--------|------|------|---------|--------------|
| instant | instant | A | 72.61.89.110 | ✅ Proxied |
| api | apiinstant | A | 72.61.89.110 | ✅ Proxied |
| files | filesinstant | A | 72.61.89.110 | ✅ Proxied |

## Current Infrastructure

```
Internet
    |
    v
[Cloudflare] ← Proxy must be ON for all records
    |
    v
[Docker Caddy] → Port 80/443
    |
    +-- instant.fidscript.com → www:3000
    +-- apiinstant.fidscript.com → server:8888
    +-- filesinstant.fidscript.com → minio:9000
```

## Verification

```bash
dig instant.fidscript.com +short
dig apiinstant.fidscript.com +short
dig filesinstant.fidscript.com +short
```

Expected output (Cloudflare IPs):
```
104.21.x.x or 172.67.x.x
```

NOT `72.61.89.110` (direct VPS IP).

## SSL Configuration

Cloudflare SSL/TLS mode: **Full (strict)**

## Prevention

Monitor with:
```bash
/usr/local/bin/check-cloudflare-proxy.sh
```
