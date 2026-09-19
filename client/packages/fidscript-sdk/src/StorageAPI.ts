import { jsonFetch } from './utils/fetch.js';
import { FIDScriptConfig } from './fidscript.js';

export type UploadFileResponse = {
  data: {
    id: string;
  };
};

export type DeleteFileResponse = {
  data: {
    id: string | null;
  };
};

// Cloudinary unsigned upload - browser uploads directly to Cloudinary
// No server-side signing required
export type CloudinaryUploadResponse = {
  secure_url: string;
  public_id: string;
  format: string;
  bytes: number;
  width?: number;
  height?: number;
};

export type CloudinaryUploadOptions = {
  resourceType?: 'image' | 'video' | 'raw';
  cloudName?: string;
  uploadPreset?: string;
};

export type StorageConfig = {
  providerType: string;
  cloudName: string;
  uploadPreset: string;
  isActive: boolean;
  hasApiKey: boolean;
  hasApiSecret: boolean;
};

export async function fetchStorageConfig(
  apiURI: string,
  appId: string,
  token: string
): Promise<StorageConfig | null> {
  const response = await jsonFetch(`${apiURI}/dash/apps/${appId}/storage_config`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      authorization: `Bearer ${token}`,
    },
  });
  return response.config || null;
}

export async function uploadToCloudinary(
  file: File | Blob,
  options: CloudinaryUploadOptions = {}
): Promise<CloudinaryUploadResponse> {
  // Support per-app config override or fall back to global config
  const cloudName = options.cloudName || FIDScriptConfig.cloudinaryCloudName;
  const uploadPreset = options.uploadPreset || FIDScriptConfig.cloudinaryUploadPreset;
  const resourceType = options.resourceType || 'image';

  if (!cloudName || !uploadPreset) {
    throw new Error(
      'Cloudinary not configured. Set INSTANT_CLOUDINARY_CLOUD_NAME and INSTANT_CLOUDINARY_UPLOAD_PRESET, or configure per-app storage via the dashboard.'
    );
  }

  const formData = new FormData();
  formData.append('file', file);
  formData.append('upload_preset', uploadPreset);

  const response = await fetch(
    `https://api.cloudinary.com/v1_1/${cloudName}/${resourceType}/upload`,
    {
      method: 'POST',
      body: formData,
    }
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Cloudinary upload failed: ${error}`);
  }

  return response.json();
}

export async function uploadFile({
  apiURI,
  appId,
  path,
  file,
  refreshToken,
  contentType,
  contentDisposition,
}: {
  apiURI: string;
  appId: string;
  path: string;
  file: File | Blob;
  refreshToken?: string;
  contentType?: string;
  contentDisposition?: string;
}): Promise<UploadFileResponse> {
  const headers = {
    'app-id': appId,
    app_id: appId,
    path,
    authorization: `Bearer ${refreshToken}`,
    'content-type': contentType || file.type,
  };
  if (contentDisposition) {
    headers['content-disposition'] = contentDisposition;
  }

  const data = await jsonFetch(`${apiURI}/storage/upload`, {
    method: 'PUT',
    headers,
    body: file,
  });

  return data;
}

export async function deleteFile({
  apiURI,
  appId,
  path,
  refreshToken,
}: {
  apiURI: string;
  appId: string;
  path: string;
  refreshToken?: string;
}): Promise<DeleteFileResponse> {
  const { data } = await jsonFetch(
    `${apiURI}/storage/files?app_id=${appId}&filename=${encodeURIComponent(path)}`,
    {
      method: 'DELETE',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${refreshToken}`,
      },
    },
  );

  return data;
}

// Deprecated Storage API (Jan 2025)
// ---------------------------------

export async function getSignedUploadUrl({
  apiURI,
  appId,
  fileName,
  refreshToken,
  metadata = {},
}: {
  apiURI: string;
  appId: string;
  fileName: string;
  refreshToken?: string;
  metadata?: Record<string, any>;
}) {
  const { data } = await jsonFetch(`${apiURI}/storage/signed-upload-url`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${refreshToken}`,
    },
    body: JSON.stringify({
      app_id: appId,
      filename: fileName,
    }),
  });

  return data;
}

export async function upload(presignedUrl, file) {
  const response = await fetch(presignedUrl, {
    method: 'PUT',
    body: file,
    headers: {
      'Content-Type': file.type,
    },
  });

  return response.ok;
}

export async function getDownloadUrl({
  apiURI,
  appId,
  path,
  refreshToken,
}: {
  apiURI: string;
  appId: string;
  path: string;
  refreshToken?: string;
}) {
  const { data } = await jsonFetch(
    `${apiURI}/storage/signed-download-url?app_id=${appId}&filename=${encodeURIComponent(
      path,
    )}`,
    {
      method: 'GET',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${refreshToken}`,
      },
    },
  );

  return data;
}
