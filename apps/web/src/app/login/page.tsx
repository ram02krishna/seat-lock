'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Eye, EyeOff } from 'lucide-react';
import { apiFetch } from '@/lib/api';
import { safeRedirect } from '@/lib/safe-redirect';

type AuthMode = 'login' | 'register' | 'register-otp' | 'forgot' | 'forgot-otp';

const COPY: Record<AuthMode, { title: string; blurb: (email: string) => string }> = {
  login: { title: 'Welcome back', blurb: () => 'Sign in to see your tickets and hold seats.' },
  register: { title: 'Create an account', blurb: () => 'You’ll need one to hold seats and receive tickets.' },
  'register-otp': { title: 'Check your email', blurb: (e) => `We sent a 6-digit code to ${e}.` },
  forgot: { title: 'Reset your password', blurb: () => 'Enter your email and we’ll send you a code.' },
  'forgot-otp': { title: 'Choose a new password', blurb: (e) => `Enter the 6-digit code we sent to ${e}.` },
};

function PasswordField({
  label,
  value,
  onChange,
  autoComplete,
  minLength,
  autoFocus,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete: string;
  minLength?: number;
  autoFocus?: boolean;
}) {
  const [shown, setShown] = useState(false);
  return (
    <div>
      <label className="field-label">{label}</label>
      <div className="relative">
        <input
          type={shown ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          required
          minLength={minLength}
          autoComplete={autoComplete}
          autoFocus={autoFocus}
          className="field pr-11"
        />
        <button
          type="button"
          onClick={() => setShown((s) => !s)}
          aria-label={shown ? 'Hide password' : 'Show password'}
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-ink-3 hover:text-ink"
        >
          {shown ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
    </div>
  );
}

function CodeField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="field-label">6-digit code</label>
      <input
        type="text"
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={6}
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, ''))}
        required
        autoFocus
        placeholder="000000"
        className="field text-center text-xl sm:text-2xl font-semibold tracking-[0.25em] sm:tracking-[0.5em] tabular-nums"
      />
    </div>
  );
}

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectTo = safeRedirect(searchParams.get('redirect'));
  const queryClient = useQueryClient();

  const [mode, setMode] = useState<AuthMode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [otp, setOtp] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [countdown, setCountdown] = useState(0);
  const [devOtp, setDevOtp] = useState<string | null>(null);

  // Already signed in? Nothing to do here.
  const { data: me } = useQuery({
    queryKey: ['auth', 'me'],
    queryFn: () => apiFetch('/api/auth/me'),
    retry: false,
    staleTime: 5 * 60 * 1000,
  });
  useEffect(() => {
    if (me?.user) router.replace(redirectTo);
  }, [me, redirectTo, router]);

  useEffect(() => {
    if (countdown <= 0) return;
    const id = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(id);
  }, [countdown]);

  function switchMode(next: AuthMode) {
    setMode(next);
    setError(null);
    setInfo(null);
    setOtp('');
    setDevOtp(null);
  }

  async function finishSignIn(payload?: any) {
    if (payload?.user) {
      queryClient.setQueryData(['auth', 'me'], { user: payload.user });
    }
    // Invalidate auth and tickets so components update with fresh session
    queryClient.invalidateQueries({ queryKey: ['auth', 'me'] });
    queryClient.invalidateQueries({ queryKey: ['my-tickets'] });
    router.replace(redirectTo);
  }

  async function run(fn: () => Promise<void>, fallbackError: string) {
    setIsLoading(true);
    setError(null);
    setInfo(null);
    try {
      await fn();
    } catch (err: any) {
      setError(err.message || fallbackError);
    } finally {
      setIsLoading(false);
    }
  }

  const post = (path: string, body: unknown) =>
    apiFetch(path, { method: 'POST', body: JSON.stringify(body) });

  function afterCodeSent(res: any, next: AuthMode | null) {
    setInfo(res?.message ?? 'A code is on its way.');
    if (res?.devOtp) {
      setDevOtp(res.devOtp);
      setOtp(res.devOtp);
    }
    setCountdown(30);
    if (next) setMode(next);
  }

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    run(async () => {
      const res = await post('/api/auth/login', { email, password });
      await finishSignIn(res);
    }, 'Sign-in failed. Check your details and try again.');
  };

  const handleSendRegisterCode = (e: React.FormEvent) => {
    e.preventDefault();
    run(async () => afterCodeSent(await post('/api/auth/register/send-otp', { email, password }), 'register-otp'), 'Couldn’t send the code.');
  };

  const handleVerifyRegister = (e: React.FormEvent) => {
    e.preventDefault();
    run(async () => {
      const res = await post('/api/auth/register/verify-otp', { email, otp: otp.trim() });
      await finishSignIn(res);
    }, 'That code didn’t work.');
  };

  const handleSendForgotCode = (e: React.FormEvent) => {
    e.preventDefault();
    run(async () => afterCodeSent(await post('/api/auth/forgot-password', { email }), 'forgot-otp'), 'Couldn’t send the code.');
  };

  const handleReset = (e: React.FormEvent) => {
    e.preventDefault();
    run(async () => {
      const res = await post('/api/auth/reset-password', { email, otp: otp.trim(), newPassword });
      await finishSignIn(res);
    }, 'Couldn’t reset the password.');
  };

  const handleResend = () => {
    if (countdown > 0) return;
    run(async () => {
      if (mode === 'register-otp') afterCodeSent(await post('/api/auth/register/send-otp', { email, password }), null);
      else afterCodeSent(await post('/api/auth/forgot-password', { email }), null);
    }, 'Couldn’t resend the code.');
  };

  const emailField = (autoFocus = false) => (
    <div>
      <label className="field-label">Email</label>
      <input
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        required
        autoFocus={autoFocus}
        autoComplete="email"
        className="field"
      />
    </div>
  );

  const resendRow = (
    <div className="flex items-center justify-between text-[13px]">
      <button
        type="button"
        onClick={() => switchMode(mode === 'register-otp' ? 'register' : 'login')}
        className="inline-flex items-center gap-1 text-ink-3 hover:text-ink min-h-[36px]"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        {mode === 'register-otp' ? 'Change email' : 'Back to sign in'}
      </button>
      <button
        type="button"
        disabled={countdown > 0 || isLoading}
        onClick={handleResend}
        className="font-medium text-accent hover:underline disabled:text-ink-3 disabled:no-underline min-h-[36px] flex items-center"
      >
        {countdown > 0 ? `Resend in ${countdown}s` : 'Resend code'}
      </button>
    </div>
  );

  const devHint = devOtp && (
    <p className="notice notice-warn justify-between items-center">
      <span>
        Dev mode code: <strong className="tabular-nums">{devOtp}</strong>
      </span>
      <button type="button" className="font-semibold underline ml-2 shrink-0" onClick={() => setOtp(devOtp)}>
        Fill
      </button>
    </p>
  );

  return (
    <main className="page max-w-md py-8 sm:py-20">
      <div className="mb-6 sm:mb-8 space-y-1.5 sm:space-y-2 text-center">
        <h1 className="font-display text-3xl sm:text-4xl font-semibold tracking-tight">{COPY[mode].title}</h1>
        <p className="text-sm sm:text-[15px] text-ink-2">{COPY[mode].blurb(email)}</p>
      </div>

      <div className="card space-y-4 sm:space-y-5 p-5 sm:p-7">
        {(mode === 'login' || mode === 'register') && (
          <div className="grid grid-cols-2 gap-1 rounded-lg bg-sunken p-1" role="tablist">
            {(['login', 'register'] as const).map((m) => (
              <button
                key={m}
                type="button"
                role="tab"
                aria-selected={mode === m}
                onClick={() => switchMode(m)}
                className={`rounded-md py-2.5 text-sm font-semibold transition min-h-[42px] ${
                  mode === m ? 'bg-surface text-ink shadow-card' : 'text-ink-3 hover:text-ink'
                }`}
              >
                {m === 'login' ? 'Sign in' : 'Register'}
              </button>
            ))}
          </div>
        )}

        {info && <p className="notice notice-ok">{info}</p>}
        {error && (
          <p role="alert" className="notice notice-error">
            {error}
          </p>
        )}

        {mode === 'login' && (
          <form onSubmit={handleLogin} className="space-y-4">
            {emailField(true)}
            <div className="space-y-1.5">
              <PasswordField label="Password" value={password} onChange={setPassword} autoComplete="current-password" />
              <div className="text-right">
                <button type="button" onClick={() => switchMode('forgot')} className="text-[13px] text-ink-3 hover:text-accent">
                  Forgot your password?
                </button>
              </div>
            </div>
            <button type="submit" disabled={isLoading} className="btn btn-primary w-full">
              {isLoading ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
        )}

        {mode === 'register' && (
          <form onSubmit={handleSendRegisterCode} className="space-y-4">
            {emailField(true)}
            <PasswordField label="Password (6+ characters)" value={password} onChange={setPassword} autoComplete="new-password" minLength={6} />
            <button type="submit" disabled={isLoading} className="btn btn-primary w-full">
              {isLoading ? 'Sending code…' : 'Email me a code'}
            </button>
          </form>
        )}

        {mode === 'register-otp' && (
          <form onSubmit={handleVerifyRegister} className="space-y-4">
            {devHint}
            <CodeField value={otp} onChange={setOtp} />
            <button type="submit" disabled={isLoading || otp.length !== 6} className="btn btn-primary w-full">
              {isLoading ? 'Verifying…' : 'Create account'}
            </button>
            {resendRow}
          </form>
        )}

        {mode === 'forgot' && (
          <form onSubmit={handleSendForgotCode} className="space-y-4">
            {emailField(true)}
            <button type="submit" disabled={isLoading} className="btn btn-primary w-full">
              {isLoading ? 'Sending code…' : 'Send reset code'}
            </button>
            <div className="flex items-center justify-between text-[13px]">
              <button type="button" onClick={() => switchMode('login')} className="inline-flex items-center gap-1 text-ink-3 hover:text-ink">
                <ArrowLeft className="h-3.5 w-3.5" />
                Back to sign in
              </button>
              <button type="button" onClick={() => switchMode('register')} className="text-accent hover:underline">
                Create account
              </button>
            </div>
          </form>
        )}

        {mode === 'forgot-otp' && (
          <form onSubmit={handleReset} className="space-y-4">
            {devHint}
            <CodeField value={otp} onChange={setOtp} />
            <PasswordField label="New password (6+ characters)" value={newPassword} onChange={setNewPassword} autoComplete="new-password" minLength={6} />
            <button type="submit" disabled={isLoading || otp.length !== 6 || newPassword.length < 6} className="btn btn-primary w-full">
              {isLoading ? 'Saving…' : 'Set new password'}
            </button>
            {resendRow}
          </form>
        )}
      </div>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <main className="page max-w-md py-20" aria-busy="true">
          <div className="skeleton h-80" />
        </main>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
