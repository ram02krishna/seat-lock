'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Html5QrcodeScanner } from 'html5-qrcode';
import { AlertTriangle, Camera, CheckCircle2, Keyboard, XCircle } from 'lucide-react';
import { apiFetch, ApiError } from '@/lib/api';

type ScanStatus = 'SUCCESS' | 'ALREADY_USED' | 'INVALID';

interface ScanResult {
  status: ScanStatus;
  message: string;
  checkedInAt?: string;
  attendee?: {
    email: string;
    eventTitle?: string;
    venue?: string;
    seat: string;
    tier?: string;
  };
}

const RESULT_STYLE: Record<ScanStatus, { box: string; icon: React.ReactNode; title: string }> = {
  SUCCESS: {
    box: 'border-ok/40 bg-ok-soft',
    icon: <CheckCircle2 className="h-7 w-7 text-ok" />,
    title: 'Let them in',
  },
  ALREADY_USED: {
    box: 'border-warn/40 bg-warn-soft',
    icon: <AlertTriangle className="h-7 w-7 text-warn" />,
    title: 'Already scanned',
  },
  INVALID: {
    box: 'border-danger/40 bg-danger-soft',
    icon: <XCircle className="h-7 w-7 text-danger" />,
    title: 'Not valid',
  },
};

function beep(kind: 'ok' | 'bad') {
  try {
    const Ctx = window.AudioContext || (window as any).webkitAudioContext;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    const t = ctx.currentTime;
    if (kind === 'ok') {
      osc.frequency.setValueAtTime(660, t);
      osc.frequency.setValueAtTime(880, t + 0.09);
    } else {
      osc.frequency.setValueAtTime(220, t);
      osc.frequency.setValueAtTime(165, t + 0.14);
    }
    gain.gain.setValueAtTime(0.18, t);
    gain.gain.exponentialRampToValueAtTime(0.01, t + 0.32);
    osc.start();
    osc.stop(t + 0.32);
    osc.onended = () => ctx.close();
  } catch {
    // audio not available; the visual result is enough
  }
}

