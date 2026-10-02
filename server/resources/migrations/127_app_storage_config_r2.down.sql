-- Migration 127 down: Remove R2 columns and restore original check constraint

ALTER TABLE app_storage_configs
  DROP CONSTRAINT IF EXISTS app_storage_configs_provider_type_check;

ALTER TABLE app_storage_configs
  ADD CONSTRAINT app_storage_configs_provider_type_check
  CHECK (provider_type IN ('s3', 'cloudinary'));

ALTER TABLE app_storage_configs
  DROP COLUMN IF EXISTS endpoint,
  DROP COLUMN IF EXISTS public_base_url,
  DROP COLUMN IF EXISTS account_id;
