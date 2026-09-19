-- Per-app storage configuration table
-- Allows projects to use their own Cloudinary/S3 credentials
CREATE TABLE app_storage_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id UUID NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
  provider_type TEXT NOT NULL DEFAULT 'cloudinary' CHECK (provider_type IN ('s3', 'cloudinary')),
  -- Cloudinary fields
  cloud_name TEXT,
  api_key TEXT,
  api_secret TEXT,
  upload_preset TEXT,
  -- S3 fields
  bucket_name TEXT,
  region TEXT,
  access_key_id TEXT,
  secret_access_key TEXT,
  -- Metadata
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Only one active config per app
  CONSTRAINT one_active_config_per_app UNIQUE (app_id, is_active)
);

-- Index for looking up config by app
CREATE INDEX idx_app_storage_configs_app_id ON app_storage_configs(app_id);

-- Index for finding active config
CREATE INDEX idx_app_storage_configs_active ON app_storage_configs(app_id) WHERE is_active = true;

COMMENT ON TABLE app_storage_configs IS 'Per-app storage configuration for multi-tenant cloud storage (Cloudinary/S3)';
