import { NextPageWithLayout } from '../_app';
import { asClientOnlyPage, ClientOnly } from '@/components/clientOnlyPage';
import { sunsetPostPath } from '@/components/SunsetBanner';
import {
  MainDashLayout,
  useFetchedDash,
} from '@/components/dash/MainDashLayout';
import {
  Button,
  Content,
  ScreenHeading,
  TextInput,
  SubsectionHeading,
  Label,
} from '@/components/ui';
import { Transition } from '@headlessui/react';
import config from '@/lib/config';
import { TokenContext } from '@/lib/contexts';
import { jsonFetch } from '@/lib/fetch';
import { InstantApp } from '@/lib/types';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { ReactElement, useContext, useState, FormEvent } from 'react';
import { v4 } from 'uuid';
import { usePostHog } from 'posthog-js/react';
import { successToast, errorToast } from '@/lib/toast';

const Page: NextPageWithLayout = asClientOnlyPage(NewAppFromBackup);

async function restoreFromZip(token: string, appId: string, zipFile: File) {
  const formData = new FormData();
  formData.append('file', zipFile);
  const headers = { authorization: `Bearer ${token}` };
  const res = await fetch(`${config.apiURI}/dash/restores/zip?app_id=${appId}`, {
    method: 'POST',
    headers,
    body: formData,
  });
  const json = await res.json();
  return res.status === 200
    ? json
    : Promise.reject({ status: res.status, body: json });
}

function NewAppFromBackup() {
  const [name, setName] = useState('');
  const [backupFile, setBackupFile] = useState<File | null>(null);
  const [isRestoring, setIsRestoring] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lastError = useState('')[1];

  const dashResponse = useFetchedDash();
  const token = useContext(TokenContext);
  const router = useRouter();
  const posthog = usePostHog();
  const appCreationAllowed =
    dashResponse.data.sunset?.['app-creation-allowed'] ?? true;

  if (!token) {
    return (
      <div className="my-auto grid h-full w-full place-items-center">
        <div className="flex max-w-md flex-col gap-4 text-center">
          <ScreenHeading>Please sign in first</ScreenHeading>
          <Content>You need to be signed in to create an app.</Content>
        </div>
      </div>
    );
  }

  if (!appCreationAllowed) {
    return (
      <div className="my-auto grid h-full w-full place-items-center">
        <div className="flex max-w-md flex-col gap-4 text-center">
          <ScreenHeading>New app creation is closed</ScreenHeading>
          <Content>
            Instant is winding down and isn&apos;t accepting new apps. Read the{' '}
            <Link
              href={sunsetPostPath}
              className="underline underline-offset-2"
            >
              announcement
            </Link>{' '}
            for what&apos;s next and how to migrate.
          </Content>
        </div>
      </div>
    );
  }

  async function onCreateApp(e: FormEvent) {
    e.preventDefault();
    if (!token || !name.trim() || !backupFile) return;

    setIsRestoring(true);
    setError(null);

    try {
      const orgId =
        dashResponse.data.currentWorkspaceId === 'personal'
          ? undefined
          : dashResponse.data.currentWorkspaceId;
      const existingApps = dashResponse.data.apps;
      const appId = v4();

      const app: InstantApp & {
        org_id?: string | null | undefined;
      } = {
        id: appId,
        pro: false,
        title: name.trim(),
        org_id: orgId,
        admin_token: v4(),
        created_at: new Date().toISOString(),
        rules: null,
        rules_version: null,
        members: [],
        invites: [],
        user_app_role: 'owner',
        magic_code_email_template: null,
        magic_code_expiry_minutes: null,
        org: null,
        webhooks: [],
      };

      // Create the app first
      await jsonFetch(`${config.apiURI}/dash/apps`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(app),
      });

      posthog.capture('app_create', {
        app_id: appId,
        is_first_app: existingApps.length === 0,
      });

      // Then restore from backup
      try {
        await restoreFromZip(token, appId, backupFile);
        successToast('App created and restored from backup!');
      } catch (restoreErr: any) {
        // App was created but restore failed - still redirect but show error
        errorToast('App created but restore failed: ' + (restoreErr?.body?.message || restoreErr?.message || 'Unknown error'));
      }

      dashResponse.addNewAppOptimistically(Promise.resolve(), app);
      router.replace(
        `/dash?app=${appId}&t=home&s=main&org=${dashResponse.data.currentWorkspaceId}`,
      );
    } catch (err: any) {
      const msg = err?.body?.message || err?.message || 'Failed to create app';
      lastError(msg);
      setError(msg);
      setIsRestoring(false);
    }
  }

  return (
    <>
      <div className="my-auto grid h-full w-full place-items-center">
        <form onSubmit={onCreateApp} className="flex max-w-md flex-col gap-4">
          <div className="mb-2 flex justify-center text-4xl">📦</div>
          <ScreenHeading className="text-center">
            New app from backup
          </ScreenHeading>
          {dashResponse.data.workspace.type === 'org' && (
            <Content className="w-full">
              This app will be created in the{' '}
              <strong className="dark:text-white">
                {dashResponse.data.workspace.org.title}
              </strong>{' '}
              organization.
            </Content>
          )}
          <Content>
            Upload a backup zip file to create a new app with that data.
          </Content>

          <div className="flex flex-col gap-1">
            <Label>App name</Label>
            <TextInput
              autoFocus
              placeholder="Name your app"
              value={name}
              onChange={(n) => setName(n)}
            />
          </div>

          <div className="flex flex-col gap-1">
            <Label>Backup zip file</Label>
            <input
              type="file"
              accept=".zip"
              onChange={(e) => setBackupFile(e.target.files?.[0] ?? null)}
              className="text-sm file:mr-3 file:rounded-sm file:border file:border-gray-300 file:bg-gray-50 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-gray-700 dark:file:border-neutral-600 dark:file:bg-neutral-800 dark:file:text-gray-300"
            />
          </div>

          <Transition
            as="div"
            show={!!error}
            className="overflow-hidden rounded-sm bg-red-100 p-3 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-300"
            enter="transition-all duration-300 ease-out"
            enterFrom="opacity-0 -translate-y-1 max-h-0 p-0!"
            enterTo="opacity-100 translate-y-0 max-h-40"
            leave="transition-all duration-200 ease-in"
            leaveFrom="opacity-100 translate-y-0 max-h-40"
            leaveTo="opacity-0 -translate-y-1 max-h-0 p-0!"
          >
            {error}
          </Transition>

          <Button
            type="submit"
            disabled={name.trim().length === 0 || !backupFile || isRestoring}
            loading={isRestoring}
          >
            Create app
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => router.back()}
          >
            Nevermind
          </Button>
        </form>
      </div>
    </>
  );
}

Page.getLayout = function getLayout(page: ReactElement) {
  return (
    <ClientOnly>
      <Head>
        <title>Create App from Backup</title>
      </Head>
      <MainDashLayout>{page}</MainDashLayout>
    </ClientOnly>
  );
};

export default Page;
