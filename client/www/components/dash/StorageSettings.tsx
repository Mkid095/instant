import { useState, useEffect, useContext } from 'react';
import { CloudArrowUpIcon, TrashIcon } from '@heroicons/react/24/outline';
import appConfig from '@/lib/config';
import { TokenContext } from '@/lib/contexts';
import { jsonFetch } from '@/lib/fetch';
import { errorToast, successToast } from '@/lib/toast';
import {
  Button,
  SectionHeading,
  SubsectionHeading,
  TextInput,
} from '@/components/ui';

type StorageConfig = {
  id: string;
  providerType: string;
  cloudName: string;
  uploadPreset: string;
  isActive: boolean;
  hasApiKey: boolean;
  hasApiSecret: boolean;
  createdAt: string;
  updatedAt: string;
};

function StorageConfigCard({
  config,
  onDelete,
  appId,
  token,
}: {
  config: StorageConfig;
  onDelete: () => void;
  appId: string;
  token: string;
}) {
  const [isDeleting, setIsDeleting] = useState(false);

  const handleDelete = async () => {
    if (!confirm('Are you sure you want to remove custom storage configuration?')) {
      return;
    }
    setIsDeleting(true);
    try {
      await jsonFetch(`${appConfig.apiURI}/dash/apps/${appId}/storage_config`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
      });
      successToast('Storage configuration removed');
      onDelete();
    } catch (e: any) {
      errorToast(`Failed to delete storage config: ${e.message}`);
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="flex items-start justify-between">
        <div>
          <h4 className="font-medium text-gray-900">Custom Cloudinary Configuration</h4>
          <p className="mt-1 text-sm text-gray-500">
            This app uses your own Cloudinary account for file uploads.
          </p>
        </div>
        <button
          onClick={handleDelete}
          disabled={isDeleting}
          className="text-red-600 hover:text-red-800"
        >
          <TrashIcon className="h-5 w-5" />
        </button>
      </div>

      <div className="mt-4 grid gap-3 text-sm">
        <div className="flex justify-between">
          <span className="text-gray-500">Cloud Name:</span>
          <span className="font-mono text-gray-900">{config.cloudName}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-500">Upload Preset:</span>
          <span className="font-mono text-gray-900">{config.uploadPreset || '(default)'}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-500">API Key:</span>
          <span className="font-mono text-gray-900">{config.hasApiKey ? '✓ Configured' : '✗ Not set'}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-500">API Secret:</span>
          <span className="font-mono text-gray-900">{config.hasApiSecret ? '✓ Configured' : '✗ Not set'}</span>
        </div>
      </div>
    </div>
  );
}

export function StorageSettings({
  appId,
}: {
  appId: string;
}) {
  const token = useContext(TokenContext)!;
  const [isLoading, setIsLoading] = useState(true);
  const [config, setConfig] = useState<StorageConfig | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [cloudName, setCloudName] = useState('');
  const [uploadPreset, setUploadPreset] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [apiSecret, setApiSecret] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const fetchConfig = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await jsonFetch(`${appConfig.apiURI}/dash/apps/${appId}/storage_config`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
      });
      setConfig(data.config);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchConfig();
  }, [appId, token]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    try {
      const body: any = {};
      if (cloudName) body.cloudName = cloudName;
      if (uploadPreset) body.uploadPreset = uploadPreset;
      if (apiKey) body.apiKey = apiKey;
      if (apiSecret) body.apiSecret = apiSecret;

      await jsonFetch(`${appConfig.apiURI}/dash/apps/${appId}/storage_config`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
      });
      successToast('Storage configuration saved');
      setCloudName('');
      setUploadPreset('');
      setApiKey('');
      setApiSecret('');
      fetchConfig();
    } catch (e: any) {
      errorToast(`Failed to save: ${e.message}`);
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return <div className="p-4 text-gray-500">Loading storage configuration...</div>;
  }

  if (error) {
    return <div className="p-4 text-red-500">Error: {error}</div>;
  }

  return (
    <div className="space-y-6 p-6">
      <div>
        <SectionHeading>Storage Settings</SectionHeading>
        <p className="mt-1 text-sm text-gray-500">
          Configure custom cloud storage for this app. By default, files are stored using
          the platform's shared Cloudinary account.
        </p>
      </div>

      {config ? (
        <StorageConfigCard
          config={config}
          onDelete={fetchConfig}
          appId={appId}
          token={token}
        />
      ) : (
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
          <p className="text-sm text-blue-800">
            This app is using the default storage configuration. To use your own
            Cloudinary account, enter your credentials below.
          </p>
        </div>
      )}

      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <SubsectionHeading>Configure Custom Cloudinary</SubsectionHeading>
        <p className="mb-4 text-sm text-gray-500">
          To use your own Cloudinary account, you'll need to create an unsigned
          upload preset in your Cloudinary dashboard.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="cloudName">Cloud Name *</label>
            <TextInput
              id="cloudName"
              value={cloudName}
              onChange={(e) => setCloudName(e.target.value)}
              placeholder="e.g., my-cloud"
              required
            />
          </div>

          <div>
            <label htmlFor="uploadPreset">Unsigned Upload Preset *</label>
            <TextInput
              id="uploadPreset"
              value={uploadPreset}
              onChange={(e) => setUploadPreset(e.target.value)}
              placeholder="e.g., my_unsigned_preset"
              required
            />
            <p className="mt-1 text-xs text-gray-500">
              Create this in Cloudinary → Settings → Upload → Upload presets
            </p>
          </div>

          <div>
            <label htmlFor="apiKey">API Key (optional)</label>
            <TextInput
              id="apiKey"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="For server-side operations"
            />
          </div>

          <div>
            <label htmlFor="apiSecret">API Secret (optional)</label>
            <TextInput
              id="apiSecret"
              type="password"
              value={apiSecret}
              onChange={(e) => setApiSecret(e.target.value)}
              placeholder="For server-side operations"
            />
          </div>

          <Button type="submit" disabled={isSaving}>
            {isSaving ? 'Saving...' : 'Save Configuration'}
          </Button>
        </form>
      </div>

      <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
        <h4 className="font-medium text-gray-900">How It Works</h4>
        <ul className="mt-2 space-y-1 text-sm text-gray-600">
          <li>• Files upload directly from the browser to Cloudinary (unsigned upload)</li>
          <li>• No server-side signing required - uses upload presets</li>
          <li>• Files are stored in a folder organized by app ID</li>
          <li>• Delete operations are handled server-side with your API credentials</li>
        </ul>
      </div>
    </div>
  );
}
