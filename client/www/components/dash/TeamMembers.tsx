import { useState } from 'react';
import { useAuthToken } from '@/lib/auth';
import config from '@/lib/config';
import { successToast, errorToast } from '@/lib/toast';
import { SectionHeading, Button } from '@/components/ui';
import { CommandLineIcon } from '@heroicons/react/24/solid';

export default function TeamMembers({ appId }: { appId: string }) {
  const token = useAuthToken();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);

  const inviteMember = async () => {
    if (!email) {
      errorToast('Please enter an email address');
      return;
    }
    setLoading(true);
    try {
      const response = await fetch(`${config.apiURI}/dash/apps/${appId}/invite/send`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ 'invitee-email': email, role: 'collaborator' }),
      });
      if (response.ok) {
        successToast(`Invitation sent to ${email}`);
        setEmail('');
      } else {
        const data = await response.json();
        errorToast(data.error || 'Failed to send invitation');
      }
    } catch (error) {
      errorToast('Failed to send invitation');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <div className="flex items-center gap-3">
          <CommandLineIcon className="h-8 w-8 text-gray-500" />
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Team Members</h1>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
              Manage team members for your app.
            </p>
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-neutral-700 dark:bg-neutral-800">
        <SectionHeading>Invite Member</SectionHeading>
        <div className="mt-4 flex flex-col gap-4 sm:flex-row">
          <input
            type="email"
            placeholder="Enter email address"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-neutral-600 dark:bg-neutral-800 dark:text-white"
          />
          <Button
            onClick={inviteMember}
            disabled={loading}
            variant="primary"
          >
            {loading ? 'Sending...' : 'Send Invitation'}
          </Button>
        </div>
      </div>

      <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-neutral-700 dark:bg-neutral-800">
        <SectionHeading>Current Members</SectionHeading>
        <div className="mt-4 text-sm text-gray-500 dark:text-gray-400">
          <p>No team members added yet.</p>
          <p className="mt-1">Members with access to this app will appear here.</p>
        </div>
      </div>
    </div>
  );
}
