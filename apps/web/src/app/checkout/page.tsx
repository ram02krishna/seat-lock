'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Clock } from 'lucide-react';
import { apiFetch, ApiError } from '@/lib/api';
import { formatINR, formatEventDateTime } from '@/lib/format';
import { deriveMyHold } from '@/lib/hold';
import { useCartStore } from '@/store/cartStore';
import { useCountdown, formatClock } from '@/hooks/useCountdown';

function safeUUID(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

function CheckoutContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const eventId = searchParams.get('eventId');
  const urlShowId = searchParams.get('showId');

  const {
    eventId: cartEventId,
    showId: cartShowId,
    selectedSeats,
    holdExpiresAt,
    heldSeatIds,
    restoreHold,
    clearHold,
  } = useCartStore();

  const showId = urlShowId || cartShowId || undefined;

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lapsed, setLapsed] = useState(false);

  // One key per attempt. It only changes after the server has definitively rejected the request,
  // so a retry after a dropped connection can never create a second order.
  const idempotencyKey = useRef(safeUUID());

  const { data: authData, isLoading: authLoading } = useQuery({
    queryKey: ['auth', 'me'],
    queryFn: () => apiFetch('/api/auth/me'),
    retry: false,
  });
  const user = authData?.user;

  const { data: seatData, isLoading: seatsLoading } = useQuery({
    queryKey: ['events', eventId, 'seats', showId || 'default'],
    queryFn: () => apiFetch(`/api/events/${eventId}/seats${showId ? `?showId=${showId}` : ''}`),
    enabled: !!eventId,
    staleTime: 5000,
  });

  // The server is the authority on what we hold. Sync it into the cart so reloads and other devices work.
  useEffect(() => {
    if (!eventId || !seatData?.seats) return;
    const hold = deriveMyHold(seatData.seats);
    if (hold) restoreHold(eventId, hold.seats, hold.expiresAt, showId, seatData?.show?.startsAt);
  }, [seatData, eventId, showId, restoreHold]);

  // Only trust the cart if it belongs to this event
  const cartMatches = !!eventId && cartEventId === eventId;
  const seats = cartMatches ? selectedSeats : [];
  const expiresAt = cartMatches ? holdExpiresAt : null;
  const hasHold = cartMatches && heldSeatIds.length > 0;
  const total = seats.reduce((sum, s) => sum + s.price, 0);

  const remaining = useCountdown(hasHold ? expiresAt : null, () => {
    setLapsed(true);
    clearHold();
    queryClient.invalidateQueries({ queryKey: ['events', eventId, 'seats'] });
  });
  const urgent = remaining !== null && remaining < 60;
  const expired = lapsed;

  async function handleConfirm() {
    if (!eventId || seats.length === 0 || isSubmitting) return;
    setIsSubmitting(true);
    setError(null);
    try {
      await apiFetch('/api/orders/confirm', {
        method: 'POST',
        body: JSON.stringify({
          eventId,
          seatIds: seats.map((s) => s.seatId),
          showId: showId || undefined,
          idempotencyKey: idempotencyKey.current,
        }),
      });
      clearHold();
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['my-tickets'] }),
        queryClient.invalidateQueries({ queryKey: ['active-hold'] }),
        queryClient.invalidateQueries({ queryKey: ['events'] }),
      ]);
      router.push('/my-tickets?confirmed=1');
    } catch (err: any) {
      if (err instanceof ApiError) {
        // Only rotate the key after a definite client-side rejection. A 5xx can happen after
        // the order commits (for example, if QR generation fails), so retry it with the same
        // key and let the server return the already-confirmed order instead of duplicating work.
        if (err.status >= 400 && err.status < 500 && err.status !== 401) {
          idempotencyKey.current = safeUUID();
        }
        setError(err.message);
      } else {
        // Network trouble: keep the key so retrying is safe
        setError("We couldn't reach the server. Check your connection and try again.");
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  if (!eventId) {
    return (
      <main className="page max-w-md space-y-4 py-24 text-center">
        <h1 className="font-display text-2xl font-semibold">Nothing to check out</h1>
        <Link href="/" className="btn btn-primary btn-sm">
          Browse events
        </Link>
      </main>
    );
  }

  if ((seatsLoading || authLoading) && !hasHold) {
    return (
      <main className="page max-w-3xl space-y-4 py-12" aria-busy="true">
        <div className="skeleton h-10 w-56" />
        <div className="skeleton h-72" />
      </main>
    );
  }

  if (seats.length === 0 || !hasHold || expired) {
    return (
      <main className="page max-w-md space-y-4 py-24 text-center">
        <h1 className="font-display text-2xl font-semibold">
          {expired ? 'Your hold has expired' : 'No seats on hold'}
        </h1>
        <p className="text-sm text-ink-2">
          {expired
            ? 'The seats were released so others can book them. You can pick again if they’re still free.'
            : 'Choose your seats first, then come back here to confirm.'}
        </p>
        <Link href={`/events/${eventId}`} className="btn btn-primary btn-sm">
          Back to the seat map
        </Link>
      </main>
    );
  }

  const eventInfo = seatData?.event;

  return (
    <main className="page max-w-3xl space-y-5 sm:space-y-6 py-6 sm:py-12 pb-safe">
      <div className="space-y-2 sm:space-y-3">
        <Link
          href={`/events/${eventId}`}
          className="inline-flex items-center gap-1.5 text-[13px] text-ink-3 transition-colors hover:text-ink"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to seat map
        </Link>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between sm:gap-3">
          <h1 className="font-display text-2xl font-bold tracking-tight sm:text-3xl md:text-4xl">Review your booking</h1>
          {remaining !== null && (
            <span
              className={`inline-flex self-start sm:self-auto items-center gap-1.5 rounded-md px-2.5 py-1 text-[13px] font-semibold tabular-nums ${
                urgent ? 'bg-danger-soft text-danger' : 'bg-warn-soft text-warn'
              }`}
              role="timer"
            >
              <Clock className="h-3.5 w-3.5" />
              {formatClock(remaining)} left
            </span>
          )}
        </div>
      </div>

      <section className="card divide-y divide-line">
        {eventInfo && (
          <div className="p-4 sm:p-5">
            <p className="eyebrow">Event</p>
            <p className="mt-1 break-words font-display text-lg sm:text-xl font-semibold">{eventInfo.title}</p>
            {seatData?.show?.startsAt ? (
              <p className="text-xs sm:text-sm font-medium text-accent">
                Showtime: {formatEventDateTime(seatData.show.startsAt)}
              </p>
            ) : eventInfo.startsAt ? (
              <p className="text-xs sm:text-sm text-ink-2">{formatEventDateTime(eventInfo.startsAt)}</p>
            ) : null}
          </div>
        )}

        <div className="p-4 sm:p-5">
          <p className="eyebrow mb-1">
            {seats.length} seat{seats.length === 1 ? '' : 's'}
          </p>
          <ul className="divide-y divide-line">
            {seats.map((seat) => (
              <li key={seat.id} className="flex items-center justify-between py-2.5 sm:py-3 text-sm">
                <div>
                  <p className="font-medium">
                    Row {seat.row}, seat {seat.number}
                  </p>
                  <p className="text-xs capitalize text-ink-3">{seat.tier.toLowerCase()}</p>
                </div>
                <span className="tabular-nums font-medium">{formatINR(seat.price)}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="flex items-baseline justify-between p-4 sm:p-5">
          <span className="text-sm text-ink-2">Total</span>
          <span className="text-2xl sm:text-3xl font-semibold tabular-nums">{formatINR(total)}</span>
        </div>

        <div className="space-y-4 p-4 sm:p-5">
          {user ? (
            <p className="text-sm text-ink-2">
              Tickets will be emailed to <span className="break-all font-medium text-ink">{user.email}</span> and saved under My
              tickets.
            </p>
          ) : (
            <p className="notice notice-warn">
              <span>
                Please{' '}
                <Link
                  className="font-semibold underline"
                  href={`/login?redirect=${encodeURIComponent(`/checkout?eventId=${eventId}`)}`}
                >
                  sign in
                </Link>{' '}
                to confirm this booking.
              </span>
            </p>
          )}

          {error && (
            <p role="alert" className="notice notice-error">
              {error}
            </p>
          )}

          <button
            type="button"
            onClick={handleConfirm}
            disabled={isSubmitting || !user}
            className="btn btn-primary w-full py-3 text-[15px]"
          >
            {isSubmitting ? 'Confirming…' : `Confirm booking · ${formatINR(total)}`}
          </button>
          <p className="text-center text-xs text-ink-3">
            This is a demo checkout. No payment is collected; confirming issues your tickets straight away.
          </p>
        </div>
      </section>
    </main>
  );
}

export default function CheckoutPage() {
  return (
    <Suspense
      fallback={
        <main className="page max-w-3xl py-12" aria-busy="true">
          <div className="skeleton h-72" />
        </main>
      }
    >
      <CheckoutContent />
    </Suspense>
  );
}