export default function StaffScannerPage() {
  const { data: authData, isLoading: authLoading } = useQuery({
    queryKey: ['auth', 'me'],
    queryFn: () => apiFetch('/api/auth/me'),
    retry: false,
    staleTime: 5 * 60 * 1000,
  });
  const user = authData?.user;
  const isAuthorized = user?.role === 'STAFF' || user?.role === 'ORGANIZER';

  const [result, setResult] = useState<ScanResult | null>(null);
  const [manualToken, setManualToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [cameraOn, setCameraOn] = useState(false);
  const lastScan = useRef<{ token: string; at: number } | null>(null);

  const validate = useCallback(async (raw: string, source: 'camera' | 'manual' = 'manual') => {
    const token = raw.trim();
    if (!token) return;

    // Cameras report the same code many times a second, so ignore camera repeats for a few
    // seconds. Typed codes are deliberate: always check them and show a result, otherwise a
    // retry after a failed attempt would silently do nothing.
    const now = Date.now();
    if (source === 'camera' && lastScan.current && lastScan.current.token === token && now - lastScan.current.at < 4000) {
      return;
    }
    lastScan.current = { token, at: now };

    setBusy(true);
    try {
      const res = await apiFetch('/api/tickets/check-in', {
        method: 'POST',
        body: JSON.stringify({ qrToken: token }),
      });
      beep('ok');
      setResult({ status: 'SUCCESS', message: 'Check-in recorded', checkedInAt: res.checkedInAt, attendee: res.attendee });
    } catch (err: any) {
      beep('bad');
      if (err instanceof ApiError && err.status === 409) {
        setResult({
          status: 'ALREADY_USED',
          message: 'This ticket has already been used.',
          attendee: err.attendee,
          checkedInAt: err.checkedInAt,
        });
      } else {
        setResult({ status: 'INVALID', message: err.message || 'This code isn’t a valid ticket.' });
      }
    } finally {
      setBusy(false);
    }
  }, []);

  // Keep the camera callback pointing at the latest validate without rebuilding the scanner
  const validateRef = useRef(validate);
  validateRef.current = validate;

  useEffect(() => {
    if (!isAuthorized || !cameraOn) return;

    const scanner = new Html5QrcodeScanner('qr-reader', { fps: 10, qrbox: { width: 240, height: 240 } }, false);
    scanner.render(
      (text) => {
        validateRef.current(text, 'camera');
        setCameraOn(false);
      },
      () => {
        // frames without a readable code are expected
      },
    );
    return () => {
      scanner.clear().catch(() => {});
    };
  }, [isAuthorized, cameraOn]);

  function next() {
    setResult(null);
    setManualToken('');
    lastScan.current = null;
  }

  if (authLoading) {
    return (
      <main className="page max-w-lg py-16" aria-busy="true">
        <div className="skeleton h-64" />
      </main>
    );
  }

  if (!isAuthorized) {
    return (
      <main className="page max-w-md space-y-4 py-24 text-center">
        <h1 className="font-display text-3xl font-semibold">Staff only</h1>
        <p className="text-sm text-ink-2">
          Ticket check-in is limited to venue staff and organizers. Sign in with a staff account to continue.
        </p>
        <Link href="/login?redirect=/staff/scanner" className="btn btn-primary btn-sm">
          Sign in
        </Link>
      </main>
    );
  }

  const style = result ? RESULT_STYLE[result.status] : null;

  return (
    <main className="page max-w-xl space-y-5 sm:space-y-6 py-6 sm:py-14 pb-safe">
      <header className="space-y-1.5 sm:space-y-2">
        <h1 className="font-display text-2xl sm:text-3xl md:text-4xl font-semibold tracking-tight">Gate check-in</h1>
        <p className="text-sm sm:text-[15px] text-ink-2">Scan a ticket’s QR code, or type the ticket code if the camera can’t read it.</p>
      </header>

      {result && style ? (
        <section className={`rounded-xl border-2 p-4 sm:p-6 ${style.box}`} role="alert">
          <div className="flex items-center gap-3">
            {style.icon}
            <div>
              <p className="font-display text-xl sm:text-2xl font-semibold leading-tight">{style.title}</p>
              <p className="text-xs sm:text-sm text-ink-2">{result.message}</p>
            </div>
          </div>

          {result.attendee && (
            <dl className="mt-4 sm:mt-5 space-y-2 rounded-lg bg-surface/70 p-3.5 sm:p-4 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-ink-3">Seat</dt>
                <dd className="text-right text-base sm:text-lg font-semibold">
                  {result.attendee.seat}
                  {result.attendee.tier && (
                    <span className="ml-2 text-xs font-medium capitalize text-ink-3">{result.attendee.tier.toLowerCase()}</span>
                  )}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-ink-3">Attendee</dt>
                <dd className="truncate text-right font-medium">{result.attendee.email}</dd>
              </div>
              {result.attendee.eventTitle && (
                <div className="flex justify-between gap-4">
                  <dt className="text-ink-3">Event</dt>
                  <dd className="min-w-0 break-words text-right">{result.attendee.eventTitle}</dd>
                </div>
              )}
              {result.checkedInAt && (
                <div className="flex justify-between gap-4 border-t border-line pt-2">
                  <dt className="text-ink-3">{result.status === 'SUCCESS' ? 'Scanned at' : 'First scanned at'}</dt>
                  <dd className="tabular-nums">{new Date(result.checkedInAt).toLocaleTimeString()}</dd>
                </div>
              )}
            </dl>
          )}

          <button type="button" onClick={next} className="btn btn-primary mt-4 sm:mt-5 w-full py-3">
            Next attendee
          </button>
        </section>
      ) : (
        <section className="card space-y-5 sm:space-y-6 p-4 sm:p-6">
          <div className="flex items-center justify-between gap-3">
            <p className="flex items-center gap-2 text-sm font-semibold">
              <Camera className="h-4 w-4 text-ink-3" />
              Camera
            </p>
            <button
              type="button"
              onClick={() => setCameraOn((on) => !on)}
              className={`btn btn-sm ${cameraOn ? 'btn-secondary' : 'btn-primary'}`}
            >
              {cameraOn ? 'Stop camera' : 'Start camera'}
            </button>
          </div>

          {cameraOn && (
            <div className="overflow-hidden rounded-lg border border-line bg-sunken p-2">
              <div id="qr-reader" className="w-full" />
            </div>
          )}

          <form
            onSubmit={(e) => {
              e.preventDefault();
              validate(manualToken);
            }}
            className="space-y-2.5 border-t border-line pt-4 sm:pt-5"
          >
            <label htmlFor="manual-code" className="flex items-center gap-2 text-sm font-semibold">
              <Keyboard className="h-4 w-4 text-ink-3" />
              Enter a ticket code
            </label>
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                id="manual-code"
                type="text"
                value={manualToken}
                onChange={(e) => setManualToken(e.target.value)}
                placeholder="Paste or type the code"
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
                className="field flex-1 font-mono text-[13px]"
              />
              <button type="submit" disabled={busy || !manualToken.trim()} className="btn btn-primary shrink-0">
                {busy ? 'Checking…' : 'Check code'}
              </button>
            </div>
          </form>
        </section>
      )}
    </main>
  );
}
