# Self Hosting InstantDB

Documentation for self hosting is available at [www.instantdb.com/docs/self-hosting](https://instantdb.com/docs/self-hosting)

See [UPGRADE_DB.md](UPGRADE_DB.md) for instructions on upgrading existing backends from postgres 16 to 17.

---

## Superuser & Admin Setup

### Creating the First Admin

Set `INSTANT_SUPERUSER_EMAIL` in your `.env` file before the first deployment:

```env
INSTANT_SUPERUSER_EMAIL=your@email.com
```

Then run the bootstrap:

```bash
docker compose -f docker-compose.with-caddy.yml up -d
```

The bootstrap script (`tasks/bootstrap-for-oss`) will:

1. Create the override config (encryption keys)
2. Run database migrations
3. Create or update the superuser account
4. Assign the "Instant Config" app to the superuser

After the server starts, log in at `https://instant.fidscript.com` with your email.
A magic code will be sent to your email (or printed to server logs if no email provider is configured).

### Resetting the Superuser

To change the superuser email:

```env
INSTANT_SUPERUSER_EMAIL=new@email.com
```

Restart the server:

```bash
docker compose -f docker-compose.with-caddy.yml restart server
```

The bootstrap will reassign the config app ownership on next startup.

### Adding Additional Admins

Admin access is granted via the `admin-email?` flag check (see `instant.flags`).
For self-hosted deployments, only the superuser email has admin privileges by default.
To grant additional admin access, set the appropriate flags in the Instant Config app
via the dashboard or database.

---

## Email Configuration

InstantDB supports four email providers. Configure **one** in your `.env`:

### Resend (Recommended)

```env
RESEND_API_KEY=re_xxxxxxxxxxxxxxxxxxxxx
EMAIL_FROM=noreply@yourdomain.com
EMAIL_REPLY_TO=support@yourdomain.com
```

### SMTP

```env
SMTP_HOST=smtp.yourprovider.com
SMTP_PORT=587
SMTP_USER=your-user
SMTP_PASSWORD=your-password
SMTP_FROM=noreply@yourdomain.com
SMTP_USE_TLS=true
```

### SendGrid or Postmark

```env
SENDGRID_TOKEN=SG.xxxxxxxxx
# or
POSTMARK_TOKEN=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
```

If no provider is configured, verification codes are printed to the server container logs.

---

## Storage Configuration

### MinIO / S3 (Default)

No additional configuration needed. Files are stored in MinIO.

### Cloudinary

```env
STORAGE_PROVIDER=cloudinary
CLOUDINARY_CLOUD_NAME=your-cloud-name
CLOUDINARY_API_KEY=your-api-key
CLOUDINARY_API_SECRET=your-api-secret
```

When using Cloudinary, the MinIO service is not required for file storage.

---

## Deployment Checklist

- [ ] Set `POSTGRES_PASSWORD` to a strong random value
- [ ] Set `MINIO_ROOT_USER` and `MINIO_ROOT_PASSWORD` to strong values
- [ ] Set `INSTANT_SUPERUSER_EMAIL` to your admin email
- [ ] Configure email (Resend, SMTP, SendGrid, or Postmark)
- [ ] Set DNS records for your domains:
  - `instant.fidscript.com` → your server IP
  - `api.instant.fidscript.com` → your server IP
  - `files.instant.fidscript.com` → your server IP
- [ ] Run `docker compose -f docker-compose.with-caddy.yml up -d`
- [ ] Verify health: `curl https://api.instant.fidscript.com/health/system`
