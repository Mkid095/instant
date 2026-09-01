# InstantDB Self-Hosted Infrastructure

## Architecture

```
Internet
    |
    v
Cloudflare (Proxy ON for all domains)
    |
    v
Caddy (System-level, port 80/443)
    |
    +-- instant.fidscript.com --> localhost:3000 (www container)
    +-- apiinstant.fidscript.com --> localhost:8888 (server container)
    +-- filesinstant.fidscript.com --> localhost:9000 (minio container)
```

## Current Deployment

### Containers
- `self-hosting-www-1`: Next.js Dashboard (port 3000)
- `self-hosting-server-1`: InstantDB Backend API (port 8888)
- `self-hosting-postgres-1`: PostgreSQL Database
- `self-hosting-minio-1`: MinIO Object Storage
- `self-hosting-cli-setup-1`: CLI Setup Page (port 3100)

### System Services
- **Caddy**: System-level reverse proxy handling HTTPS
  - Config: `/etc/caddy/Caddyfile`
  - Service: `systemctl status caddy`
  - Automatically obtains SSL certificates

### Cloudflare Configuration
- SSL/TLS Mode: **Full (strict)**
- Proxy Status: Must be ON for all domains
- Origin certificates handled by Caddy

## Internal Communication

Containers communicate via Docker network:
- www → server: `http://server:8888`
- server → postgres: `postgresql://instant:pass@postgres:5432/instant`
- server → minio: `http://minio:9000`

Public endpoints:
- Dashboard: https://instant.fidscript.com
- API: https://apiinstant.fidscript.com
- Storage: https://filesinstant.fidscript.com

## Cloudflare DNS Requirements

All domains MUST have proxy enabled:

| Domain | Proxy Status | SSL Mode |
|--------|--------------|----------|
| instant.fidscript.com | ON (Orange) | Full (strict) |
| apiinstant.fidscript.com | ON (Orange) | Full (strict) |
| filesinstant.fidscript.com | ON (Orange) | Full (strict) |

## Prevention: How DNS Gets Changed

Common causes of proxy being disabled:
1. Manual changes in Cloudflare dashboard
2. Automated scripts modifying DNS
3. Cloudflare API calls with incorrect proxy settings
4. Import/export of DNS records without proxy status

## Prevention Measures

1. **Lock DNS Records**: In Cloudflare, enable "Lock" on critical records
2. **Use Tags**: Tag records and require tags for changes
3. **Audit Log**: Monitor Cloudflare audit log for changes
4. **Documentation**: Keep this file updated
5. **Alerts**: Set up Cloudflare alerts for DNS changes

## Emergency Recovery

If proxy gets disabled:
1. Log in to Cloudflare Dashboard
2. Go to DNS → Records
3. Enable proxy (orange cloud) for affected domains
4. Verify with: `dig apiinstant.fidscript.com +short`
5. Should return Cloudflare IPs, not VPS IP

## Security Notes

- Never expose VPS IP directly in production
- Always keep Cloudflare proxy enabled
- Use Full (strict) SSL mode
- Caddy handles origin certificates automatically
- Never disable proxy for extended periods
