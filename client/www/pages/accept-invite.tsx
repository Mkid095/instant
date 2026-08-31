import { useState, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import config from '@/lib/config';
import { Button } from '@/components/ui';
import { CommandLineIcon } from '@heroicons/react/24/solid';

function AcceptInviteInner() {
  const searchParams = useSearchParams();
  const token = searchParams?.get('token');

  const [status, setStatus] = useState<'loading' | 'valid' | 'invalid' | 'error'>('loading');
  const [email, setEmail] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [step, setStep] = useState<'email' | 'code' | 'success'>('email');
  const [codeSent, setCodeSent] = useState(false);
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!token) {
      setStatus('invalid');
      setErrorMessage('Invalid invitation link. Please check your email for the correct link.');
      return;
    }

    // Validate the token
    const validateUrl = `${config.apiURI}/dash/account-invites/validate/${token}`;
    fetch(validateUrl)
      .then(res => res.json())
      .then(data => {
        if (data.valid) {
          setStatus('valid');
          setEmail(data.email);
        } else {
          setStatus('invalid');
          setErrorMessage(data.message || 'This invitation is invalid or has expired.');
        }
      })
      .catch(() => {
        setStatus('error');
        setErrorMessage('Failed to validate invitation. Please try again.');
      });
  }, [token]);

  const handleSendCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return;

    setLoading(true);
    try {
      const res = await fetch(`${config.apiURI}/dash/auth/send_magic_code`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });

      if (res.ok) {
        setCodeSent(true);
        setStep('code');
      } else {
        const data = await res.json();
        setErrorMessage(data.message || 'Failed to send verification code.');
      }
    } catch {
      setErrorMessage('Failed to send verification code. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !code) return;

    setLoading(true);
    try {
      const res = await fetch(`${config.apiURI}/dash/auth/verify_magic_code`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, code }),
      });

      if (res.ok) {
        setStep('success');
      } else {
        setErrorMessage('Invalid verification code. Please try again.');
      }
    } catch {
      setErrorMessage('Failed to verify code. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  if (status === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="h-12 w-12 mx-auto mb-4 rounded-full bg-blue-100 flex items-center justify-center">
            <CommandLineIcon className="h-6 w-6 text-blue-600 animate-pulse" />
          </div>
          <p className="text-gray-600">Validating your invitation...</p>
        </div>
      </div>
    );
  }

  if (status === 'invalid' || status === 'error') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <div className="max-w-md w-full mx-4">
          <div className="bg-white rounded-lg shadow-lg p-8 text-center">
            <div className="h-16 w-16 mx-auto mb-4 rounded-full bg-red-100 flex items-center justify-center">
              <CommandLineIcon className="h-8 w-8 text-red-600" />
            </div>
            <h1 className="text-2xl font-bold text-gray-900 mb-2">Invalid Invitation</h1>
            <p className="text-gray-600 mb-6">
              {errorMessage || 'This invitation link is invalid or has expired.'}
            </p>
            <p className="text-sm text-gray-500">
              Please contact the person who invited you for a new invitation link.
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (step === 'success') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <div className="max-w-md w-full mx-4">
          <div className="bg-white rounded-lg shadow-lg p-8 text-center">
            <div className="h-16 w-16 mx-auto mb-4 rounded-full bg-green-100 flex items-center justify-center">
              <svg className="h-8 w-8 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h1 className="text-2xl font-bold text-gray-900 mb-2">Welcome to Instant!</h1>
            <p className="text-gray-600 mb-6">
              Your account has been created successfully. You can now log in and start creating your projects.
            </p>
            <a href="/dash">
              <Button variant="primary">Go to Dashboard</Button>
            </a>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50">
      <div className="max-w-md w-full mx-4">
        <div className="bg-white rounded-lg shadow-lg p-8">
          <div className="text-center mb-8">
            <div className="h-16 w-16 mx-auto mb-4 rounded-full bg-blue-100 flex items-center justify-center">
              <CommandLineIcon className="h-8 w-8 text-blue-600" />
            </div>
            <h1 className="text-2xl font-bold text-gray-900">Accept Invitation</h1>
            <p className="text-gray-600 mt-2">
              You've been invited to create an account
            </p>
          </div>

          {errorMessage && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md">
              <p className="text-sm text-red-600">{errorMessage}</p>
            </div>
          )}

          {step === 'email' && (
            <form onSubmit={handleSendCode}>
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Your Email
                </label>
                <input
                  type="email"
                  value={email || ''}
                  disabled
                  className="w-full px-3 py-2 border border-gray-300 rounded-md bg-gray-50 text-gray-600"
                />
              </div>
              <Button
                type="submit"
                variant="primary"
                disabled={loading}
                className="w-full"
              >
                {loading ? 'Sending...' : 'Continue'}
              </Button>
            </form>
          )}

          {step === 'code' && (
            <form onSubmit={handleVerifyCode}>
              <p className="text-sm text-gray-600 mb-4">
                Enter the verification code sent to <strong>{email}</strong>
              </p>
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Verification Code
                </label>
                <input
                  type="text"
                  value={code}
                  onChange={e => setCode(e.target.value)}
                  placeholder="Enter 6-digit code"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md"
                  maxLength={6}
                  autoFocus
                />
              </div>
              <Button
                type="submit"
                variant="primary"
                disabled={loading || code.length !== 6}
                className="w-full"
              >
                {loading ? 'Verifying...' : 'Verify & Create Account'}
              </Button>
              <button
                type="button"
                onClick={() => {
                  setCodeSent(false);
                  setStep('email');
                  setCode('');
                }}
                className="mt-3 w-full text-sm text-gray-600 hover:text-gray-800"
              >
                Didn't receive a code? Try again
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

function LoadingFallback() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50">
      <div className="text-center">
        <div className="h-12 w-12 mx-auto mb-4 rounded-full bg-blue-100 flex items-center justify-center">
          <CommandLineIcon className="h-6 w-6 text-blue-600 animate-pulse" />
        </div>
        <p className="text-gray-600">Loading...</p>
      </div>
    </div>
  );
}

export default function AcceptInvite() {
  return (
    <Suspense fallback={<LoadingFallback />}>
      <AcceptInviteInner />
    </Suspense>
  );
}
