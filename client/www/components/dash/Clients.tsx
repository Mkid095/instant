import { useState, useEffect } from 'react';
import { useAuthToken } from '@/lib/auth';
import config from '@/lib/config';
import { successToast, errorToast } from '@/lib/toast';
import { SectionHeading, Button } from '@/components/ui';
import { CommandLineIcon } from '@heroicons/react/24/solid';

interface ClientInvite {
  id: string;
  email: string;
  status: 'pending' | 'accepted' | 'revoked' | 'expired';
  expires_at: string;
  accepted_at: string | null;
  created_at: string;
}

export default function Clients() {
  const token = useAuthToken();
  const [clientName, setClientName] = useState('');
  const [clientEmail, setClientEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [invites, setInvites] = useState<ClientInvite[]>([]);
  const [fetching, setFetching] = useState(true);

  useEffect(() => {
    fetchInvites();
  }, [token]);

  const fetchInvites = async () => {
    if (!token) return;
    try {
      const response = await fetch(`${config.apiURI}/dash/account-invites`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      if (response.ok) {
        const data = await response.json();
        setInvites(data.invites || []);
      }
    } catch (error) {
      console.error('Failed to fetch invites:', error);
    } finally {
      setFetching(false);
    }
  };

  const addClient = async () => {
    if (!clientEmail) {
      errorToast('Please enter an email address');
      return;
    }
    setLoading(true);
    try {
      const response = await fetch(`${config.apiURI}/dash/account-invites/send`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ email: clientEmail }),
      });
      if (response.ok) {
        successToast(`Invitation sent to ${clientEmail}`);
        setClientEmail('');
        setClientName('');
        fetchInvites();
      } else {
        const data = await response.json();
        errorToast(data.message || data.hint?.errors?.[0]?.message || 'Failed to send invitation');
      }
    } catch (error) {
      errorToast('Failed to send invitation');
    } finally {
      setLoading(false);
    }
  };

  const resendInvite = async (inviteId: string) => {
    try {
      const response = await fetch(`${config.apiURI}/dash/account-invites/send`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ email: invites.find(i => i.id === inviteId)?.email }),
      });
      if (response.ok) {
        successToast('Invitation resent');
      } else {
        const data = await response.json();
        errorToast(data.message || 'Failed to resend invitation');
      }
    } catch (error) {
      errorToast('Failed to resend invitation');
    }
  };

  const revokeInvite = async (inviteId: string) => {
    try {
      const response = await fetch(`${config.apiURI}/dash/account-invites/${inviteId}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      if (response.ok) {
        successToast('Invitation revoked');
        fetchInvites();
      } else {
        const data = await response.json();
        errorToast(data.message || 'Failed to revoke invitation');
      }
    } catch (error) {
      errorToast('Failed to revoke invitation');
    }
  };

  const pendingInvites = invites.filter((invite) => invite.status === 'pending');
  const activeInvites = invites.filter((invite) => invite.status === 'accepted');
  const revokedInvites = invites.filter((invite) => invite.status === 'revoked');
  const expiredInvites = invites.filter((invite) => invite.status === 'expired');

  if (fetching) {
    return (
      <div className="flex flex-col gap-6 p-6">
        <div className="flex items-center gap-3">
          <CommandLineIcon className="h-8 w-8 text-gray-500" />
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Clients</h1>
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
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Clients</h1>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
              Manage client accounts and invitations.
            </p>
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-neutral-700 dark:bg-neutral-800">
        <SectionHeading>Add Client</SectionHeading>
        <div className="mt-4 flex flex-col gap-4 sm:flex-row">
          <input
            type="text"
            placeholder="Client name (optional)"
            value={clientName}
            onChange={(e) => setClientName(e.target.value)}
            className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-neutral-600 dark:bg-neutral-800 dark:text-white"
          />
          <input
            type="email"
            placeholder="Client email address"
            value={clientEmail}
            onChange={(e) => setClientEmail(e.target.value)}
            className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-neutral-600 dark:bg-neutral-800 dark:text-white"
          />
          <Button
            onClick={addClient}
            disabled={loading}
            variant="primary"
          >
            {loading ? 'Sending...' : 'Send Account Invitation'}
          </Button>
        </div>
      </div>

      {pendingInvites.length > 0 && (
        <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-neutral-700 dark:bg-neutral-800">
          <SectionHeading>Pending Invitations ({pendingInvites.length})</SectionHeading>
          <div className="mt-4 divide-y divide-gray-100 dark:divide-neutral-700">
            {pendingInvites.map((invite) => (
              <div key={invite.id} className="flex items-center justify-between py-3">
                <div>
                  <div className="font-medium text-gray-900 dark:text-white">{invite.email}</div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">
                    Sent {new Date(invite.created_at).toLocaleDateString()} · Expires {new Date(invite.expires_at).toLocaleDateString()}
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button
                    onClick={() => resendInvite(invite.id)}
                    variant="subtle"
                  >
                    Resend
                  </Button>
                  <Button
                    onClick={() => revokeInvite(invite.id)}
                    variant="destructive"
                  >
                    Revoke
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {activeInvites.length > 0 && (
        <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-neutral-700 dark:bg-neutral-800">
          <SectionHeading>Active Clients ({activeInvites.length})</SectionHeading>
          <div className="mt-4 divide-y divide-gray-100 dark:divide-neutral-700">
            {activeInvites.map((invite) => (
              <div key={invite.id} className="flex items-center justify-between py-3">
                <div>
                  <div className="font-medium text-gray-900 dark:text-white">{invite.email}</div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">
                    Accepted {invite.accepted_at ? new Date(invite.accepted_at).toLocaleDateString() : 'Unknown'}
                  </div>
                </div>
                <span className="rounded-full bg-green-100 px-2 py-1 text-xs font-medium text-green-800 dark:bg-green-900 dark:text-green-200">
                  Active
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {expiredInvites.length > 0 && (
        <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-neutral-700 dark:bg-neutral-800">
          <SectionHeading>Expired Invitations ({expiredInvites.length})</SectionHeading>
          <div className="mt-4 divide-y divide-gray-100 dark:divide-neutral-700">
            {expiredInvites.map((invite) => (
              <div key={invite.id} className="flex items-center justify-between py-3">
                <div>
                  <div className="font-medium text-gray-900 dark:text-white">{invite.email}</div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">
                    Sent {new Date(invite.created_at).toLocaleDateString()}
                  </div>
                </div>
                <span className="rounded-full bg-gray-100 px-2 py-1 text-xs font-medium text-gray-800 dark:bg-gray-700 dark:text-gray-200">
                  Expired
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {revokedInvites.length > 0 && (
        <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-neutral-700 dark:bg-neutral-800">
          <SectionHeading>Revoked Invitations ({revokedInvites.length})</SectionHeading>
          <div className="mt-4 divide-y divide-gray-100 dark:divide-neutral-700">
            {revokedInvites.map((invite) => (
              <div key={invite.id} className="flex items-center justify-between py-3">
                <div>
                  <div className="font-medium text-gray-900 dark:text-white">{invite.email}</div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">
                    Sent {new Date(invite.created_at).toLocaleDateString()}
                  </div>
                </div>
                <span className="rounded-full bg-red-100 px-2 py-1 text-xs font-medium text-red-800 dark:bg-red-900 dark:text-red-200">
                  Revoked
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {invites.length === 0 && (
        <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-neutral-700 dark:bg-neutral-800">
          <p className="text-sm text-gray-500 dark:text-gray-400">
            No clients yet. Send an invitation to add a client account.
          </p>
        </div>
      )}
    </div>
  );
}
