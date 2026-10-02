-- Migration 127: Add R2 (Cloudflare R2) support to per-app storage configuration
-- Adds endpoint, public_base_url, and account_id columns.
-- Allows provider_type = 'r2'.

ALTER TABLE app_storage_configs
  ADD COLUMN endpoint TEXT,
  ADD COLUMN public_base_url TEXT,
  ADD COLUMN account_id TEXT;

-- Extend provider_type check constraint to include 'r2'
ALTER TABLE app_storage_configs
  DROP CONSTRAINT IF EXISTS app_storage_configs_provider_type_check;

ALTER TABLE app_storage_configs
  ADD CONSTRAINT app_storage_configs_provider_type_check
  CHECK (provider_type IN ('s3', 'cloudinary', 'r2'));

COMMENT ON COLUMN app_storage_configs.endpoint IS 'S3-compatible endpoint (used by R2). For R2: https://<account-id>.r2.cloudflarestorage.com';
COMMENT ON COLUMN app_storage_configs.public_base_url IS 'Public base URL for serving files (R2 has no secure_url equivalent; requires custom domain or r2.dev subdomain)';
COMMENT ON COLUMN app_storage_configs.account_id IS 'Cloudflare R2 account ID';
