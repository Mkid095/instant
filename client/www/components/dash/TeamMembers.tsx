import { useState, useEffect } from 'react';
import { useAuthToken } from '@/lib/auth';
import config from '@/lib/config';
import { successToast, errorToast } from '@/lib/toast';
import { SectionHeading, Button } from '@/components/ui';
import { CommandLineIcon } from '@heroicons/react/24/solid';

interface Invite {
  id: string;
  email: string;
  role: string;
  status: string;
  sent_at: string;
  expired: boolean;
}

export default function TeamMembers({ appId }: { appId: string }) {
  const token = useAuthToken();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [members, setMembers] = useState<any[]>([]);
  const [appData, setAppData] = useState<any>(null);
  const [fetching, setFetching] = useState(true);

  useEffect(() => {
    if (!appId || !token) return;
    
    const fetchAppData = async () => {
      try {
        const response = await fetch(`${config.apiURI}/dash/apps/${appId}`, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });
        if (response.ok) {
          const data = await response.json();
          setAppData(data);
          setInvites(data.invites || []);
          setMembers(data.members || []);
        }
      } catch (error) {
        console.error('Failed to fetch app data:', error);
      } finally {
        setFetching(false);
      }
    };

    fetchAppData();
  }, [appId, token]);

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
        // Refresh invites
        const refreshResponse = await fetch(`${config.apiURI}/dash/apps/${appId}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (refreshResponse.ok) {
          const data = await refreshResponse.json();
          setInvites(data.invites || []);
          setMembers(data.members || []);
        }
      } else {
        const data = await response.json();
        errorToast(data.message || 'Failed to send invitation');
      }
    } catch (error) {
      errorToast('Failed to send invitation');
    } finally {
      setLoading(false);
    }
  };

  const revokeInvite = async (inviteId: string) => {
    try {
      const response = await fetch(`${config.apiURI}/dash/apps/${appId}/invite/revoke`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ 'invite-id': inviteId }),
      });
      if (response.ok) {
        successToast('Invitation revoked');
        setInvites(invites.filter((i) => i.id !== inviteId));
      } else {
        const data = await response.json();
        errorToast(data.message || 'Failed to revoke invitation');
      }
    } catch (error) {
      errorToast('Failed to revoke invitation');
    }
  };

  const pendingInvites = invites.filter(
    (invite) => invite.status === 'pending' && !invite.expired,
  );
  const expiredInvites = invites.filter(
    (invite) => invite.status === 'pending' && invite.expired,
  );
  const acceptedMembers = invites.filter((invite) => invite.status === 'accepted');

  if (fetching) {
    return (
      <div className="flex flex-col gap-6 p-6">
        <div className="flex items-center gap-3">
          <CommandLineIcon className="h-8 w-8 text-gray-500" />
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Team Members</h1>
          </div>
        </div>
        <div className="text-sm text-gray-500">Loading...</div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <div className="flex items-center gap-3">
          <CommandLineIcon className="h-8 w-8 text-gray-500" />
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Team Members</h1>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
              Manage team members and invites for your app.
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

      {pendingInvites.length > 0 && (
        <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-neutral-700 dark:bg-neutral-800">
          <SectionHeading>Pending Invites ({pendingInvites.length})</SectionHeading>
          <div className="mt-4 divide-y divide-gray-100 dark:divide-neutral-700">
            {pendingInvites.map((invite) => (
              <div key={invite.id} className="flex items-center justify-between py-3">
                <div>
                  <div className="font-medium text-gray-900 dark:text-white">{invite.email}</div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">
                    {invite.role} · Sent {new Date(invite.sent_at).toLocaleDateString()}
                  </div>
                </div>
                <Button
                  onClick={() => revokeInvite(invite.id)}
                  variant="destructive"
                >
                  Revoke
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}

      {expiredInvites.length > 0 && (
        <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-neutral-700 dark:bg-neutral-800">
          <SectionHeading>Expired Invites ({expiredInvites.length})</SectionHeading>
          <div className="mt-4 text-sm text-gray-500 dark:text-gray-400">
            <p>These invites have expired and can no longer be accepted.</p>
          </div>
        </div>
      )}

      <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-neutral-700 dark:bg-neutral-800">
        <SectionHeading>
          Members ({acceptedMembers.length})
        </SectionHeading>
        {acceptedMembers.length > 0 ? (
          <div className="mt-4 divide-y divide-gray-100 dark:divide-neutral-700">
            {acceptedMembers.map((member) => (
              <div key={member.id} className="flex items-center justify-between py-3">
                <div>
                  <div className="font-medium text-gray-900 dark:text-white">{member.email}</div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">
                    {member.role}
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="mt-4 text-sm text-gray-500 dark:text-gray-400">
            <p>No members yet. Send an invitation to add team members.</p>
          </div>
        )}
      </div>
    </div>
  );
}
